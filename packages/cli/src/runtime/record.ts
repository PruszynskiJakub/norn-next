/**
 * GR6 record: after the story PR merged, the spec folder on the base branch is the record. Mark
 * its `story.md` `status: done` there without touching the person's main checkout:
 *   - with a remote: fetch the base branch, commit in a throwaway detached worktree at
 *     `<remote>/<base>`, push `HEAD:refs/heads/<base>` (fast-forward only, never forced). A
 *     protected base branch or a race rejects the push: the record is then left as merged
 *     (`failed`, with the reason) — nothing is forced and the main checkout is untouched.
 *   - solo (no remote): commit in the main checkout only when it is on the base branch.
 * `deferred` when story.md is not on the base branch yet (the merge has not reached it).
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { GitPort } from "@norn/core";
import type { StoryStatus } from "@norn/schema";
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
}): Promise<RecordResult> {
  const { root, remote, git, base, spec_dir } = opts;
  const rel = join(spec_dir, "story.md");
  const message = `norn: ${opts.story} ${opts.status} (PR merged)`;
  if (!remote) {
    const branch = (await git.status(root).catch(() => null))?.branch;
    if (branch !== base) return { state: "deferred", branch: base, reason: `main checkout is on ${branch ?? "a detached HEAD"}, not ${base}` };
    const r = patchStoryFile(storyFile(join(root, spec_dir)), { status: opts.status }, root);
    if (!r.ok) return { state: "deferred", branch: base, reason: `story.md: ${r.reason}` };
    const sha = await git.commit(root, { message, trailers: opts.trailers, paths: [rel] });
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
    const r = patchStoryFile(storyFile(join(wt, spec_dir)), { status: opts.status }, wt);
    if (!r.ok) return { state: "failed", branch: base, reason: `story.md: ${r.reason}` };
    const sha = await git.commit(wt, { message, trailers: opts.trailers, paths: [rel] });
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
