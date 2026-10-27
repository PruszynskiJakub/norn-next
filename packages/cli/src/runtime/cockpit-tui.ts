/**
 * The terminal renderer of the cockpit model (SPEC-cockpit CP6–CP8): raw keys, a filter, a one-line
 * prompt for actions that take text, and a full-screen frame — rows on the left, the selected row's
 * preview on the right. Pure: keys and a model in, the next state, an effect and a frame out. Which
 * actions a row offers is the model's (CP4); keys only look them up.
 */
import { basename } from "node:path";
import { formatAge, type InboxGroup } from "@norn/core";
import { type CockpitAction, type CockpitModel, type CockpitRow, prLine, unitStanding } from "@norn/view";
import { GROUP_MARK } from "./cockpit.ts";

export type Key =
  | { kind: "char"; char: string }
  | { kind: "up" | "down" | "pgup" | "pgdn" | "home" | "end" | "enter" | "esc" | "backspace" | "clear" | "quit" };

export type Tone = "ok" | "error" | "info";

export interface TuiState {
  /** id of the selected row; kept across refreshes (CP2) */
  selected: string | null;
  filter: string;
  /** typing into the filter (`/`) */
  filtering: boolean;
  /** CP7: an action waiting for its text */
  prompt: { row: string; action: CockpitAction["id"]; text: string } | null;
  message: { text: string; tone: Tone } | null;
  /** CP8: a shown verb's markdown (or the key list) in place of the preview */
  shown: string | null;
}

export type TuiEffect = { kind: "run"; row: CockpitRow; action: CockpitAction; input?: string } | { kind: "refresh" } | { kind: "quit" };

export const initialState = (): TuiState => ({ selected: null, filter: "", filtering: false, prompt: null, message: null, shown: null });

