/**
 * loadRunView (B44): one run of a unit — its step row of the timeline (step, attempt, outcome,
 * durations, who, reason, receipts). A unit key means its latest run; a run id is looked up in
 * the timelines of every story. Local files only, like loadTraceView.
 */
import { ULID_PATTERN } from "@norn/schema";
import { loadSnapshot, scanWorktrees } from "@norn/store";
import { type LoadTraceViewOptions, loadTraceView } from "./trace-view.ts";
import type { RoundView, StepRow, TraceView } from "./types.ts";

export interface RunDetail extends StepRow {
  story: string;
  /** the agent session of the row (the one asked for by a run id, else its latest); null for a gate or check */
  run_id: string | null;
  /** gh-196 D5 (B34): the row's round, when a supervisor started it with `--delegated` (its reason shows in `run view`) */
  delegated_round?: RoundView;
}

export type LoadRunViewOptions = Omit<LoadTraceViewOptions, "key" | "events" | "all" | "storyOnly"> & {
  /** a unit key or a run id */
  target: string;
};

const lastRun = (r: StepRow) => r.who.findLast((w) => w.run_id)?.run_id ?? null;

function detail(view: TraceView, row: StepRow, runId: string | null): RunDetail {
  const round = view.rounds?.find((rd) => rd.n === (row.round ?? 1));
  return { ...row, story: view.story, run_id: runId, ...(round?.delegated_reason !== undefined ? { delegated_round: round } : {}) };
}

/** null when the unit or the run is unknown, or the unit has no run yet. */
export function loadRunView(opts: LoadRunViewOptions): RunDetail | null {
  if (new RegExp(ULID_PATTERN).test(opts.target)) {
    const wts = scanWorktrees(opts.repoRoot);
    const snap = loadSnapshot({ repoRoot: opts.repoRoot, storyRoots: [...wts.stories.values()], home: opts.home, env: opts.env });
    for (const s of snap.stories) {
      const view = loadTraceView({ ...opts, key: s.key });
      const row = view?.steps.find((r) => r.who.some((w) => w.run_id === opts.target));
      if (view && row) return detail(view, row, opts.target);
    }
    return null;
  }
  const view = loadTraceView({ ...opts, key: opts.target });
  const row = view?.steps.findLast((r) => r.unit === opts.target);
  return view && row ? detail(view, row, lastRun(row)) : null;
}
