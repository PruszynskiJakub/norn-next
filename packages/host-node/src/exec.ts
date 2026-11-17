import type { ExecOptions, ExecOutput } from "@norn/plugin-api";

/** The exit code a timed-out process reports, as `timeout(1)` does, so a caller can tell it from the process's own codes. */
export const TIMEOUT_CODE = 124;
/** The exit code for an executable that could not be started, as a shell reports it: a missing binary is data, never a throw. */
export const NOT_STARTED_CODE = 127;

/** After the group is killed, how long to wait for the pipes to close before giving up on them. */
const KILL_GRACE_MS = 2_000;

/**
 * Read a pipe to its end chunk by chunk, so the text read so far survives `stop()`: a grandchild that
 * left the process group may hold the pipe open after the kill.
 */
function drain(stream: ReadableStream<Uint8Array>): { text: () => string; done: Promise<void>; stop: () => void } {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let text = "";
  const done = (async () => {
    try {
      for (;;) {
        const { value, done: end } = await reader.read();
        if (end) break;
        text += decoder.decode(value, { stream: true });
      }
      text += decoder.decode();
    } catch {
      // cancelled by stop(), or the pipe broke: keep what was read
    }
  })();
  return { text: () => text, done, stop: () => void reader.cancel().catch(() => {}) };
}

function mergedEnv(extra: Record<string, string> | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(process.env)) if (v !== undefined) out[k] = v;
  return { ...out, ...(extra ?? {}) };
}

/**
 * Run argv and collect its output; never throws. The child leads its own process group so a timeout
 * kills the whole group: a grandchild holding the pipes (git → ssh) cannot keep the call open.
 * `Bun.spawn`, not `child_process`: under `bun test --parallel` a `child_process` child sometimes
 * never emits `close`, and the call would hang for good.
 */
export async function nodeExec(argv: string[], opts: ExecOptions = {}): Promise<ExecOutput> {
  let child: ReturnType<typeof Bun.spawn<"ignore" | Uint8Array, "pipe", "pipe">>;
  try {
    child = Bun.spawn(argv, {
      ...(opts.cwd === undefined ? {} : { cwd: opts.cwd }),
      env: mergedEnv(opts.env),
      detached: true,
      stdin: opts.input === undefined ? "ignore" : Buffer.from(opts.input, "utf8"),
      stdout: "pipe",
      stderr: "pipe",
    });
  } catch (e) {
    return { code: NOT_STARTED_CODE, stdout: "", stderr: e instanceof Error ? e.message : String(e), timedOut: false };
  }
  const out = drain(child.stdout);
  const err = drain(child.stderr);
  const closed = Promise.all([out.done, err.done, child.exited]).then(() => {});
  let timedOut = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let grace: ReturnType<typeof setTimeout> | undefined;
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
  if (timedOut) return { code: TIMEOUT_CODE, stdout: out.text(), stderr: err.text(), timedOut: true };
  return { code: child.exitCode ?? 1, stdout: out.text(), stderr: err.text(), timedOut: false };
}
