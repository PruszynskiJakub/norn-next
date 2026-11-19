/**
 * The two git questions this forge asks, through the host's exec. A refusal git gives on purpose
 * (no such ref, not an ancestor) is an answer; anything else is a failure, never read as "no".
 */
import { type ExecOutput, fail, type HostContext, ok, type PluginResult } from "@norn/plugin-api";

function gitFailure<T>(argv: string[], out: ExecOutput): PluginResult<T> {
  const why = out.timedOut ? "timed out" : out.stderr.trim() || `exit ${out.code}`;
  return fail("unavailable", `git ${argv.join(" ")}: ${why}`);
}

async function git(ctx: HostContext, args: string[]): Promise<{ argv: string[]; out: ExecOutput } | PluginResult<never>> {
  try {
    return { argv: args, out: await ctx.exec(["git", ...args], { cwd: ctx.repo.root }) };
  } catch (e) {
    return fail("unavailable", `git ${args.join(" ")}: ${e instanceof Error ? e.message : String(e)}`);
  }
}

/** The commit `ref` names, or null when there is no such ref. */
export async function revParse(ctx: HostContext, ref: string): Promise<PluginResult<string | null>> {
  const r = await git(ctx, ["rev-parse", "--verify", "--quiet", `${ref}^{commit}`]);
  if ("ok" in r) return r;
  // --verify --quiet exits 1 with no output for a missing ref; every other exit is git failing
  if (r.out.code === 1 && !r.out.timedOut) return ok(null);
  const sha = r.out.stdout.trim();
  if (r.out.code !== 0 || !/^[0-9a-f]{40}([0-9a-f]{24})?$/.test(sha)) return gitFailure(r.argv, r.out);
  return ok(sha);
}

/**
 * The commit a change's base branch is at: the local branch, else the remote's copy of it. A clone
 * holds only the remote's default branch locally, so a story on another base (`develop`) finds that
 * base only as `origin/develop`, which is also where a teammate's merge into it lands. `origin` is
 * the remote the vcs pushes to unless its config names another.
 */
export async function baseTip(ctx: HostContext, branch: string): Promise<PluginResult<string | null>> {
  const local = await revParse(ctx, branch);
  if (!local.ok || local.value !== null) return local;
  return revParse(ctx, `refs/remotes/origin/${branch}`);
}

/** Whether commit `a` is reachable from commit `b`. */
export async function isAncestor(ctx: HostContext, a: string, b: string): Promise<PluginResult<boolean>> {
  if (a === b) return ok(true);
  const r = await git(ctx, ["merge-base", "--is-ancestor", a, b]);
  if ("ok" in r) return r;
  if (r.out.timedOut) return gitFailure(r.argv, r.out);
  if (r.out.code === 0) return ok(true);
  if (r.out.code === 1) return ok(false);
  return gitFailure(r.argv, r.out);
}
