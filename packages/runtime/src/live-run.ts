/**
 * What an agent's side asks of a unit's record: which run is live, whether its step is an agent
 * step that waits on a report, and which outcomes `done` may name. Read from the run state and the
 * flat workflow document it pins, so a hook process needs no loaded workflows to answer.
 */
import { type KernelReceipt, OVERRIDABLE_OUTCOMES, type RunInfo, type RunState, type UnitJournal } from "@norn/kernel";
import type { HandBack, StepWrites, Verdict } from "@norn/schema";

const CLASSIFIED: ReadonlySet<string> = new Set(OVERRIDABLE_OUTCOMES);

export interface LiveStep {
  run: RunInfo;
  step: string;
  attempt: number;
  /** the step runs an agent, so its run ends with a report */
  agent: boolean;
  attended: boolean;
  /** the outcomes an agent may report with `done`, in the order the workflow lists them */
  outcomes: string[];
  /** `criteria: required`: `done` comes with a criteria report */
  criteria: boolean;
  /** outcome → the worst verdict of the report it may be reported with */
  verdict: Record<string, Verdict>;
  /** outcome → what its `done` must hand back */
  handBack: Record<string, HandBack>;
}

/** The outcomes a step routes that an agent may report: the ones norn classifies itself are left out. */
export function reportableOutcomes(routed: readonly string[]): string[] {
  return routed.filter((o) => !CLASSIFIED.has(o));
}

/**
 * The agent run the newest launch on the record started at the unit's step, applied or not. The
 * launch's receipt is applied by the next tick, but the agent it started asks for its brief and may
 * stop or report within seconds: until then the unapplied receipt is the only word that it is live.
 */
function launchedRun(state: RunState, unapplied: readonly KernelReceipt[]): RunInfo | null {
  let run = state.run;
  for (const r of unapplied) {
    const d = r.data;
    if (d.kind !== "run.started" || d.run_kind !== "agent" || d.step !== state.step || d.attempt !== state.attempt || run?.id === d.run_id) continue;
    // as the kernel applies it: a fresh run only where none is, a retry only of the current one
    if ((d.retry_of ?? null) !== (run?.id ?? null)) continue;
    run = { id: d.run_id, step: state.step, attempt: state.attempt, started_at: r.at, executor: d.executor, attended: d.attended, nudges: 0, ...(d.session !== undefined && { session: d.session }) };
  }
  return run;
}

/**
 * The unit's live run and its step, or null when no run is on the record or the unit has ended.
 * `unapplied` is the record's receipts above its state, so a run launched since the last tick counts.
 */
export function liveStepOf(state: RunState | null, unapplied: readonly KernelReceipt[] = []): LiveStep | null {
  if (!state || state.ended !== undefined) return null;
  const run = launchedRun(state, unapplied);
  if (!run) return null;
  const doc = state.workflow.doc.steps[state.step];
  if (!doc) return null;
  const agent = typeof doc.agent === "string";
  return {
    run,
    step: state.step,
    attempt: state.attempt,
    agent,
    attended: doc.attended === true,
    outcomes: agent ? reportableOutcomes(Object.keys(doc.outcomes ?? {})) : [],
    criteria: agent && doc.criteria === "required",
    verdict: agent ? { ...(doc.verdict ?? {}) } : {},
    handBack: agent ? { ...(doc.hand_back ?? {}) } : {},
  };
}

/**
 * The step's `writes` in every launch env, resumes too, set always so a value inherited from the
 * launching process never stands. The hook guard reads the step's rule from the record; when the
 * record cannot be read it holds this instead, so a docs-only run never falls back to the worktree rule.
 */
export const WRITES_ENV = "NORN_WRITES";

/**
 * The step a run was started at and what it lets the agent write, from the run's start receipt and
 * the workflow the unit pins; null when the record holds no start of that run. A run that is no
 * longer live is held to its own step's rule, not to the step the unit has moved on to.
 */
export function runWrites(unit: UnitJournal, runId: string): { step: string; writes: StepWrites } | null {
  const started = unit.receipts.findLast((r) => r.data.kind === "run.started" && r.data.run_id === runId);
  if (started?.data.kind !== "run.started") return null;
  const step = started.data.step ?? (unit.state?.run?.id === runId ? unit.state.run.step : undefined);
  if (step === undefined) return null;
  return { step, writes: unit.state?.workflow.doc.steps[step]?.writes ?? "worktree" };
}

/** The run's newest report on the record that still stands, applied or not yet. */
function standingReport(unit: UnitJournal, runId: string) {
  const rejected = new Set(unit.receipts.flatMap((r) => (r.data.kind === "receipt.rejected" ? [r.data.seq] : [])));
  const r = unit.receipts.findLast((x) => x.data.kind === "run.reported" && x.data.run_id === runId && !rejected.has(x.seq));
  return r?.data.kind === "run.reported" ? { seq: r.seq, id: r.id, verb: r.data.verb, outcome: r.data.outcome } : null;
}

/**
 * The run's report on the record, applied or not yet; null when it has none. A report the kernel
 * refused (`receipt.rejected`) is no report, and neither is an ask a person has since answered: the
 * agent works on with the answer and still owes the step its report.
 */
export function reportOnRecord(unit: UnitJournal, runId: string): { seq: number; id: string } | null {
  const r = standingReport(unit, runId);
  if (!r) return null;
  if (r.verb === "ask" && unit.receipts.some((x) => x.data.kind === "answer.sent" && x.seq > r.seq)) return null;
  return { seq: r.seq, id: r.id };
}

/**
 * Whether the record already holds the report a session shows. The reporting API writes the receipt
 * before the event, so such a report is applied through its receipt; read off the session again, an
 * ask that does not end the run would be recorded and parked once more on every tick.
 */
export function sessionReportOnRecord(unit: UnitJournal, runId: string, report: { verb: string; outcome?: string }): boolean {
  const r = standingReport(unit, runId);
  return r !== null && r.verb === report.verb && r.outcome === report.outcome;
}

/**
 * Why the kernel refused the run's report a session shows: its newest matching `run.reported`
 * receipt was rejected and no report of the run stands since. Undefined when none was refused.
 */
export function sessionReportRejected(unit: UnitJournal, runId: string, report: { verb: string; outcome?: string }): string | undefined {
  if (standingReport(unit, runId) !== null) return undefined;
  const refusals = new Map(unit.receipts.flatMap((r) => (r.data.kind === "receipt.rejected" ? [[r.data.seq, r.data.reason] as const] : [])));
  const r = unit.receipts.findLast((x) => x.data.kind === "run.reported" && x.data.run_id === runId && x.data.verb === report.verb && x.data.outcome === report.outcome);
  return r === undefined ? undefined : refusals.get(r.seq);
}