/** Raw terminal input → keys. Unknown escape sequences are dropped. */
export function parseKeys(chunk: string): Key[] {
  const keys: Key[] = [];
  for (let i = 0; i < chunk.length; ) {
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
    else if (c === "\x03" || c === "\x04") keys.push({ kind: "quit" });
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
  return [r.group ? GROUP_WORD[r.group] : "story", r.unit, r.step ?? "", r.title, r.preview.report.title].join(" ").toLowerCase();
}

/** CP7: every word of the filter appears in the row. */
export function visibleRows(model: CockpitModel, filter: string): CockpitRow[] {
  const words = filter.toLowerCase().split(/\s+/).filter(Boolean);
  return model.rows.filter((r) => words.every((w) => rowText(r).includes(w)));
}

/** The selected row: the one with the state's id among the visible rows, else the first. */
export function selectedRow(model: CockpitModel, s: TuiState): CockpitRow | null {
  const rows = visibleRows(model, s.filter);
  return rows.find((r) => r.id === s.selected) ?? rows[0] ?? null;
}

export const HELP = [
  "Keys",
  "  ↑ ↓  j k        move (PgUp PgDn a page)",
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
  "Only the keys of the selected row's actions work; the footer lists them.",
].join("\n");

const PAGE = 10;

/** One key → the next state and what to do. Pure. */
export function handleKey(s: TuiState, key: Key, model: CockpitModel): { state: TuiState; effect?: TuiEffect } {
  if (key.kind === "quit") return { state: s, effect: { kind: "quit" } };
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
  const rows = visibleRows(model, s.filter);
  const at = Math.max(0, rows.findIndex((r) => r.id === row?.id));
  const move = (to: number) => ({ state: { ...s, selected: rows[Math.max(0, Math.min(rows.length - 1, to))]?.id ?? null, shown: null, message: null } });
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
    case "esc":
      if (s.shown) return { state: { ...s, shown: null } };
      if (s.filter) return { state: { ...s, filter: "", selected: row?.id ?? null } };
      return { state: s, effect: { kind: "quit" } };
    default:
      break;
  }
  const name = key.kind === "enter" ? "enter" : key.kind === "char" ? key.char : null;
  if (name === "j") return move(at + 1);
  if (name === "k") return move(at - 1);
  if (name === "/") return { state: { ...s, filtering: true, message: null } };
  if (name === "q") return { state: s, effect: { kind: "quit" } };
  if (name === "r") return { state: { ...s, message: null }, effect: { kind: "refresh" } };
  if (name === "?") return { state: { ...s, shown: HELP } };
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

/** CP3: the preview as lines (unstyled), for a column `width` wide. */
export function previewLines(row: CockpitRow, now: number, width: number): string[] {
  const r = row.preview.report;
  const out: string[] = [`${r.story} — ${r.title}`, `story: ${unitStanding(r.unit)} · ${r.mode} · ${r.claim}`];
  if (r.slices.length) {
    out.push(`slices: ${r.slices.filter((s) => s.status === "done").length}/${r.slices.length} done`);
    for (const s of r.slices) out.push(`  ${s.key} ${s.title} — ${unitStanding(s)}`);
  }
  out.push(`PR: ${prLine(r.pr)}${r.pr ? ` (seen ${formatAge(now - Date.parse(r.pr.seen_at))} ago)` : ""}`);
  if (r.url) out.push(`issue: ${r.url}`);
  const it = row.preview.item;
  if (it) {
    out.push("", it.title);
    if (it.detail) out.push(it.detail);
    if (it.full) out.push("", ...it.full.split("\n"));
    out.push(`$ ${it.command}`);
  }
  if (r.waiting.length) {
    out.push("", "waits for you:");
    for (const w of r.waiting) out.push(`  ${GROUP_MARK[w.group] ?? "·"} ${w.unit}${w.step ? ` ${w.step}` : ""}: ${w.command}`);
  }
  if (r.running.length) {
    out.push("", "running:");
    for (const w of r.running) out.push(`  ${GROUP_MARK.running} ${w.unit}${w.step ? ` ${w.step}` : ""} · ${w.age}`);
  }
  out.push("", `notes: ${r.note_count} open`);
  for (const g of r.notes) {
    out.push(`  ${g.unit}`);
    for (const n of g.notes) out.push(`    - [${n.step}${n.criterion ? ` · ${n.criterion}` : ""}] ${n.text.replace(/\s+/g, " ")}`);
  }
  return out.flatMap((l) => wrap(l, width));
}

function storySummary(r: CockpitRow): string {
  const rep = r.preview.report;
  const done = rep.slices.filter((s) => s.status === "done").length;
  const where = rep.unit.status === "done" ? "done" : rep.unit.status === "not_started" ? "not started" : `${rep.unit.status} ${rep.unit.step ?? ""}`.trim();
  const pr = rep.pr ? `PR #${rep.pr.number}${rep.pr.is_draft && rep.pr.state === "open" ? " draft" : rep.pr.state === "open" ? "" : ` ${rep.pr.state}`}` : "no PR";
  return `${where} · ${rep.slices.length ? `${done}/${rep.slices.length} slices` : "no slices"} · ${pr}`;
}

export function renderCockpit(model: CockpitModel, s: TuiState, o: Look): string {
  const paint = (t: string, styles: readonly Style[] = []) => (o.color && styles.length && t ? `\x1b[${styles.map((k) => STYLE[k]).join(";")}m${t}\x1b[0m` : t);
  const width = Math.max(40, o.width);
  const height = Math.max(10, o.height);
  const rule = paint("─".repeat(width), ["dim"]);
  const rows = visibleRows(model, s.filter);
  const sel = selectedRow(model, s);

  // header
  const hb = model.header.heartbeat;
  const pending = model.header.pending;
  const left = `${paint("norn cockpit", ["bold"])} ${paint("·", ["dim"])} ${basename(model.header.repo)}  ${pending ? paint(`${pending} need${pending === 1 ? "s" : ""} you`, ["bold", "yellow"]) : paint("nothing needs you", ["green"])}`;
  const right = `${hb.down ? paint(`no heartbeat${hb.age ? ` for ${hb.age}` : ""} — norn watch`, ["red"]) : paint(hb.age ? `tick ${hb.age} ago` : "no tick yet", ["dim"])}  ${paint(o.clock, ["dim"])}`;
  const out = [`${left}${" ".repeat(Math.max(2, width - visible(left) - visible(right)))}${right}`];
  out.push(s.filtering ? `${paint("/", ["bold", "cyan"])} ${s.filter}${paint("▏", ["dim"])}` : s.filter ? `${paint("filter:", ["dim"])} ${s.filter} ${paint("(esc clears)", ["dim"])}` : paint("/ to filter", ["dim"]));
  out.push(rule);

  // body: list | preview (preview below when narrow); header 3, footer 3, the log's newline 1
  const bodyH = height - 7;
  const wide = width >= 100;
  const listW = wide ? Math.floor(width * 0.5) : width;
  const prevW = wide ? width - listW - 3 : width;
  const items = rows.filter((r) => r.kind === "item");
  const w = (f: (r: CockpitRow) => string, max: number) => Math.min(max, Math.max(0, ...items.map((r) => f(r).length)));
  const wordW = w((r) => (r.group ? (GROUP_WORD[r.group] ?? r.group) : ""), 9);
  const unitW = Math.max(w((r) => r.unit, 10), Math.min(10, Math.max(0, ...rows.map((r) => r.unit.length))));
  const stepW = w((r) => r.step ?? "", 12);
  const titleW = Math.min(28, Math.max(0, ...rows.filter((r) => r.kind === "story").map((r) => r.title.length)));
  const line = (r: CockpitRow, room: number): string => {
    if (r.kind === "story") {
      const head = `${fit(r.unit, unitW).padEnd(unitW)}  ${fit(r.title, titleW).padEnd(titleW)}  `;
      return `${head}${fit(storySummary(r), room - head.length)}`;
    }
    const g = r.group as InboxGroup;
    const head = `${GROUP_MARK[g] ?? "·"} ${(GROUP_WORD[g] ?? g).padEnd(wordW)}  ${fit(r.unit, unitW).padEnd(unitW)}  ${fit(r.step ?? "", stepW).padEnd(stepW)}  `;
    const age = r.age ?? "";
    const t = fit(r.title, Math.max(0, room - head.length - age.length - 2));
    return `${head}${t}${" ".repeat(Math.max(2, room - head.length - t.length - age.length))}${age}`;
  };
  const list: Array<{ text: string; row?: CockpitRow }> = [];
  let kind: CockpitRow["kind"] | null = null;
  for (const r of rows) {
    if (r.kind !== kind) list.push({ text: paint(r.kind === "item" ? "NEEDS YOU" : "STORIES", ["dim"]) });
    kind = r.kind;
    list.push({ text: "", row: r });
  }
  if (!rows.length) list.push({ text: paint(s.filter ? "  no row matches the filter" : "  no stories yet", ["dim"]) });
  const listH = wide ? bodyH : Math.max(3, Math.floor(bodyH / 2));
  const selAt = Math.max(0, list.findIndex((l) => l.row && l.row.id === sel?.id));
  const start = Math.max(0, Math.min(selAt - Math.floor(listH / 2), list.length - listH));
  const listLines = list.slice(start, start + listH).map((l) => {
    if (!l.row) return l.text;
    const text = line(l.row, listW - 2);
    if (l.row.id === sel?.id) return paint(`▸ ${text}`.padEnd(listW), ["inverse"]);
    return `  ${l.row.kind === "item" ? paint(text, GROUP_STYLE[l.row.group as InboxGroup] ?? []) : text}`;
  });
  const preview = s.shown ? s.shown.split("\n").flatMap((l) => wrap(l, prevW)) : sel ? previewLines(sel, o.now, prevW) : [];
  const previewStyled = preview.map((l, i) => (i === 0 && !s.shown ? paint(fit(l, prevW), ["bold"]) : fit(l, prevW)));
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
  const keys = [...(sel?.actions.map((a) => `${paint(a.key, ["bold"])} ${paint(a.label, ["dim"])}`) ?? []), `${paint("/", ["bold"])} ${paint("filter", ["dim"])}`, `${paint("?", ["bold"])} ${paint("keys", ["dim"])}`, `${paint("q", ["bold"])} ${paint("quit", ["dim"])}`];
  const footer = s.prompt ? paint("enter sends · esc cancels", ["dim"]) : keys.join(paint(" · ", ["dim"]));
  out.push(visible(footer) > width ? fit(footer.replace(/\x1b\[[0-9;]*m/g, ""), width) : footer);
  return out.join("\n");
}
