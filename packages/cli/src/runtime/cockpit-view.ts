/**
 * The cockpit's frame (HC4): the inbox as aligned rows, one per item, cut to the pane width, with
 * colour per group on a terminal. Pure: a view in, a string out. `formatInbox` (@norn/view) stays
 * the plain-text form for `norn inbox`; this is the cockpit's own presentation.
 */
import { basename } from "node:path";
import { INBOX_GROUPS, INBOX_TITLES } from "@norn/core";
import { groupAbout, type InboxEntry, type ProjectView } from "@norn/view";

type InboxGroup = (typeof INBOX_GROUPS)[number];

export interface FrameOptions {
  /** pane width in columns */
  width: number;
  /** ANSI colour (a terminal, NO_COLOR unset) */
  color: boolean;
  /** local time of day shown in the header, e.g. `21:12:05` */
  clock: string;
  /** redraw interval as typed, e.g. `5s` */
  interval: string;
  /** the result of the last command, if any */
  message?: { text: string; tone: Tone } | null;
  /** text a command printed (a trace, an item's details), shown under the rows */
  output?: string;
  /** Herdr reachable: `go` focuses panes (else it shows the command, HC8) */
  herdr: boolean;
  /** HC16: Notes as an accordion — open or not, and how many notes are new; absent = always listed */
  notes?: { open: boolean; fresh: number };
}

export type Tone = "ok" | "error" | "info";

const ESC = "\x1b[";
const STYLE = {
  bold: "1",
  dim: "2",
  red: "31",
  green: "32",
  yellow: "33",
  blue: "34",
  magenta: "35",
  cyan: "36",
} as const;
type Style = keyof typeof STYLE;

/**
 * What each group is drawn in: needing a person stands out, work under way and notes stay readable
 * in their own colour, only finished work recedes (dim reads as done on a dark theme).
 */
const GROUP_STYLE: Record<InboxGroup, Style[]> = {
  your_turn: ["bold", "green"],
  answer: ["bold", "yellow"],
  approve: ["bold", "cyan"],
  unblock: ["bold", "red"],
  check: ["magenta"],
  unclaimed: ["blue"],
  running: ["cyan"],
  notes: ["yellow"],
  recently_done: ["dim"],
};

/**
 * HC16: the items a frame numbers — Notes left out while collapsed, else grouped by unit, the unit
 * with the newest note first and each unit's notes in the order they were left.
 */
export function frameItems(items: readonly InboxEntry[], notesOpen: boolean): InboxEntry[] {
  const notes = items.filter((i) => i.group === "notes");
  if (!notesOpen || !notes.length) return items.filter((i) => i.group !== "notes");
  const unit = (i: InboxEntry) => i.slice ?? i.story;
  const newest = new Map<string, number>();
  for (const n of notes) newest.set(unit(n), Math.max(newest.get(unit(n)) ?? Number.NEGATIVE_INFINITY, Date.parse(n.since) || 0));
  const units = [...newest.keys()].sort((a, b) => (newest.get(b) ?? 0) - (newest.get(a) ?? 0));
  // the items come in O1 group order, so the notes sit together
  const at = items.findIndex((i) => i.group === "notes");
  return [...items.slice(0, at), ...units.flatMap((u) => notes.filter((n) => unit(n) === u)), ...items.slice(at + notes.length)];
}

/** HC16: how many notes were left after `seenAt` (all of them when nothing was seen yet). */
export function freshNotes(items: readonly InboxEntry[], seenAt: string | undefined): number {
  const seen = seenAt ? Date.parse(seenAt) : Number.NEGATIVE_INFINITY;
  return items.filter((i) => i.group === "notes" && Date.parse(i.since) > seen).length;
}

/** HC16: when the newest note was left; undefined = no notes. */
export function newestNote(items: readonly InboxEntry[]): string | undefined {
  const times = items.filter((i) => i.group === "notes").map((i) => Date.parse(i.since)).filter(Number.isFinite);
  return times.length ? new Date(Math.max(...times)).toISOString() : undefined;
}

const TONE_STYLE: Record<Tone, Style[]> = { ok: ["green"], error: ["red"], info: ["dim"] };

/** The commands, short enough for one footer line; `?` lists them in full. */
const KEYS: Array<[string, string]> = [
  ["<n>", "go"],
  ["a <n> …", "answer"],
  ["y/x <n>", "approve/reject"],
  ["u <n>", "unstick"],
  ["t <n>", "take"],
  ["v <n>", "trace"],
  ["d <n>", "details"],
  ["o", "notes"],
  ["n", "next"],
  ["?", "help"],
  ["q", "quit"],
];

/** Cut `s` to `n` columns with an ellipsis. */
export function fit(s: string, n: number): string {
  if (n <= 0) return "";
  const one = s.replace(/\s+/g, " ").trim();
  return one.length <= n ? one : `${one.slice(0, Math.max(0, n - 1))}…`;
}

