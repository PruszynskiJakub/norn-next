/**
 * @norn/adapters — every built-in adapter in one package (simplification of the PRD's
 * per-adapter `@norn/adapter-*` packages; see AGENTS.md). Each subfolder implements one
 * port from @norn/core and is exported as a namespace.
 */
export * as claude from "./claude/index.ts";
export * as codex from "./codex/index.ts";
export * as gemini from "./gemini/index.ts";
export * as gh from "./gh/index.ts";
export * as git from "./git/index.ts";
export * as glab from "./glab/index.ts";
export * as headless from "./headless/index.ts";
export * as herdr from "./herdr/index.ts";
export * as notify from "./notify/index.ts";
export * as opencode from "./opencode/index.ts";
/** OS processes: ProcessPort (pid + start time), injectable exec, PortError helper. `proc` avoids shadowing global `process`. */
export * as proc from "./process/index.ts";
