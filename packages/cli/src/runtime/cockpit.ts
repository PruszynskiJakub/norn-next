/**
 * Herdr side of `norn cockpit` (SPEC-cockpit CP8–CP10, HC6, HC12, HC15): which Herdr the cockpit talks
 * to, going to an agent's pane, labelling agent panes, and the oldest Your turn item for `--next`.
 * Presentation only — none of this is a fact for decide (HC13). Verbs run through the CLI dispatcher.
 */
import { herdr } from "@norn/adapters";
import type { InboxGroup, InboxItem } from "@norn/core";
import type { InboxEntry } from "@norn/view";
import type { Context } from "../context.ts";

type HerdrCockpit = herdr.HerdrCockpit;
type PaneLabel = herdr.PaneLabel;

/** One mark per inbox group, shared by the cockpit rows and the tab bar segment. */
export const GROUP_MARK: Partial<Record<InboxGroup, string>> = {
  your_turn: "▶",
  answer: "◆",
  approve: "●",
  unblock: "✖",
  check: "◇",
  unclaimed: "○",
  running: "◐",
};

/** HC6/HC8: the Herdr the cockpit talks to — injected, or the real one inside Herdr, else none. */
export function cockpitHerdr(ctx: Context): herdr.HerdrCockpit | null {
  if (ctx.deps.herdr !== undefined) return ctx.deps.herdr;
  // inside a Herdr pane (HERDR_ENV), or a command Herdr runs itself (a tab bar segment: only the socket is set)
  if (ctx.env.HERDR_ENV !== "1" && !ctx.env.HERDR_SOCKET_PATH) return null;
  const o = ctx.config.runner?.adapter === "herdr" ? (ctx.config.runner.options ?? {}) : {};
  return herdr.createHerdrCockpit({ env: ctx.env, ...(typeof o.bin === "string" ? { bin: o.bin } : {}), ...(typeof o.session === "string" ? { session: o.session } : {}) });
}

/**
 * HC10: the Your turn item to go to next — the oldest one with a run (an agent waits there), else,
 * unless `agentsOnly`, the oldest one at all (a manual start).
 */
export function oldestYourTurn(items: readonly InboxEntry[], agentsOnly = false): InboxEntry | null {
  const oldest = (xs: InboxEntry[]) => xs.reduce<InboxEntry | null>((a, b) => (a === null || Date.parse(b.since) < Date.parse(a.since) ? b : a), null);
  const mine = items.filter((i) => i.group === "your_turn");
  return oldest(mine.filter((i) => i.reach)) ?? (agentsOnly ? null : oldest(mine));
}

/** HC7: one line for a verb's JSON outcome. */
export function verbMessage(argv: readonly string[], exit: number, value: unknown): string {
  // the command words and the unit: `norn take gh-6`, `norn story answer gh-6`
  const unit = argv.findIndex((a) => /^(gh|gl)-\d/.test(a));
  const what = `norn ${argv.slice(0, unit < 0 ? 2 : unit + 1).join(" ")}`;
  if (exit === 0) return `ok: ${what}`;
  const v = value as { error?: string; do_instead?: string } | null;
  return `refused: ${what} — ${v?.error ?? `exit ${exit}`}${v?.do_instead ? ` (${v.do_instead})` : ""}`;
}

/**
 * CP4 place `agent` (HC6, HC15): focus the agent pane of the run, else the workspace of the run; a
 * line saying where it went or why not. Several candidates are no candidate (never a guess).
 */
export async function placeAgent(cockpit: HerdrCockpit, reach: InboxItem["reach"], unit: string): Promise<string> {
  const agents = await cockpit.listAgents().catch(() => null);
  if (agents === null) return "herdr unreachable";
  const pane = herdr.findAgentPane(agents, reach);
  if (pane) {
    await cockpit.focus(pane);
    return `focused ${pane} (${unit})`;
  }
  const workspaces = await cockpit.listWorkspaces().catch(() => []);
  const ws = herdr.findWorkspace(workspaces, reach);
  if (!ws) return `no single agent pane or workspace found for ${unit}`;
  await cockpit.focusWorkspace(ws);
  return `focused workspace ${ws} (${unit})`;
}

/** HC12: the label for an item's agent pane; null = none. */
function labelFor(item: InboxEntry, ttlMs: number): PaneLabel | null {
  const title = `${item.slice ?? item.story}${item.step ? ` · ${item.step}` : ""}`;
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
