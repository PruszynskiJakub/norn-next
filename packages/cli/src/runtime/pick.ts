/**
 * `norn pick`: a raw-key picker for a Herdr overlay. Rows are the inbox items that need the person,
 * then one row per story; typing filters them, ↑↓ move, the right side previews the story's orient
 * summary. Pure: keys and a view in, the next state, an effect and a frame out. The command does
 * the IO: verbs through the CLI dispatcher (X1), Herdr through the cockpit adapter.
 */
import { formatAge, type InboxGroup } from "@norn/core";
import type { RemoteProvider } from "@norn/schema";
import { type InboxEntry, inboxItemsInOrder, type OrientReport, orientReport, prCommand, prLine, type ProjectView, type StoryView, unitStanding } from "@norn/view";
import { fit, wrap } from "./cockpit-view.ts";

/** Inbox groups a pick row is made for, in O1 order. */
export const PICK_GROUPS: readonly InboxGroup[] = ["your_turn", "answer", "approve", "unblock", "check"];

/** One mark per group, shared with the tab bar segment. */
export const GROUP_MARK: Partial<Record<InboxGroup, string>> = {
  your_turn: "▶",
  answer: "◆",
  approve: "●",
  unblock: "✖",
  check: "◇",
  unclaimed: "○",
  running: "◐",
};

const GROUP_WORD: Partial<Record<InboxGroup, string>> = { your_turn: "your turn", answer: "answer", approve: "approve", unblock: "stuck", check: "check", unclaimed: "unclaimed" };

export interface PickRow {
  kind: "item" | "story";
  story: string;
  /** the unit an action on the row addresses */
  unit: string;
  /** what the filter matches, lower case */
  text: string;
  /** the row as drawn, before cutting */
  label: string;
  /** item rows: mark, group word, unit, step, title, age; story rows: key, title, summary */
  cols: string[];
  item?: InboxEntry;
  /** story rows: nobody holds a live claim (`norn take`) */
  unclaimed?: boolean;
}

export interface PickState {
  query: string;
  /** index into the filtered rows */
  cursor: number;
  message: string | null;
}

export type PickKey =
  | { kind: "char"; char: string }
  | { kind: "up" | "down" | "enter" | "esc" | "backspace" | "clear" | "ctrl-o" | "ctrl-y" | "ctrl-g" | "ctrl-t" | "ctrl-r" };

export type PickEffect =
  | { kind: "orient"; story: string }
  | { kind: "pr"; story: string; argv: string[] }
  | { kind: "verb"; argv: string[] }
  | { kind: "go"; item: InboxEntry }
  | { kind: "refresh" }
  | { kind: "quit" };