/** Wrap one line to `n` columns at spaces, keeping its indent on the continuation lines. */
export function wrap(line: string, n: number): string[] {
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

/** The item's title without a leading `<step>: ` (the step has its own column). */
function titleOf(it: InboxEntry): string {
  return it.step && it.title.startsWith(`${it.step}: `) ? it.title.slice(it.step.length + 2) : it.title;
}

export function renderFrame(view: ProjectView, items: readonly InboxEntry[], o: FrameOptions): string {
  const paint = (s: string, styles: readonly Style[]) => (o.color && styles.length && s ? `${ESC}${styles.map((k) => STYLE[k]).join(";")}m${s}${ESC}0m` : s);
  const width = Math.max(40, o.width);
  const rule = paint("─".repeat(width), ["dim"]);
  const out: string[] = [];

  // header: repo, what needs you, heartbeat, time
  const hb = view.heartbeat;
  const heartbeat = hb.down ? paint(`no heartbeat${hb.age ? ` for ${hb.age}` : ""} — norn watch`, ["red"]) : paint(hb.age ? `tick ${hb.age} ago` : "no tick yet", ["dim"]);
  const pending = view.inbox.pending;
  const left = `${paint("norn", ["bold"])} ${paint("·", ["dim"])} ${basename(view.repo)}  ${pending ? paint(`${pending} need${pending === 1 ? "s" : ""} you`, ["bold", "yellow"]) : paint("nothing needs you", ["green"])}`;
  const right = `${heartbeat}  ${paint(`${o.clock} · every ${o.interval}`, ["dim"])}`;
  const visible = (s: string) => s.replace(/\x1b\[[0-9;]*m/g, "").length;
  out.push(`${left}${" ".repeat(Math.max(2, width - visible(left) - visible(right)))}${right}`, rule);

  if (!items.length) out.push("", paint("  Inbox empty.", ["dim"]), "");

  // rows: number · unit · step · title … age, the command dimmed beneath
  const unitW = Math.min(12, Math.max(4, ...items.map((i) => (i.slice ?? i.story).length)));
  const stepW = Math.min(14, Math.max(4, ...items.map((i) => (i.step ?? "").length)));
  const numW = String(items.length).length;
  const indent = 2 + numW + 2 + unitW + 2 + stepW + 2;
  let n = 0;
  for (const g of INBOX_GROUPS) {
    // HC16: collapsed Notes keep their header (count, new ones, how to open) and drop their rows
    const accordion = g === "notes" && o.notes ? o.notes : null;
    const group = accordion && !accordion.open ? [] : items.filter((i) => i.group === g);
    const all = accordion ? view.inbox.groups.notes : group;
    if (!all.length) continue;
    const marker = accordion ? `${accordion.open ? "▾" : "▸"} ` : "";
    const fresh = accordion && !accordion.open && accordion.fresh ? ` · ${accordion.fresh} new` : "";
    const about = [groupAbout(g, all), accordion ? `o to ${accordion.open ? "close" : "open"}` : ""].filter(Boolean).join(" · ");
    const head = `${marker}${INBOX_TITLES[g].toUpperCase()}`;
    const count = `${all.length}${fresh}`;
    out.push("", `${paint(head, GROUP_STYLE[g])} ${paint(count, ["dim"])}  ${paint(fit(about, width - head.length - count.length - 3), ["dim"])}`);
    for (const it of group) {
      n++;
      const age = it.age;
      const title = fit(titleOf(it), width - indent - age.length - 2);
      const pad = " ".repeat(Math.max(1, width - indent - title.length - age.length));
      const fade = g === "recently_done";
      out.push(
        `  ${paint(String(n).padStart(numW), ["bold", ...GROUP_STYLE[g].filter((s) => s !== "bold")])}  ${paint(fit(it.slice ?? it.story, unitW).padEnd(unitW), fade ? ["dim"] : ["bold"])}  ${paint(fit(it.step ?? "", stepW).padEnd(stepW), ["dim"])}  ${fade ? paint(title, ["dim"]) : title}${pad}${paint(age, ["dim"])}`,
        `${" ".repeat(indent)}${paint(`→ ${fit(it.command, width - indent - 2)}`, ["dim"])}`,
      );
    }
  }

  if (o.output?.trim()) out.push("", rule, ...o.output.trimEnd().split("\n").flatMap((l) => wrap(l, width)));
  out.push("", rule);
  if (o.message) out.push(paint(fit(o.message.text, width), TONE_STYLE[o.message.tone]));
  const keys = KEYS.map(([k, what]) => `${paint(k, ["bold"])} ${paint(what, ["dim"])}`);
  const footer: string[] = [];
  let line = "";
  for (const k of keys) {
    const next = line ? `${line}   ${k}` : k;
    if (line && visible(next) > width) {
      footer.push(line);
      line = k;
    } else line = next;
  }
  if (line) footer.push(line);
  out.push(...footer);
  if (!o.herdr) out.push(paint("outside Herdr: go shows the command (HC8)", ["dim"]));
  return `${out.join("\n")}\n${paint("›", ["bold", "cyan"])} `;
}

/** `d <n>`: an item's full text — title, detail, full screen, command, link. */
export function itemDetails(it: InboxEntry): string {
  const lines = [`${it.slice ?? it.story}${it.step ? ` · ${it.step}` : ""} · ${INBOX_TITLES[it.group]} · ${it.age}`, "", it.title];
  if (it.detail) lines.push("", it.detail);
  if (it.full) lines.push("", it.full);
  lines.push("", `$ ${it.command}`);
  if (it.url) lines.push(it.url);
  return lines.join("\n");
}
