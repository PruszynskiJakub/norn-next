/**
 * Rules decide and the inbox both read off Facts — each defined once here, so the tick that acts
 * and the inbox that tells a person never disagree about them.
 */
import { type Mode, parseDuration, type ResolvedConfig } from "@norn/schema";
import type { Facts, RunFacts, StoryFacts, UnitFacts } from "./facts.ts";

/** MO2: manual if the step is attended or no runner is configured; else the story's mode. */
export function effectiveMode(story: Mode, attended: boolean, runner: string | null): { mode: Mode; downgraded: boolean } {
  if (attended) return { mode: "manual", downgraded: false };
  if (!runner) return { mode: "manual", downgraded: story === "auto" };
  return { mode: story, downgraded: false };
}

/** The story's own unit (slice null), or null before it has facts. */
export const storyUnit = (story: StoryFacts): UnitFacts | null => story.units.find((u) => u.unit.slice === null) ?? null;

/** GR6: the story unit reached `$done`, or story.md says done/dropped — finished, never "unclaimed". */
export function storyFinished(story: StoryFacts): boolean {
  const status = story.frontmatter?.status;
  if (status === "done" || status === "dropped") return true;
  return storyUnit(story)?.state?.status === "done";
}

/** BS11: the PR's target branch, when the remote said (`base_branch`, older adapters `base`). */
export const prBaseBranch = (pr: StoryFacts["pr"]): string | null => pr?.base_branch ?? pr?.base ?? null;

/**
 * GR6 + BS11: the story's work landed on its base — the PR merged into the base branch, or its head is
 * already on the fetched base (P2). A PR merged into any other branch does not count.
 */
export function mergedIntoBase(story: StoryFacts, base: string): boolean {
  if (story.merged_by_ancestry) return true;
  if (story.pr?.state !== "merged") return false;
  const target = prBaseBranch(story.pr);
  return target === null || target === base;
}

/** R5.5 (N3): this checkout's heartbeat is up — observed, and its last tick within 3 × watch interval. */
export function heartbeatUp(facts: Facts, config: ResolvedConfig): boolean {
  const hb = facts.heartbeat;
  return !!hb && hb.last_tick_at !== null && facts.now - hb.last_tick_at <= 3 * parseDuration(config.watch_interval);
}

/** R9.1 (M6): the run's newest `session_start` hook when no turn came after it, else null. */
export function sessionStartedNoTurn(rf: RunFacts): RunFacts["hooks"][number] | null {
  const i = rf.hooks.findLastIndex((h) => h.event === "session_start");
  if (i < 0 || rf.hooks.slice(i + 1).some((h) => h.event !== "session_start")) return null;
  return rf.hooks[i] as RunFacts["hooks"][number];
}

/** The first non-blank line of a text, trimmed (a pending command shown in one line, L1). */
export const firstLine = (text: string | undefined): string | undefined => text?.split("\n").map((l) => l.trim()).find((l) => l !== "");

/**
 * The unit's worktree path — its own, or the story's for the story unit (or a story with no unit
 * yet). `mustExist`: only a worktree observed on disk (where decide may act); else the recorded
 * path whether or not it exists (what a person is told to `cd` into).
 */
export function unitWorktree(story: StoryFacts, uf: UnitFacts | null, opts: { mustExist: boolean }): string | null {
  const wt = uf?.worktree ?? (!uf || uf.unit.slice === null ? story.worktree : null);
  if (!wt) return null;
  return !opts.mustExist || wt.exists ? wt.path : null;
}
