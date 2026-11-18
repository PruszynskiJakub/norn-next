/**
 * The kernel's answer in the reply protocol of norn's pi extension (see extension.ts). Pure. An
 * allow prints nothing: the extension reads an empty reply as allow.
 */
import type { NativeReply, RespondInput } from "@norn/plugin-api";

const SILENT: NativeReply = { stdout: "", exit_code: 0 };
const CONTEXT_HOOKS: ReadonlySet<string> = new Set(["session_start", "session_compact", "before_agent_start"]);

const json = (value: unknown): NativeReply => ({ stdout: JSON.stringify(value), exit_code: 0 });

/** An answer the event cannot carry (a deny on a settle, a block on a tool call) is acknowledged silently. */
export function respond({ hook, answer }: RespondInput): NativeReply {
  if (answer.kind === "deny" && hook === "tool_call") return json({ block: true, reason: answer.reason });
  if (answer.kind === "block" && hook === "agent_before_settle") return json({ continue: answer.reason });
  if (answer.kind === "context" && CONTEXT_HOOKS.has(hook)) return json({ context: answer.text });
  return SILENT;
}
