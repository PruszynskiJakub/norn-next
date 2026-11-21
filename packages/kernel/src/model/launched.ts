import type { KernelReceipt } from "./receipts.ts";
import type { RunInfo, RunState } from "./run-state.ts";

/**
 * The agent run the newest launch on the record started at the unit's step, applied or not. The
 * launch's receipt is applied by the next tick, but the agent it started asks for its brief and may
 * report within seconds: until then the unapplied receipt is the only word that it is live, and a
 * report against it must be held to the code level that receipt names.
 */
export function launchedRun(state: RunState, unapplied: readonly KernelReceipt[]): RunInfo | null {
  let run = state.run;
  for (const r of unapplied) {
    const d = r.data;
    if (d.kind !== "run.started" || d.run_kind !== "agent" || d.step !== state.step || d.attempt !== state.attempt) continue;
    if (run?.id === d.run_id) {
      // the same run again: the launch's outcome names the session and the hooks its intent could not
      run = { ...run, ...(d.session !== undefined && { session: d.session }), ...(d.hooks !== undefined && { hooks: d.hooks }) };
      continue;
    }
    // as the kernel applies it: a fresh run only where none is, a retry only of the current one
    if ((d.retry_of ?? null) !== (run?.id ?? null)) continue;
    run = {
      id: d.run_id,
      step: state.step,
      attempt: state.attempt,
      started_at: r.at,
      executor: d.executor,
      attended: d.attended,
      nudges: 0,
      ...(d.session !== undefined && { session: d.session }),
      ...(d.code !== undefined && { code: d.code }),
      ...(d.hooks !== undefined && { hooks: d.hooks }),
    };
  }
  return run;
}
