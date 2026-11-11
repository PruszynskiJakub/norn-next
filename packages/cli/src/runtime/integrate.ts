/**
 * Git step logic over GitPort: `git: integrate`, remote story branch sync and `git: update`.
 * These choose between outcomes (conflict, stuck, adopt, merge), so they live in
 * the cli runtime rather than the git adapter: ports never decide, they perform one
 * effect each.
 */
import { git as gitAdapter } from "@norn/adapters";
import { type GitPort, REGENERATED_TRAILER, regenerateEntriesFor } from "@norn/core";
import { parseDuration, REGENERATE_TIMEOUT, type RegenerateEntry } from "@norn/schema";

const { portError } = gitAdapter;

export type IntegrateResult = { outcome: "done"; head: string } | { outcome: "conflict"; files: string[] };

/**
 * `git: integrate`: rebase the slice branch (checked out in `sliceCwd`) onto the story
 * branch — or merge the story branch in when the slice already merged it once (`trailers`
 * on that merge commit) — then fast-forward the story branch to it. A conflicting rebase or merge
 * is aborted cleanly and yields `conflict`. The caller serializes integrations per story.
 * If the story branch is checked out in a worktree it is fast-forwarded there (keeps that
 * checkout in sync); otherwise its ref is moved with a compare-and-swap.
 */
