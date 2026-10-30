/**
 * GR6 record: after the story PR merged, the spec folder on the base branch is the record. Mark
 * its `spec.md` (or an older folder's `story.md`, GR2) `status: done` there without touching the person's main checkout:
 *   - with a remote: fetch the base branch, commit in a throwaway detached worktree at
 *     `<remote>/<base>`, push `HEAD:refs/heads/<base>` (fast-forward only, never forced). A
 *     protected base branch or a race rejects the push: the record is then left as merged
 *     (`failed`, with the reason) — nothing is forced and the main checkout is untouched.
 *   - solo (no remote): commit in the main checkout only when it is on the base branch.
 * `deferred` when the spec file is not on the base branch yet (the merge has not reached it).
 *
 * The done record carries how the PR landed: spec file frontmatter `merge:` (StoryMerge — pr, url,
 * head_sha, merge_commit_sha, merged_by, merged_at, by_ancestry), mirrored as commit trailers
 * (`Norn-Merge-Commit`, `Norn-Merged-By`, `Norn-Merged-At`) on the record commit.
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import type { GitPort, StoryFacts } from "@norn/core";
import { isGitSha, LEGACY_SPEC_FILE, SPEC_FILE, type StoryMerge, type StoryStatus } from "@norn/schema";
import { patchStoryFile, storyFile } from "@norn/store";

export type RecordResult =
  | { state: "pushed" | "committed"; sha: string | null; branch: string }
  | { state: "unchanged"; branch: string }
  | { state: "deferred" | "failed"; branch: string; reason: string };

export async function markStoryOnBase(opts: {
  root: string;
  remote: string | null;
  git: GitPort;
  base: string;
  spec_dir: string;
  story: string;
  status: StoryStatus;
  trailers: Record<string, string>;
  merge?: StoryMerge;
}): Promise<RecordResult> {
  const { root, remote, git, base, spec_dir } = opts;
  const patch = { status: opts.status, ...(opts.merge && Object.keys(opts.merge).length ? { merge: opts.merge } : {}) };
  const trailers = {
    ...opts.trailers,
    ...(opts.merge?.merge_commit_sha ? { "Norn-Merge-Commit": opts.merge.merge_commit_sha } : {}),
    ...(opts.merge?.merged_by ? { "Norn-Merged-By": opts.merge.merged_by } : {}),
    ...(opts.merge?.merged_at ? { "Norn-Merged-At": opts.merge.merged_at } : {}),
  };
  const message = `norn: ${opts.story} ${opts.status} (PR merged)`;
  if (!remote) {
    const branch = (await git.status(root).catch(() => null))?.branch;
    if (branch !== base) return { state: "deferred", branch: base, reason: `main checkout is on ${branch ?? "a detached HEAD"}, not ${base}` };
    const file = storyFile(join(root, spec_dir));
    const r = patchStoryFile(file, patch, root);
    if (!r.ok) return { state: "deferred", branch: base, reason: `${relative(root, file)}: ${r.reason}` };
    const sha = await git.commit(root, { message, trailers, paths: [relative(root, file)] });
    return sha ? { state: "committed", sha, branch: base } : { state: "unchanged", branch: base };
  }
  const tracking = `refs/remotes/${remote}/${base}`;
  const fetched = await git.fetch(root, remote, [`+refs/heads/${base}:${tracking}`], { quiet: true }).then(
    () => null,
    (e: unknown) => (e instanceof Error ? e.message : String(e)),
  );
  if (fetched !== null) return { state: "failed", branch: base, reason: `fetch ${base}: ${fetched}` };
  // GR2: the base holds spec.md, or story.md for a story an older norn intook
  const onBase = async (name: string) => ((await git.hasPath(root, tracking, join(spec_dir, name))) ? join(spec_dir, name) : null);
  const rel = (await onBase(SPEC_FILE)) ?? (await onBase(LEGACY_SPEC_FILE));
  if (!rel) return { state: "deferred", branch: base, reason: `${join(spec_dir, SPEC_FILE)} is not on ${remote}/${base} yet` };
  const tmp = mkdtempSync(join(tmpdir(), "norn-record-"));
  const wt = join(tmp, "wt");
  try {
    const added = await git.worktreeAddDetached(root, wt, tracking).then(
      () => null,
      (e: unknown) => (e instanceof Error ? e.message : String(e)),
    );
    if (added !== null) return { state: "failed", branch: base, reason: `worktree: ${added}` };
    const r = patchStoryFile(join(wt, rel), patch, wt);
    if (!r.ok) return { state: "failed", branch: base, reason: `${rel}: ${r.reason}` };
    const sha = await git.commit(wt, { message, trailers, paths: [rel] });
    if (!sha) return { state: "unchanged", branch: base };
    const p = await git.push(wt, remote, `HEAD:refs/heads/${base}`);
    if (!p.ok) return { state: "failed", branch: base, reason: `push to ${base} rejected (${p.reason}): set status: ${opts.status} in ${rel} by hand` };
    await git.updateRef(root, { ref: tracking, sha });
    return { state: "pushed", sha, branch: base };
  } finally {
    await git.worktreeRemove(root, wt, { force: true }).catch(() => undefined);
    rmSync(tmp, { recursive: true, force: true });
    await git.worktreePrune(root).catch(() => undefined);
  }
}

async function revOf(git: GitPort, root: string, rev: string): Promise<string | null> {
  if (!rev) return null;
  return git.revParse(root, `${rev}^{commit}`);
}

/**
 * GR6 done record: how the story PR landed, from the PR facts; merged by ancestry (P2) the merge
 * commit is the first commit of `<remote>/<base>` that contains the head (the head itself when the
 * base's first-parent line holds it), dated by its committer date.
 */
