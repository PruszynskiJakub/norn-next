/**
 * A process the tick starts detached and reads back on later ticks: a check, or a worktree's setup.
 * Its wrapper leaves its pid beside the exit file first and the exit file once the command exits
 * (temp file, then `mv`, so a reader sees all of it or none). What one look at it finds:
 * - no handle and no pid file: still starting within the grace, else never started;
 * - exit file present: exited;
 * - no exit file, past the deadline: timed out, with whether the process still runs;
 * - no exit file, process alive: running;
 * - no exit file, process gone: died without recording its exit.
 */
import type { HostContext } from "@norn/plugin-api";

/** A detached process's handle: `<pid>@<start marker>`; the marker is opaque, so only the first `@` splits. */
export function encodeCheckHandle(pid: number, started: string): string {
  return `${pid}@${started}`;
}

/** The handle's pid and start marker; an empty marker (a process found by its pid file) matches the pid alone. */
export function decodeCheckHandle(handle: string): { pid: number; started?: string } | null {
  const at = handle.indexOf("@");
  if (at < 1) return null;
  const pid = Number(handle.slice(0, at));
  if (!Number.isInteger(pid) || pid < 1) return null;
  const started = handle.slice(at + 1);
  return started === "" ? { pid } : { pid, started };
}

/** How long a start recorded without a handle or pid file is taken as still starting, not cut short. */
export const CHECK_START_GRACE_MS = 30_000;

/** What a reader knows of one detached process from its record. */
export interface DetachedSpec {
  /** the handle recorded at the spawn; absent when the start was cut short before it was recorded */
  handle?: string;
  /** when the start was recorded, which the grace and the deadline count from */
  at: string;
  timeoutMs?: number;
  exitPath: string;
  pidPath: string;
}

export type DetachedRead =
  | { kind: "starting" }
  | { kind: "never_started" }
  | { kind: "exited"; handle: string; exitText: string }
  | { kind: "timed_out"; handle: string; alive: boolean }
  | { kind: "running"; handle: string }
  | { kind: "died"; handle: string };

/** The handle of the process a start cut short before recording it made, from the wrapper's pid file. */
export async function handleFromPidFile(ctx: HostContext, pidPath: string): Promise<string | null> {
  const pid = Number((await ctx.files.read(pidPath))?.trim());
  return Number.isInteger(pid) && pid > 0 ? encodeCheckHandle(pid, "") : null;
}

export async function isAlive(ctx: HostContext, handle: string | undefined): Promise<boolean> {
  const h = handle ? decodeCheckHandle(handle) : null;
  if (!h) return false;
  // without a probe the run cannot be told dead; the deadline still ends it
  if (typeof ctx.alive !== "function") return true;
  return ctx.alive(h.pid, h.started);
}

/** One look at a detached process at `now`. */
export async function readDetached(ctx: HostContext, spec: DetachedSpec, now: string): Promise<DetachedRead> {
  let handle = spec.handle;
  if (handle === undefined) {
    const found = await handleFromPidFile(ctx, spec.pidPath);
    if (found === null) {
      // a tick may be between recording the start and its wrapper leaving the pid file: until the grace
      // has passed the start is in flight, and writing it off now would start the process twice
      return Date.parse(now) - Date.parse(spec.at) <= CHECK_START_GRACE_MS ? { kind: "starting" } : { kind: "never_started" };
    }
    handle = found;
  }
  const exitText = await ctx.files.read(spec.exitPath);
  if (exitText !== null) return { kind: "exited", handle, exitText };
  const deadline = spec.timeoutMs !== undefined ? Date.parse(spec.at) + spec.timeoutMs : Number.POSITIVE_INFINITY;
  const alive = await isAlive(ctx, handle);
  if (Date.parse(now) > deadline) return { kind: "timed_out", handle, alive };
  if (alive) return { kind: "running", handle };
  // it may have exited between the first read and the probe
  const late = await ctx.files.read(spec.exitPath);
  if (late !== null) return { kind: "exited", handle, exitText: late };
  return { kind: "died", handle };
}

/** Between TERM to a detached process's group and KILL, while its leader lives on. */
export const CHECK_KILL_GRACE_MS = 2_000;
const STOP_POLL_MS = 100;

export interface StopDeps {
  /** waits between stop's looks; a test passes one that returns at once */
  sleep?: (ms: number) => Promise<void>;
}

const realSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/**
 * End a detached process group: TERM, then KILL once the leader ends or outlives the grace, as a
 * test runner's workers may ignore TERM and outlive the wrapper; a group id is not handed out again
 * while any member lives, so the KILL reaches only what is left of it. One already gone, or a host
 * that cannot kill, is nothing to do.
 */
export async function stopDetached(ctx: HostContext, handle: string, deps: StopDeps = {}): Promise<void> {
  const h = decodeCheckHandle(handle);
  if (!h || typeof ctx.kill !== "function") return;
  const probe = typeof ctx.alive === "function" ? ctx.alive.bind(ctx) : null;
  if (probe && !(await probe(h.pid, h.started))) return;
  await ctx.kill(h.pid, "TERM");
  const sleep = deps.sleep ?? realSleep;
  for (let waited = 0; probe && waited < CHECK_KILL_GRACE_MS; waited += STOP_POLL_MS) {
    await sleep(STOP_POLL_MS);
    if (!(await probe(h.pid, h.started))) break;
  }
  await ctx.kill(h.pid, "KILL");
}
