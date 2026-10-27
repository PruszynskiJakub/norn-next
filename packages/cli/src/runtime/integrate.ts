/**
 * Git step logic over GitPort: W2 `git: integrate`, BS3.3a remote story branch sync and W2
 * `git: update`. These choose between outcomes (conflict, stuck, adopt, merge), so they live in
 * the cli runtime rather than the git adapter: ports never decide (AGENTS.md), they perform one
 * effect each.
 */
import { git as gitAdapter } from "@norn/adapters";
import type { GitPort } from "@norn/core";

const { portError } = gitAdapter;

export type IntegrateResult = { outcome: "done"; head: string } | { outcome: "conflict"; files: string[] };

/**
 * W2 `git: integrate`: rebase the slice branch (checked out in `sliceCwd`) onto the story
 * branch, then fast-forward the story branch to it. A conflicting rebase is aborted cleanly
 * and yields `conflict` (K6). The caller serializes integrations per story (K6).
 * If the story branch is checked out in a worktree it is fast-forwarded there (keeps that
 * checkout in sync); otherwise its ref is moved with a compare-and-swap.
 */
export async function integrate(git: GitPort, opts: { sliceCwd: string; storyBranch: string; storyCwd?: string }): Promise<IntegrateResult> {
  const rb = await git.rebase(opts.sliceCwd, opts.storyBranch);
  if (!rb.ok) return { outcome: "conflict", files: rb.files };
  const storyRef = `refs/heads/${opts.storyBranch}`;
  let storyCwd = opts.storyCwd;
  if (!storyCwd) storyCwd = (await git.worktreeList(opts.sliceCwd)).find((w) => w.branch === opts.storyBranch)?.path;
  if (storyCwd) {
    const ff = await git.fastForward(storyCwd, rb.head);
    if (!ff.ok) throw portError("git_ff_failed", `cannot fast-forward ${opts.storyBranch} to ${rb.head} in ${storyCwd}`);
    return { outcome: "done", head: rb.head };
  }
  const old = await git.readRef(opts.sliceCwd, storyRef);
  if (old === null) throw portError("git_no_branch", `story branch ${opts.storyBranch} does not exist`);
  if (!(await git.isAncestor(opts.sliceCwd, old, rb.head)) || !(await git.updateRef(opts.sliceCwd, { ref: storyRef, sha: rb.head, expected: old })))
    throw portError("git_ff_failed", `cannot fast-forward ${opts.storyBranch} to ${rb.head}`, true);
  return { outcome: "done", head: rb.head };
}

export type UpdateResult =
  | { outcome: "done"; head: string; merged: boolean; adopted: string | null }
  | { outcome: "conflict"; files: string[]; adopted: string | null }
  | { outcome: "stuck"; reason: string };

/**
 * BS3.3a: how the local story branch took in `<remote>/<branch>` — `none` (no remote branch),
 * `local` (nothing new on the remote), `adopted` (fast-forwarded to it), `merged` (a merge commit),
 * or `conflict` (diverged and the merge was aborted, paths reported).
 */
export type RemoteSync =
  | { outcome: "none" | "local"; remote_sha: string | null }
  | { outcome: "adopted" | "merged"; remote_sha: string; head: string }
  | { outcome: "conflict"; remote_sha: string; files: string[] };

/**
 * BS3.3a (dogfood D4): bring the remote story branch into the local one checked out in `cwd` —
 * fetch it; fast-forward when the local branch is an ancestor of it (a person pressed "Update
 * branch"); when they diverged (a person pushed while norn committed locally), merge it with
 * `message` and `trailers` (never rebase: the branch is published, BS4). A conflicting merge is
 * aborted and its paths reported. The caller holds the claim (T7) and pushes afterwards.
 */