/** Raw terminal input → keys. Unknown escape sequences are dropped. */
export function parseKeys(chunk: string): PickKey[] {
  const keys: PickKey[] = [];
  for (let i = 0; i < chunk.length; ) {
    const rest = chunk.slice(i);
    const seq = /^\x1b(?:\[[0-9;]*[A-Za-z~]|O[A-Za-z])/.exec(rest)?.[0];
    if (seq) {
      const end = seq.at(-1);
      if (end === "A") keys.push({ kind: "up" });
      else if (end === "B") keys.push({ kind: "down" });
      i += seq.length;
      continue;
    }
    const c = rest[0] as string;
    i++;
    if (c === "\x1b" || c === "\x03") keys.push({ kind: "esc" });
    else if (c === "\r" || c === "\n") keys.push({ kind: "enter" });
    else if (c === "\x7f" || c === "\b") keys.push({ kind: "backspace" });
    else if (c === "\x15") keys.push({ kind: "clear" });
    else if (c === "\x10") keys.push({ kind: "up" });
    else if (c === "\x0e") keys.push({ kind: "down" });
    else if (c === "\x0f") keys.push({ kind: "ctrl-o" });
    else if (c === "\x19") keys.push({ kind: "ctrl-y" });
    else if (c === "\x07") keys.push({ kind: "ctrl-g" });
    else if (c === "\x14") keys.push({ kind: "ctrl-t" });
    else if (c === "\x12") keys.push({ kind: "ctrl-r" });
    else if (c >= " ") keys.push({ kind: "char", char: c });
  }
  return keys;
}

function storySummary(s: StoryView): string {
  const done = s.slices.filter((x) => x.status === "done").length;
  const slices = s.slices.length ? `${done}/${s.slices.length} slices` : "no slices";
  const step = s.status === "done" ? "done" : s.status === "not_started" ? "not started" : `${s.status} ${s.step ?? ""}`.trim();
  const pr = s.pr ? `PR #${s.pr.number}${s.pr.is_draft && s.pr.state === "open" ? " draft" : s.pr.state === "open" ? "" : ` ${s.pr.state}`}` : "no PR";
  return `${step} · ${slices} · ${pr}`;
}

/** Rows in order: the items that need the person, then one per story. */
export function pickRows(view: ProjectView): PickRow[] {
  const items: PickRow[] = inboxItemsInOrder(view)
    .filter((i) => PICK_GROUPS.includes(i.group))
    .map((i) => {
      const unit = i.slice ?? i.story;
      const cols = [GROUP_MARK[i.group] ?? "·", GROUP_WORD[i.group] ?? i.group, unit, i.step ?? "", i.title, i.age];
      const label = cols.join(" ");
      return { kind: "item" as const, story: i.story, unit, item: i, label, cols, text: label.toLowerCase() };
    });
  const stories: PickRow[] = view.stories.map((s) => {
    const cols = [s.key, s.title, storySummary(s)];
    const label = cols.join(" ");
    return { kind: "story" as const, story: s.key, unit: s.key, label, cols, text: label.toLowerCase(), unclaimed: s.claim.unclaimed };
  });
  return [...items, ...stories];
}

/** Every word of the query appears in the row (case does not matter). */
export function filterRows(rows: readonly PickRow[], query: string): PickRow[] {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  return rows.filter((r) => words.every((w) => r.text.includes(w)));
}

const clamp = (n: number, len: number) => Math.max(0, Math.min(n, len - 1));

/** One key against the current rows → the next state and what to do, if anything. */
export function pickKey(state: PickState, key: PickKey, rows: readonly PickRow[], opts: { provider: RemoteProvider; branchOf: (story: string) => string | null }): { state: PickState; effect?: PickEffect } {
  const shown = filterRows(rows, state.query);
  const row = shown[clamp(state.cursor, shown.length)];
  const next = (over: Partial<PickState>) => ({ ...state, message: null, ...over });
  switch (key.kind) {
    case "char":
      return { state: next({ query: state.query + key.char, cursor: 0 }) };
    case "backspace":
      return { state: next({ query: state.query.slice(0, -1), cursor: 0 }) };
    case "clear":
      return { state: next({ query: "", cursor: 0 }) };
    case "up":
      return { state: next({ cursor: clamp(state.cursor - 1, shown.length) }) };
    case "down":
      return { state: next({ cursor: clamp(state.cursor + 1, shown.length) }) };
    case "esc":
      return { state, effect: { kind: "quit" } };
    case "ctrl-r":
      return { state: next({}), effect: { kind: "refresh" } };
    default:
      break;
  }
  if (!row) return { state: next({ message: "no row selected" }) };
  switch (key.kind) {
    case "enter":
      return { state, effect: { kind: "orient", story: row.story } };
    case "ctrl-o": {
      const branch = opts.branchOf(row.story);
      if (!branch) return { state: next({ message: `no branch known for ${row.story}` }) };
      return { state, effect: { kind: "pr", story: row.story, argv: prCommand(opts.provider, branch, true).split(" ") } };
    }
    case "ctrl-y":
      return row.item?.group === "approve" ? { state: next({}), effect: { kind: "verb", argv: ["approve", row.unit] } } : { state: next({ message: "⌃y approves a gate: pick an approve row" }) };
    case "ctrl-g":
      return row.item ? { state, effect: { kind: "go", item: row.item } } : { state: next({ message: "⌃g goes to an agent: pick an item row" }) };
    case "ctrl-t":
      return row.unclaimed || row.item?.group === "unclaimed" ? { state: next({}), effect: { kind: "verb", argv: ["take", row.story] } } : { state: next({ message: `${row.story} is held: nothing to take` }) };
  }
}

/** The preview of a story: the first lines an orient agent would summarize. */
export function previewLines(r: OrientReport, now: number, item?: InboxEntry): string[] {
  const done = r.slices.filter((s) => s.status === "done").length;
  const out = [`${r.story} — ${r.title}`, `story: ${unitStanding(r.unit)}`, `slices: ${done}/${r.slices.length} done`, `PR: ${prLine(r.pr)}${r.pr ? ` (seen ${formatAge(now - Date.parse(r.pr.seen_at))} ago)` : ""}`, ""];
  if (item) out.push(`${GROUP_WORD[item.group] ?? item.group}: ${item.title}`, `$ ${item.command}`, "");
  out.push(r.waiting.length ? "waits for you:" : "nothing waits for you");
  for (const w of r.waiting) out.push(`  ${GROUP_MARK[w.group] ?? "·"} ${w.unit}${w.step ? ` ${w.step}` : ""}: ${w.command}`);
  for (const w of r.running) out.push(`  ${GROUP_MARK.running} ${w.unit}${w.step ? ` ${w.step}` : ""} running`);
  out.push("", `notes: ${r.note_count} open${r.notes.length > 1 ? ` across ${r.notes.length} units` : ""}`);
  return out;
}

export interface PickFrameOptions {
  width: number;
  height: number;
  color: boolean;
  provider: RemoteProvider;
  now: number;
}

const ESC = "\x1b[";
const visible = (s: string) => s.replace(/\x1b\[[0-9;]*m/g, "").length;

export function renderPick(view: ProjectView, rows: readonly PickRow[], state: PickState, o: PickFrameOptions): string {
  const paint = (s: string, code: string) => (o.color && s ? `${ESC}${code}m${s}${ESC}0m` : s);
  const width = Math.max(40, o.width);
  const height = Math.max(8, o.height);
  const shown = filterRows(rows, state.query);
  const cursor = clamp(state.cursor, shown.length);
  const leftW = width >= 100 ? Math.floor(width * 0.55) : width;
  const rightW = width - leftW - 3;
  // header 3, rules and keys 2, and the newline the log adds after the frame
  const bodyH = height - 6;

  const needs = rows.filter((r) => r.kind === "item").length;
  const head = `${paint("norn pick", "1")}  ${needs ? paint(`${needs} need${needs === 1 ? "s" : ""} you`, "1;33") : paint("nothing needs you", "32")}`;
  const out = [head, `${paint("›", "1;36")} ${state.query}${paint("▏", "2")}`, paint("─".repeat(width), "2")];

  // aligned columns: item rows by mark/word/unit/step, story rows by key
  const items = shown.filter((r) => r.kind === "item");
  const w = (k: number, max: number) => Math.min(max, Math.max(0, ...items.map((r) => (r.cols[k] ?? "").length)));
  const [wordW, unitW, stepW] = [w(1, 9), w(2, 10), w(3, 12)];
  const keyW = Math.min(10, Math.max(0, ...shown.filter((r) => r.kind === "story").map((r) => (r.cols[0] ?? "").length)));
  const line = (r: PickRow, room: number): string => {
    if (r.kind === "story") {
      const [key = "", title = "", summary = ""] = r.cols;
      const head = `${key.padEnd(keyW)}  `;
      const tail = `  ${summary}`;
      return `${head}${fit(title, Math.max(8, room - head.length - tail.length))}${tail}`.slice(0, room);
    }
    const [mark = "", word = "", unit = "", step = "", title = "", age = ""] = r.cols;
    const head = `${mark} ${word.padEnd(wordW)}  ${fit(unit, unitW).padEnd(unitW)}  ${fit(step, stepW).padEnd(stepW)}  `;
    const t = fit(title, Math.max(0, room - head.length - age.length - 2));
    return `${head}${t}${" ".repeat(Math.max(2, room - head.length - t.length - age.length))}${age}`;
  };

  // keep the cursor in sight
  const start = Math.max(0, Math.min(cursor - Math.floor(bodyH / 2), shown.length - bodyH));
  const left: string[] = [];
  let lastKind: PickRow["kind"] | null = start > 0 ? (shown[start - 1]?.kind ?? null) : null;
  for (let i = start; i < shown.length && left.length < bodyH; i++) {
    const r = shown[i] as PickRow;
    if (r.kind === "story" && lastKind !== "story" && left.length < bodyH - 1) left.push(paint("stories", "2"));
    lastKind = r.kind;
    const mark = i === cursor ? "▸ " : "  ";
    const text = line(r, leftW - 2);
    left.push(i === cursor ? paint(`${mark}${text}`, "7") : `${mark}${r.kind === "item" ? paint(text, "1") : text}`);
  }
  if (!shown.length) left.push(paint(state.query ? "  no match" : "  no stories yet", "2"));

  const row = shown[cursor];
  const report = row ? orientReport(view, row.story, o.provider) : null;
  const right = rightW >= 20 && report ? previewLines(report, o.now, row?.item).flatMap((l) => wrap(l, rightW)).map((l) => fit(l, rightW)) : [];
  for (let i = 0; i < bodyH; i++) {
    const l = left[i] ?? "";
    if (!right.length) {
      out.push(l);
      continue;
    }
    out.push(`${l}${" ".repeat(Math.max(0, leftW - visible(l)))} ${paint("│", "2")} ${paint(right[i] ?? "", "2")}`);
  }
  out.push(paint("─".repeat(width), "2"));
  const keys = "enter orient · ⌃o PR · ⌃y approve · ⌃g agent · ⌃t take · ⌃r refresh · esc quit";
  out.push(state.message ? paint(fit(state.message, width), "33") : paint(fit(keys, width), "2"));
  return out.join("\n");
}
