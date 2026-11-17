/** The Claude Code hook events norn wires, by the names Claude Code sends them. */
export const CLAUDE_HOOKS = [
  "SessionStart",
  "UserPromptSubmit",
  "PreToolUse",
  "PostToolUse",
  "PostToolUseFailure",
  "Notification",
  "Stop",
  // a usage limit or a failed login ends the turn here instead of in Stop
  "StopFailure",
  "SubagentStop",
  "PreCompact",
  "SessionEnd",
] as const;
export type ClaudeHook = (typeof CLAUDE_HOOKS)[number];

/** Tool events take a matcher; without one Claude Code would run the hook for no tool. */
export const MATCHED_HOOKS: ReadonlySet<string> = new Set(["PreToolUse", "PostToolUse", "PostToolUseFailure"]);

export const isClaudeHook = (hook: string): hook is ClaudeHook => (CLAUDE_HOOKS as readonly string[]).includes(hook);
