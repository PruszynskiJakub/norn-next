/**
 * loadTraceView (O4, X1): the step timeline of one unit — for a story, its slices too —
 * read from local files only (spec folders in the checkout and story worktrees, slice
 * worktrees — found as the project view finds them, `scanWorktrees` — and the whole trace of
 * that story). No writes, no network.
 */
import { recordRef, storyOf, type TraceEvent, type UnitState } from "@norn/schema";
import { bindNornHome, loadRounds, loadSnapshot, readTrace, scanWorktrees, type StorySnapshot, machineDir, type UnitSnapshot, withSliceWorktrees } from "@norn/store";
import { buildStepTimeline, mergeStoryTimeline } from "./steps.ts";
import { TIMELINE_TYPES } from "./timeline.ts";
import type { CriteriaSummary, RoundView, TraceRecords, TraceView, UnitTraceSummary } from "./types.ts";

/** QV8: sum the `criteria` trace events of the given units, per verdict (B37: no split by `needs`). */
export function criteriaSummary(events: readonly TraceEvent[], units: ReadonlySet<string>): CriteriaSummary | null {
  const out: CriteriaSummary = { reports: 0, verdicts: { pass: 0, fail: 0, person: 0, unverified: 0 }, unchecked_coverage: 0 };
  for (const ev of events) {
    if (ev.type !== "criteria" || !units.has(ev.unit)) continue;
    out.reports++;
    for (const k of ["pass", "fail", "person", "unverified"] as const) out.verdicts[k] += ev.verdicts[k];
    if (ev.rule === "criteria.unchecked_coverage") out.unchecked_coverage++;
  }
  return out.reports ? out : null;
}

/**
 * Where the unit's records are read from (S12, gh-195 D7): the checkout's machine dir; a finished
 * story's archive ref, unpacked into the machine dir's cache (the ref named, D16: never the base
 * tree); or an older norn's run state still on a unit worktree's branch, before the tick moves it (B34).
 */
function recordsOf(repoRoot: string, story: StorySnapshot): { records: TraceRecords; runsDir: (u: UnitSnapshot) => string } {
  if (story.run_state.archive) return { records: { source: "archive", root: story.run_state.base, ref: recordRef(story.key), commit: story.run_state.archive }, runsDir: (u) => u.path };
  if (!story.run_state.tree) return { records: { source: "machine", root: story.run_state.base }, runsDir: (u) => u.path };
  return { records: { source: story.root === repoRoot ? "checkout" : "worktree", root: story.root }, runsDir: (u) => u.path };
}

export interface LoadTraceViewOptions {
  repoRoot: string;
  /** story key or slice key */
  key: string;
  home?: string;
  env?: Record<string, string | undefined>;
  /** ms epoch; default Date.now() */
  now?: number;
  /** attach events to rows (no-op / claim-renew ticks hidden) */
  events?: boolean;
  /** attach every event, no-op ticks included */
  all?: boolean;
  /** a story without its slices */
  storyOnly?: boolean;
}

/** gh-71 B29, B32: how a round's record says it ended; null while it is under way. */
function roundEnd(st: UnitState | null): RoundView["ended"] {
  if (st?.ended) return { by: "person", at: st.ended.at };
  return st?.status === "done" ? { by: "workflow", at: "$done" } : null;
}

/**
 * gh-71 B29, B36: the story's timeline across its rounds — each round's record read on its own, with
 * the trace events of its time (from its start to the next round's), its rows in round order; the
 * summary is the current round's, the wall-clock from the first round's intake. A flat record is round 1.
 */
