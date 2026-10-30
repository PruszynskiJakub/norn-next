/**
 * loadRunView (B44): one run of a unit — its step row of the timeline (step, attempt, outcome,
 * durations, who, reason, receipts). A unit key means its latest run; a run id is looked up in
 * the timelines of every story. Local files only, like loadTraceView.
 */
import { ULID_PATTERN } from "@norn/schema";
import { loadSnapshot, scanWorktrees } from "@norn/store";
import { type LoadTraceViewOptions, loadTraceView } from "./trace-view.ts";
import type { StepRow } from "./types.ts";

export interface RunDetail extends StepRow {
  story: string;
  /** the agent session of the row (the one asked for by a run id, else its latest); null for a gate or check */
  run_id: string | null;
}

export type LoadRunViewOptions = Omit<LoadTraceViewOptions, "key" | "events" | "all" | "storyOnly"> & {
  /** a unit key or a run id */
  target: string;
};

const lastRun = (r: StepRow) => r.who.findLast((w) => w.run_id)?.run_id ?? null;

/** null when the unit or the run is unknown, or the unit has no run yet. */
export function loadRunView(opts: LoadRunViewOptions): RunDetail | null {
  if (new RegExp(ULID_PATTERN).test(opts.target)) {
    const wts = scanWorktrees(opts.repoRoot);
    const snap = loadSnapshot({ repoRoot: opts.repoRoot, storyRoots: [...wts.stories.values()], home: opts.home, env: opts.env });
    for (const s of snap.stories) {
      const row = loadTraceView({ ...opts, key: s.key })?.steps.find((r) => r.who.some((w) => w.run_id === opts.target));
      if (row) return { ...row, story: s.key, run_id: opts.target };
    }
    return null;
  }
  const view = loadTraceView({ ...opts, key: opts.target });
  const row = view?.steps.findLast((r) => r.unit === opts.target);
  return view && row ? { ...row, story: view.story, run_id: lastRun(row) } : null;
}
