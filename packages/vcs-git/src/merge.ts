/**
 * Merging one commit into the branch checked out in a worktree, never rebasing: a story branch is
 * published, and a rebase would rewrite commits a person or a change request already holds.
 */
import { fail, type HostContext, ok, type PluginResult } from "@norn/plugin-api";
import { git, gitFailure, said } from "./git.ts";
import { notReady, revParse, unmergedPaths } from "./refs.ts";

export type MergeAttempt = { head: string; merged: boolean } | { conflict: { files: string[] } };

export interface MergeOptions {
  /** the merge commit's message; absent, git's own */
  message?: string;
  /** leave a conflicted merge in progress for a resolver rather than aborting it */
  keepConflict?: boolean;
}

/**
 * Merge `rev` into the branch checked out at `cwd` with a merge commit (`--no-ff`), so the story's
 * history shows where the base or a slice came in. A worktree with uncommitted changes or someone's
 * merge in progress is refused before anything changes.
 */
export async function mergeInto(ctx: HostContext, cwd: string, rev: string, opts: MergeOptions = {}): Promise<PluginResult<MergeAttempt>> {
  if (rev.startsWith("-")) return fail("invalid", `git: ${rev} is not a ref`, false);
  const busy = await notReady(ctx, cwd);
  if (!busy.ok) return busy;
  if (busy.value !== null) return fail("conflict", `not merging ${rev}: ${busy.value}`, false);
  const before = await revParse(ctx, cwd, "HEAD");
  if (!before.ok) return before;
  const out = await git(ctx, cwd, ["merge", "--no-ff", "--no-edit", ...(opts.message ? ["-m", opts.message] : []), rev]);
  if (out.code === 0) {
    const head = await revParse(ctx, cwd, "HEAD");
    if (!head.ok) return head;
    if (head.value === null) return fail("unknown", `git merge: no HEAD in ${cwd} after merging ${rev}`);
    return ok({ head: head.value, merged: head.value !== before.value });
  }
  const stopped = await revParse(ctx, cwd, "MERGE_HEAD");
  if (!stopped.ok) return stopped;
  // a merge that never started (an unknown rev, a hook refusing) is a failure, not a conflict
  if (stopped.value === null) return gitFailure(out, `merge ${rev}`, "invalid");
  const files = await unmergedPaths(ctx, cwd);
  if (!files.ok) return files;
  if (!opts.keepConflict) {
    const aborted = await abortMerge(ctx, cwd);
    if (!aborted.ok) return aborted;
  }
  return ok({ conflict: { files: files.value } });
}

/** Undo a stopped merge. The worktree was clean when it began, so nothing of anyone's is lost. */
export async function abortMerge(ctx: HostContext, cwd: string): Promise<PluginResult<void>> {
  const out = await git(ctx, cwd, ["merge", "--abort"]);
  return out.code === 0 ? ok(undefined) : fail("unknown", `git merge --abort in ${cwd}: ${said(out)}`, false);
}