function storyTimeline(story: StorySnapshot, build: (u: UnitSnapshot, evs?: TraceEvent[]) => TraceView, events: TraceEvent[], now: number): TraceView {
  const rounds = loadRounds(story, { includeApplied: true });
  const current = story.units[0] as UnitSnapshot;
  if (rounds.length <= 1) {
    const r = rounds[0];
    return { ...build(current), rounds: r ? [{ n: r.n, workflow: r.workflow, ended: roundEnd(r.unit.state) }] : [] };
  }
  const starts = rounds.map((r) => (r.unit.state ? Date.parse(r.unit.state.created_at) : Number.NaN));
  const views = rounds.map((r, i) => {
    const from = i === 0 ? Number.NEGATIVE_INFINITY : (starts[i] as number);
    const to = i === rounds.length - 1 ? Number.POSITIVE_INFINITY : (starts[i + 1] as number);
    return build(r.unit, events.filter((ev) => {
      const t = Date.parse(ev.type === "hook" ? ev.fact.at : ev.at);
      return t >= from && t < to;
    }));
  });
  const first = views[0] as TraceView;
  const last = views.at(-1) as TraceView;
  const totals = { ...last.totals, by_type: {} as Record<string, number>, by_step: {} as Record<string, number>, human_wait_ms: 0 };
  for (const v of views) {
    for (const [k, d] of Object.entries(v.totals.by_type)) totals.by_type[k] = (totals.by_type[k] ?? 0) + d;
    for (const [k, d] of Object.entries(v.totals.by_step)) totals.by_step[k] = (totals.by_step[k] ?? 0) + d;
    totals.human_wait_ms += v.totals.human_wait_ms;
  }
  const intake_at = first.intake_at;
  if (intake_at) totals.wall_clock_ms = Math.max(0, (last.done_at ? Date.parse(last.done_at) : now) - Date.parse(intake_at));
  const summary = { ...last.units[0], intake_at, totals } as UnitTraceSummary;
  return {
    ...last,
    intake_at,
    totals,
    units: [summary],
    steps: views.flatMap((v) => v.steps),
    hidden_events: views.reduce((n, v) => n + v.hidden_events, 0),
    rounds: rounds.map((r) => ({ n: r.n, workflow: r.workflow, ended: roundEnd(r.unit.state) })),
  };
}

/** null when the unit is unknown. */
export function loadTraceView(opts: LoadTraceViewOptions): TraceView | null {
  const now = opts.now ?? Date.now();
  const storyKey = storyOf(opts.key);
  if (opts.home) bindNornHome(opts.repoRoot, opts.home);
  const wts = scanWorktrees(opts.repoRoot);
  const snap = loadSnapshot({
    repoRoot: opts.repoRoot,
    storyRoots: [...wts.stories.values()],
    home: opts.home,
    env: opts.env,
    includeApplied: true,
  });
  const read = snap.stories.find((s) => s.key === storyKey);
  if (!read) return null;
  const story = withSliceWorktrees(read, (slice) => wts.slices.get(slice), { includeApplied: true });
  const { events } = readTrace(opts.repoRoot, { unit: storyKey, types: TIMELINE_TYPES });
  const tdir = machineDir(opts.repoRoot);
  const { records, runsDir } = recordsOf(opts.repoRoot, story);

  const build = (u: UnitSnapshot, evs: TraceEvent[] = events): TraceView => {
    const file = u.unit.slice ? story.slices.find((s) => s.key === u.unit.slice) : null;
    const view = buildStepTimeline(
      {
        key: u.unit.key,
        story: story.key,
        slice: u.unit.slice,
        title: (u.unit.slice ? file?.frontmatter?.title : story.frontmatter?.title) ?? u.unit.key,
        runs_dir: runsDir(u),
        trace_dir: tdir,
        state: u.state,
        workflow: u.workflow?.workflow ?? null,
        receipts: u.receipts ?? u.unapplied,
        events: evs,
        intake_at: u.unit.slice ? null : (story.frontmatter?.intake_at ?? null),
      },
      { now, events: opts.events, all: opts.all },
    );
    const round = u.state?.round ?? 1;
    return { ...view, steps: view.steps.map((r) => ({ ...r, round })) };
  };

  const unit = story.units.find((u) => u.unit.key === opts.key);
  if (!unit) return null;
  const view = unit.unit.slice ? build(unit) : storyTimeline(story, build, events, now);
  const shown = unit.unit.slice || opts.storyOnly ? [unit] : story.units;
  const summary = criteriaSummary(events, new Set(shown.map((u) => u.unit.key)));
  const criteria = summary ? { criteria: summary } : {};
  if (unit.unit.slice || opts.storyOnly) return { ...view, records, ...criteria };
  return {
    ...mergeStoryTimeline(
      view,
      story.units.filter((u) => u.unit.slice).map((u) => build(u)),
    ),
    records,
    ...criteria,
  };
}