export async function syncRemoteBranch(
  git: GitPort,
  opts: { cwd: string; branch: string; remote: string; message: string; trailers: Record<string, string> },
): Promise<RemoteSync> {
  const tracking = `refs/remotes/${opts.remote}/${opts.branch}`;
  try {
    await git.fetch(opts.cwd, opts.remote, [`+refs/heads/${opts.branch}:${tracking}`]);
  } catch (e) {
    // a story branch never pushed has nothing to take in; anything else is a failed effect (R4.3)
    if (!/couldn't find remote ref|could not find remote ref/i.test((e as Error).message)) throw e;
    return { outcome: "none", remote_sha: null };
  }
  const remoteSha = await git.readRef(opts.cwd, tracking);
  const local = await git.revParse(opts.cwd, "HEAD");
  if (!remoteSha || !local || remoteSha === local || (await git.isAncestor(opts.cwd, remoteSha, local))) return { outcome: "local", remote_sha: remoteSha };
  if (await git.isAncestor(opts.cwd, local, remoteSha)) {
    const ff = await git.fastForward(opts.cwd, remoteSha);
    if (!ff.ok) throw portError("git_ff_failed", `cannot fast-forward ${opts.branch} to ${opts.remote}/${opts.branch}`);
    return { outcome: "adopted", remote_sha: remoteSha, head: remoteSha };
  }
  const m = await git.merge(opts.cwd, remoteSha, { message: opts.message, trailers: opts.trailers });
  return m.ok ? { outcome: "merged", remote_sha: remoteSha, head: m.head } : { outcome: "conflict", remote_sha: remoteSha, files: m.files };
}

/**
 * W2 `git: update` (BS3, BS4) in the story worktree `cwd`, whose branch is `branch`. The caller
 * holds the story's integrate lock (K6) and pushes afterwards (S8, T7).
 *  1. a dirty worktree → `stuck` (`worktree dirty`);
 *  3. the remote story branch ahead of the local one and descended from it (a person pressed
 *     "Update branch" on the host) → fast-forward to it first; diverged → merge it (BS3.3a), and a
 *     conflicting merge of it → `stuck`;
 *  4. nothing of `baseSha` missing → `done`, no commit;
 *  5. else `git merge --no-ff <baseSha>` with `message` and `trailers` (`Norn-Tick`, so Q6 does
 *     not report the merge as foreign) → `done`;
 *  6. a conflicting merge is aborted → `conflict` with the paths.
 * Merge, never rebase: the story branch is published (BS4).
 */
export async function update(
  git: GitPort,
  opts: { cwd: string; branch: string; baseSha: string; remote: string | null; message: string; trailers: Record<string, string> },
): Promise<UpdateResult> {
  const st = await git.status(opts.cwd);
  // H1: a merge or rebase left in progress (a resolve agent's) is never aborted or concluded here
  const busy = await git.inProgress(opts.cwd);
  if (busy.operation || busy.unmerged.length) return { outcome: "stuck", reason: `${busy.operation ?? "merge"} in progress in the story worktree` };
  if (!st.clean || st.rebase_in_progress) return { outcome: "stuck", reason: "worktree dirty" };
  if (st.branch !== opts.branch) return { outcome: "stuck", reason: `story worktree is on ${st.branch ?? "a detached HEAD"}, not ${opts.branch}` };
  let adopted: string | null = null;
  if (opts.remote) {
    const where = `${opts.remote}/${opts.branch}`;
    const r = await syncRemoteBranch(git, { cwd: opts.cwd, branch: opts.branch, remote: opts.remote, message: `Merge ${where} into ${opts.branch}`, trailers: opts.trailers });
    if (r.outcome === "conflict") return { outcome: "stuck", reason: `story branch diverged from ${where}; merging it conflicts in ${r.files.join(", ") || "?"}` };
    if (r.outcome === "adopted" || r.outcome === "merged") adopted = r.remote_sha;
  }
  const d = await git.divergence(opts.cwd, "HEAD", opts.baseSha);
  if (d.behind === 0) return { outcome: "done", head: (await git.revParse(opts.cwd, "HEAD")) as string, merged: false, adopted };
  const m = await git.merge(opts.cwd, opts.baseSha, { message: opts.message, trailers: opts.trailers });
  if (!m.ok) return { outcome: "conflict", files: m.files, adopted };
  return { outcome: "done", head: m.head, merged: true, adopted };
}
