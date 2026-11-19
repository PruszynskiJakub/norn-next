/** Pushing and fetching: the only calls that reach the remote. */
import { fail, type HostContext, ok, type PluginResult } from "@norn/plugin-api";
import { git, said } from "./git.ts";
import { PUBLISHED_PREFIX, publishedCopyPrefix } from "./heads.ts";
import { remoteIfAny } from "./refs.ts";

export interface PushOutcome {
  /** false when the repo has no such remote: nothing to push to */
  pushed: boolean;
}

/**
 * Push `branch` to the same name on `remote`. With `lease`, the remote branch must still be at that
 * commit (`""`: must not exist), so a push never overwrites work someone pushed meanwhile; without
 * it only a fast-forward goes through. A refused push is `conflict`: pushing again unchanged cannot help.
 */
export async function pushBranch(ctx: HostContext, cwd: string, remote: string, branch: string, lease?: string): Promise<PluginResult<PushOutcome>> {
  if (branch.startsWith("-")) return fail("invalid", `git: ${branch} is not a branch`, false);
  const has = await remoteIfAny(ctx, cwd, remote);
  if (!has.ok) return has;
  if (has.value === null) return ok({ pushed: false });
  const ref = `refs/heads/${branch}`;
  const args = ["push", "--porcelain", ...(lease === undefined ? [] : [`--force-with-lease=${ref}:${lease}`]), remote, `${ref}:${ref}`];
  const out = await git(ctx, cwd, args);
  if (out.code === 0) return ok({ pushed: true });
  if (/\[(remote )?rejected\]|stale info|non-fast-forward|fetch first/.test(`${out.stdout}\n${out.stderr}`))
    return fail("conflict", `git push of ${branch} to ${remote} refused: ${rejection(out.stdout) ?? said(out)}`, false);
  // an unreachable remote or a timeout: the same push may go through later
  return fail("unavailable", `git push of ${branch} to ${remote}: ${said(out)}`);
}

/** The porcelain line that says why a ref was refused. */
function rejection(stdout: string): string | null {
  const line = stdout.split("\n").find((l) => l.startsWith("!"));
  return line ? line.split("\t").slice(2).join(" ").trim() || null : null;
}

/**
 * Fetch every branch of `remote` and its published heads; a repo without that remote has nothing to
 * fetch. Both refspecs are named, so one round trip brings both and prunes what the remote dropped.
 */
export async function fetchRemote(ctx: HostContext, cwd: string, remote: string): Promise<PluginResult<{ fetched: boolean }>> {
  const has = await remoteIfAny(ctx, cwd, remote);
  if (!has.ok) return has;
  if (has.value === null) return ok({ fetched: false });
  const branches = `+refs/heads/*:refs/remotes/${remote}/*`;
  const heads = `+${PUBLISHED_PREFIX}*:${publishedCopyPrefix(remote)}*`;
  const out = await git(ctx, cwd, ["fetch", "--quiet", "--no-tags", "--prune", remote, branches, heads]);
  return out.code === 0 ? ok({ fetched: true }) : fail("unavailable", `git fetch ${remote}: ${said(out)}`);
}
