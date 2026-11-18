import { defineNornPlugin, type Harness } from "@norn/plugin-api";
import { install, LOCAL_SETTINGS, uninstall } from "./install.ts";
import { launch } from "./launch.ts";
import { normalize } from "./normalize.ts";
import { respond } from "./respond.ts";

export { CLAUDE_HOOKS, type ClaudeHook } from "./hooks.ts";
export { gitignorePath, settingsLocalPath } from "./install.ts";
export { DEFAULT_ARGS, RUN_ID_ENV } from "./launch.ts";
export { PROMPT_SOURCE_ENV } from "./normalize.ts";
export { hookCommandFor, mergeNornHooks, NORN_MARKER, removeNornHooks } from "./settings.ts";

export const claudeHarness: Harness = Object.freeze({
  name: "claude",
  capabilities: Object.freeze({ blockStop: true, denyTool: true, injectContext: true, subagents: true, limits: true, paneInput: true, promptMarks: true, resume: true }),
  skillsDir: ".claude/skills",
  localFiles: Object.freeze([LOCAL_SETTINGS]),
  install,
  uninstall,
  launch,
  normalize,
  respond,
});

export const claudePlugin = defineNornPlugin({ name: "norn-harness-claude", api: "^1", provides: { harness: { claude: claudeHarness } } });
