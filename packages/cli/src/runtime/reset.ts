/**
 * What stops `norn story reset` (GR7a) without `--force`: a story PR, a started slice, a story
 * branch whose own commits since intake change files outside its spec folder, or such changes not
 * yet committed in the story worktree. A story that only went through triage has none of these.
 */
import { isIntakeCommit, type StoryFacts } from "@norn/core";
import type { Observed } from "./observe/index.ts";
import { storyBaseRef } from "./observe/git-facts.ts";

/** Why the story holds work a reset would delete; [] = it holds none. */
export async function resetBlockers(obs: Observed, story: StoryFacts): Promise<string[]> {
  const git = obs.ports.git;
  const out: string[] = [];
  const pr = story.pr ?? story.pr_seen?.pr ?? null;
  if (pr && pr.state !== "closed") out.push(`PR #${pr.number} is ${pr.state}`);
  const slices = story.units.filter((u) => u.unit.slice).map((u) => u.unit.key);
  if (slices.length) out.push(`started slices: ${slices.join(", ")}`);
  const own = (p: string) => p.startsWith(`${story.spec_dir}/`);

  const loc = obs.stories[story.key];
  if (loc?.worktree) {
    const st = await git.status(loc.worktree).catch(() => null);
    const dirty = st ? [...st.staged, ...st.unstaged, ...st.untracked].filter((p) => !own(p)) : [];
    if (dirty.length) out.push(`uncommitted changes outside ${story.spec_dir}: ${dirty.slice(0, 5).join(", ")}${dirty.length > 5 ? ", …" : ""}`);
  }

  // the story's own commits: the first-parent line from its intake commit (found by trailers) to
  // the head, merges skipped — a merge brings the base in, not the story's work
  const head = `refs/heads/${story.branch}`;
  if (!(await git.hasRef(obs.root, head))) return out;
  const commits = await git.log(obs.root, `${storyBaseRef(obs.remote, obs.facts.repo.default_branch)}..${head}`);
  const intake = commits.find((c) => isIntakeCommit(c.trailers, story.key));
  if (!intake) {
    out.push(`no intake commit of ${story.key} on ${story.branch}, so its own changes cannot be told apart`);
    return out;
  }
  const changed = new Set<string>();
  for (const sha of await git.revList(obs.root, `${intake.sha}..${head}`, { firstParent: true })) {
    if (await git.revParse(obs.root, `${sha}^2`)) continue;
    for (const p of await git.changedPaths(obs.root, `${sha}^`, sha)) if (!own(p)) changed.add(p);
  }
  if (changed.size) {
    const paths = [...changed].sort();
    out.push(`commits since intake change ${paths.slice(0, 5).join(", ")}${paths.length > 5 ? ", …" : ""}`);
  }
  return out;
}
