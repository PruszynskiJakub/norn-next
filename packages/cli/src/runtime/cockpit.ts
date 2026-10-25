/**
 * The interactive cockpit behind `norn pane --interactive` (HC4–HC8, HC12): one line per command,
 * planned against the numbered inbox frame. Planning is pure; verbs run through the CLI dispatcher
 * (HC7, X1) and Herdr only focuses, opens and labels panes (presentation, HC13).
 */
import { herdr } from "@norn/adapters";
import type { InboxEntry } from "@norn/view";

type HerdrCockpit = herdr.HerdrCockpit;
type PaneLabel = herdr.PaneLabel;

export type CockpitCommand =
  | { kind: "go"; n: number }
  | { kind: "answer"; n: number; text: string }
  | { kind: "approve"; n: number }
  | { kind: "reject"; n: number; reason: string }
  | { kind: "take"; n: number }
  | { kind: "unstick"; n: number }
  | { kind: "view"; n: number }
  | { kind: "next" }
  | { kind: "refresh" }
  | { kind: "help" }
  | { kind: "quit" }
  | { kind: "invalid"; message: string };

export type CockpitStep =
  | { kind: "verb"; argv: string[] }
  | { kind: "go"; item: InboxEntry }
  | { kind: "message"; text: string }
  | { kind: "refresh" }
  | { kind: "quit" };

export const COCKPIT_HELP =
  "<n> go · a <n> <text> answer · y <n> approve · x <n> <reason> reject · t <n> take · u <n> unstick · v <n> trace · n next waiting · r refresh · q quit";

/** HC5: one input line → a command. Empty line = redraw. */
export function parseCockpitLine(line: string): CockpitCommand {
  const s = line.trim();
  if (s === "" || s === "r") return { kind: "refresh" };
  if (s === "q") return { kind: "quit" };
  if (s === "?" || s === "h") return { kind: "help" };
  if (s === "n") return { kind: "next" };
  if (/^[0-9]+$/.test(s)) return { kind: "go", n: Number(s) };
  const m = /^([a-z])\s+([0-9]+)(?:\s+([\s\S]*))?$/.exec(s);
  if (!m) return { kind: "invalid", message: `unknown command: ${s} — ? lists the commands` };
  const [, verb, num, rest = ""] = m;
  const n = Number(num);
  const text = rest.trim();
  switch (verb) {
    case "g":
      return { kind: "go", n };
    case "a":
      return text ? { kind: "answer", n, text } : { kind: "invalid", message: "a <n> <text>: the answer is missing" };
    case "y":
      return { kind: "approve", n };
    case "x":
      return text ? { kind: "reject", n, reason: text } : { kind: "invalid", message: "x <n> <reason>: the reason is missing" };
    case "t":
      return { kind: "take", n };
    case "u":
      return { kind: "unstick", n };
    case "v":
      return { kind: "view", n };
    default:
      return { kind: "invalid", message: `unknown command: ${verb} — ? lists the commands` };
  }
}

const unitOf = (it: InboxEntry) => it.slice ?? it.story;

/**
 * HC10: the Your turn item to go to next — the oldest one with a run (an agent waits there), else,
 * unless `agentsOnly`, the oldest one at all (a manual start).
 */
export function oldestYourTurn(items: readonly InboxEntry[], agentsOnly = false): InboxEntry | null {
  const oldest = (xs: InboxEntry[]) => xs.reduce<InboxEntry | null>((a, b) => (a === null || Date.parse(b.since) < Date.parse(a.since) ? b : a), null);
  const mine = items.filter((i) => i.group === "your_turn");
  return oldest(mine.filter((i) => i.reach)) ?? (agentsOnly ? null : oldest(mine));
}

