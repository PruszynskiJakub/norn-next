/**
 * Rules decide and the inbox both read off Facts — each defined once here, so the tick that acts
 * and the inbox that tells a person never disagree about them.
 */
import { type Mode, parseDuration, type ResolvedConfig, type Step, type UnitState } from "@norn/schema";
import type { Facts, RunFacts, StoryFacts, UnitFacts } from "./facts.ts";

/** W9: the issue label that picks a story's workflow at intake (`norn:wf:<name>`); B19: it follows the round after. */
export const WF_LABEL = "norn:wf:";

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

/** GR6: the story unit reached `$done`, or spec.md says done/dropped — finished, never "unclaimed". */
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

/** GR7: what is wrong with the story PR on the remote (closed unmerged, merged elsewhere), or null. */
export function prProblem(story: StoryFacts, base: string): string | null {
  if (story.pr?.state === "closed") return "remote: PR closed unmerged";
  // BS11 (old norn 0.1.1): a merge into the wrong base skipped story review — park, never clean up
  if (story.pr?.state === "merged" && !mergedIntoBase(story, base)) return `remote: PR merged into ${prBaseBranch(story.pr)}, not ${base}`;
  return null;
}

/** GR7: what is wrong with the story issue on the remote (closed, unlabelled, unassigned, unseen), or null; undefined issue = not observed. */
export function issueProblem(story: StoryFacts, label: string): string | null {
  const issue = story.issue;
  if (issue === undefined) return null;
  if (issue === null) return "remote: issue closed, unassigned or unlabelled";
  if (issue.state === "closed") return "remote: issue closed";
  if (!issue.labels.includes(label)) return `remote: label '${label}' removed`;
  if (!issue.assignees.length) return "remote: issue unassigned";
  return null;
}

/**
 * gh-71 D5 (B2, B35): the story's round is finished — its unit reached `$done`, or an older norn
 * parked it there for a remote change (read as finished; the holder's tick drops that park).
 */
export function roundFinished(st: UnitState | null | undefined): boolean {
  if (st?.step !== "$done") return false;
  return st.status === "done" || (st.status === "stuck" && st.park?.kind === "remote");
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