export async function mergeFacts(opts: { root: string; remote: string | null; git: GitPort; base: string; story: StoryFacts }): Promise<StoryMerge> {
  const { root, remote, git, story } = opts;
  const pr = story.pr ?? null;
  const out: StoryMerge = {};
  if (pr) {
    out.pr = pr.number;
    if (pr.url) out.url = pr.url;
    if (isGitSha(pr.head_sha)) out.head_sha = pr.head_sha;
    if (isGitSha(pr.merge_commit_sha)) out.merge_commit_sha = pr.merge_commit_sha;
    if (pr.merged_by) out.merged_by = pr.merged_by;
    if (pr.merged_at && !Number.isNaN(Date.parse(pr.merged_at))) out.merged_at = new Date(pr.merged_at).toISOString();
  }
  if (!story.merged_by_ancestry || !remote) return out;
  out.by_ancestry = true;
  const baseRef = `refs/remotes/${remote}/${opts.base}`;
  const head = (out.head_sha ? await revOf(git, root, out.head_sha) : null) ?? (await revOf(git, root, `refs/heads/${story.branch}`)) ?? (await revOf(git, root, `refs/remotes/${remote}/${story.branch}`));
  if (!head) return out;
  out.head_sha = head;
  if (!out.merge_commit_sha) {
    const fp = await git.revList(root, baseRef, { firstParent: true, limit: 2000 }).catch(() => null);
    let merge: string | null = fp?.includes(head) ? head : null;
    if (!merge) {
      const ap = await git.revList(root, `${head}..${baseRef}`, { ancestryPath: true, firstParent: true, reverse: true }).catch(() => null);
      merge = ap?.[0] ?? null;
    }
    if (merge) out.merge_commit_sha = merge;
  }
  if (out.merge_commit_sha && !out.merged_at) {
    const [c] = await git.log(root, out.merge_commit_sha, 1).catch(() => []);
    if (c && Number.isFinite(c.at)) out.merged_at = new Date(c.at).toISOString();
  }
  return out;
}