/** HC5: a command against the current frame → what to do. A command that does not fit its item runs nothing. */
export function planCockpit(cmd: CockpitCommand, items: readonly InboxEntry[]): CockpitStep {
  switch (cmd.kind) {
    case "quit":
      return { kind: "quit" };
    case "refresh":
      return { kind: "refresh" };
    case "help":
      return { kind: "message", text: COCKPIT_HELP };
    case "invalid":
      return { kind: "message", text: cmd.message };
    case "next": {
      const item = oldestYourTurn(items);
      return item ? { kind: "go", item } : { kind: "message", text: "nothing waits for you" };
    }
    default:
      break;
  }
  const item = items[cmd.n - 1];
  if (!item) return { kind: "message", text: `no item ${cmd.n} in this frame` };
  const unit = unitOf(item);
  const wrong = (what: string) => ({ kind: "message" as const, text: `[${cmd.n}] is not ${what}` });
  switch (cmd.kind) {
    case "go":
      // MO5: a manual start the runner can open itself — run that verb rather than splitting a pane here
      if (item.group === "your_turn" && !item.reach && item.command.startsWith("norn open ")) return { kind: "verb", argv: ["open", unit] };
      return { kind: "go", item };
    case "view":
      return { kind: "verb", argv: ["trace", unit, "--text"] };
    case "answer":
      return item.group === "answer" ? { kind: "verb", argv: ["answer", unit, cmd.text] } : wrong("a question (Answer)");
    case "approve":
      return item.group === "approve" ? { kind: "verb", argv: ["approve", unit] } : wrong("a gate (Approve)");
    case "reject":
      return item.group === "approve" ? { kind: "verb", argv: ["approve", unit, "--reject", "--reason", cmd.reason] } : wrong("a gate (Approve)");
    case "take":
      return item.group === "unclaimed" ? { kind: "verb", argv: ["take", item.story] } : wrong("an unclaimed story");
    case "unstick":
      return item.command.startsWith("norn unstick ") ? { kind: "verb", argv: ["unstick", unit] } : wrong("a stuck unit (norn unstick)");
  }
}

/** A manual start (B3): no run yet, the item's command starts an agent in the worktree. */
export function isManualStart(item: InboxEntry): boolean {
  return item.group === "your_turn" && !item.reach && item.command.includes("norn brief");
}

/** HC7: one message line for a verb's JSON outcome. */
export function verbMessage(argv: readonly string[], exit: number, value: unknown): string {
  const what = `norn ${argv.slice(0, 2).join(" ")}`;
  if (exit === 0) return `ok: ${what}`;
  const v = value as { error?: string; do_instead?: string } | null;
  return `refused: ${what} — ${v?.error ?? `exit ${exit}`}${v?.do_instead ? ` (${v.do_instead})` : ""}`;
}

/** HC12: the label for an item's agent pane; null = none. */
export function labelFor(item: InboxEntry, ttlMs: number): PaneLabel | null {
  const title = `${unitOf(item)}${item.step ? ` · ${item.step}` : ""}`;
  const all = (text: string) => ({ idle: text, done: text, blocked: text, working: text, unknown: text });
  switch (item.group) {
    case "your_turn":
      return { title, state_labels: all("norn: your turn"), ttl_ms: ttlMs };
    case "answer":
      return { title, state_labels: all("norn: answer"), ttl_ms: ttlMs };
    case "unblock":
      return { title, state_labels: all("norn: unblock"), ttl_ms: ttlMs };
    case "running":
      return { title, state_labels: {}, ttl_ms: ttlMs };
    default:
      return null;
  }
}

/** HC12: label the agent pane of every item whose run Herdr hosts; first item per pane wins. Failures are ignored (HC13). */
export async function labelPanes(cockpit: HerdrCockpit, items: readonly InboxEntry[], ttlMs: number): Promise<number> {
  const agents = await cockpit.listAgents().catch(() => []);
  const done = new Set<string>();
  for (const it of items) {
    const pane = herdr.findAgentPane(agents, it.reach);
    const label = pane ? labelFor(it, ttlMs) : null;
    if (!pane || !label || done.has(pane)) continue;
    done.add(pane);
    await cockpit.label(pane, label).catch(() => null);
  }
  return done.size;
}

/** HC5/HC6: go to an item — focus its agent pane, start a manual agent beside the cockpit, or show its command. */
export async function goTo(cockpit: HerdrCockpit | null, item: InboxEntry, cwd: string): Promise<string> {
  if (!cockpit) return `$ ${item.command}`;
  const agents = await cockpit.listAgents().catch(() => null);
  if (agents === null) return `herdr unreachable — $ ${item.command}`;
  const pane = herdr.findAgentPane(agents, item.reach);
  if (pane) {
    await cockpit.focus(pane);
    return `focused ${pane} (${unitOf(item)})`;
  }
  if (isManualStart(item)) {
    const opened = await cockpit.openCommand(cwd, item.command, `${unitOf(item)}${item.step ? ` ${item.step}` : ""}`);
    return `started an agent for ${unitOf(item)} in ${opened.pane_id}`;
  }
  return item.reach ? `no single agent pane found for ${unitOf(item)} — $ ${item.command}` : `$ ${item.command}`;
}