export async function integrate(
  git: GitPort,
  opts: { sliceCwd: string; storyBranch: string; storyCwd?: string; trailers?: Record<string, string> },
): Promise<IntegrateResult> {
  const rb = await bringInStory(git, opts.sliceCwd, opts.storyBranch, opts.trailers ?? {});
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

/**
 * A slice whose merge step merged the story branch in (a merge on the ancestry
 * path from its fork point) takes the story branch in by merging again, never by rebasing: a
 * rebase linearises the resolution away (or re-creates the merge on a story tip that moved on)
 * and the same conflict comes back, spending `conflict_loop` twice on one conflict.
 */
async function bringInStory(git: GitPort, cwd: string, storyBranch: string, trailers: Record<string, string>) {
  const fork = (await git.divergence(cwd, "HEAD", storyBranch)).merge_base;
  if (!fork || !(await git.baseMergeCommit(cwd, fork, "HEAD"))) return git.rebase(cwd, storyBranch);
  return git.merge(cwd, storyBranch, { message: `Merge ${storyBranch} into the slice`, trailers });
}

export type UpdateResult =
  | { outcome: "done"; head: string; merged: boolean; adopted: string | null; regenerated?: string[]; base_side?: string[] }
  | { outcome: "conflict"; files: string[]; adopted: string | null; regenerate?: { output: string } }
  | { outcome: "stuck"; reason: string };

/** What a base update may complete without an agent: the team's generated files, and a branch holding only its spec folder. */
export interface UpdateRegenerate {
  /** the story's spec folder, repo-relative */
  specDir: string;
  entries: readonly RegenerateEntry[];
  /** run one command at the story worktree's root, killed after `timeoutMs`; `output` says how it ended */
  run(command: string, timeoutMs: number): Promise<{ ok: boolean; output: string }>;
}

/**
 * How the local story branch took in `<remote>/<branch>` — `none` (no remote branch),
 * `local` (nothing new on the remote), `adopted` (fast-forwarded to it), `merged` (a merge commit),
 * or `conflict` (diverged and the merge was aborted, paths reported).
 */
export type RemoteSync =
  | { outcome: "none" | "local"; remote_sha: string | null }
  | { outcome: "adopted" | "merged"; remote_sha: string; head: string }
  | { outcome: "conflict"; remote_sha: string; files: string[] };

/**
 * Bring the remote story branch into the local one checked out in `cwd` —
 * fetch it; fast-forward when the local branch is an ancestor of it (a person pressed "Update
 * branch"); when they diverged (a person pushed while norn committed locally), merge it with
 * `message` and `trailers` (never rebase: the branch is published). A conflicting merge is
 * aborted and its paths reported. The caller holds the claim and pushes afterwards.
 */
export async function syncRemoteBranch(
  git: GitPort,
  opts: { cwd: string; branch: string; remote: string; message: string; trailers: Record<string, string> },
): Promise<RemoteSync> {
  const tracking = `refs/remotes/${opts.remote}/${opts.branch}`;
  try {
    await git.fetch(opts.cwd, opts.remote, [`+refs/heads/${opts.branch}:${tracking}`]);
  } catch (e) {
    // a story branch never pushed has nothing to take in; anything else is a failed effect
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
 * `git: update` in the story worktree `cwd`, whose branch is `branch`. The caller
 * holds the story's integrate lock and pushes afterwards.
 *  1. a dirty worktree → `stuck` (`worktree dirty`);
 *  2. the remote story branch ahead of the local one and descended from it (a person pressed
 *     "Update branch" on the host) → fast-forward to it first; diverged → merge it, and a
 *     conflicting merge of it → `stuck`;
 *  3. nothing of `baseSha` missing → `done`, no commit;
 *  4. else `git merge --no-ff <baseSha>` with `message` and `trailers` (`Norn-Tick`, so the merge is
 *     not reported as foreign) → `done`;
 *  5. a conflicting merge, given `regenerate`: on a branch holding only its spec folder, the base side of
 *     every conflict, committed as the merge → `done`; when every conflicted path is a generated file,
 *     the base side of each, the matched commands run bounded, committed with `Norn-Regenerated` →
 *     `done`; a failed command or a path still conflicted aborts it → `conflict` with the output;
 *  6. any other conflicting merge is aborted → `conflict` with the paths.
 * Merge, never rebase: the story branch is published.
 */
export async function update(
  git: GitPort,
  opts: { cwd: string; branch: string; baseSha: string; remote: string | null; message: string; trailers: Record<string, string>; regenerate?: UpdateRegenerate },
): Promise<UpdateResult> {
  const st = await git.status(opts.cwd);
  // A merge or rebase left in progress (a resolve agent's) is never aborted or concluded here
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
  const spec = { message: opts.message, trailers: opts.trailers };
  const m = await git.merge(opts.cwd, opts.baseSha, spec, { keepConflicts: !!opts.regenerate });
  if (m.ok) return { outcome: "done", head: m.head, merged: true, adopted };
  if (!opts.regenerate) return { outcome: "conflict", files: m.files, adopted };
  // The merge is in progress with its conflicts: complete it without an agent, or abort it as before
  const r = opts.regenerate;
  const conflict = (output?: string): UpdateResult => ({ outcome: "conflict", files: m.files, adopted, ...(output !== undefined ? { regenerate: { output } } : {}) });
  try {
    if (await specFolderOnly(git, opts.cwd, opts.baseSha, r.specDir, m.files)) {
      await git.takeSide(opts.cwd, opts.baseSha, m.files);
      return { outcome: "done", head: await git.concludeMerge(opts.cwd, spec), merged: true, adopted, base_side: m.files };
    }
    const matched = m.files.map((p) => regenerateEntriesFor(r.entries, p));
    if (!m.files.length || matched.some((e) => !e.length)) {
      await git.abortMerge(opts.cwd);
      return conflict();
    }
    await git.takeSide(opts.cwd, opts.baseSha, m.files);
    const out: string[] = [];
    for (const e of r.entries.filter((e) => matched.some((es) => es.includes(e)))) {
      const res = await r.run(e.run, parseDuration(e.timeout ?? REGENERATE_TIMEOUT));
      out.push(`$ ${e.run}`, res.output.replace(/\n$/, ""));
      if (!res.ok) {
        await git.abortMerge(opts.cwd);
        return conflict(out.join("\n"));
      }
    }
    const busy = await git.inProgress(opts.cwd);
    const marked = [...new Set((await git.conflictMarkers(opts.cwd, { paths: m.files })).map((c) => c.path))];
    const still = [...new Set([...busy.unmerged, ...marked])].sort();
    if (still.length) {
      await git.abortMerge(opts.cwd);
      return conflict([...out, `still conflicted: ${still.join(", ")}`].join("\n"));
    }
    const head = await git.concludeMerge(opts.cwd, { message: spec.message, trailers: { ...spec.trailers, [REGENERATED_TRAILER]: m.files.join(", ") } });
    return { outcome: "done", head, merged: true, adopted, regenerated: m.files };
  } catch (e) {
    // never leave a half-completed merge behind: the resolve step starts from a clean worktree
    if ((await git.inProgress(opts.cwd)).operation === "merge") await git.abortMerge(opts.cwd);
    throw e;
  }
}

/**
 * The story branch holds nothing but its spec folder: every commit of its own on the first-parent
 * line since the base changes only that folder, and every merge there is a norn base update (a
 * merge of the remote branch could carry a person's work). Then the base's side of every conflict
 * outside the folder is the whole answer; a conflict inside it is the story's and goes to resolve.
 */
async function specFolderOnly(git: GitPort, cwd: string, baseSha: string, specDir: string, conflicts: readonly string[]): Promise<boolean> {
  const dir = `${specDir.replace(/\/+$/, "")}/`;
  if (!conflicts.length || conflicts.some((p) => p.startsWith(dir))) return false;
  const commits = await git.commitPaths(cwd, "HEAD", baseSha);
  const subjects = new Map((await git.log(cwd, `${baseSha}..HEAD`)).map((c) => [c.sha, c.subject]));
  return commits.every((c) => (c.parents.length > 1 ? "Norn-Tick" in c.trailers && /^Update \S+ from /.test(subjects.get(c.sha) ?? "") : c.paths.every((p) => p.startsWith(dir))));
}
