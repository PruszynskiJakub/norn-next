/**
 * The host on node and bun: the one place the new packages perform raw IO (running and spawning processes,
 * writing files, reading the clock). Every plugin reaches those only through the HostContext made
 * here, so the rest stays testable with in-memory stand-ins.
 */
export { NOT_STARTED_CODE, nodeExec, TIMEOUT_CODE } from "./exec.ts";
export { nodeFiles, TEMP_SUFFIX } from "./files.ts";
export { createNodeHost } from "./host.ts";
export { type NodeHostOptions } from "./options.ts";
export { nodeProcesses, type Probe, probeMatches, readStartProbe, startMarker } from "./spawn.ts";
export { type AncestorProcess, ancestorPids, chainOf, envFromEnviron, nodeAncestry, parentFromStat, readParents, readPsEnvs } from "./ancestry.ts";
