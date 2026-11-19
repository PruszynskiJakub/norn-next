/**
 * Checks and plugin step kinds in the unit's worktree. A check runs detached on a host that can
 * spawn (checks-detached.ts), so the tick does not wait for it; on a host that cannot, it runs inside
 * the tick. A plugin step kind runs inside the tick. Each run goes under its intent receipt, and how
 * it went is kept as the unit's step run, which the next ticks turn into a receipt through decide. A
 * run found already answered under the same intent is not run again, so a replay of the act repeats
 * no effect; a failure that left no answer is recorded as the run's error, and decide runs it again
 * while the retries last.
 */
import type { DecisionOf, ReceiptIntent } from "@norn/kernel";
import { fail, ok, type PluginResult, stepKindAnswerProblem, type StepKindOutcome } from "@norn/plugin-api";
import { baseRefOf, branchOf, ensureWorktree } from "./branches.ts";
import { checkCommandOf } from "./check-command.ts";
import { canDetach, checkOutcome, OUTPUT_TAIL, startDetachedCheck } from "./checks-detached.ts";
import type { TickContext } from "./env.ts";
import { unitInFacts } from "./record.ts";
import { readStepRun, type StepRunRecord, writeStepRun } from "./step-runs.ts";

const unitOf = (d: { unit: string | null; rule: string }): string => {
  if (d.unit === null) throw new Error(`${d.rule}: a unit decision without a unit`);
  return d.unit;
};

const message = (e: unknown): string => (e instanceof Error ? e.message : String(e));

export { checkOutcome };

/**
 * Run `perform` under the decision's intent, or alone for a wait poll that carries none. The run is
 * answered once a step run under the same intent holds an outcome; then the act is a replay.
 */
async function underIntent(t: TickContext, unit: string, intent: ReceiptIntent | undefined, perform: () => Promise<StepRunRecord>): Promise<PluginResult<unknown>> {
  let reused = false;
  const once = async (): Promise<PluginResult<StepRunRecord>> => {
    const prior = intent ? await readStepRun(t.env.ctx, unit) : null;
    if (prior && prior.intent_id === intent?.id && prior.outcome !== undefined) {
      reused = true;
      return ok(prior);
    }
    const record = await perform();
    await writeStepRun(t.env.ctx, record);
    return ok(record);
  };
  if (!intent) {
    const ran = await once();
    return ran.ok ? ok(summary(ran.value, true)) : ran;
  }
  const acted = await t.env.journal.act(unit, { intent, perform: once, outcome: null, next: () => null });
  if (!acted.ok) return acted;
  return ok(acted.value.value ? summary(acted.value.value, acted.value.performed && !reused) : { performed: false });
}

function summary(r: StepRunRecord, performed: boolean): Record<string, unknown> {
  return { performed, ...(r.outcome !== undefined ? { outcome: r.outcome } : {}), ...(r.error !== undefined ? { error: r.error } : {}), ...(r.exit !== undefined ? { exit: r.exit } : {}) };
}

function base(t: TickContext, unit: string, d: { run_id: string; step: string; attempt: number }, kind: string, intent?: ReceiptIntent): StepRunRecord {
  return { unit, run_id: d.run_id, ...(intent ? { intent_id: intent.id } : {}), step: d.step, attempt: d.attempt, kind, at: t.env.ctx.now() };
}

export async function runCheck(t: TickContext, d: DecisionOf<"run_check">): Promise<PluginResult<unknown>> {
  if (canDetach(t.env.ctx)) return startDetachedCheck(t, d);
  const unit = unitOf(d);
  const state = unitInFacts(t.facts, unit)?.state;
  const exits = state ? (t.workflows.byHash[state.workflow.hash]?.graph.steps[d.step]?.check?.exits ?? {}) : {};
  const worktree = await ensureWorktree(t.env, unit);
  if (!worktree.ok) return worktree;
  return underIntent(t, unit, d.intent, async () => {
    const record = base(t, unit, d, "check", d.intent);
    const command = checkCommandOf(d.command, t.env.config.checks);
    if (!command.ok) return { ...record, error: command.error };
    try {
      const out = await t.env.ctx.exec(["sh", "-c", command.command], { cwd: worktree.value, timeoutMs: d.timeout_ms });
      const output = `${out.stdout}${out.stderr ? `\n${out.stderr}` : ""}${out.timedOut ? `\n(timed out after ${d.timeout_ms} ms)` : ""}`;
      return { ...record, outcome: checkOutcome(exits, out.code, out.timedOut), exit: out.code, output: output.slice(-OUTPUT_TAIL) };
    } catch (e) {
      return { ...record, error: `the check could not run: ${message(e)}` };
    }
  });
}

/** A step kind's answer as a step run: a declared outcome (or `waiting`), else the reason it was refused. */
function answered(record: StepRunRecord, kind: string, got: PluginResult<StepKindOutcome>, def: Parameters<typeof stepKindAnswerProblem>[0]): StepRunRecord {
  if (!got.ok) return { ...record, error: `${kind}: ${got.failure.message}` };
  const problem = stepKindAnswerProblem(def, got.value);
  if (problem) return { ...record, error: problem };
  return { ...record, outcome: got.value.outcome, ...(got.value.detail !== undefined ? { detail: got.value.detail } : {}) };
}

export async function runStep(t: TickContext, d: DecisionOf<"run_step">): Promise<PluginResult<unknown>> {
  const unit = unitOf(d);
  const def = t.env.slots.stepKinds[d.step_kind];
  if (!def) return fail("not_found", `no configured plugin provides step kind ${d.step_kind}`, false);
  const worktree = await ensureWorktree(t.env, unit);
  if (!worktree.ok) return worktree;
  const { vcs, forge, tracker } = t.env.slots;
  // a kind over the provider-neutral slots cannot learn the branch, the base or the receipt any other way
  const input = {
    unit,
    story: unit.split("/")[0] as string,
    step: d.step,
    config: structuredClone(d.config),
    worktree: worktree.value,
    slots: { vcs, forge, tracker },
    branch: branchOf(unit),
    base: { branch: t.env.config.base, ref: await baseRefOf(t.env) },
    ...(d.intent ? { receipt_id: d.intent.id } : {}),
  };
  return underIntent(t, unit, d.intent, async () => {
    const record = base(t, unit, d, d.step_kind, d.intent);
    try {
      return answered(record, d.step_kind, await def.run(input, t.env.ctx), def);
    } catch (e) {
      return { ...record, error: `${d.step_kind} threw: ${message(e)}` };
    }
  });
}
