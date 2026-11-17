/** Claude Code's waiting and turn-ending hooks → permission, input, limit and turn events. */
import type { Draft } from "./draft.ts";
import { isObject, list, stableId, str } from "./payload.ts";

/**
 * `Notification.notification_type` that waits on a person. `idle_prompt` is not one: it fires a
 * minute after a turn that Stop already ended, and after a Stop that left background work running
 * it would end a turn that is only paused. The rest are informational, and an unknown future type
 * is ignored rather than parking a session.
 */
const ASKING_NOTIFICATIONS: ReadonlySet<string> = new Set(["elicitation_dialog", "elicitation_url_dialog", "agent_needs_input", "quota_auto_resume_stale"]);

/** A dialog answered or dismissed in the pane; it names no ask, so it answers whichever is open. */
const ANSWERED_NOTIFICATIONS: ReadonlySet<string> = new Set(["elicitation_response", "elicitation_complete"]);

export function notification(payload: unknown): Draft[] {
  const message = str(payload, "message");
  const type = str(payload, "notification_type") ?? untypedNotification(message);
  const session = str(payload, "session_id");
  if (type === "permission_prompt") {
    // Claude Code names no tool call here; when a newer one does, the permission closes with it
    const id = str(payload, "tool_use_id") ?? stableId("perm", session, message);
    return [{ type: "tool.permission", id, prompt: message ?? "permission requested" }];
  }
  if (ANSWERED_NOTIFICATIONS.has(type)) return [{ type: "input.received", by: "pane" }];
  if (!ASKING_NOTIFICATIONS.has(type)) return [];
  return [{ type: "input.requested", id: stableId("input", session, type, message), question: message ?? type }];
}

/** An older Claude Code sends no type: read it from the text it shows. */
function untypedNotification(message: string | undefined): string {
  if (/permission/i.test(message ?? "")) return "permission_prompt";
  if (/waiting for your input/i.test(message ?? "")) return "idle_prompt";
  return "agent_needs_input";
}

/**
 * The whole message `Claude AI usage limit reached|<epoch seconds>`, as Claude Code prints a limit
 * with its reset. Anchored and with its reset only: an agent's own words that mention a usage limit
 * would otherwise park a finished turn as limited, and a limit with no reset never expires.
 */
const LIMIT_NOTICE = /^\s*Claude AI usage limit reached\|(\d{10})\s*$/;
const RESET_EPOCH = /\|(\d{10})\b/;

function resetsAt(...texts: Array<string | undefined>): string | undefined {
  for (const t of texts) {
    const m = t ? RESET_EPOCH.exec(t) : null;
    if (m) return new Date(Number(m[1]) * 1000).toISOString();
  }
  return undefined;
}

function usageLimit(...texts: Array<string | undefined>): Draft {
  const resets_at = resetsAt(...texts);
  return { type: "limit.hit", kind: "usage", ...(resets_at && { resets_at }) };
}

/**
 * A turn that ended on an API error. A usage limit is a limit, not a stuck agent: Claude Code
 * continues the session at the reset. A failed login leaves the session unable to act on any
 * prompt until a person runs `/login`, so it asks. Any other error ends the turn like Stop would.
 */
export function stopFailure(payload: unknown): Draft[] {
  const error = str(payload, "error");
  const details = str(payload, "error_details");
  const last = str(payload, "last_assistant_message");
  if (error === "rate_limit") return [usageLimit(details, last)];
  if (error === "authentication_failed")
    return [{ type: "input.requested", id: stableId("login", str(payload, "session_id")), question: "agent logged out: run /login in the pane" }];
  return [{ type: "turn.ended", ...(last && { last_message: last }) }];
}

/**
 * Claude Code lists the session's running background work on Stop. A subagent there wakes the
 * session with its hand-back, so it is reported running before the turn ends: the session awaits
 * it rather than going silent. Other background work sends no SubagentStop, so it is not tracked.
 */
export function stop(payload: unknown): Draft[] {
  const last = str(payload, "last_assistant_message");
  const out: Draft[] = [];
  for (const work of (list(payload, "background_tasks") ?? []).filter(isObject)) {
    const id = str(work, "id");
    const done = ["completed", "failed", "killed"].includes(str(work, "status") ?? "");
    if (id && str(work, "type") === "subagent" && !done) out.push({ type: "subagent.started", id, background: true });
  }
  out.push({ type: "turn.ended", ...(last && { last_message: last }) });
  const notice = last ? LIMIT_NOTICE.exec(last) : null;
  // after the turn end, which would otherwise outlive the limit it reports
  if (notice) out.push({ type: "limit.hit", kind: "usage", resets_at: new Date(Number(notice[1]) * 1000).toISOString() });
  return out;
}
