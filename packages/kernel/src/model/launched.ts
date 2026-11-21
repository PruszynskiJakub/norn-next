import type { KernelReceipt } from "./receipts.ts";
import type { RunInfo, RunState, SupervisorRun } from "./run-state.ts";

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

/**
 * The supervisor at work for the unit's visit, applied or not: its launch is applied by the next tick,
 * but the supervisor asks for its brief and may answer within seconds, and only the unapplied
 * `supervisor.started` says it stands in. Null when none does.
 */
export function launchedSupervisor(state: RunState, unapplied: readonly KernelReceipt[]): SupervisorRun | null {
  let sup = state.supervisor ?? null;
  for (const r of unapplied) {
    const d = r.data;
    if (d.kind !== "supervisor.started" || d.step !== state.step || d.attempt !== state.attempt) continue;
    if (sup?.id === d.run_id) {
      if (d.session !== undefined) sup = { ...sup, session: d.session };
      continue;
    }
    if (sup !== null) continue;
    sup = { id: d.run_id, subject: d.subject, executor: d.executor, started_at: r.at, ...(d.input_id !== undefined && { input_id: d.input_id }), ...(d.session !== undefined && { session: d.session }) };
  }
  return sup;
}
