/**
 * The kernel's answer in Claude Code's hook protocol (https://code.claude.com/docs/en/hooks). Pure.
 * An allow prints nothing: Claude Code then runs its own permission check, where an explicit
 * `permissionDecision: "allow"` would skip it.
 */
import type { NativeReply, RespondInput } from "@norn/plugin-api";

const SILENT: NativeReply = { stdout: "", exit_code: 0 };
const STOPPABLE: ReadonlySet<string> = new Set(["Stop", "SubagentStop"]);
const CONTEXT_HOOKS: ReadonlySet<string> = new Set(["SessionStart", "UserPromptSubmit"]);

const json = (value: unknown): NativeReply => ({ stdout: JSON.stringify(value), exit_code: 0 });

/** An answer the hook cannot carry (a block on PreToolUse, a deny on Stop) is acknowledged silently. */
export function respond({ hook, answer }: RespondInput): NativeReply {
  if (answer.kind === "deny" && hook === "PreToolUse")
    return json({ hookSpecificOutput: { hookEventName: hook, permissionDecision: "deny", permissionDecisionReason: answer.reason } });
  if (answer.kind === "block" && STOPPABLE.has(hook)) return json({ decision: "block", reason: answer.reason });
  if (answer.kind === "context" && CONTEXT_HOOKS.has(hook)) return json({ hookSpecificOutput: { hookEventName: hook, additionalContext: answer.text } });
  return SILENT;
}
