/**
 * R2.3 (H5, A18): local runs/ work a checkout holds for a story it no longer holds the claim of —
 * receipts and state written here that never reached the record (the remote unit branch). Read
 * only; `norn tidy` moves what this finds to `runs/<unit>/orphaned/`.
 */
import type { UnpushedRuns } from "@norn/core";
import { git } from "./git.ts";

/** A unit worktree to inspect. */
export interface UnpushedTarget {
  /** unit key */
  unit: string;
  /** unit runs dir name (`_story`, `<nn>-<slug>`) */
  dir: string;
  /** the unit's worktree */
  cwd: string;
  /** the unit's branch (its remote copy is the record) */
  branch: string;
}

/** One unit's local runs/ work missing from its remote branch, with where it was measured. */
export interface UnpushedUnit extends UnpushedRuns {
  dir: string;
  /** the unit's worktree; `files` are relative to it */
  cwd: string;
  /** commit the local work is measured from: merge-base of HEAD and the remote unit branch */
  base: string;
}

/**
 * Per unit, files under `<spec_dir>/runs/<dir>/` that the worktree has (committed, changed or
 * untracked) but `<remote>/<branch>` does not: everything changed since the merge-base of HEAD and
 * that ref (the fetched base `baseRef` when the branch is gone). Files already under `orphaned/` are
 * not reported again.
 */
export async function unpushedRuns(remote: string, baseRef: string | null, spec_dir: string, targets: readonly UnpushedTarget[]): Promise<UnpushedUnit[]> {
  const out: UnpushedUnit[] = [];
  for (const t of targets) {
    const tracking = `refs/remotes/${remote}/${t.branch}`;
    const against = (await git(t.cwd, ["rev-parse", "--verify", "--quiet", tracking])).code === 0 ? tracking : baseRef;
    if (!against) continue;
    const mb = await git(t.cwd, ["merge-base", "HEAD", against]);
    if (mb.code !== 0) continue;
    const base = mb.stdout.trim();
    const dir = `${spec_dir}/runs/${t.dir}/`;
    const [changed, untracked] = await Promise.all([
      git(t.cwd, ["diff", "--name-only", "--no-renames", "--diff-filter=AM", base, "--", dir]),
      git(t.cwd, ["ls-files", "--others", "--exclude-standard", "--", dir]),
    ]);
    if (changed.code !== 0 || untracked.code !== 0) continue;
    const files = [...new Set([...changed.stdout.split("\n"), ...untracked.stdout.split("\n")].map((l) => l.trim()).filter((l) => l && !l.slice(dir.length).startsWith("orphaned/")))].sort();
    if (files.length) out.push({ unit: t.unit, dir: t.dir, files, cwd: t.cwd, base });
  }
  return out;
}
