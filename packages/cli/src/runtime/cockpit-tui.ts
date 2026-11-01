/**
 * The terminal renderer of the cockpit model (SPEC-cockpit CP6–CP8): raw keys, three tabs (now, backlog,
 * done) each with its own selection and filter, a one-line prompt for actions that take text, and a
 * full-screen frame — rows on the left, the selected row's preview on the right. Pure: keys and a model in, the next state, an effect and a frame out. Which
 * actions a row offers is the model's (CP4); keys only look them up.
 */
import { basename } from "node:path";
import { cmd, formatAge, type InboxGroup } from "@norn/core";
import type { CockpitAction, CockpitModel, CockpitRow, CockpitTab } from "@norn/view";
import { GROUP_MARK } from "./cockpit.ts";

export type Key =
  | { kind: "char"; char: string }
  | { kind: "up" | "down" | "pgup" | "pgdn" | "home" | "end" | "enter" | "esc" | "backspace" | "clear" | "scroll-down" | "quit" }
  /** the mouse wheel (SGR mouse reporting): `x` is the 1-based column under the pointer */
  | { kind: "wheel"; dir: "up" | "down"; x: number };

export type Tone = "ok" | "error" | "info";

export interface TuiState {
  /** CP7: the tab shown (`1` `2` `3`) */
  tab: CockpitTab;
  /** the selection and filter of the tabs not shown, restored when the person goes back to one */
  saved: Partial<Record<CockpitTab, { selected: string | null; filter: string }>>;
  /** id of the selected row in the shown tab; kept across refreshes (CP2) */
  selected: string | null;
  filter: string;
  /** typing into the filter (`/`) */
  filtering: boolean;
  /** CP7: an action waiting for its text */
  prompt: { row: string; action: CockpitAction["id"]; text: string } | null;
  message: { text: string; tone: Tone } | null;
  /** CP8: a shown verb's markdown (or the key list) in place of the preview */
  shown: string | null;
  /** first preview line shown (⌃d / ⌃u); back to 0 when the selection moves */
  scroll: number;
}

export type TuiEffect = { kind: "run"; row: CockpitRow; action: CockpitAction; input?: string } | { kind: "refresh" } | { kind: "quit" };

export const initialState = (): TuiState => ({ tab: "now", saved: {}, selected: null, filter: "", filtering: false, prompt: null, message: null, shown: null, scroll: 0 });

