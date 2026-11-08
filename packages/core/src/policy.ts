/**
 * Rules decide and the inbox both read off Facts — each defined once here, so the tick that acts
 * and the inbox that tells a person never disagree about them.
 */
import { BUILT_IN_LIMITS, HANDOFFS_DIR, isClosedStatus, type Mode, parseDuration, type ResolvedConfig, RUNS_DIR, SPECS_DIR, type Step, type DoneState, type StuckState, type UnitState, type Workflow } from "@norn/schema";
import type { Facts, RunFacts, StoryFacts, UnitFacts } from "./facts.ts";
import { hookActivity } from "./session.ts";
import { stepOf } from "./workflow.ts";

/** The issue label that picks a story's workflow at intake (`norn:wf:<name>`); it follows the round after. */
export const WF_LABEL = "norn:wf:";

/** When `norn check-run` holds the unit's check lease at a check step, the lease's time (running since then, not queued); else null. */
export function checkRunningSince(step: Step | null | undefined, uf: UnitFacts): string | null {
  return step?.type === "check" && uf.lease?.kind === "check" && uf.state && !uf.state.park ? uf.lease.created_at : null;
}

/**
 * The unit's worktree holds bundled skills that differ from the running norn's while
 * it still has work to do. Nothing is held: its runs use the worktree's copies, and merging the base
 * brings the new ones in. The inbox shows it as a Check item.
 */
export function skillsDiffer(uf: UnitFacts): boolean {
  const st = uf.state;
  return !!uf.skills_drift?.length && !!st && st.status !== "done" && st.status !== "corrupt";
}

/** Manual if the step is attended or no runner is configured; else the story's mode. */
export function effectiveMode(story: Mode, attended: boolean, runner: string | null): { mode: Mode; downgraded: boolean } {
  if (attended) return { mode: "manual", downgraded: false };
  if (!runner) return { mode: "manual", downgraded: story === "auto" };
  return { mode: story, downgraded: false };
}

/**
 * A story's mode, nearest first: the story (`norn story edit`), the workflow its
 * story unit runs (top-level `mode`), your config (local file over user file, already merged),
 * built-in `manual`.
 */
export function storyMode(state: { mode?: Mode } | null | undefined, workflow: Workflow | null | undefined, config: Pick<ResolvedConfig, "mode">): Mode {
  return state?.mode ?? workflow?.mode ?? config.mode;
}

export interface StepLimits {
  deadline: string;
  nudges: number;
  retries: number;
  stalled: string;
}

/**
 * A step's limits — its own `deadline`, `nudges`, `retries`, else the
 * workflow's, else the base; `stalled` is a workflow limit only.
 */
export function stepLimits(workflow: Workflow | null | undefined, step: Step | null | undefined): StepLimits {
  const own = step?.type === "agent" ? step : undefined;
  const d = workflow?.defaults ?? {};
  return {
    deadline: own?.deadline ?? d.deadline ?? BUILT_IN_LIMITS.deadline,
    nudges: own?.nudges ?? d.nudges ?? BUILT_IN_LIMITS.nudges,
    retries: own?.retries ?? d.retries ?? BUILT_IN_LIMITS.retries,
    stalled: d.stalled ?? BUILT_IN_LIMITS.stalled,
  };
}

/** The hook read window — the longest `stalled` across the loaded workflows (built-in when none). */
export function hookWindowMs(workflows: Iterable<Workflow | null | undefined>): number {
  let ms = parseDuration(BUILT_IN_LIMITS.stalled);
  for (const wf of workflows) if (wf) ms = Math.max(ms, parseDuration(stepLimits(wf, null).stalled));
  return ms;
}

/** The story's own unit (slice null), or null before it has facts. */
export const storyUnit = (story: StoryFacts): UnitFacts | null => story.units.find((u) => u.unit.slice === null) ?? null;

