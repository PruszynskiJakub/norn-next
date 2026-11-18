import { closeSync, mkdirSync, openSync } from "node:fs";
import { dirname } from "node:path";
import type { HostProcesses, KillSignal, SpawnedProcess, SpawnOptions } from "@norn/plugin-api";
import { nodeExec } from "./exec.ts";

/** `ps` in the C locale, so the start time it prints reads the same on every machine and every call. */
const PS_ENV = { LC_ALL: "C", LANG: "C" };
/** `ps` exits 1 with nothing printed when no process has the pid (BSD and procps alike). */
const PS_NO_SUCH_PID = 1;

export type Probe = { kind: "alive"; start: string } | { kind: "gone" } | { kind: "unknown" };

/** What `ps -o stat= -o lstart=` says about a pid. A zombie has exited, whatever its parent has yet to reap. */
export function readStartProbe(stdout: string, code: number): Probe {
  const m = /^\s*(\S+)\s+(.+?)\s*$/.exec(stdout);
  if (code === 0 && m) return (m[1] as string).startsWith("Z") ? { kind: "gone" } : { kind: "alive", start: (m[2] as string).replace(/\s+/g, " ") };
  if (code === PS_NO_SUCH_PID && !stdout.trim()) return { kind: "gone" };
  return { kind: "unknown" };
}

async function probe(pid: number): Promise<Probe> {
  if (!Number.isInteger(pid) || pid < 1) return { kind: "gone" };
  const out = await nodeExec(["ps", "-o", "stat=", "-o", "lstart=", "-p", String(pid)], { env: PS_ENV, timeoutMs: 5_000 });
  return readStartProbe(out.stdout, out.code);
}

/** The marker of a process whose start time no probe read; it matches whatever runs under the pid. */
const UNPROBED = "unprobed:";
/** Looks a spawn takes at a new process's start time before it settles for an unprobed marker. */
const SPAWN_PROBES = 3;

/**
 * The start marker a spawn hands back from its probe. A process gone before its start time was read
 * gets a marker no live process can match, so it reads as dead; a probe that could not answer says
 * nothing of the kind, so its process is not written off: it gets a marker that matches the pid alone.
 */
export function startMarker(pid: number, p: Probe): string {
  if (p.kind === "alive") return p.start;
  return p.kind === "gone" ? `gone:${pid}` : `${UNPROBED}${pid}`;
}

/** Whether a probe shows the process a marker names; a probe that cannot answer is alive. */
export function probeMatches(p: Probe, started: string | undefined): boolean {
  if (p.kind === "unknown") return true;
  if (p.kind === "gone") return false;
  return started === undefined || started.startsWith(UNPROBED) || p.start === started;
}

function definedEnv(extra: Record<string, string> | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(process.env)) if (v !== undefined) out[k] = v;
  return { ...out, ...(extra ?? {}) };
}

/**
 * Start argv detached in its own process group with stdout and stderr appended to the log, and
 * return without waiting. `Bun.spawn`, not `child_process`, as in exec.ts. The child is unref'd so
 * this process may exit while it runs.
 */
async function spawn(argv: string[], opts: SpawnOptions): Promise<SpawnedProcess> {
  mkdirSync(dirname(opts.logPath), { recursive: true });
  const fd = openSync(opts.logPath, "a");
  let pid: number;
  try {
    const child = Bun.spawn(argv, { cwd: opts.cwd, env: definedEnv(opts.env), detached: true, stdio: ["ignore", fd, fd] });
    child.unref();
    pid = child.pid;
  } finally {
    closeSync(fd);
  }
  let p = await probe(pid);
  for (let i = 1; i < SPAWN_PROBES && p.kind === "unknown"; i++) p = await probe(pid);
  return { pid, started: startMarker(pid, p) };
}

async function alive(pid: number, started?: string): Promise<boolean> {
  return probeMatches(await probe(pid), started);
}

function errno(e: unknown): string | undefined {
  return (e as NodeJS.ErrnoException | undefined)?.code;
}

/**
 * Signal the group a spawn made. No group under the id means the run is over: the pid alone is not
 * tried then, as once the group is gone the pid may be another program's. Only a group that refuses
 * the signal (EPERM, a member under another user) falls back to the leader alone.
 */
async function kill(pid: number, signal: KillSignal = "TERM"): Promise<void> {
  if (!Number.isInteger(pid) || pid < 1) return;
  const sig = signal === "KILL" ? "SIGKILL" : "SIGTERM";
  try {
    process.kill(-pid, sig);
    return;
  } catch (e) {
    if (errno(e) === "ESRCH") return;
    if (errno(e) !== "EPERM") throw e;
  }
  try {
    process.kill(pid, sig);
  } catch (e) {
    if (errno(e) !== "ESRCH") throw e;
  }
}

/** Detached processes on this machine. */
export const nodeProcesses: HostProcesses = { spawn, alive, kill };
