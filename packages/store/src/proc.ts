/**
 * Process liveness by PID + start time. The one `ps -o stat= -o lstart=` parser:
 * store's own `localProcess` (leases, tick and integrate locks) and the process adapter
 * (`createProcessPort`) both use it, so they agree. The start time is kept opaque — only
 * compared for equality, so a reused PID never looks like the original process — and a zombie
 * (stat `Z…`) has no start time: it is dead, so a lock or lease it holds is reclaimed.
 *
 * A process is dead only on a positive answer: `ps` saying the pid is gone (exit 1, nothing
 * printed), a zombie, or another start time. A probe that cannot answer — the spawn failed, it
 * timed out, or it printed nothing yet exited 0, as `ps` does from a process out of file
 * descriptors — is unknown, and unknown is never dead: reclaim is machine-wide, so a probe
 * misread as dead deletes live leases of every repo on the machine.
 */
import type { ProcessPort } from "@norn/core";
import type { ProcessIdentity } from "@norn/schema";
import { spawnSyncCaptured } from "./spawn.ts";

/** Liveness check injected into leases and the tick lock. */
export type LivenessCheck = (proc: ProcessIdentity) => Promise<boolean> | boolean;

/** Stable `ps` output regardless of the user's locale. */
export const PS_ENV: Record<string, string | undefined> = { ...process.env, LC_ALL: "C", LANG: "C" };

/** `ps` argv that prints a process's state and start time (macOS and Linux). */
export function psStartArgv(pid: number): string[] {
  return ["ps", "-o", "stat=", "-o", "lstart=", "-p", String(pid)];
}

/** What one `ps -o stat= -o lstart=` call says about a pid. */
export type StartProbe = { kind: "alive"; start: string } | { kind: "gone" } | { kind: "unknown" };

/** `ps` exits 1 with nothing printed when no process has the pid (BSD and procps alike). */
const PS_NO_SUCH_PID = 1;

/** Read `ps -o stat= -o lstart=` output and exit code. */
export function probeStart(stdout: string, code: number | null): StartProbe {
  const m = /^\s*(\S+)\s+(.+?)\s*$/.exec(stdout);
  if (code === 0 && m) return m[1]!.startsWith("Z") ? { kind: "gone" } : { kind: "alive", start: m[2]!.replace(/\s+/g, " ") };
  if (code === PS_NO_SUCH_PID && !stdout.trim()) return { kind: "gone" };
  return { kind: "unknown" };
}

/** The start time `ps` printed; null when the pid is gone, a zombie, or the probe could not answer. */
export function parseStart(stdout: string, code: number | null): string | null {
  const p = probeStart(stdout, code);
  return p.kind === "alive" ? p.start : null;
}

/** Whether a probe shows `proc` itself still running; an unknown probe is never dead. */
export function probeAlive(p: StartProbe, proc: ProcessIdentity): boolean {
  return p.kind === "unknown" || (p.kind === "alive" && p.start === proc.pid_start);
}

function probeLocal(pid: number): StartProbe {
  try {
    const r = spawnSyncCaptured(psStartArgv(pid), { env: PS_ENV }); // not a pipe: see spawnSyncCaptured
    return probeStart(r.stdout.toString(), r.exitCode);
  } catch {
    return { kind: "unknown" };
  }
}

/** A process's start time, or null when it is gone, a zombie, `pid` is not a pid, or `ps` cannot answer. */
export function processStart(pid: number): string | null {
  if (!Number.isInteger(pid) || pid < 1) return null;
  const p = probeLocal(pid);
  return p.kind === "alive" ? p.start : null;
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
    if (!Number.isInteger(proc.pid) || proc.pid < 1) return false;
    return probeAlive(probeLocal(proc.pid), proc);
  },
  self() {
    if (!selfId) selfId = selfIdentity(process.pid, processStart(process.pid));
    return selfId;
  },
};

export const defaultLiveness: LivenessCheck = (p) => localProcess.isAlive(p);
