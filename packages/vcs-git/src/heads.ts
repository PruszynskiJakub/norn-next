/**
 * Published heads: a unit branch's commit pushed to a ref of the remote that only norn reads, so a
 * clone that carries the unit on after a takeover starts from the work, not from the base. Never a
 * branch, so a publish starts no build and opens nothing on a code host. The tick's fetch brings the
 * remote's published heads into a namespace of this clone per remote, read as a branch's remote copy.
 */
import { fail, type HostContext, ok, type PluginResult } from "@norn/plugin-api";
import { git, said } from "./git.ts";
import { isAncestor, remoteIfAny, revParse } from "./refs.ts";

/** where the remote keeps a branch's published head */
export const PUBLISHED_PREFIX = "refs/norn/heads/";
/** where this clone keeps what it last fetched of `remote`'s published heads */
export const publishedCopyPrefix = (remote: string): string => `refs/norn/remote-heads/${remote}/`;

export const publishedRef = (branch: string): string => `${PUBLISHED_PREFIX}${branch}`;
export const publishedCopyRef = (remote: string, branch: string): string => `${publishedCopyPrefix(remote)}${branch}`;

/**
 * Push `branch` to its published head on `remote`, fast-forward only. The lease is this clone's copy
 * of the published head, so a publish never overwrites one another clone made since the last fetch:
 * that is refused, and the next fetch shows it.
 */
export async function publishHead(ctx: HostContext, cwd: string, remote: string, branch: string): Promise<PluginResult<{ pushed: boolean }>> {
  if (branch.startsWith("-")) return fail("invalid", `git: ${branch} is not a branch`, false);
  const has = await remoteIfAny(ctx, cwd, remote);
  if (!has.ok) return has;
  if (has.value === null) return ok({ pushed: false });
  const local = await revParse(ctx, cwd, `refs/heads/${branch}`);
  if (!local.ok) return local;
  if (local.value === null) return ok({ pushed: false });
  const copy = publishedCopyRef(remote, branch);
  const seen = await revParse(ctx, cwd, copy);
  if (!seen.ok) return seen;
  if (seen.value === local.value) return ok({ pushed: false });
  if (seen.value !== null) {
    const behind = await isAncestor(ctx, cwd, local.value, seen.value);
    if (!behind.ok) return behind;
    // another clone carried the branch further: its work is the newer, and this clone takes it in when it cuts a worktree
    if (behind.value) return ok({ pushed: false });
    const builtOn = await isAncestor(ctx, cwd, seen.value, local.value);
    if (!builtOn.ok) return builtOn;
    if (!builtOn.value) return fail("conflict", `the published head of ${branch} on ${remote} and this clone's ${branch} have diverged; neither is pushed over the other`, false);
  }
  const target = publishedRef(branch);
  const out = await git(ctx, cwd, ["push", "--porcelain", `--force-with-lease=${target}:${seen.value ?? ""}`, remote, `${local.value}:${target}`]);
  if (out.code !== 0) {
    if (/\[(remote )?rejected\]|stale info|non-fast-forward|fetch first/.test(`${out.stdout}\n${out.stderr}`))
      return fail("conflict", `the published head of ${branch} on ${remote} moved since this clone last fetched it`, false);
    return fail("unavailable", `git push of ${branch}'s published head to ${remote}: ${said(out)}`);
  }
  // the copy records only what the remote is known to hold; a racing publish that moved it further wins
  await git(ctx, cwd, ["update-ref", copy, local.value, seen.value ?? ""]);
  return ok({ pushed: true });
}
