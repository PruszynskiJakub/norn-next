/**
 * The `norn` a launched agent finds on its PATH. The brief tells the agent to run `norn brief`,
 * `norn done` and the rest; a bare `norn` resolves through the agent's PATH, which may hold another
 * build (a released binary) whose reports go to no run of this one. So the launcher writes a shim
 * named `norn` that execs the build that launched the agent, into a folder of the machine dir, and
 * puts that folder first on the agent's PATH.
 */
import type { HostContext, PluginResult } from "@norn/plugin-api";
import { fail, ok } from "@norn/plugin-api";
import { shellQuote } from "./shell.ts";

export const AGENT_BIN_NAME = "norn";

export function agentBinDir(ctx: HostContext): string {
  return `${ctx.repo.dataDir}/runtime/bin`;
}

/** The CLI a hook command runs, without its `hook` verb: `["/bin/bun", "/src/main.ts", "hook"]` → the first two. */
export function cliOfHookCommand(hookCommand: readonly string[]): readonly string[] {
  return hookCommand.at(-1) === "hook" ? hookCommand.slice(0, -1) : hookCommand;
}

export function shimScript(cli: readonly string[]): string {
  return `#!/bin/sh\n# the norn build that launched this agent, ahead of any other norn on its PATH\nexec ${shellQuote(cli)} "$@"\n`;
}

const message = (e: unknown): string => (e instanceof Error ? e.message : String(e));

/**
 * The env a launched agent takes so `norn` runs `cli`: PATH with the shim's folder first. Empty when
 * no shim can help: a bare `norn` would exec itself through the shim forever, a host with no
 * executable files cannot write one, and with no host PATH known a PATH of the shim alone would
 * hide every other program. Idempotent: an unchanged shim is not written again.
 */
export async function agentBinEnv(ctx: HostContext, cli: readonly string[], hostPath: string | undefined): Promise<PluginResult<Record<string, string>>> {
  const program = cli[0];
  const writeExecutable = ctx.files.writeExecutable?.bind(ctx.files);
  if (program === undefined || !program.includes("/") || !writeExecutable || hostPath === undefined) return ok({});
  const dir = agentBinDir(ctx);
  const path = `${dir}/${AGENT_BIN_NAME}`;
  const script = shimScript(cli);
  try {
    if ((await ctx.files.read(path)) !== script) await writeExecutable(path, script);
  } catch (e) {
    return fail("unavailable", `writing the agents' norn shim at ${path}: ${message(e)}`);
  }
  const rest = hostPath.split(":").filter((p) => p !== "" && p !== dir);
  return ok({ PATH: [dir, ...rest].join(":") });
}
