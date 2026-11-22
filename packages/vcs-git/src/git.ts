/**
 * Running git through the host. Every call goes through `ctx.exec` with an explicit `cwd`, so the
 * plugin never depends on the process's own directory and a test drives it with a fake exec.
 */
import { type ExecOutput, fail, type HostContext, type PluginFailureCode, type PluginResult } from "@norn/plugin-api";

/**
 * No prompt can hang a tick (credentials, an editor for a merge message), and git speaks English so
 * a message this plugin tells apart reads the same on every machine.
 */
export const GIT_ENV: Readonly<Record<string, string>> = { GIT_TERMINAL_PROMPT: "0", GIT_EDITOR: "true", LC_ALL: "C" };

/** A call that reaches the remote is bounded, so an unreachable host fails the effect instead of holding the tick. */
export const REMOTE_TIMEOUT_MS = 120_000;
const REMOTE_COMMANDS: ReadonlySet<string> = new Set(["fetch", "push"]);

export function git(ctx: HostContext, cwd: string, args: string[], input?: string): Promise<ExecOutput> {
  const remote = REMOTE_COMMANDS.has(args[0] ?? "");
  return ctx.exec(["git", ...args], { cwd, env: { ...GIT_ENV }, ...(remote ? { timeoutMs: REMOTE_TIMEOUT_MS } : {}), ...(input === undefined ? {} : { input }) });
}

export const lines = (s: string): string[] => s.split("\n").filter((l) => l.length > 0);

/** What a failed git call says: its stderr's first line, else how it ended. */
export function said(out: ExecOutput): string {
  if (out.timedOut) return "timed out";
  const first = out.stderr.trim().split("\n")[0];
  return first ? first : `exit ${out.code}`;
}

export function gitFailure<T = never>(out: ExecOutput, what: string, code: PluginFailureCode = "unknown"): PluginResult<T> {
  return fail(out.timedOut ? "unavailable" : code, `git ${what}: ${said(out)}`);
}

/** The trimmed output of a call that must succeed. */
export async function must(ctx: HostContext, cwd: string, args: string[]): Promise<PluginResult<string>> {
  const out = await git(ctx, cwd, args);
  return out.code === 0 ? { ok: true, value: out.stdout.trim() } : gitFailure(out, args[0] ?? "");
}