/** Raw terminal input → keys. Unknown escape sequences are dropped. */
export function parseKeys(chunk: string): Key[] {
  const keys: Key[] = [];
  for (let i = 0; i < chunk.length; ) {
    // SGR mouse: `ESC [ < button ; x ; y M|m`; 64/65 are the wheel, other buttons are ignored
    const mouse = /^\x1b\[<(\d+);(\d+);(\d+)[Mm]/.exec(chunk.slice(i));
    if (mouse) {
      const button = Number(mouse[1]) & ~(4 | 8 | 16); // without shift/alt/ctrl
      if (button === 64 || button === 65) keys.push({ kind: "wheel", dir: button === 64 ? "up" : "down", x: Number(mouse[2]) });
      i += mouse[0].length;
      continue;
    }
    const seq = /^\x1b(?:\[[0-9;]*[A-Za-z~]|O[A-Za-z])/.exec(chunk.slice(i))?.[0];
    if (seq) {
      const named: Record<string, Key["kind"]> = { A: "up", B: "down", H: "home", F: "end", "5~": "pgup", "6~": "pgdn", "1~": "home", "4~": "end" };
      const kind = named[seq.at(-1) as string] ?? named[seq.slice(2)];
      if (kind) keys.push({ kind } as Key);
      i += seq.length;
      continue;
    }
    const c = chunk[i] as string;
    i++;
    if (c === "\x1b") keys.push({ kind: "esc" });
    else if (c === "\x03") keys.push({ kind: "quit" });
    else if (c === "\x04") keys.push({ kind: "scroll-down" });
    else if (c === "\r" || c === "\n") keys.push({ kind: "enter" });
    else if (c === "\x7f" || c === "\b") keys.push({ kind: "backspace" });
    else if (c === "\x15") keys.push({ kind: "clear" });
    else if (c === "\x10") keys.push({ kind: "up" });
    else if (c === "\x0e") keys.push({ kind: "down" });
    else if (c >= " ") keys.push({ kind: "char", char: c });
  }
  return keys;
}

const GROUP_WORD: Partial<Record<InboxGroup, string>> = { your_turn: "your turn", answer: "answer", approve: "approve", unblock: "stuck", check: "check" };

/** What the filter matches for a row, lower case. */
function rowText(r: CockpitRow): string {
  return [r.group ? GROUP_WORD[r.group] : "story", r.unit, r.step ?? "", r.preview.report.unit.workflow, r.title, r.preview.report.title].join(" ").toLowerCase();
}

/** CP7: the shown tab's rows where every word of the filter appears. */
function visibleRows(model: CockpitModel, s: Pick<TuiState, "tab" | "filter">): CockpitRow[] {
  const words = s.filter.toLowerCase().split(/\s+/).filter(Boolean);
  return model.rows.filter((r) => r.tab === s.tab && words.every((w) => rowText(r).includes(w)));
}

const TABS: ReadonlyArray<{ id: CockpitTab; key: string; label: string }> = [
  { id: "now", key: "1", label: "Now" },
  { id: "backlog", key: "2", label: "Backlog" },
  { id: "done", key: "3", label: "Done" },
];

/** The list section a row is drawn under. */
function sectionOf(r: CockpitRow): string {
  if (r.kind === "item") return "NEEDS YOU";
  return r.tab === "now" ? "IN FLIGHT" : r.tab === "backlog" ? "BACKLOG" : "DONE";
}

/** What `n` matches: an item's group (the next approve), a story's section and unit status. */
const likeKey = (r: CockpitRow) => r.group ?? `${sectionOf(r)}:${standing(r)}`;

/** A story's standing word: a closed story reads done (or dropped) whatever its unit says. */
function standing(r: CockpitRow): string {
  const rep = r.preview.report;
  if (rep.story_status === "done" || rep.story_status === "dropped") return rep.story_status;
  return rep.unit.status;
}

/** The selected row: the one with the state's id among the visible rows, else the first. */
function selectedRow(model: CockpitModel, s: TuiState): CockpitRow | null {
  const rows = visibleRows(model, s);
  return rows.find((r) => r.id === s.selected) ?? rows[0] ?? null;
}

const HELP = [
  "Keys",
  "  ↑ ↓  j k        move (PgUp PgDn a page)",
  "  ⌃d ⌃u, wheel    scroll the preview (the wheel over the list moves the selection)",
  "  1 2 3           tabs: now (needs you, in flight), backlog, done",
  "  ] [             the next, the previous section",
  "  n               the next row of the same kind (the next approve)",
  "  /               filter: type words, enter keeps it, esc clears it",
  "  enter           orient: the story's workspace with an agent (or its report)",
  "  g               go to the agent's pane",
  "  s               start the agent of a manual step",
  "  a               answer the question (type it, enter sends, esc cancels)",
  "  y  x            approve the gate, or reject it with what to change",
  "  u               unstick a stuck unit",
  "  t               take an unclaimed story",
  "  v               the unit's trace",
  "  o  i            open the PR, the issue",
  "  r  ?  q         refresh, these keys, quit",
  "",
  "Each tab keeps its own selection and filter.",
  "Only the keys of the selected row's actions work; the footer lists them.",
].join("\n");

const PAGE = 10;

/** One key → the next state and what to do. Pure. */
/** Preview lines one wheel notch scrolls. */
const WHEEL_LINES = 3;

/**
 * One key → the next state and what to do. Pure. `look` places the mouse: the wheel over the preview
 * scrolls it, over the list it moves the selection (without `look`, it always scrolls the preview).
 */
export function handleKey(s: TuiState, key: Key, model: CockpitModel, look?: Look): { state: TuiState; effect?: TuiEffect } {
  if (key.kind === "quit") return { state: s, effect: { kind: "quit" } };
  if (key.kind === "wheel") {
    const overList = look ? layout(look).wide && key.x <= layout(look).listW + 1 : false;
    if (!overList) return { state: { ...s, scroll: Math.max(0, s.scroll + (key.dir === "down" ? WHEEL_LINES : -WHEEL_LINES)) } };
    if (s.prompt || s.filtering) return { state: s };
    return handleKey(s, { kind: key.dir }, model, look);
  }
  const row = selectedRow(model, s);
  // CP7: the prompt of an action that takes text
  if (s.prompt) {
    const p = s.prompt;
    if (key.kind === "esc") return { state: { ...s, prompt: null, message: { text: "cancelled", tone: "info" } } };
    if (key.kind === "backspace") return { state: { ...s, prompt: { ...p, text: p.text.slice(0, -1) } } };
    if (key.kind === "clear") return { state: { ...s, prompt: { ...p, text: "" } } };
    if (key.kind === "char") return { state: { ...s, prompt: { ...p, text: p.text + key.char } } };
    if (key.kind !== "enter") return { state: s };
    const target = model.rows.find((r) => r.id === p.row);
    const action = target?.actions.find((a) => a.id === p.action);
    if (!target || !action) return { state: { ...s, prompt: null, message: { text: "that item is gone", tone: "error" } } };
    const text = p.text.trim();
    if (!text && action.input?.required) return { state: { ...s, message: { text: `${action.input.prompt}: type something first`, tone: "error" } } };
    return { state: { ...s, prompt: null, message: null }, effect: { kind: "run", row: target, action, input: text } };
  }
  // the filter line
  if (s.filtering) {
    if (key.kind === "esc") return { state: { ...s, filtering: false, filter: "", selected: null } };
    if (key.kind === "enter") return { state: { ...s, filtering: false } };
    if (key.kind === "backspace") return { state: { ...s, filter: s.filter.slice(0, -1), selected: null } };
    if (key.kind === "clear") return { state: { ...s, filter: "", selected: null } };
    if (key.kind === "char") return { state: { ...s, filter: s.filter + key.char, selected: null } };
  }
  const rows = visibleRows(model, s);
  const at = Math.max(0, rows.findIndex((r) => r.id === row?.id));
  const move = (to: number) => ({ state: { ...s, selected: rows[Math.max(0, Math.min(rows.length - 1, to))]?.id ?? null, shown: null, message: null, scroll: 0 } });
  switch (key.kind) {
    case "up":
      return move(at - 1);
    case "down":
      return move(at + 1);
    case "pgup":
      return move(at - PAGE);
    case "pgdn":
      return move(at + PAGE);
    case "home":
      return move(0);
    case "end":
      return move(rows.length - 1);
    // ⌃d / ⌃u: half a screen of preview (renderCockpit keeps it in range)
    case "scroll-down":
      return { state: { ...s, scroll: s.scroll + PAGE } };
    case "clear":
      return { state: { ...s, scroll: Math.max(0, s.scroll - PAGE) } };
    case "esc":
      if (s.shown) return { state: { ...s, shown: null, scroll: 0 } };
      if (s.filter) return { state: { ...s, filter: "", selected: row?.id ?? null } };
      return { state: s, effect: { kind: "quit" } };
    default:
      break;
  }
  const name = key.kind === "enter" ? "enter" : key.kind === "char" ? key.char : null;
  if (name === "j") return move(at + 1);
  if (name === "k") return move(at - 1);
  if (name === "/") return { state: { ...s, filtering: true, message: null } };
  const tab = TABS.find((t) => t.key === name);
  if (tab) {
    if (tab.id === s.tab) return { state: s };
    const back = s.saved[tab.id] ?? { selected: null, filter: "" };
    return { state: { ...s, tab: tab.id, saved: { ...s.saved, [s.tab]: { selected: s.selected, filter: s.filter } }, ...back, shown: null, message: null, scroll: 0 } };
  }
  // ] [: the first row of the next or previous section
  if ((name === "]" || name === "[") && row) {
    const sections = [...new Set(rows.map(sectionOf))];
    const to = sections[sections.indexOf(sectionOf(row)) + (name === "]" ? 1 : -1)];
    return to ? move(rows.findIndex((r) => sectionOf(r) === to)) : { state: { ...s, message: { text: `no ${name === "]" ? "next" : "previous"} section`, tone: "info" } } };
  }
  // n: the next row of the same kind, round to the top
  if (name === "n" && row) {
    const like = [...rows.slice(at + 1), ...rows.slice(0, at)].find((r) => likeKey(r) === likeKey(row));
    return like ? move(rows.indexOf(like)) : { state: { ...s, message: { text: "no other row like this one", tone: "info" } } };
  }
  if (name === "q") return { state: s, effect: { kind: "quit" } };
  if (name === "r") return { state: { ...s, message: null }, effect: { kind: "refresh" } };
  if (name === "?") return { state: { ...s, shown: HELP, scroll: 0 } };
  if (!name) return { state: s };
  if (!row) return { state: { ...s, message: { text: s.filter ? "no row matches the filter" : "nothing to act on", tone: "error" } } };
  const action = row.actions.find((a) => a.key === name);
  if (!action) {
    const known = HELP.includes(`  ${name} `) || /^[gsayxutvoi]$/.test(name);
    return { state: { ...s, message: { text: known ? `no ${name} here: ${row.unit} offers ${row.actions.map((a) => `${a.key} ${a.label}`).join(", ")}` : `unknown key ${name} — ? lists the keys`, tone: "error" } } };
  }
  if (action.input) return { state: { ...s, selected: row.id, prompt: { row: row.id, action: action.id, text: "" }, message: null } };
  return { state: { ...s, selected: row.id, message: null }, effect: { kind: "run", row, action } };
}

// ------------------------------------------------------------------ frame

export interface Look {
  width: number;
  height: number;
  color: boolean;
  /** ms epoch, for ages in the preview */
  now: number;
  /** local time of day for the header */
  clock: string;
  /** the running norn's version (`NORN_VERSION`), for the header */
  version?: string;
}

const STYLE = { bold: "1", dim: "2", inverse: "7", red: "31", green: "32", yellow: "33", blue: "34", magenta: "35", cyan: "36" } as const;
type Style = keyof typeof STYLE;
const GROUP_STYLE: Partial<Record<InboxGroup, Style[]>> = { your_turn: ["bold", "green"], answer: ["bold", "yellow"], approve: ["bold", "cyan"], unblock: ["bold", "red"], check: ["magenta"] };
const TONE: Record<Tone, Style[]> = { ok: ["green"], error: ["red"], info: ["dim"] };

const visible = (s: string) => s.replace(/\x1b\[[0-9;]*m/g, "").length;

/** Cut `s` to `n` columns with an ellipsis (one line). */
export function fit(s: string, n: number): string {
  if (n <= 0) return "";
  const one = s.replace(/\s+/g, " ").trim();
  return one.length <= n ? one : `${one.slice(0, Math.max(0, n - 1))}…`;
}

/** Wrap one line to `n` columns at spaces, keeping its indent. */
export function wrap(line: string, n: number): string[] {
  if (n <= 0) return [];
  if (line.length <= n) return [line];
  const indent = /^\s*/.exec(line)?.[0] ?? "";
  const out: string[] = [];
  let rest = line;
  while (rest.length > n) {
    let cut = rest.lastIndexOf(" ", n);
    if (cut <= indent.length) cut = n;
    out.push(rest.slice(0, cut));
    rest = indent + rest.slice(cut).trimStart();
  }
  if (rest.trim()) out.push(rest);
  return out;
}

type Paint = (text: string, styles?: readonly Style[]) => string;

/** Lines of an item's full text the preview shows. */
const FULL_LINES = 12;

/** An item's detail or full text without its open-notes part (`… · open notes (…): …`, `Open notes (…):` and below). */
export function withoutNotes(text: string): string {
  const at = text.search(/(^|\n|\s·\s)open notes\b/i);
  return (at < 0 ? text : text.slice(0, at)).trimEnd();
}

/** A unit's mark and its colour: ✓ done, ◐ running, ● parked, ✖ stuck, ○ ready, · not started. */
function unitMark(status: string): [string, Style[]] {
  if (status === "done") return ["✓", ["green"]];
  if (status === "running") return ["◐", ["cyan"]];
  if (status === "parked") return ["●", ["yellow"]];
  if (status === "stuck" || status === "corrupt") return ["✖", ["red"]];
  if (status === "ready") return ["○", ["blue"]];
  return ["·", ["dim"]];
}

/** `text` wrapped to `width`: the first line after `first`, the rest after `rest` (a hanging indent). */
function hang(text: string, width: number, first: string, rest: string, max = Number.POSITIVE_INFINITY): string[] {
  const lines = wrap(text.replace(/\s+/g, " ").trim(), Math.max(10, width - rest.length));
  const cut = lines.length > max ? [...lines.slice(0, max - 1), fit(lines.slice(max - 1).join(" "), width - rest.length)] : lines;
  return cut.map((l, i) => `${i === 0 ? first : rest}${l}`);
}

/**
 * CP3: the preview, styled, for a column `width` wide — the story, its slices one line each, the PR,
 * the selected item, what waits and runs, and the open notes by unit. Lines never exceed `width`.
 */
export function previewLines(row: CockpitRow, now: number, width: number, paint: Paint = (t) => t): string[] {
  const r = row.preview.report;
  const head = (t: string) => paint(t, ["bold", "dim"]);
  const label = (t: string) => paint(t.padEnd(8), ["dim"]);
  const out: string[] = [paint(fit(`${r.story} — ${r.title}`, width), ["bold"])];
  const status = standing(row);
  const [mark, markStyle] = unitMark(status === "dropped" ? "done" : status);
  const where = status === "done" || status === "dropped" ? status : status === "not_started" ? "not started" : `${status}${r.unit.step ? ` at ${r.unit.step}` : ""}`;
  // RD8, gh-71 B28 (D10): the round and its workflow before the step, as `story view` writes them
  const round = r.unit.round ? `round ${r.unit.round} · ` : "";
  out.push(`${paint(mark, markStyle)} ${fit(`${round}${r.unit.workflow} · ${where} · ${r.mode} · ${r.claim}`, width - 2)}`);
  if (r.unit.last_outcome) out.push(paint(fit(`  last: ${r.unit.last_outcome.step} → ${r.unit.last_outcome.outcome}`, width), ["dim"]));

  if (r.slices.length) {
    const done = r.slices.filter((x) => x.status === "done").length;
    out.push("", `${head("SLICES")} ${paint(`${done}/${r.slices.length} done`, done === r.slices.length ? ["green"] : ["dim"])}`);
    for (const x of r.slices) {
      const [m, ms] = unitMark(x.status);
      const nn = x.key.split("/")[1] ?? x.key;
      const tail = x.status === "done" ? "" : `  ${x.status === "not_started" ? "not started" : `${x.status} ${x.step ?? ""}`.trim()}`;
      out.push(`${paint(m, ms)} ${paint(nn, ["dim"])}  ${fit(x.title, width - 6 - tail.length)}${paint(tail, ["dim"])}`);
    }
  }

  out.push("", head("LINKS"));
  if (r.pr) {
    const state = r.pr.is_draft && r.pr.state === "open" ? "draft · open" : r.pr.state;
    out.push(`${label("PR")}#${r.pr.number} ${state} ${paint(`· seen ${formatAge(now - Date.parse(r.pr.seen_at))} ago`, ["dim"])}`);
    out.push(`${" ".repeat(8)}${paint(fit(r.pr.url, width - 8), ["blue"])}`);
  } else out.push(`${label("PR")}${paint("none seen yet", ["dim"])}`);
  if (r.url) out.push(`${label("issue")}${paint(fit(r.url, width - 8), ["blue"])}`);

  const it = row.preview.item;
  if (it && row.group) {
    out.push("", `${paint(GROUP_MARK[row.group] ?? "·", GROUP_STYLE[row.group] ?? [])} ${head((GROUP_WORD[row.group] ?? row.group).toUpperCase())} ${paint(`${row.unit}${row.step ? ` · ${row.step}` : ""}`, ["dim"])}`);
    out.push(...hang(it.title, width, "", ""));
    // a gate's detail and full text repeat its open notes: those show under NOTES, so they end here
    const detail = it.detail ? withoutNotes(it.detail) : "";
    if (detail) out.push(...hang(detail, width, "", "", 2).map((l) => paint(l, ["dim"])));
    const full = it.full ? withoutNotes(it.full).split("\n").flatMap((l) => wrap(l, width)) : [];
    out.push(...full.slice(0, FULL_LINES).map((l) => paint(l, ["dim"])));
    if (full.length > FULL_LINES) out.push(paint(`… ${full.length - FULL_LINES} more lines: v shows the trace`, ["dim"]));
    out.push(paint(fit(`$ ${it.command}`, width), ["cyan"]));
  }

  const waiting = r.waiting.filter((w) => !it || w.command !== it.command);
  if (waiting.length || r.running.length) {
    out.push("", head(waiting.length ? "ALSO WAITS FOR YOU" : "RUNNING"));
    for (const w of waiting) out.push(`${paint(GROUP_MARK[w.group] ?? "·", GROUP_STYLE[w.group] ?? [])} ${fit(`${w.unit}${w.step ? ` ${w.step}` : ""}`, 18).padEnd(18)} ${paint(fit(w.command, width - 21), ["cyan"])}`);
    if (waiting.length && r.running.length) out.push("", head("RUNNING"));
    for (const w of r.running) out.push(`${paint(GROUP_MARK.running ?? "◐", ["cyan"])} ${fit(`${w.unit}${w.step ? ` ${w.step}` : ""} · ${w.age}`, width - 2)}`);
  }

  out.push("", `${head("NOTES")} ${paint(r.note_count ? `${r.note_count} open, no action needed` : "none open", ["dim"])}`);
  for (const g of r.notes) {
    out.push(paint(`${g.unit} (${g.notes.length})`, ["bold"]));
    for (const n of g.notes) {
      const tag = `[${n.step}${n.criterion ? ` · ${n.criterion}` : ""}] `;
      out.push(...hang(`${tag}${n.text}`, width, "• ", "  ").map((l, i) => (i === 0 ? l.replace(tag, paint(tag, ["dim"])) : l)));
    }
  }
  return out;
}

/** A story row's workflow and standing (RD8), then its slices and PR when it has them. */
function storySummary(r: CockpitRow): string {
  const rep = r.preview.report;
  const done = rep.slices.filter((s) => s.status === "done").length;
  const status = standing(r);
  const where = status === "done" || status === "dropped" ? status : status === "not_started" ? "not started" : `${status} ${rep.unit.step ?? ""}`.trim();
  const slices = rep.slices.length ? `${done}/${rep.slices.length} slices` : "";
  const pr = rep.pr ? `PR #${rep.pr.number}${rep.pr.is_draft && rep.pr.state === "open" ? " draft" : rep.pr.state === "open" ? "" : ` ${rep.pr.state}`}` : "";
  return [rep.unit.workflow, where, slices, pr].filter(Boolean).join(" · ");
}

/** The body's geometry for a frame: list and preview widths and heights. */
function layout(o: Look) {
  const width = Math.max(40, o.width);
  const height = Math.max(10, o.height);
  // header 3, footer 3, the log's newline 1
  const bodyH = height - 7;
  const wide = width >= 100;
  const listW = wide ? Math.max(64, Math.floor(width * 0.6)) : width;
  const prevW = wide ? width - listW - 3 : width;
  const listH = wide ? bodyH : Math.max(3, Math.floor(bodyH / 2));
  const prevH = wide ? bodyH : bodyH - listH - 1;
  return { width, height, bodyH, wide, listW, prevW, listH, prevH };
}

/** The preview's lines for the state (a shown verb, the key list, or the selected row's story). */
function previewOf(model: CockpitModel, s: TuiState, o: Look, paint?: Paint): string[] {
  const { prevW } = layout(o);
  const sel = selectedRow(model, s);
  return s.shown ? s.shown.split("\n").flatMap((l) => wrap(l, prevW)) : sel ? previewLines(sel, o.now, prevW, paint) : [];
}

/** ⌃d / ⌃u: the state with its preview scroll kept within what the preview holds. */
export function clampScroll(model: CockpitModel, s: TuiState, o: Look): TuiState {
  const max = Math.max(0, previewOf(model, s, o).length - layout(o).prevH);
  return s.scroll > max ? { ...s, scroll: max } : s;
}

const EMPTY: Record<CockpitTab, string> = { now: "nothing needs you, nothing in flight", backlog: "no story waits to start", done: "no story closed yet" };

/** The tab strip: each tab's key, name and count, the shown one inverse; Now counts what needs you and what is in flight. */
function tabStrip(model: CockpitModel, tab: CockpitTab, width: number, paint: Paint): string {
  const strip = TABS.map((t) => {
    const rows = model.rows.filter((r) => r.tab === t.id);
    const need = rows.filter((r) => r.kind === "item").length;
    const count = t.id === "now" ? `${need} need${need === 1 ? "s" : ""} you · ${rows.length - need} in flight` : String(rows.length);
    return paint(` ${t.key} ${t.label} ${count} `, t.id === tab ? ["inverse", "bold"] : ["dim"]);
  }).join(paint("│", ["dim"]));
  return visible(strip) > width ? fit(strip.replace(/\x1b\[[0-9;]*m/g, ""), width) : strip;
}

export function renderCockpit(model: CockpitModel, s: TuiState, o: Look): string {
  const paint = (t: string, styles: readonly Style[] = []) => (o.color && styles.length && t ? `\x1b[${styles.map((k) => STYLE[k]).join(";")}m${t}\x1b[0m` : t);
  const { width, bodyH, wide, listW, prevW, listH, prevH } = layout(o);
  const rule = paint("─".repeat(width), ["dim"]);
  const rows = visibleRows(model, s);
  const sel = selectedRow(model, s);

  // header: the version, the repo and what needs you across it; the filter in front while in use
  const hb = model.header.heartbeat;
  const pending = model.header.pending;
  const filter = s.filtering ? `${paint("/", ["bold", "cyan"])} ${s.filter}${paint("▏", ["dim"])}   ` : s.filter ? `${paint("filter:", ["dim"])} ${s.filter} ${paint("(esc clears)", ["dim"])}   ` : "";
  const left = `${filter}${paint(o.version ? `norn ${o.version}` : "norn", ["bold"])} ${paint("·", ["dim"])} ${basename(model.header.repo)}  ${pending ? paint(`${pending} need${pending === 1 ? "s" : ""} you`, ["bold", "yellow"]) : paint("nothing needs you", ["green"])}`;
  const right = `${hb.down ? paint(`no heartbeat${hb.age ? ` for ${hb.age}` : ""} — ${cmd.watch()}`, ["red"]) : paint(hb.age ? `tick ${hb.age} ago` : "no tick yet", ["dim"])}  ${paint(o.clock, ["dim"])}`;
  const header = `${left}${" ".repeat(Math.max(2, width - visible(left) - visible(right)))}${right}`;
  const out = [visible(header) > width ? fit(header.replace(/\x1b\[[0-9;]*m/g, ""), width) : header];
  out.push(tabStrip(model, s.tab, width, paint));
  out.push(rule);

  // body: list | preview (preview below when narrow)
  const items = rows.filter((r) => r.kind === "item");
  const stories = rows.filter((r) => r.kind === "story");
  const w = (f: (r: CockpitRow) => string, max: number) => Math.min(max, Math.max(0, ...items.map((r) => f(r).length)));
  const unitW = Math.max(w((r) => r.unit, 10), Math.min(10, Math.max(0, ...rows.map((r) => r.unit.length))));
  const stepW = w((r) => r.step ?? "", 12);
  const summaryW = Math.min(36, Math.max(0, ...stories.map((r) => storySummary(r).length)));
  const titleW = Math.min(Math.max(0, ...stories.map((r) => r.title.length)), Math.max(16, listW - 2 - unitW - 2 - summaryW - 2));
  const line = (r: CockpitRow, room: number): string => {
    if (r.kind === "story") {
      const head = `${fit(r.unit, unitW).padEnd(unitW)}  ${fit(r.title, titleW).padEnd(titleW)}  `;
      return `${head}${fit(storySummary(r), room - head.length)}`;
    }
    // what the story is; the item's instruction stays in the preview
    const g = r.group as InboxGroup;
    const head = `${GROUP_MARK[g] ?? "·"} ${fit(r.unit, unitW).padEnd(unitW)}  ${fit(r.step ?? "", stepW).padEnd(stepW)}  `;
    const age = r.age ?? "";
    const t = fit(r.preview.report.title, Math.max(0, room - head.length - age.length - 2));
    return `${head}${t}${" ".repeat(Math.max(2, room - head.length - t.length - age.length))}${age}`;
  };
  const counts = new Map<string, number>();
  for (const r of rows) counts.set(sectionOf(r), (counts.get(sectionOf(r)) ?? 0) + 1);
  const list: Array<{ text: string; row?: CockpitRow }> = [];
  let section: string | null = null;
  for (const r of rows) {
    if (sectionOf(r) !== section) list.push({ text: `${paint(sectionOf(r), ["bold", "dim"])} ${paint(String(counts.get(sectionOf(r))), ["dim"])}` });
    section = sectionOf(r);
    list.push({ text: "", row: r });
  }
  if (!rows.length) list.push({ text: paint(s.filter ? "  no row matches the filter" : `  ${EMPTY[s.tab]}`, ["dim"]) });
  const selAt = Math.max(0, list.findIndex((l) => l.row && l.row.id === sel?.id));
  const start = Math.max(0, Math.min(selAt - Math.floor(listH / 2), list.length - listH));
  const listLines = list.slice(start, start + listH).map((l) => {
    if (!l.row) return l.text;
    const text = line(l.row, listW - 2);
    if (l.row.id === sel?.id) return paint(`▸ ${text}`.padEnd(listW), ["inverse"]);
    return `  ${l.row.kind === "item" ? paint(text, GROUP_STYLE[l.row.group as InboxGroup] ?? []) : text}`;
  });
  const all = previewOf(model, s, o, paint);
  // ⌃d / ⌃u scroll the preview; the footer says so when it does not fit
  const scroll = Math.max(0, Math.min(s.scroll, all.length - prevH));
  const previewStyled = all.slice(scroll, scroll + prevH);
  const overflow = all.length > prevH;
  if (wide) {
    for (let i = 0; i < bodyH; i++) {
      const l = listLines[i] ?? "";
      out.push(`${l}${" ".repeat(Math.max(0, listW - visible(l)))} ${paint("│", ["dim"])} ${previewStyled[i] ?? ""}`);
    }
  } else {
    for (let i = 0; i < listH; i++) out.push(listLines[i] ?? "");
    out.push(rule);
    for (let i = 0; i < bodyH - listH - 1; i++) out.push(previewStyled[i] ?? "");
  }

  // footer: the message or prompt, then the selected row's keys
  out.push(rule);
  if (s.prompt) {
    const target = model.rows.find((r) => r.id === s.prompt?.row);
    const a = target?.actions.find((x) => x.id === s.prompt?.action);
    out.push(`${paint(`${a?.input?.prompt ?? "Text"} (${a?.label ?? "?"} ${target?.unit ?? ""}):`, ["bold", "yellow"])} ${s.prompt.text}${paint("▏", ["dim"])}`);
  } else out.push(s.message ? paint(fit(s.message.text, width), TONE[s.message.tone]) : "");
  const keys = [...(sel?.actions.map((a) => `${paint(a.key, ["bold"])} ${paint(a.label, ["dim"])}`) ?? []), ...(overflow ? [`${paint("⌃d/⌃u", ["bold"])} ${paint("scroll", ["dim"])}`] : []), `${paint("1 2 3", ["bold"])} ${paint("tabs", ["dim"])}`, `${paint("/", ["bold"])} ${paint("filter", ["dim"])}`, `${paint("?", ["bold"])} ${paint("keys", ["dim"])}`, `${paint("q", ["bold"])} ${paint("quit", ["dim"])}`];
  const footer = s.prompt ? paint("enter sends · esc cancels", ["dim"]) : keys.join(paint(" · ", ["dim"]));
  out.push(visible(footer) > width ? fit(footer.replace(/\x1b\[[0-9;]*m/g, ""), width) : footer);
  return out.join("\n");
}
