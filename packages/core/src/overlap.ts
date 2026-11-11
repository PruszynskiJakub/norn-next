/** Overlap between open stories: which stories are compared, and the Check item a conflict raises. */
import { cmd } from "./commands.ts";
import type { Facts, StoryFacts } from "./facts.ts";
import type { InboxItem } from "./ports.ts";
import { prOpen, storyPhase } from "./policy.ts";
import { iso } from "./time.ts";

/**
 * Is the story compared with the other open stories: it has commits of its own beyond its base,
 * and a unit in flight or a finished round with an open PR. Anything else has nothing to merge.
 */
export function overlapEligible(story: StoryFacts, base: string): boolean {
  if (!story.base || story.base.ahead === 0) return false;
  const p = storyPhase(story, base);
  if (p.phase === "active") return true;
  return p.phase === "round_done" && prOpen(story);
}

const inside = (path: string, dir: string) => path.startsWith(`${dir.replace(/\/+$/, "")}/`);

/**
 * One Check item per pair of open stories whose heads conflict outside their spec folders. It
 * informs and nothing more: no dismiss, no merge order; it goes when the facts stop saying so.
 */
export function overlapItems(facts: Facts): InboxItem[] {
  const byKey = new Map(facts.stories.map((s) => [s.key, s]));
  const base = facts.repo.default_branch;
  const out: InboxItem[] = [];
  for (const o of facts.overlaps ?? []) {
    const a = byKey.get(o.stories[0]);
    const b = byKey.get(o.stories[1]);
    if (!a || !b || !overlapEligible(a, base) || !overlapEligible(b, base)) continue;
    const paths = o.paths.filter((p) => !inside(p, a.spec_dir) && !inside(p, b.spec_dir));
    if (!paths.length) continue;
    out.push({
      id: `overlap:${a.key}:${b.key}`,
      group: "check",
      story: a.key,
      slice: null,
      step: null,
      title: `${a.key} and ${b.key} both change ${paths.join(", ")}; whichever merges second needs a resolve`,
      command: cmd.storyView(b.key),
      since: iso(facts.now),
      ...(a.frontmatter ? { url: a.frontmatter.url } : {}),
    });
  }
  return out;
}
