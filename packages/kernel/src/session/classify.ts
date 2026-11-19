import type { SessionActivity, SessionFacts, SessionView } from "./view.ts";

export interface ClassifyOptions {
  silentAfterMs: number;
}

function limitHolds(view: SessionView, nowMs: number): boolean {
  if (!view.limit) return false;
  if (view.limit.resets_at === undefined) return true;
  return Date.parse(view.limit.resets_at) > nowMs;
}

/** The order is the contract: a higher reason to be idle hides every lower one. */
function activityOf(view: SessionView, nowMs: number): SessionActivity {
  if (view.ended) return "ended";
  if (view.report) return "reported";
  if (limitHolds(view, nowMs)) return "limited";
  if (view.permission) return "permission";
  if (view.input) return "asking";
  if (view.subagents.length > 0) return "awaiting_subagents";
  if (view.pending_tools.length > 0) return "awaiting_tools";
  if (view.turn_ended) return "turn_ended";
  if (view.active) return "working";
  return "starting";
}

/** Judge a view at `now`. Pure: the caller supplies the time, so one view classifies the same way twice. */
export function classifySession(view: SessionView, now: string, opts: ClassifyOptions): SessionFacts {
  const nowMs = Date.parse(now);
  const activity = activityOf(view, nowMs);
  const quietMs = view.last_event_at === undefined ? Number.NaN : nowMs - Date.parse(view.last_event_at);
  const facts: SessionFacts = {
    activity,
    // working already implies no subagents or tools by the order above; the checks keep that true if it changes
    silent: activity === "working" && view.pending_tools.length === 0 && view.subagents.length === 0 && quietMs > opts.silentAfterMs,
    pending_tools: view.pending_tools.length,
    subagents: view.subagents.length,
    pane_answers: view.pane_answers,
    errors: view.errors.map((e) => e.message),
  };
  if (view.input) facts.ask = view.input.options ? { ...view.input, options: [...view.input.options] } : { ...view.input };
  if (view.permission) facts.permission = structuredClone(view.permission);
  if (activity === "limited" && view.limit) facts.limit = { ...view.limit };
  if (view.report) facts.report = { ...view.report };
  if (view.last_message !== undefined) facts.last_message = view.last_message;
  if (view.error !== undefined) facts.error = view.error;
  return facts;
}
