/**
 * @norn/cli — wiring and commands. `main.ts` is the `norn` bin; `runCli` runs a command
 * in-process (tests, embedding). Command files live in `src/commands/` (see commands/index.ts).
 */
export { type CliResult, helpFor, parseCommandArgs, runCli } from "./cli.ts";
export { type Command, defineCommand, opt, type OptionSpec, type ParsedArgs } from "./command.ts";
export { COMMANDS, findCommand } from "./commands/index.ts";
export { type CliDeps, Context, findUnitMarker, type Located, locateRepo, systemClock } from "./context.ts";
export { busyError, CliFailure, corruptError, failure, isRendered, isWithExit, refuse, render, rendered, toFailure, usageError, withExit } from "./output.ts";
export { type ActRecord, Actor } from "./runtime/act/index.ts";
export { heartbeatId, markNotified, readNotified, readRemoteCache } from "@norn/store";
export { type Observed, observe, type ObserveOptions, type StoryLoc, type SyncMode, type UnitLoc } from "./runtime/observe.ts";
export { releaseHeldClaims, releaseStory } from "./runtime/release.ts";
export { runShell, tailLines } from "./runtime/shell.ts";
export { replayInputs, runTick, type TickOptions, type TickReport, traceRecord } from "./runtime/tick.ts";
export { type AssetsSources, assetsDir, resolveAssetsDir } from "./runtime/assets.ts";
export { agentSkills, bundledSkills, repoWorkflows } from "./runtime/workflows.ts";
export { buildPorts, defaultRegistry } from "./wiring.ts";
