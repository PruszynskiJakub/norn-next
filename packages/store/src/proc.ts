/**
 * Process liveness by PID + start time (K3, H1, MO3). The one `ps -o stat= -o lstart=` parser:
 * store's own `localProcess` (leases, tick and integrate locks) and the process adapter
 * (`createProcessPort`) both use it, so they agree. The start time is kept opaque — only
 * compared for equality, so a reused PID never looks like the original process — and a zombie
 * (stat `Z…`) has no start time: it is dead, so a lock or lease it holds is reclaimed (K3).
 */
import type { ProcessPort } from "@norn/core";
import type { ProcessIdentity } from "@norn/schema";

/** Liveness check injected into leases and the tick lock. */
export type LivenessCheck = (proc: ProcessIdentity) => Promise<boolean> | boolean;

/** Stable `ps` output regardless of the user's locale. */
export const PS_ENV: Record<string, string | undefined> = { ...process.env, LC_ALL: "C", LANG: "C" };

/** `ps` argv that prints a process's state and start time (macOS and Linux). */
export function psStartArgv(pid: number): string[] {
  return ["ps", "-o", "stat=", "-o", "lstart=", "-p", String(pid)];
}

/** Parse `ps -o stat= -o lstart=` output; null when the pid is gone or a zombie (K3). */
export function parseStart(stdout: string, code: number): string | null {
  const m = /^\s*(\S+)\s+(.+?)\s*$/.exec(stdout);
  if (code !== 0 || !m || m[1]!.startsWith("Z")) return null;
  return m[2]!.replace(/\s+/g, " ");
}

/** A process's start time, or null when it is gone, a zombie, or `pid` is not a pid. */
export function processStart(pid: number): string | null {
  if (!Number.isInteger(pid) || pid < 1) return null;
  const r = Bun.spawnSync(psStartArgv(pid), { stdout: "pipe", stderr: "ignore", env: PS_ENV });
  return parseStart(r.stdout.toString(), r.exitCode ?? 1);
}

/**
 * A process's own identity. `ps` always sees its own process; should it still fail, the
 * fallback start time never equals a real one, so no other process is taken for this one.
 */
export function selfIdentity(pid: number, start: string | null): ProcessIdentity {
  return { pid, pid_start: start ?? `unknown-${pid}` };
}

let selfId: ProcessIdentity | null = null;

export const localProcess: ProcessPort = {
  async identify(pid) {
    const start = processStart(pid);
    return start ? { pid, pid_start: start } : null;
  },
  async isAlive(proc) {
    return processStart(proc.pid) === proc.pid_start;
  },
  self() {
    if (!selfId) selfId = selfIdentity(process.pid, processStart(process.pid));
    return selfId;
  },
};

export const defaultLiveness: LivenessCheck = (p) => localProcess.isAlive(p);
