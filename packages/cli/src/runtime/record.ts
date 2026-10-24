/**
 * GR6 record: after the story PR merged, the spec folder on the base branch is the record. Mark
 * its `story.md` `status: done` there without touching the person's main checkout:
 *   - with a remote: fetch the base branch, commit in a throwaway detached worktree at
 *     `<remote>/<base>`, push `HEAD:refs/heads/<base>` (fast-forward only, never forced). A
 *     protected base branch or a race rejects the push: the record is then left as merged
 *     (`failed`, with the reason) — nothing is forced and the main checkout is untouched.
 *   - solo (no remote): commit in the main checkout only when it is on the base branch.
 * `deferred` when story.md is not on the base branch yet (the merge has not reached it).
 *
 * The done record carries how the PR landed: story.md frontmatter `merge:` (StoryMerge — pr, url,
 * head_sha, merge_commit_sha, merged_by, merged_at, by_ancestry), mirrored as commit trailers
 * (`Norn-Merge-Commit`, `Norn-Merged-By`, `Norn-Merged-At`) on the record commit.
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { GitPort, StoryFacts } from "@norn/core";
import type { StoryMerge, StoryStatus } from "@norn/schema";
import { git as rawGit, patchStoryFile, storyFile } from "@norn/store";

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
  const rel = join(spec_dir, "story.md");
  const message = `norn: ${opts.story} ${opts.status} (PR merged)`;
  if (!remote) {
    const branch = (await git.status(root).catch(() => null))?.branch;
    if (branch !== base) return { state: "deferred", branch: base, reason: `main checkout is on ${branch ?? "a detached HEAD"}, not ${base}` };
    const r = patchStoryFile(storyFile(join(root, spec_dir)), patch, root);
    if (!r.ok) return { state: "deferred", branch: base, reason: `story.md: ${r.reason}` };
    const sha = await git.commit(root, { message, trailers, paths: [rel] });
    return sha ? { state: "committed", sha, branch: base } : { state: "unchanged", branch: base };
  }
  const tracking = `refs/remotes/${remote}/${base}`;
  const f = await rawGit(root, ["fetch", "--quiet", "--no-tags", remote, `+refs/heads/${base}:${tracking}`]);
  if (f.code !== 0) return { state: "failed", branch: base, reason: `fetch ${base}: ${f.stderr.trim()}` };
  if ((await rawGit(root, ["cat-file", "-e", `${tracking}:${rel}`])).code !== 0)
    return { state: "deferred", branch: base, reason: `${rel} is not on ${remote}/${base} yet` };
  const tmp = mkdtempSync(join(tmpdir(), "norn-record-"));
  const wt = join(tmp, "wt");
  try {
    const add = await rawGit(root, ["worktree", "add", "--detach", "--quiet", wt, tracking]);
    if (add.code !== 0) return { state: "failed", branch: base, reason: `worktree: ${add.stderr.trim()}` };
    const r = patchStoryFile(storyFile(join(wt, spec_dir)), patch, wt);
    if (!r.ok) return { state: "failed", branch: base, reason: `story.md: ${r.reason}` };
    const sha = await git.commit(wt, { message, trailers, paths: [rel] });
    if (!sha) return { state: "unchanged", branch: base };
    const p = await git.push(wt, remote, `HEAD:refs/heads/${base}`);
    if (!p.ok) return { state: "failed", branch: base, reason: `push to ${base} rejected (${p.reason}): set status: ${opts.status} in ${rel} by hand` };
    await rawGit(root, ["update-ref", tracking, sha]);
    return { state: "pushed", sha, branch: base };
  } finally {
    await rawGit(root, ["worktree", "remove", "--force", wt]);
    rmSync(tmp, { recursive: true, force: true });
    await rawGit(root, ["worktree", "prune"]);
  }
}

const SHA = /^[0-9a-f]{40,64}$/;

async function revOf(root: string, rev: string): Promise<string | null> {
  if (!rev) return null;
  const r = await rawGit(root, ["rev-parse", "--verify", "--quiet", "--end-of-options", `${rev}^{commit}`]);
  return r.code === 0 ? r.stdout.trim() : null;
}

/**
 * GR6 done record: how the story PR landed, from the PR facts; merged by ancestry (P2) the merge
 * commit is the first commit of `<remote>/<base>` that contains the head (the head itself when the
 * base's first-parent line holds it), dated by its committer date.
 */
export async function mergeFacts(opts: { root: string; remote: string | null; base: string; story: StoryFacts }): Promise<StoryMerge> {
  const { root, remote, story } = opts;
  const pr = story.pr ?? null;
  const out: StoryMerge = {};
  if (pr) {
    out.pr = pr.number;
    if (pr.url) out.url = pr.url;
    if (SHA.test(pr.head_sha)) out.head_sha = pr.head_sha;
    if (pr.merge_commit_sha && SHA.test(pr.merge_commit_sha)) out.merge_commit_sha = pr.merge_commit_sha;
    if (pr.merged_by) out.merged_by = pr.merged_by;
    if (pr.merged_at && !Number.isNaN(Date.parse(pr.merged_at))) out.merged_at = new Date(pr.merged_at).toISOString();
  }
  if (!story.merged_by_ancestry || !remote) return out;
  out.by_ancestry = true;
  const baseRef = `refs/remotes/${remote}/${opts.base}`;
  const head = (out.head_sha ? await revOf(root, out.head_sha) : null) ?? (await revOf(root, `refs/heads/${story.branch}`)) ?? (await revOf(root, `refs/remotes/${remote}/${story.branch}`));
  if (!head) return out;
  out.head_sha = head;
  if (!out.merge_commit_sha) {
    const fp = await rawGit(root, ["rev-list", "--first-parent", "-n", "2000", baseRef]);
    let merge: string | null = fp.code === 0 && fp.stdout.split("\n").includes(head) ? head : null;
    if (!merge) {
      const ap = await rawGit(root, ["rev-list", "--ancestry-path", "--first-parent", "--reverse", `${head}..${baseRef}`]);
      merge = ap.code === 0 ? (ap.stdout.split("\n").find(Boolean) ?? null) : null;
    }
    if (merge) out.merge_commit_sha = merge;
  }
  if (out.merge_commit_sha && !out.merged_at) {
    const d = await rawGit(root, ["show", "-s", "--format=%cI", out.merge_commit_sha]);
    if (d.code === 0 && !Number.isNaN(Date.parse(d.stdout.trim()))) out.merged_at = new Date(d.stdout.trim()).toISOString();
  }
  return out;
}
