/**
 * What the host remembers of a check or plugin step it ran, until decide turns it into a receipt.
 * The kernel routes a check's or step's outcome from facts (`step_run`), not from a receipt the host
 * writes itself, so the answer is kept here between the tick that ran it and the tick that applies it.
 *
 * A run inside the tick is written only once finished: a tick that crashed mid-run would leave it
 * running for good, where no record at all reads as cut short and decide runs it again under its
 * retries. A detached run (a check started through `ctx.spawn`) is written `running` with the handle
 * of its process, so liveness, not the record, tells a died run: running, not alive and no exit
 * recorded is a failed outcome with its reason (see checks-detached.ts).
 */
import { type HostContext, parseJson } from "@norn/plugin-api";
import { IsoTime, NonEmpty, PosInt } from "@norn/schema";
import { type Static, Type } from "@sinclair/typebox";
import type { StepRunFacts } from "@norn/kernel";

export const STEP_RUNS_DIR = "runtime/step-runs";

export const StepRunRecord = Type.Object(
  {
    unit: NonEmpty,
    run_id: NonEmpty,
    /** the receipt the run went under (`run.started`, `run.resumed`), or absent for a wait poll after the first */
    intent_id: Type.Optional(NonEmpty),
    step: NonEmpty,
    attempt: PosInt,
    /** `check` or the step kind's name */
    kind: NonEmpty,
    outcome: Type.Optional(NonEmpty),
    error: Type.Optional(Type.String()),
    /** the check's exit code */
    exit: Type.Optional(Type.Integer()),
    /** the end of what the check printed, for the brief of the step that reworks it */
    output: Type.Optional(Type.String()),
    detail: Type.Optional(Type.Unknown()),
    at: IsoTime,
    /** a detached run that was started and has not been seen to finish */
    running: Type.Optional(Type.Boolean()),
    /** the detached process, as checks-detached.ts encodes it */
    handle: Type.Optional(NonEmpty),
    /** where the detached process's output goes, for the output tail once it exits */
    log: Type.Optional(NonEmpty),
    /** the deadline facts enforce on a detached run: started `at` plus this */
    timeout_ms: Type.Optional(PosInt),
    finished_at: Type.Optional(IsoTime),
  },
  { additionalProperties: false, title: "StepRunRecord" },
);
export type StepRunRecord = Static<typeof StepRunRecord>;

export function stepRunPath(ctx: HostContext, unit: string): string {
  return `${ctx.repo.dataDir}/${STEP_RUNS_DIR}/${unit.replace("/", "-")}.json`;
}

/** The unit's last step run, or null when there is none or it fails validation (then it is run again, never guessed at). */
export async function readStepRun(ctx: HostContext, unit: string): Promise<StepRunRecord | null> {
  const text = await ctx.files.read(stepRunPath(ctx, unit));
  if (text === null) return null;
  const parsed = parseJson(StepRunRecord, text, "step run");
  return parsed.ok && parsed.value.unit === unit ? parsed.value : null;
}

export async function writeStepRun(ctx: HostContext, record: StepRunRecord): Promise<void> {
  await ctx.files.write(stepRunPath(ctx, record.unit), `${JSON.stringify(record, null, 2)}\n`);
}

/** The fact decide reads: the record when it belongs to the run, step and attempt the unit is at. */
export function stepRunFact(record: StepRunRecord | null, run: { id: string; step: string; attempt: number } | null): StepRunFacts | undefined {
  if (!record || !run || record.run_id !== run.id || record.step !== run.step || record.attempt !== run.attempt) return undefined;
  const fact: StepRunFacts = { kind: record.kind, running: record.running === true };
  if (record.outcome !== undefined) fact.outcome = record.outcome;
  if (record.error !== undefined) fact.error = record.error;
  if (record.detail !== undefined) fact.detail = record.detail;
  return fact;
}
