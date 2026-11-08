/**
 * The one reading of what an agent session is doing, from its hooks and its pane. The two signals
 * stay apart: hooks carry the time they fired, the pane only what it shows now, so the precedence
 * between them is caller policy, never decided here. Callers that need a time (the attended wait,
 * a run's end) read the hooks alone, since a pane carries none.
 */
import type { HookEventKind, HookFact } from "@norn/schema";
import type { RunFacts } from "./facts.ts";
import type { PaneState } from "./ports.ts";
import { epoch } from "./time.ts";

export type Activity = "starting" | "working" | "waiting" | "turn_ended" | "ended";

/** What each hook event says the agent session is doing. */
const HOOK_ACTIVITY: Record<HookEventKind, Activity> = {
  session_start: "starting",
  turn_start: "working",
  tool_use: "working",
  waiting_input: "waiting",
  permission_prompt: "waiting",
  turn_end: "turn_ended",
  session_end: "ended",
};

/** What each pane state says; an unknown pane says nothing. */
const PANE_ACTIVITY: Record<PaneState["state"], Activity | null> = {
  working: "working",
  idle: "turn_ended",
  done: "turn_ended",
  waiting_input: "waiting",
  unknown: null,
};

/** The agent is not moving on: it waits, or its turn is over. */
const idle = (a: Activity | null): boolean => a === "waiting" || a === "turn_ended";

/**
 * The hooks' view: the activity of the newest hook (`at`, ms epoch). `idle_since` is when the
 * trailing run of waits and turn ends began, so a repeated idle notification never restarts a
 * wait (else the newest hook's time); `before` the activity just before that run.
 */
export type HookView = { kind: "none" } | { kind: Activity; at: number; last: HookFact; idle_since: number; before: Activity | null };

/** The pane's view, as the pane shows it now: it carries no time of change. */
export interface PaneView {
  kind: Activity | null;
  alive: boolean;
}

export interface SessionActivity {
  hook: HookView;
  pane: PaneView | null;
}

/** Hooks arrive sorted by time from store (a stable sort), so the last one is the newest. */
export function hookActivity(hooks: readonly HookFact[]): HookView {
  const last = hooks.at(-1);
  if (!last) return { kind: "none" };
  const kind = HOOK_ACTIVITY[last.event];
  const at = epoch(last.at);
  let first = hooks.length - 1;
  if (idle(kind)) while (first > 0 && idle(HOOK_ACTIVITY[(hooks[first - 1] as HookFact).event])) first--;
  const prev = hooks[first - 1];
  return { kind, at, last, idle_since: idle(kind) ? epoch((hooks[first] as HookFact).at) : at, before: prev ? HOOK_ACTIVITY[prev.event] : null };
}

/** The pane as an activity; liveness is copied, never judged here. */
export function paneActivity(pane: PaneState | null | undefined): PaneView | null {
  return pane ? { kind: PANE_ACTIVITY[pane.state], alive: pane.alive } : null;
}

export function sessionActivity(rf: Pick<RunFacts, "hooks" | "pane">): SessionActivity {
  return { hook: hookActivity(rf.hooks), pane: paneActivity(rf.pane) };
}

/** The first hook after `since` (ms epoch) that is not another wait: the agent moved on. */
export function movedSince(hooks: readonly HookFact[], since: number): HookFact | null {
  return hooks.find((h) => epoch(h.at) > since && HOOK_ACTIVITY[h.event] !== "waiting") ?? null;
}

/** A live pane that shows something other than a prompt; an unknown pane proves nothing. */
export function paneLeftPrompt(pane: PaneState | null | undefined): boolean {
  if (!pane?.alive) return false;
  const kind = PANE_ACTIVITY[pane.state];
  return kind !== null && kind !== "waiting";
}
