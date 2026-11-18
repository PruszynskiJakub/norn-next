import { defineNornPlugin, type Harness } from "@norn/plugin-api";
import { install, uninstall } from "./install.ts";
import { launch } from "./launch.ts";
import { normalize } from "./normalize.ts";
import { respond } from "./respond.ts";

export { EXTENSION_MARKER, extensionSource, FAILED_WRITE_REASON, HOOK_TIMEOUT_MS } from "./extension.ts";
export { PI_HOOKS, type PiHook, WRITE_TOOLS } from "./hooks.ts";
export { extensionDir, extensionPath, gitignorePath } from "./install.ts";
export { toolKind } from "./normalize.ts";

/**
 * pi reports no subagents and no usage limit (a provider error reaches norn only as the words a run
 * stopped on), so the kernel never waits on either for a pi session.
 */
export const piHarness: Harness = Object.freeze({
  name: "pi",
  capabilities: Object.freeze({ blockStop: true, denyTool: true, injectContext: true, subagents: false, limits: false, paneInput: true, promptMarks: true, resume: true }),
  // under `.pi`, which `--approve` trusts for norn's runs; `.agents/skills` may be the repo's own and committed
  skillsDir: ".pi/skills",
  install,
  uninstall,
  launch,
  normalize,
  respond,
});

export const piPlugin = defineNornPlugin({ name: "norn-harness-pi", api: "^1", provides: { harness: { pi: piHarness } } });
