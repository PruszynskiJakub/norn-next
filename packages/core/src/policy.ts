/**
 * Rules decide and the inbox both read off Facts — each defined once here, so the tick that acts
 * and the inbox that tells a person never disagree about them.
 */
import { type Mode, parseDuration, type ResolvedConfig, type Step } from "@norn/schema";
import type { Facts, RunFacts, StoryFacts, UnitFacts } from "./facts.ts";

/** C5: when `norn check-run` holds the unit's check lease at a check step, the lease's time (running since then, not queued); else null. */
export function checkRunningSince(step: Step | null | undefined, uf: UnitFacts): string | null {
  return step?.type === "check" && uf.lease?.kind === "check" && uf.state && !uf.state.park ? uf.lease.created_at : null;
}

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

/** BS11: the PR's target branch, when the remote said (`base_branch`; `base` in a `pr.json` an older norn cached, read until 0.11.0). */
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
 * yet) — only when observed on disk. Decide acts only there, and the inbox points a person only
 * there (never at a recorded path that is gone).
 */
export function unitWorktree(story: StoryFacts, uf: UnitFacts | null): string | null {
  const wt = uf?.worktree ?? (!uf || uf.unit.slice === null ? story.worktree : null);
  return wt?.exists ? wt.path : null;
}

/**
 * S4: the trailers of every commit norn makes for a unit — Norn-Story, Norn-Slice for a slice,
 * Norn-Step when the unit has a cursor (none before the story unit starts), Norn-Tick.
 */
export function nornTrailers(tick: string, story: string, slice: string | null, step: string | null): Record<string, string> {
  const trailers: Record<string, string> = { "Norn-Story": story };
  if (slice) trailers["Norn-Slice"] = slice;
  if (step !== null) trailers["Norn-Step"] = step;
  trailers["Norn-Tick"] = tick;
  return trailers;
}

/**
 * R3.1: the trailers of a story's intake commit (`remote.intake`) — norn's (Norn-Tick), for `story`,
 * made before any unit has a cursor (no Norn-Step, no Norn-Slice). Read off the trailers, never the subject.
 */
export const isIntakeCommit = (trailers: Record<string, string>, story: string): boolean =>
  trailers["Norn-Story"] === story && !!trailers["Norn-Tick"] && !("Norn-Step" in trailers) && !("Norn-Slice" in trailers);
