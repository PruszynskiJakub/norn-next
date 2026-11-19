/**
 * The terminal renderer of the cockpit model: raw keys, three tabs (now, backlog, done) each with its
 * own selection and filter, a one-line prompt for actions that take text, and a full-screen frame:
 * rows on the left, the selected row's preview on the right. Pure: keys and a model in, the next
 * state, an effect and a frame out. Which actions a row offers is the model's; keys only look them up.
 */
import { basename } from "node:path";
import { unitLine, type UnitView } from "../views.ts";
import { type CockpitGroup, GROUP_MARK, GROUP_WORD } from "./groups.ts";
import type { CockpitAction, CockpitModel, CockpitRow, CockpitTab } from "./model.ts";

export type Key =
  | { kind: "char"; char: string }
  | { kind: "up" | "down" | "pgup" | "pgdn" | "home" | "end" | "enter" | "esc" | "backspace" | "clear" | "scroll-down" | "quit" }
  /** the mouse wheel (SGR mouse reporting): `x` is the 1-based column under the pointer */
  | { kind: "wheel"; dir: "up" | "down"; x: number };

export type Tone = "ok" | "error" | "info";

export interface TuiState {
  tab: CockpitTab;
  /** the selection and filter of the tabs not shown, restored when the person goes back to one */
  saved: Partial<Record<CockpitTab, { selected: string | null; filter: string }>>;
  /** id of the selected row in the shown tab; kept across refreshes */
  selected: string | null;
  filter: string;
  /** typing into the filter (`/`) */
  filtering: boolean;
  /** an action waiting for its text */
  prompt: { row: string; action: CockpitAction["id"]; text: string } | null;
  message: { text: string; tone: Tone } | null;
  /** a shown command's markdown (or the key list) in place of the preview */
  shown: string | null;
  /** first preview line shown; back to 0 when the selection moves */
  scroll: number;
}

export type TuiEffect = { kind: "run"; row: CockpitRow; action: CockpitAction; input?: string } | { kind: "refresh" } | { kind: "quit" };

export const initialState = (): TuiState => ({ tab: "now", saved: {}, selected: null, filter: "", filtering: false, prompt: null, message: null, shown: null, scroll: 0 });

