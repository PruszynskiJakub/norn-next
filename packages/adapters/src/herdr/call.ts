/**
 * The one way norn calls the `herdr` CLI (runner, status pane, cockpit): run a command, map a
 * failure to a PortError, parse its JSON answer; plus the two command sequences they share.
 */
import { type Exec, portError } from "../exec.ts";

/** A herdr command: JSON stdout parsed (plain text as is, empty → null); a failure throws PortError. */
export type HerdrCall = (args: string[]) => Promise<unknown>;

export interface HerdrCallOptions {
  /** herdr binary (default `herdr`) */
  bin?: string;
  /** named Herdr session (`--session <name>`); default = the user's default session */
  session?: string;
  /** H11: bound each call (a timeout is exit 124); default unbounded */
  timeoutMs?: number;
  /**
   * How a failure maps to a PortError. `parsed` (default, runner and status pane): herdr's JSON
   * error code (`session_gone`, `session_blocked`, `herdr_<code>`) and message. `raw` (cockpit):
   * `session_gone` when stderr names a not-found pane/tab/workspace, else `herdr_error`, with the
   * raw stderr as message; plain-text stdout comes back trimmed.
   */
  errors?: "parsed" | "raw";
}

/** Herdr error codes that mean the pane (and so the session) no longer exists. */
const GONE = new Set(["pane_not_found", "tab_not_found", "workspace_not_found"]);

/** argv prefix of every herdr command: the binary and its session. */
export function herdrBase(opts: Pick<HerdrCallOptions, "bin" | "session">): string[] {
  return [opts.bin ?? "herdr", ...(opts.session ? ["--session", opts.session] : [])];
}

/** Run one herdr command; parse JSON stdout (empty stdout → null). Throws PortError on failure. */
export function herdrCaller(exec: Exec, opts: HerdrCallOptions = {}): HerdrCall {
  const base = herdrBase(opts);
  const execOpts = opts.timeoutMs === undefined ? undefined : { timeoutMs: opts.timeoutMs };
  const raw = opts.errors === "raw";
  return async function herdr(args: string[]): Promise<unknown> {
    const r = execOpts ? await exec([...base, ...args], execOpts) : await exec([...base, ...args]);
    if (r.code === 127) throw portError("runner_unavailable", `herdr not runnable: ${r.stderr.trim()}`);
    if (r.code !== 0 && raw) {
      const message = `herdr ${args.slice(0, 2).join(" ")}: ${r.stderr.trim() || `exit ${r.code}`}`;
      throw portError(/"code"\s*:\s*"(pane|tab|workspace)_not_found"/.test(r.stderr) ? "session_gone" : "herdr_error", message);
    }
    if (r.code !== 0) {
      const err = parseError(r.stderr) ?? parseError(r.stdout);
      const code = err?.code ?? "herdr_error";
      const message = `herdr ${args.slice(0, 2).join(" ")}: ${err?.message ?? (r.stderr.trim() || `exit ${r.code}`)}`;
      if (GONE.has(code)) throw portError("session_gone", message);
      if (code === "agent_blocked") throw portError("session_blocked", message, true);
      throw portError(code === "herdr_error" ? code : `herdr_${code}`, message, code === "timeout");
    }
    // Control commands answer JSON; `pane read` and input commands print plain text or nothing.
    const text = r.stdout.trim();
    if (text === "") return null;
    try {
      return JSON.parse(text);
    } catch {
      return raw ? text : r.stdout;
    }
  };
}

function parseError(text: string): { code?: string; message?: string } | null {
  try {
    const parsed = JSON.parse(text.trim()) as { error?: { code?: string; message?: string } };
    return parsed?.error ?? null;
  } catch {
    return null;
  }
}

/** The workspace whose worktree is checked out at `cwd` (`herdr workspace list`), or null. */
export async function workspaceFor(herdr: HerdrCall, cwd: string): Promise<string | null> {
  const list = (await herdr(["workspace", "list"])) as {
    result?: { workspaces?: Array<{ workspace_id: string; worktree?: { checkout_path?: string } }> };
  } | null;
  return list?.result?.workspaces?.find((w) => w.worktree?.checkout_path === cwd)?.workspace_id ?? null;
}

export interface SplitSpec {
  cwd: string;
  direction: "down" | "right";
  /** `--ratio` of the new pane */
  ratio?: string;
  /** split the calling pane (`--current`, running inside Herdr) */
  current: boolean;
  /** the pane's name; cosmetic, a failed rename is ignored */
  title?: string;
  /** shell command run in the new pane */
  command: string;
}

/** Split a pane (focus stays put), name it and run `command` in it: `pane split`, `pane rename`, `pane run`. */
export async function splitAndRun(herdr: HerdrCall, spec: SplitSpec): Promise<{ pane_id: string }> {
  const out = (await herdr([
    "pane",
    "split",
    ...(spec.current ? ["--current"] : []),
    "--direction",
    spec.direction,
    ...(spec.ratio ? ["--ratio", spec.ratio] : []),
    "--cwd",
    spec.cwd,
    "--no-focus",
  ])) as { result?: { pane?: { pane_id?: string } } } | null;
  const paneId = out?.result?.pane?.pane_id;
  if (!paneId) throw portError("launch_failed", "herdr pane split did not return a pane");
  if (spec.title) await herdr(["pane", "rename", paneId, spec.title]).catch(() => null);
  await herdr(["pane", "run", paneId, spec.command]);
  return { pane_id: paneId };
}
