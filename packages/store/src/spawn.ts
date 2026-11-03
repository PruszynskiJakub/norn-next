/**
 * Bounded child processes (H11). The child leads its own process group; on timeout the whole
 * group is killed, so a grandchild holding the pipes (git → ssh) cannot keep the call open.
 * A connection dropped while the machine slept otherwise never errors and holds the tick lock.
 */
import { spawn } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

export interface BoundedOptions {
  cwd?: string;
  /** full environment for the child; omitted = inherit */
  env?: Record<string, string | undefined>;
  stdin?: string;
  /** kill the process group after this long; omitted = no limit */
  timeoutMs?: number;
  /** true: do not tell the spawn observer (read-only pid probes whose argv differs on every run) */
  unobserved?: boolean;
  /** keep only the last this-many characters of each of stdout and stderr (default: all) */
  maxOutputChars?: number;
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

/**
 * Read a child's pipe to the end, chunk by chunk, so the text read so far survives `stop()` (a
 * grandchild that left the group may hold the pipe open after the kill).
 */
export function drainPipe(stream: ReadableStream<Uint8Array>, onText: (text: string) => void): { done: Promise<void>; stop: () => void } {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  const done = (async () => {
    try {
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        onText(decoder.decode(value, { stream: true }));
      }
      onText(decoder.decode());
    } catch {
      // cancelled by stop(), or the pipe broke: keep what was read
    }
  })();
  return { done, stop: () => void reader.cancel().catch(() => {}) };
}

/** `env` without the keys set to undefined (Bun.spawn wants strings). */
export function definedEnv(env: Record<string, string | undefined>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(env)) if (v !== undefined) out[k] = v;
  return out;
}

/**
 * Run argv, collect its output. Never throws. Uses `Bun.spawn`, not node's `child_process`: under
 * `bun test --parallel` (bun 1.3.13) a `child_process` child sometimes never emits `exit` or
 * `close`, so the call would hang for good.
 */
export async function spawnBounded(argv: string[], opts: BoundedOptions): Promise<BoundedResult> {
  let stdout = "";
  let stderr = "";
  let timedOut = false;
  if (!opts.unobserved) noteSpawn(argv, opts.cwd);
  let child: ReturnType<typeof Bun.spawn<"ignore" | Uint8Array, "pipe", "pipe">>;
  try {
    child = Bun.spawn(argv, {
      ...(opts.cwd === undefined ? {} : { cwd: opts.cwd }),
      env: definedEnv(opts.env ?? process.env),
      detached: true,
      stdin: opts.stdin === undefined ? "ignore" : Buffer.from(opts.stdin, "utf8"),
      stdout: "pipe",
      stderr: "pipe",
    });
  } catch (e) {
    return { code: 127, stdout: "", stderr: e instanceof Error ? e.message : String(e), timed_out: false };
  }
  const cap = opts.maxOutputChars;
  const keep = (text: string) => (cap !== undefined && text.length > cap ? text.slice(text.length - cap) : text);
  const out = drainPipe(child.stdout, (t) => (stdout = keep(stdout + t)));
  const err = drainPipe(child.stderr, (t) => (stderr = keep(stderr + t)));
  let timer: ReturnType<typeof setTimeout> | undefined;
  let grace: ReturnType<typeof setTimeout> | undefined;
  // like child_process "close": the child has exited and both pipes are at their end
  const closed = Promise.all([out.done, err.done, child.exited]).then(() => {});
  const ended =
    opts.timeoutMs === undefined
      ? closed
      : Promise.race([
          closed,
          new Promise<void>((resolve) => {
            timer = setTimeout(() => {
              timedOut = true;
              try {
                process.kill(-child.pid, "SIGKILL");
              } catch {
                child.kill("SIGKILL");
              }
              // a grandchild that left the group may still hold the pipes: stop waiting for them
              grace = setTimeout(() => {
                out.stop();
                err.stop();
                resolve();
              }, KILL_GRACE_MS);
            }, opts.timeoutMs);
          }),
        ]);
  await ended;
  clearTimeout(timer);
  clearTimeout(grace);
  if (timedOut) {
    stderr += `${stderr && !stderr.endsWith("\n") ? "\n" : ""}${argv.slice(0, 2).join(" ")} timed out after ${(opts.timeoutMs ?? 0) / 1000}s (killed)\n`;
    return { code: 124, stdout, stderr, timed_out: true };
  }
  return { code: child.exitCode ?? 1, stdout, stderr, timed_out: false };
}

/** A child started by `spawnDetached`: its pid and a promise that settles when it exits. */
export interface DetachedChild {
  pid: number;
  exited: Promise<void>;
}

/**
 * Start argv in its own process group with no stdio, not waited for: it outlives this process (a
 * `norn check-run`). Does not tell the spawn observer (the caller does, with the argv a transcript
 * should show). Throws when the executable cannot be started. `Bun.spawn`, not child_process (see
 * `spawnBounded`).
 */
export function spawnDetached(argv: string[], opts: { cwd?: string; env: Record<string, string | undefined> }): DetachedChild {
  const child = Bun.spawn(argv, {
    ...(opts.cwd === undefined ? {} : { cwd: opts.cwd }),
    env: definedEnv(opts.env),
    detached: true,
    stdio: ["ignore", "ignore", "ignore"],
  });
  const exited = child.exited.then(() => {});
  child.unref();
  return { pid: child.pid, exited };
}

/**
 * `text` edited by the person in `editor` (a shell command, `code --wait` included) on their
 * terminal — stdin, stdout and stderr inherited — until it exits (D2). Not bounded: the person
 * decides when it ends. The edited text, or null when the editor fails. Never throws.
 */
export async function editInTerminal(text: string, editor: string): Promise<string | null> {
  const dir = mkdtempSync(join(tmpdir(), "norn-edit-"));
  const file = join(dir, "BODY.md");
  try {
    writeFileSync(file, text);
    const argv = ["sh", "-c", `${editor} "$1"`, "sh", file];
    noteSpawn(argv, undefined);
    const code = await new Promise<number>((resolve) => {
      const child = spawn(argv[0] as string, argv.slice(1), { stdio: "inherit" });
      child.on("error", () => resolve(127));
      child.on("close", (c) => resolve(c ?? 1));
    });
    return code === 0 ? readFileSync(file, "utf8") : null;
  } catch {
    return null;
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}
