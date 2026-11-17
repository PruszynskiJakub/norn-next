import type { HostContext } from "@norn/plugin-api";
import { nodeExec } from "./exec.ts";
import { nodeFiles } from "./files.ts";
import type { NodeHostOptions } from "./options.ts";

/** The HostContext every plugin of a real run is given: processes, files and the clock of this machine. */
export function createNodeHost(opts: NodeHostOptions): HostContext {
  return {
    exec: nodeExec,
    files: nodeFiles(opts.root),
    now: () => new Date().toISOString(),
    repo: { root: opts.root, dataDir: opts.dataDir },
  };
}
