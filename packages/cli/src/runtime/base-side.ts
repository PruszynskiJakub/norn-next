/**
 * The `base_side` step input: for each path a base update conflicts in, the base commits between
 * the merge base and the base sha that touched it, the story that landed each (its `Norn-Story`
 * trailer) and where that story's spec and PR body are on the base. Gathered at `norn brief`, so
 * renderBrief stays pure.
 */
import { type BaseSideCommit, type BaseSidePath, enteringReceipt, type GitPort, type NumberedReceipt } from "@norn/core";
import { type AgentStep, LEGACY_SPEC_FILE, parseSpecDirName, PR_BODY_FILE, SPEC_FILE, SPECS_DIR, type UnitState } from "@norn/schema";

/** The base side of the conflict that sent the unit to this step; null when the step does not take `base_side` or no base conflict sent it here. */
export async function gatherBaseSide(git: GitPort, worktree: string, step: AgentStep, unit: { state: UnitState; receipts: readonly NumberedReceipt[] }): Promise<BaseSidePath[] | null> {
  if (!(step.inputs ?? []).includes("base_side")) return null;
  const r = enteringReceipt(unit)?.receipt;
  if (r?.kind !== "classify" || r.outcome !== "conflict" || !r.base) return null;
  const { sha, conflicts } = r.base;
  // HEAD is still the story side while the resolver's merge is in progress
  const { merge_base } = await git.divergence(worktree, "HEAD", sha);
  const range = merge_base ? `${merge_base}..${sha}` : sha;
  const specs = await specFolders(git, worktree, sha);
  const out: BaseSidePath[] = [];
  for (const path of conflicts) {
    const commits: BaseSideCommit[] = [];
    for (const c of await git.log(worktree, range, undefined, [path])) {
      const story = c.trailers["Norn-Story"] || null;
      const where = story ? await specs(story) : { spec: null, pr: null };
      commits.push({ sha: c.sha, subject: c.subject, story, ...where });
    }
    out.push({ path, commits });
  }
  return out;
}

/** The spec and PR body paths of a story's spec folder on `rev`, looked up once per story. */
async function specFolders(git: GitPort, cwd: string, rev: string): Promise<(story: string) => Promise<{ spec: string | null; pr: string | null }>> {
  const dirs = new Map<string, string>();
  for (const name of (await git.lsTree(cwd, rev, SPECS_DIR)) ?? []) {
    const p = parseSpecDirName(name);
    if (p && !dirs.has(p.story)) dirs.set(p.story, `${SPECS_DIR}/${name}`);
  }
  const seen = new Map<string, { spec: string | null; pr: string | null }>();
  const has = async (path: string) => ((await git.hasPath(cwd, rev, path)) ? path : null);
  return async (story) => {
    const known = seen.get(story);
    if (known) return known;
    const dir = dirs.get(story);
    const found = dir ? { spec: (await has(`${dir}/${SPEC_FILE}`)) ?? (await has(`${dir}/${LEGACY_SPEC_FILE}`)), pr: await has(`${dir}/${PR_BODY_FILE}`) } : { spec: null, pr: null };
    seen.set(story, found);
    return found;
  };
}
