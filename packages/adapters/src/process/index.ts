/**
 * ProcessPort (ports.ts): liveness by PID + start time (K3, MO3). The start time and the zombie
 * rule come from store's one `ps -o stat= -o lstart=` parser (`parseStart`), shared with the
 * leases and locks, so both agree: a zombie is dead. The start time is kept opaque — only
 * compared for equality, so a reused PID never looks like the original process.
 */
import type { AdapterContext, ProcessPort } from "@norn/core";
import type { ProcessIdentity } from "@norn/schema";
import { PS_ENV, parseStart, processStart, psStartArgv, selfIdentity } from "@norn/store";
import { type Exec, unobservedExec } from "./exec.ts";

export { portError } from "./error.ts";
export { type Exec, type ExecOptions, type ExecResult, bunExec, shellJoin, shellQuote } from "./exec.ts";
export { parseStart, psStartArgv } from "@norn/store";

/**
 * R5.1: every process with its environment appended to the command line. macOS (BSD ps) prints
 * the environment with `-E`; procps (Linux) with the BSD-style `e` flag. Only processes this user
 * may inspect show it — elsewhere the env is simply absent (no match, never an error).
 */
export function psEnvArgv(platform: string = process.platform): string[] {
  return platform === "linux" ? ["ps", "axeww", "-o", "pid=,args="] : ["ps", "-A", "-E", "-ww", "-o", "pid=,command="];
}

/** Pids whose `ps` env listing holds the whole token `name=value`. */
export function parseEnvMatches(stdout: string, name: string, value: string): number[] {
  const token = `${name}=${value}`;
  const out: number[] = [];
  for (const line of stdout.split("\n")) {
    const m = /^\s*(\d+)\s+(.*)$/.exec(line);
    if (m && m[2]!.split(/\s+/).includes(token)) out.push(Number(m[1]));
  }
  return out;
}

export interface ProcessPortOptions {
  exec?: Exec;
  /** override for tests */
  selfPid?: number;
  /** override for tests (default `process.platform`) */
  platform?: string;
}

export function createProcessPort(opts: ProcessPortOptions = {}): ProcessPort {
  const exec = opts.exec ?? unobservedExec;
  let selfId: ProcessIdentity | null = null;
  return {
    async identify(pid) {
      if (!Number.isInteger(pid) || pid <= 0) return null;
      const r = await exec(psStartArgv(pid), { env: PS_ENV });
      const start = parseStart(r.stdout, r.code);
      return start === null ? null : { pid, pid_start: start };
    },
    async isAlive(proc) {
      const now = await this.identify(proc.pid);
      return now !== null && now.pid_start === proc.pid_start;
    },
    async findByEnv(name, value) {
      const r = await exec(psEnvArgv(opts.platform), { env: PS_ENV });
      if (r.code !== 0) return [];
      const self = opts.selfPid ?? process.pid;
      const found: ProcessIdentity[] = [];
      for (const pid of parseEnvMatches(r.stdout, name, value)) {
        if (pid === self) continue;
        const id = await this.identify(pid);
        if (id) found.push(id);
      }
      return found;
    },
    self() {
      if (selfId) return selfId;
      const pid = opts.selfPid ?? process.pid;
      selfId = selfIdentity(pid, processStart(pid));
      return selfId;
    },
  };
}

export const processFactory = (_ctx: AdapterContext): ProcessPort => createProcessPort();
