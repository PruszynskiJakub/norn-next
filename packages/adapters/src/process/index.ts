/**
 * ProcessPort (ports.ts): liveness by PID + start time (K3, MO3). The start time is what
 * `ps -o lstart= -p <pid>` prints (macOS and Linux), kept opaque — only compared for equality,
 * so a reused PID never looks like the original process.
 */
import type { AdapterContext, ProcessPort } from "@norn/core";
import type { ProcessIdentity } from "@norn/schema";
import { type Exec, bunExec } from "./exec.ts";

export { AdapterError, isPortError, portError } from "./error.ts";
export { type Exec, type ExecOptions, type ExecResult, bunExec, shellJoin, shellQuote } from "./exec.ts";

/** Stable `ps` output regardless of the user's locale. */
const PS_ENV = { ...process.env, LC_ALL: "C", LANG: "C" };

export function psStartArgv(pid: number): string[] {
  return ["ps", "-o", "stat=", "-o", "lstart=", "-p", String(pid)];
}

/** Parse `ps -o stat= -o lstart=` output; null when the pid is gone or a zombie. */
export function parseStart(stdout: string, code: number): string | null {
  const m = /^\s*(\S+)\s+(.+?)\s*$/.exec(stdout);
  if (code !== 0 || !m || m[1]!.startsWith("Z")) return null;
  return m[2]!.replace(/\s+/g, " ");
}

export interface ProcessPortOptions {
  exec?: Exec;
  /** override for tests */
  selfPid?: number;
}

export function createProcessPort(opts: ProcessPortOptions = {}): ProcessPort {
  const exec = opts.exec ?? bunExec;
  let selfIdentity: ProcessIdentity | null = null;
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
    self() {
      if (selfIdentity) return selfIdentity;
      const pid = opts.selfPid ?? process.pid;
      const r = Bun.spawnSync(psStartArgv(pid), { env: PS_ENV });
      const start = parseStart(r.stdout.toString(), r.exitCode ?? 1);
      // ps always sees its own parent; fall back to a value that never matches a real start time.
      selfIdentity = { pid, pid_start: start ?? `unknown-${pid}` };
      return selfIdentity;
    },
  };
}

export const processFactory = (_ctx: AdapterContext): ProcessPort => createProcessPort();