/** The story unit reached `$done`, or spec.md says done/dropped — finished, never "unclaimed". */
export function storyFinished(story: StoryFacts): boolean {
  const status = story.frontmatter?.status;
  if (isClosedStatus(status)) return true;
  return storyUnit(story)?.state?.status === "done";
}

/** The PR's target branch, when the remote said (`base` is the field an older norn's cached `pr.json` holds). */
export const prBaseBranch = (pr: StoryFacts["pr"]): string | null => pr?.base_branch ?? pr?.base ?? null;

/**
 * The story's work landed on its base — the PR merged into the base branch, or its head is
 * already on the fetched base. A PR merged into any other branch does not count.
 */
export function mergedIntoBase(story: StoryFacts, base: string): boolean {
  if (story.merged_by_ancestry) return true;
  if (story.pr?.state !== "merged") return false;
  const target = prBaseBranch(story.pr);
  return target === null || target === base;
}

/** What is wrong with the story PR on the remote (closed unmerged, merged elsewhere), or null. */
export function prProblem(story: StoryFacts, base: string): string | null {
  if (story.pr?.state === "closed") return "remote: PR closed unmerged";
  // a merge into the wrong base skipped story review: park, never clean up
  if (story.pr?.state === "merged" && !mergedIntoBase(story, base)) return `remote: PR merged into ${prBaseBranch(story.pr)}, not ${base}`;
  return null;
}

/** What is wrong with the story issue on the remote (closed, unlabelled, unassigned, unseen), or null; undefined issue = not observed. */
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
 * The story's round is finished — its unit reached `$done`, or it is parked there for a
 * problem with its PR or an older norn's remote change (still finished; the holder's tick drops
 * that park). A stuck unit at `$done` on a `workflow` park is not: its round receipt was rejected.
 */
export function roundFinished(
  st: UnitState | null | undefined,
): st is DoneState | (StuckState & { step: "$done"; park: { kind: "remote" } }) {
  if (st?.step !== "$done") return false;
  return st.status === "done" || (st.status === "stuck" && st.park?.kind === "remote");
}

/** This checkout's heartbeat is up — observed, and its last tick within 3 × watch interval. */
export function heartbeatUp(facts: Facts, config: ResolvedConfig): boolean {
  const hb = facts.heartbeat;
  return !!hb && hb.last_tick_at !== null && facts.now - hb.last_tick_at <= 3 * parseDuration(config.interval);
}

/** The run's newest `session_start` hook when no turn came after it, else null. */
export function sessionStartedNoTurn(rf: RunFacts): RunFacts["hooks"][number] | null {
  // hooks only: a launch prompt is judged by what the agent reported, never by the pane
  const h = hookActivity(rf.hooks);
  return h.kind === "starting" ? h.last : null;
}

/** The first non-blank line of a text, trimmed (a pending command shown in one line). */
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

/** A cursor as people read it: `step#attempt`, or the step alone for a step-only receipt. */
export const stepLabel = (step: string, attempt?: number): string => (attempt === undefined ? step : `${step}#${attempt}`);

/** How a step ended — the outcome whose edge moved the cursor on, and the step it moved to. */
export interface StepEnd {
  outcome: string;
  next: string;
}

/**
 * The trailers of every commit norn makes for a unit — Norn-Story, Norn-Slice for a slice,
 * Norn-Step when the unit has a cursor (none before the story unit starts), Norn-Tick. A commit
 * that ends a step (its outcome moved the cursor on) also carries Norn-Outcome, so a step boundary
 * is told apart from the other commits made at that step, and Norn-Next, the step that outcome
 * moved the cursor to.
 */
export function nornTrailers(tick: string, story: string, slice: string | null, step: string | null, ended?: StepEnd): Record<string, string> {
  const trailers: Record<string, string> = { "Norn-Story": story };
  if (slice) trailers["Norn-Slice"] = slice;
  if (step !== null) trailers["Norn-Step"] = step;
  if (ended !== undefined && step !== null) {
    trailers["Norn-Outcome"] = ended.outcome;
    trailers["Norn-Next"] = ended.next;
  }
  trailers["Norn-Tick"] = tick;
  return trailers;
}

