/**
 * `norn status --segment`: one plain line for herdr's tab bar (`tab_bar_right`), and the `$norn`
 * sidebar token of each story's workspace. Pure: a view in, the line and tokens out. Presentation
 * only, never a fact.
 */
import { basename } from "node:path";
import type { ProjectView } from "../views.ts";
import { type CockpitGroup, finished, GROUP_MARK, GROUP_WORD, groupOf, NEEDS } from "./groups.ts";

/** The groups the line counts, in the order it names them. */
const COUNTED: readonly CockpitGroup[] = [...NEEDS, "running"];

/** How many units of the view are in each group; a diverged story waiting on a person is one stuck. */
function counts(view: ProjectView, story?: string): Map<CockpitGroup, number> {
  const out = new Map<CockpitGroup, number>();
  const add = (g: CockpitGroup) => out.set(g, (out.get(g) ?? 0) + 1);
  for (const s of view.stories) {
    if (story !== undefined && s.key !== story) continue;
    if (s.unsynced?.waiting) add("unblock");
    for (const u of s.units) {
      const g = groupOf(u);
      if (g) add(g);
    }
  }
  return out;
}

/** e.g. `norn·todoist-app ● 1 approve ◐ 2 running`; calm when nothing waits: `norn·todoist-app ✓ nothing waits`. */
export function segmentLine(view: ProjectView, repo: string): string {
  const n = counts(view);
  const head = `norn·${basename(repo)}`;
  const parts = COUNTED.flatMap((g) => (n.get(g) ? [`${GROUP_MARK[g]} ${n.get(g)} ${GROUP_WORD[g]}`] : []));
  if (NEEDS.some((g) => n.get(g))) return `${head} ${parts.join(" ")}`;
  return `${head} ✓ nothing waits${parts.length ? ` · ${parts.join(" ")}` : ""}`;
}

/** What a story needs, as its workspace's sidebar token: the first thing it waits on you for, else whether it runs. */
export function storyToken(view: ProjectView, story: string): string {
  const n = counts(view, story);
  const first = NEEDS.find((g) => n.get(g));
  if (first) {
    const more = NEEDS.reduce((sum, g) => sum + (n.get(g) ?? 0), 0) - 1;
    return `${GROUP_MARK[first]} ${GROUP_WORD[first]}${more > 0 ? ` +${more}` : ""}`;
  }
  if (n.get("running")) return `${GROUP_MARK.running} running`;
  const s = view.stories.find((x) => x.key === story);
  return s && finished(s) ? "✓ done" : "· quiet";
}
