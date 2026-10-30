/**
 * Bounded child processes (H11). The child leads its own process group; on timeout the whole
 * group is killed, so a grandchild holding the pipes (git → ssh) cannot keep the call open.
 * A connection dropped while the machine slept otherwise never errors and holds the tick lock.
 */
import { spawn } from "node:child_process";

export interface BoundedOptions {
  cwd?: string;
  /** full environment for the child; omitted = inherit */
  env?: Record<string, string | undefined>;
  stdin?: string;
  /** kill the process group after this long; omitted = no limit */
  timeoutMs?: number;
  /** true: do not tell the spawn observer (read-only pid probes whose argv differs on every run) */
  unobserved?: boolean;
}

export interface BoundedResult {
  /** exit code; 124 when killed by the timeout, 127 when the executable could not be started */
  code: number;
  stdout: string;
  stderr: string;
  timed_out: boolean;
}

/** One child process norn is about to start: what an effect transcript records (refactor Phase 0.2). */
export interface SpawnRecord {
  argv: readonly string[];
  cwd: string | undefined;
}

export type SpawnObserver = (spawned: SpawnRecord) => void;

let observer: SpawnObserver | null = null;

/**
 * Test hook: call `fn` with each argv + cwd before it is spawned (`spawnBounded`, store's sync git
 * calls, and every other spawn that calls `noteSpawn`: check commands, `gitRemoteUrl`, adapters'
 * `bunExec`, the headless launch, doctor's probes; the read-only `ps`/`lsof` pid probes are left
 * out). `null` (the default) turns it off. Returns the observer it replaced. The observer
 * only watches; it cannot change or stop the spawn, and one that throws is ignored.
 */
export function setSpawnObserver(fn: SpawnObserver | null): SpawnObserver | null {
  const prev = observer;
  observer = fn;
  return prev;
}

/** Tell the observer, if any, about a spawn that does not go through `spawnBounded`. */
export function noteSpawn(argv: readonly string[], cwd: string | undefined): void {
  if (!observer) return;
  try {
    observer({ argv: [...argv], cwd });
  } catch {
    // an observer never changes what norn does
  }
}

/** After the group is killed, how long to wait for the pipes to close before giving up on them. */
const KILL_GRACE_MS = 2_000;

/** Run argv, collect its output. Never throws. */
export function spawnBounded(argv: string[], opts: BoundedOptions): Promise<BoundedResult> {
  return new Promise((resolve) => {
    let stdout = "";
    let stderr = "";
    let timedOut = false;
    let settled = false;
    let grace: ReturnType<typeof setTimeout> | undefined;
    if (!opts.unobserved) noteSpawn(argv, opts.cwd);
    const child = spawn(argv[0] as string, argv.slice(1), {
      cwd: opts.cwd,
      env: (opts.env ?? process.env) as NodeJS.ProcessEnv,
      detached: true,
      stdio: [opts.stdin === undefined ? "ignore" : "pipe", "pipe", "pipe"],
    });
    child.stdout?.on("data", (b: Buffer) => (stdout += b.toString("utf8")));
    child.stderr?.on("data", (b: Buffer) => (stderr += b.toString("utf8")));
    const finish = (code: number) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      clearTimeout(grace);
      if (timedOut) stderr += `${stderr && !stderr.endsWith("\n") ? "\n" : ""}${argv.slice(0, 2).join(" ")} timed out after ${(opts.timeoutMs ?? 0) / 1000}s (killed)\n`;
      resolve({ code: timedOut ? 124 : code, stdout, stderr, timed_out: timedOut });
    };
    const timer =
      opts.timeoutMs === undefined
        ? undefined
        : setTimeout(() => {
            timedOut = true;
            try {
              if (child.pid) process.kill(-child.pid, "SIGKILL");
            } catch {
              child.kill("SIGKILL");
            }
            // a grandchild that left the group may still hold the pipes: stop waiting for them
            grace = setTimeout(() => {
              child.stdout?.destroy();
              child.stderr?.destroy();
              finish(124);
            }, KILL_GRACE_MS);
          }, opts.timeoutMs);
    child.on("error", (e) => {
      stderr += e.message;
      finish(127);
    });
    child.on("close", (code) => finish(code ?? 1));
    if (opts.stdin !== undefined) child.stdin?.end(opts.stdin);
  });
}
