/**
 * The pi extension events norn's extension forwards, by the names pi gives them; each is also the
 * `<hook>` argument of the hook command the extension runs.
 */
export const PI_HOOKS = [
  "session_start",
  "before_agent_start",
  "tool_call",
  "tool_execution_end",
  "ui_prompt_start",
  "ui_prompt_end",
  "session_compact",
  // pi's last actionable boundary: the one place a run's end can still be refused
  "agent_before_settle",
  // a run pi will not continue (an error or aborted response) is never forwarded at agent_before_settle and ends here instead
  "agent_settled",
  "session_shutdown",
] as const;
export type PiHook = (typeof PI_HOOKS)[number];

export const isPiHook = (hook: string): hook is PiHook => (PI_HOOKS as readonly string[]).includes(hook);

/**
 * pi's built-in tools that change files. A write is the call norn guards, so the extension refuses
 * one when the hook command fails rather than let an unchecked write through.
 */
export const WRITE_TOOLS: readonly string[] = ["write", "edit"];