/** Raw terminal input as keys. Unknown escape sequences are dropped. */
export function parseKeys(chunk: string): Key[] {
  const keys: Key[] = [];
  for (let i = 0; i < chunk.length; ) {
    // SGR mouse: `ESC [ < button; x; y M|m`; 64/65 are the wheel, other buttons are ignored
    const mouse = /^\x1b\[<(\d+);(\d+);(\d+)[Mm]/.exec(chunk.slice(i));
    if (mouse) {
      const button = Number(mouse[1]) & ~(4 | 8 | 16);
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

/** What the filter matches for a row, lower case. */
function rowText(r: CockpitRow): string {
  return [r.group ? GROUP_WORD[r.group] : r.kind, r.unit, r.step ?? "", r.title, r.text ?? ""].join(" ").toLowerCase();
}

/** The shown tab's rows where every word of the filter appears. */
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
  if (r.kind === "intake") return "INTAKE";
  return r.tab === "now" ? "IN FLIGHT" : "DONE";
}

/** What `n` matches: an item's group (the next approve), a story's section. */
const likeKey = (r: CockpitRow) => r.group ?? sectionOf(r);

/** The selected row: the one with the state's id among the visible rows, else the first. */
function selectedRow(model: CockpitModel, s: TuiState): CockpitRow | null {
  const rows = visibleRows(model, s);
  return rows.find((r) => r.id === s.selected) ?? rows[0] ?? null;
}

const HELP = [
  "Keys",
  "  ↑ ↓  j k        move (PgUp PgDn a page)",
  "  ⌃d ⌃u, wheel    scroll the preview (the wheel over the list moves the selection)",
  "  1 2 3           tabs: now (needs you, in flight), backlog (intake), done",
  "  ] [             the next, the previous section",
  "  n               the next row of the same kind (the next approve)",
  "  /               filter: type words, enter keeps it, esc clears it",
  "  enter           the story in full (norn story view), in place of the preview",
  "  g               go to the agent's pane (norn run attach)",
  "  s               start the agent of a manual or attended step (norn run start)",
  "  a               answer the question or the pane's prompt (norn story answer)",
  "  y  x            approve the gate, or reject it with what to change (norn story approve, reject)",
  "  u               run a stuck unit's step again (norn run rerun)",
  "  t               take a story another machine holds (norn story take)",
  "  o  i            open the PR, the issue",
  "  r  ?  q         refresh, these keys, quit",
  "",
  "Each tab keeps its own selection and filter.",
  "Only the keys of the selected row's actions work; the footer lists them.",
].join("\n");

const PAGE = 10;
/** Preview lines one wheel notch scrolls. */
const WHEEL_LINES = 3;

/**
 * One key: the next state and what to do. `look` places the mouse: the wheel over the preview
 * scrolls it, over the list it moves the selection.
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
  if ((name === "]" || name === "[") && row) {
    const sections = [...new Set(rows.map(sectionOf))];
    const to = sections[sections.indexOf(sectionOf(row)) + (name === "]" ? 1 : -1)];
    return to ? move(rows.findIndex((r) => sectionOf(r) === to)) : { state: { ...s, message: { text: `no ${name === "]" ? "next" : "previous"} section`, tone: "info" } } };
  }
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
    const known = /^[gsayxutoi]$/.test(name) || name === "enter";
    const offers = row.actions.map((a) => `${a.key} ${a.label}`).join(", ") || "nothing";
    return { state: { ...s, message: { text: known ? `no ${name} here: ${row.unit} offers ${offers}` : `unknown key ${name} — ? lists the keys`, tone: "error" } } };
  }
  if (action.input) return { state: { ...s, selected: row.id, prompt: { row: row.id, action: action.id, text: "" }, message: null } };
  return { state: { ...s, selected: row.id, message: null }, effect: { kind: "run", row, action } };
}

export interface Look {
  width: number;
  height: number;
  color: boolean;
  /** local time of day for the header */
  clock: string;
  /** the running norn's version, for the header */
  version?: string;
}

const STYLE = { bold: "1", dim: "2", inverse: "7", red: "31", green: "32", yellow: "33", blue: "34", magenta: "35", cyan: "36" } as const;
type Style = keyof typeof STYLE;
const GROUP_STYLE: Readonly<Record<CockpitGroup, Style[]>> = { your_turn: ["bold", "green"], answer: ["bold", "yellow"], approve: ["bold", "cyan"], unblock: ["bold", "red"], running: ["cyan"] };
const TONE: Record<Tone, Style[]> = { ok: ["green"], error: ["red"], info: ["dim"] };

const ANSI = /\x1b\[[0-9;]*m/g;
const visible = (s: string) => s.replace(ANSI, "").length;

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

/** A unit's mark and its colour: ✓ done, ✖ stuck, ● waits for you, ◐ runs, · not started, ○ otherwise. */
function unitMark(u: UnitView): [string, Style[]] {
  if (u.ended === "done") return ["✓", ["green"]];
  if (u.ended !== undefined || u.corrupt !== undefined) return ["✖", ["red"]];
  if (u.waiting) return ["●", ["yellow"]];
  if (u.run) return ["◐", ["cyan"]];
  if (!u.step) return ["·", ["dim"]];
  return ["○", ["blue"]];
}

/** `text` wrapped to `width` with a hanging indent. */
function hang(text: string, width: number, first: string, rest: string): string[] {
  return wrap(text.replace(/\s+/g, " ").trim(), Math.max(10, width - rest.length)).map((l, i) => `${i === 0 ? first : rest}${l}`);
}

/**
 * The preview, styled, for a column `width` wide: the story, its units one line each, its links, the
 * selected item with the command that resolves it, and the open notes. Lines never exceed `width`.
 */
export function previewLines(model: CockpitModel, row: CockpitRow, width: number, paint: Paint = (t) => t): string[] {
  const head = (t: string) => paint(t, ["bold", "dim"]);
  const label = (t: string) => paint(t.padEnd(8), ["dim"]);
  const out: string[] = [paint(fit(`${row.story} — ${row.title}`, width), ["bold"])];
  const s = model.stories[row.story];
  if (!s) {
    const i = model.intake[row.story];
    out.push(`${paint("·", ["dim"])} ${fit("intake: the next tick takes it in as a story", width - 2)}`);
    if (i?.url) out.push("", head("LINKS"), `${label("issue")}${paint(fit(i.url, width - 8), ["blue"])}`);
    return out;
  }
  const claim = s.claim ? `claimed by ${s.claim.holder}` : "unclaimed";
  out.push(paint(fit(`${claim}${s.change ? ` · change #${s.change.id} ${s.change.state}` : ""}`, width), ["dim"]));
  if (s.units.length) {
    const done = s.units.filter((u) => u.ended === "done").length;
    out.push("", `${head("UNITS")} ${paint(`${done}/${s.units.length} done`, done === s.units.length ? ["green"] : ["dim"])}`);
    for (const u of s.units) {
      const [m, ms] = unitMark(u);
      out.push(`${paint(m, ms)} ${fit(unitLine(u).replace(/ — waits for .*$/, ""), width - 2)}`);
    }
  }
  out.push("", head("LINKS"));
  out.push(s.change?.url ? `${label("PR")}${paint(fit(s.change.url, width - 8), ["blue"])}` : `${label("PR")}${paint("none seen", ["dim"])}`);
  if (s.url) out.push(`${label("issue")}${paint(fit(s.url, width - 8), ["blue"])}`);
  if (row.group && row.text) {
    out.push("", `${paint(GROUP_MARK[row.group], GROUP_STYLE[row.group])} ${head(GROUP_WORD[row.group].toUpperCase())} ${paint(`${row.unit}${row.step ? ` · ${row.step}` : ""}`, ["dim"])}`);
    out.push(...hang(row.text, width, "", ""));
    if (row.command) out.push(...hang(`$ ${row.command}`, width, "", "  ").map((l) => paint(l, ["cyan"])));
  }
  const notes = model.notes.filter((n) => n.unit === row.story || n.unit.startsWith(`${row.story}/`));
  out.push("", `${head("NOTES")} ${paint(notes.length ? `${notes.length} open, read them before approving` : "none open", ["dim"])}`);
  for (const n of notes) {
    const tag = `[${n.unit}${n.step ? ` · ${n.step}` : ""}${n.criterion ? ` · ${n.criterion}` : ""}] `;
    out.push(...hang(`${tag}${n.text}`, width, "• ", "  ").map((l, i) => (i === 0 ? l.replace(tag, paint(tag, ["dim"])) : l)));
  }
  if (model.header.problems.length && row.kind !== "intake") {
    out.push("", head("PROBLEMS"));
    for (const p of model.header.problems) out.push(...hang(p, width, "! ", "  ").map((l) => paint(l, ["red"])));
  }
  return out;
}

/** A story row's standing in a few words: the step its own unit is at, what runs, its change. */
function storySummary(model: CockpitModel, r: CockpitRow): string {
  const s = model.stories[r.story];
  if (!s) return "intake";
  const own = s.units.find((u) => u.id === s.key);
  const running = s.units.filter((u) => u.run && u.ended === undefined).length;
  const where = !own?.step ? "not started" : own.ended === "done" ? "done" : own.step;
  const change = s.change ? `PR #${s.change.id}${s.change.state === "open" ? "" : ` ${s.change.state}`}` : "";
  return [where, running ? `${GROUP_MARK.running} ${running} running` : "", change].filter(Boolean).join(" · ");
}

/** The body's geometry for a frame: list and preview widths and heights. */
function layout(o: Look) {
  const width = Math.max(40, o.width);
  const height = Math.max(10, o.height);
  // header 3, footer 3, the log's newline 1
  const bodyH = height - 7;
  const wide = width >= 100;
  const listW = wide ? Math.max(56, Math.floor(width * 0.55)) : width;
  const prevW = wide ? width - listW - 3 : width;
  const listH = wide ? bodyH : Math.max(3, Math.floor(bodyH / 2));
  const prevH = wide ? bodyH : bodyH - listH - 1;
  return { width, height, bodyH, wide, listW, prevW, listH, prevH };
}

function previewOf(model: CockpitModel, s: TuiState, o: Look, paint?: Paint): string[] {
  const { prevW } = layout(o);
  const sel = selectedRow(model, s);
  return s.shown ? s.shown.split("\n").flatMap((l) => wrap(l, prevW)) : sel ? previewLines(model, sel, prevW, paint) : [];
}

/** The state with its preview scroll kept within what the preview holds. */
export function clampScroll(model: CockpitModel, s: TuiState, o: Look): TuiState {
  const max = Math.max(0, previewOf(model, s, o).length - layout(o).prevH);
  return s.scroll > max ? { ...s, scroll: max } : s;
}

const EMPTY: Record<CockpitTab, string> = { now: "nothing needs you, nothing in flight", backlog: "no intake waits to be taken in", done: "no story finished yet" };

function tabStrip(model: CockpitModel, tab: CockpitTab, width: number, paint: Paint): string {
  const strip = TABS.map((t) => {
    const rows = model.rows.filter((r) => r.tab === t.id);
    const need = rows.filter((r) => r.kind === "item").length;
    const count = t.id === "now" ? `${need} need${need === 1 ? "s" : ""} you · ${rows.length - need} in flight` : String(rows.length);
    return paint(` ${t.key} ${t.label} ${count} `, t.id === tab ? ["inverse", "bold"] : ["dim"]);
  }).join(paint("│", ["dim"]));
  return visible(strip) > width ? fit(strip.replace(ANSI, ""), width) : strip;
}

export function renderCockpit(model: CockpitModel, s: TuiState, o: Look): string {
  const paint: Paint = (t, styles = []) => (o.color && styles.length && t ? `\x1b[${styles.map((k) => STYLE[k]).join(";")}m${t}\x1b[0m` : t);
  const { width, bodyH, wide, listW, listH, prevH } = layout(o);
  const rule = paint("─".repeat(width), ["dim"]);
  const rows = visibleRows(model, s);
  const sel = selectedRow(model, s);

  const pending = model.header.pending;
  const filter = s.filtering ? `${paint("/", ["bold", "cyan"])} ${s.filter}${paint("▏", ["dim"])}   ` : s.filter ? `${paint("filter:", ["dim"])} ${s.filter} ${paint("(esc clears)", ["dim"])}   ` : "";
  const left = `${filter}${paint(o.version ? `norn ${o.version}` : "norn", ["bold"])} ${paint("·", ["dim"])} ${basename(model.header.repo)}  ${pending ? paint(`${pending} need${pending === 1 ? "s" : ""} you`, ["bold", "yellow"]) : paint("nothing needs you", ["green"])}`;
  const problems = model.header.problems.length;
  const right = `${problems ? paint(`! ${problems} problem${problems === 1 ? "" : "s"}`, ["red"]) : ""}  ${paint(o.clock, ["dim"])}`;
  const header = `${left}${" ".repeat(Math.max(2, width - visible(left) - visible(right)))}${right}`;
  const out = [visible(header) > width ? fit(header.replace(ANSI, ""), width) : header];
  out.push(tabStrip(model, s.tab, width, paint));
  out.push(rule);

  const items = rows.filter((r) => r.kind === "item");
  const unitW = Math.min(12, Math.max(0, ...rows.map((r) => r.unit.length)));
  const stepW = Math.min(14, Math.max(0, ...items.map((r) => (r.step ?? "").length)));
  const line = (r: CockpitRow, room: number): string => {
    if (r.kind !== "item") {
      const summary = storySummary(model, r);
      const head = `${fit(r.unit, unitW).padEnd(unitW)}  `;
      const t = fit(r.title, Math.max(8, room - head.length - summary.length - 2));
      return `${head}${t}${" ".repeat(Math.max(2, room - head.length - t.length - summary.length))}${fit(summary, room - head.length - t.length - 2)}`;
    }
    const g = r.group as CockpitGroup;
    const head = `${GROUP_MARK[g]} ${fit(r.unit, unitW).padEnd(unitW)}  ${fit(r.step ?? "", stepW).padEnd(stepW)}  `;
    return `${head}${fit(r.text ?? r.title, room - head.length)}`;
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
    return `  ${l.row.group ? paint(text, GROUP_STYLE[l.row.group]) : text}`;
  });
  const all = previewOf(model, s, o, paint);
  const scroll = Math.max(0, Math.min(s.scroll, all.length - prevH));
  const preview = all.slice(scroll, scroll + prevH);
  const overflow = all.length > prevH;
  if (wide) {
    for (let i = 0; i < bodyH; i++) {
      const l = listLines[i] ?? "";
      out.push(`${l}${" ".repeat(Math.max(0, listW - visible(l)))} ${paint("│", ["dim"])} ${preview[i] ?? ""}`);
    }
  } else {
    for (let i = 0; i < listH; i++) out.push(listLines[i] ?? "");
    out.push(rule);
    for (let i = 0; i < bodyH - listH - 1; i++) out.push(preview[i] ?? "");
  }

  out.push(rule);
  if (s.prompt) {
    const target = model.rows.find((r) => r.id === s.prompt?.row);
    const a = target?.actions.find((x) => x.id === s.prompt?.action);
    out.push(`${paint(`${a?.input?.prompt ?? "Text"} (${a?.label ?? "?"} ${target?.unit ?? ""}):`, ["bold", "yellow"])} ${s.prompt.text}${paint("▏", ["dim"])}`);
  } else out.push(s.message ? paint(fit(s.message.text, width), TONE[s.message.tone]) : "");
  const keys = [
    ...(sel?.actions.map((a) => `${paint(a.key, ["bold"])} ${paint(a.label, ["dim"])}`) ?? []),
    ...(overflow ? [`${paint("⌃d/⌃u", ["bold"])} ${paint("scroll", ["dim"])}`] : []),
    `${paint("1 2 3", ["bold"])} ${paint("tabs", ["dim"])}`,
    `${paint("/", ["bold"])} ${paint("filter", ["dim"])}`,
    `${paint("?", ["bold"])} ${paint("keys", ["dim"])}`,
    `${paint("q", ["bold"])} ${paint("quit", ["dim"])}`,
  ];
  const footer = s.prompt ? paint("enter sends · esc cancels", ["dim"]) : keys.join(paint(" · ", ["dim"]));
  out.push(visible(footer) > width ? fit(footer.replace(ANSI, ""), width) : footer);
  return out.join("\n");
}
