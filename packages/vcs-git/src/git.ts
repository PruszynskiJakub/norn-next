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

export function git(ctx: HostContext, cwd: string, args: string[], input?: string, env?: Record<string, string>): Promise<ExecOutput> {
  const remote = REMOTE_COMMANDS.has(args[0] ?? "");
  return ctx.exec(["git", ...args], { cwd, env: { ...GIT_ENV, ...env }, ...(remote ? { timeoutMs: REMOTE_TIMEOUT_MS } : {}), ...(input === undefined ? {} : { input }) });
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

const WORDS_MAX = 300;

/**
 * A failed call named whole: which git call, in which folder, how it ended and everything git said
 * past its hints. A snapshot that fails ends as a park, and the person reading it has only this line
 * to go on, so a bare exit code or a first line that is a hint leaves them nothing to act on.
 */
export function failedIn<T = never>(out: ExecOutput, what: string, cwd: string): PluginResult<T> {
  const said = out.stderr
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l !== "" && !l.startsWith("hint:"))
    .join(" / ");
  const words = said.length > WORDS_MAX ? `${said.slice(0, WORDS_MAX - 1)}…` : said;
  const ended = out.timedOut ? "timed out" : `exited ${out.code}`;
  return fail(out.timedOut ? "unavailable" : "unknown", `git ${what} in ${cwd} ${ended}${words ? `: ${words}` : " and said nothing"}`);
}

/** The trimmed output of a call that must succeed. */
export async function must(ctx: HostContext, cwd: string, args: string[]): Promise<PluginResult<string>> {
  const out = await git(ctx, cwd, args);
  return out.code === 0 ? { ok: true, value: out.stdout.trim() } : gitFailure(out, args[0] ?? "");
}