/**
 * Is this the boundary commit of `slice`'s (null: the story unit's) step
 * `at.step` ending with `at.outcome` and moving the cursor to `at.next`? Read off the trailers, never the subject.
 */
export const isStepBoundary = (trailers: Record<string, string>, story: string, slice: string | null, at: { step: string } & StepEnd): boolean =>
  trailers["Norn-Story"] === story &&
  (trailers["Norn-Slice"] ?? null) === slice &&
  trailers["Norn-Step"] === at.step &&
  trailers["Norn-Outcome"] === at.outcome &&
  trailers["Norn-Next"] === at.next;

/**
 * Is `path` (repo-relative) the work's own, not norn's bookkeeping in a spec folder:
 * its `handoffs/` (prose a boundary commit carries), or an older layout's `runs/`?
 */
export function isCodePath(path: string): boolean {
  const specs = `${SPECS_DIR}/`;
  if (!path.startsWith(specs)) return true;
  const sub = path.slice(specs.length).split("/")[1];
  return sub !== HANDOFFS_DIR && sub !== RUNS_DIR;
}

/**
 * The trailers of a story's intake commit (`remote.intake`) — norn's (Norn-Tick), for `story`,
 * made before any unit has a cursor (no Norn-Step, no Norn-Slice). Read off the trailers, never the subject.
 */
export const isIntakeCommit = (trailers: Record<string, string>, story: string): boolean =>
  trailers["Norn-Story"] === story && !!trailers["Norn-Tick"] && !("Norn-Step" in trailers) && !("Norn-Slice" in trailers);

/**
 * How many times the base may refuse an owed done record before norn stops retrying it and
 * tells the person. A `rejected` push lumps a race on the base together with a protected branch;
 * each retry refetches, so a race does not repeat three times in a row, but a refusal that is
 * never lifted needs a person. The attempt at merged clean-up counts, so norn stops after it and
 * RECORD_REFUSALS - 1 retries.
 */
export const RECORD_REFUSALS = 3;

/** Why an owed record attempt failed: `waiting` clears by itself (offline, not on the base yet); `refused` is the base saying no. */
export type RecordFailure = "waiting" | "refused";

/**
 * The base already reads the story closed, so its owed done record has nothing left to do.
 * With a remote only the fetched base is the record: a local frontmatter that says done may
 * never have been pushed. Solo, the main checkout's frontmatter is the record.
 */
export function recordOnBase(story: StoryFacts | undefined, solo: boolean): boolean {
  return !!story && isClosedStatus(solo ? story.frontmatter?.status : story.base_status);
}

// The two rules below take epochs, not Facts: act applies them to records.json while it retries,
// and they live here so the bound is defined once beside the inbox item that reports it.

/** An owed record is retried once per sync interval until norn stops retrying it. */
export function recordRetryDue(p: { attempted_at: number; stopped_at?: number }, now: number, everyMs: number): boolean {
  return p.stopped_at === undefined && now - p.attempted_at >= everyMs;
}

/** When norn stops retrying an owed record: kept once set, `now` once the base refused RECORD_REFUSALS times. */
export function recordStopsAt(refusals: number, prev: number | undefined, now: number): number | undefined {
  return prev ?? (refusals >= RECORD_REFUSALS ? now : undefined);
}

/**
 * `norn tidy` drops an owed record only when norn stopped retrying it and its story is gone from
 * the observed stories, so nothing can ever land it. A record still retried is never dropped:
 * while the merge has not reached the base its story is absent from the stories too.
 */
export function recordPrunable(p: { story: string; stopped_at?: number }, stories: readonly Pick<StoryFacts, "key">[]): boolean {
  return p.stopped_at !== undefined && !stories.some((s) => s.key === p.story);
}
