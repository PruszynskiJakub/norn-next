import { closeSync, mkdirSync, openSync } from "node:fs";
import { dirname } from "node:path";
import type { HostProcesses, KillSignal, SpawnedProcess, SpawnOptions } from "@norn/plugin-api";
import { nodeExec } from "./exec.ts";

/** `ps` in the C locale, so the start time it prints reads the same on every machine and every call. */
const PS_ENV = { LC_ALL: "C", LANG: "C" };
/** `ps` exits 1 with nothing printed when no process has the pid (BSD and procps alike). */
const PS_NO_SUCH_PID = 1;

type Probe = { kind: "alive"; start: string } | { kind: "gone" } | { kind: "unknown" };

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
  const p = await probe(pid);
  // a process gone before its start time was read gets a marker no live process can match, so it reads as dead
  return { pid, started: p.kind === "alive" ? p.start : `gone:${pid}` };
}

async function alive(pid: number, started?: string): Promise<boolean> {
  const p = await probe(pid);
  if (p.kind === "unknown") return true;
  return p.kind === "alive" && (started === undefined || p.start === started);
}

function errno(e: unknown): string | undefined {
  return (e as NodeJS.ErrnoException | undefined)?.code;
}

async function kill(pid: number, signal: KillSignal = "TERM"): Promise<void> {
  if (!Number.isInteger(pid) || pid < 1) return;
  const sig = signal === "KILL" ? "SIGKILL" : "SIGTERM";
  try {
    process.kill(-pid, sig);
    return;
  } catch (e) {
    if (errno(e) !== "ESRCH" && errno(e) !== "EPERM") throw e;
  }
  // not a group leader after all (or the group is gone): the pid alone
  try {
    process.kill(pid, sig);
  } catch (e) {
    if (errno(e) !== "ESRCH") throw e;
  }
}

/** Detached processes on this machine. */
export const nodeProcesses: HostProcesses = { spawn, alive, kill };
