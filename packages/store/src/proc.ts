/**
 * Default process liveness by PID + start time (K3, H1), used when the caller does not
 * inject a `ProcessPort`. Start time is `ps -o lstart=` — opaque, compared for equality.
 */
import type { ProcessPort } from "@norn/core";
import type { ProcessIdentity } from "@norn/schema";

/** Liveness check injected into leases and the tick lock. */
export type LivenessCheck = (proc: ProcessIdentity) => Promise<boolean> | boolean;

export function processStart(pid: number): string | null {
  if (!Number.isInteger(pid) || pid < 1) return null;
  try {
    process.kill(pid, 0);
  } catch (e) {
    // EPERM: exists but not ours — still alive
    if ((e as { code?: string }).code !== "EPERM") return null;
  }
  const r = Bun.spawnSync(["ps", "-o", "lstart=", "-p", String(pid)], { stdout: "pipe", stderr: "ignore", env: { ...process.env, LC_ALL: "C" } });
  const out = r.stdout.toString().trim().replace(/\s+/g, " ");
  return r.exitCode === 0 && out ? out : null;
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
    if (!selfId) selfId = { pid: process.pid, pid_start: processStart(process.pid) ?? "unknown" };
    return selfId;
  },
};

export const defaultLiveness: LivenessCheck = (p) => localProcess.isAlive(p);
