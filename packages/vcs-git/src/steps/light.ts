/**
 * The light path of a base update: when everything the story gained since its change request last
 * took the branch is base merges and spec-folder bookkeeping (never `spec.md`, the contract), the
 * update skips the full path. `clean` when git made every such merge alone, `resolved` when a
 * resolver finished one; anything else, or nothing to measure from, is `done`, the safe full path.
 */
import { type HostContext, ok, type PluginResult } from "@norn/plugin-api";
import { SPECS_DIR } from "@norn/schema";
import { git, lines } from "../git.ts";
import { isAncestor } from "../refs.ts";

export interface LightCommit {
  sha: string;
  parents: string[];
  /** paths changed against the first parent */
  paths: string[];
  /** a merge: every parent past the first is in the base's history */
  fromBase?: boolean;
  /** a merge: paths of its remerge-diff ([] = git merged it alone); null = git could not tell */
  remerge?: string[] | null;
}

/** Bookkeeping: a path in the story's spec folder (`.agents/specs/<story>/`) that is not its `spec.md`. */
export function bookkeeping(path: string, story: string): boolean {
  const folder = `${SPECS_DIR}/${story}/`;
  return path.startsWith(folder) && path.slice(folder.length) !== "spec.md";
}

/** The light outcome the commits allow, or null for the full path. Pure, so every case is tested with scripted commits. */
export function lightOutcome(commits: readonly LightCommit[], story: string): "clean" | "resolved" | null {
  const merges = commits.filter((c) => c.parents.length > 1);
  const light = commits.every((c) => (c.parents.length > 1 ? c.fromBase === true : c.paths.every((p) => bookkeeping(p, story))));
  if (!light) return null;
  // a remerge-diff git could not compute is never read as a clean merge
  return merges.every((c) => Array.isArray(c.remerge) && c.remerge.length === 0) ? "clean" : "resolved";
}

/** The story's first-parent commits from `anchor` (exclusive) to HEAD, with what the light path needs of each. */
export async function commitsSince(ctx: HostContext, cwd: string, anchor: string, baseSha: string): Promise<PluginResult<LightCommit[] | null>> {
  const list = await git(ctx, cwd, ["rev-list", "--first-parent", "--parents", `${anchor}..HEAD`, "--"]);
  if (list.code !== 0) return ok(null);
  const out: LightCommit[] = [];
  for (const line of lines(list.stdout)) {
    const [sha, ...parents] = line.trim().split(/\s+/) as [string, ...string[]];
    if (parents.length < 2) {
      const diff = await git(ctx, cwd, ["diff-tree", "--no-commit-id", "--name-only", "-r", "-z", sha, "--"]);
      if (diff.code !== 0) return ok(null);
      out.push({ sha, parents, paths: diff.stdout.split("\0").filter(Boolean) });
      continue;
    }
    let fromBase = true;
    for (const p of parents.slice(1)) {
      const a = await isAncestor(ctx, cwd, p, baseSha);
      if (!a.ok) return a;
      fromBase &&= a.value;
    }
    const rd = await git(ctx, cwd, ["show", "--remerge-diff", "--format=", "--name-only", "-z", sha, "--"]);
    const remerge = rd.code === 0 ? [...new Set(rd.stdout.split("\0").map((p) => p.trim()).filter(Boolean))].sort() : null;
    out.push({ sha, parents, paths: [], fromBase, remerge });
  }
  return ok(out);
}
