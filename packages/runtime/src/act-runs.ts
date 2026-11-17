/**
 * Agent runs through the launcher, each under the Journal's act protocol: the intent receipt, the
 * launcher call, then (for a start) a second `run.started` naming the session the launcher answered,
 * which applyReceipts folds into the run already on the record. Once that receipt is written a replay
 * never launches again; between the launch and it, the launcher's idempotence by run id keeps a replay
 * to the one session.
 */
import type { DecisionOf, ReceiptData, ReceiptIntent, RunInfo } from "@norn/kernel";
import { fail, ok, type PluginResult } from "@norn/plugin-api";
import { ensureWorktree } from "./branches.ts";
import type { TickContext } from "./env.ts";
import { unitInFacts } from "./record.ts";

const unitOf = (d: { unit: string | null; rule: string }): string => {
  if (d.unit === null) throw new Error(`${d.rule}: a unit decision without a unit`);
  return d.unit;
};

/** What the agent is told when nudged, by why decide nudged it. */
const NUDGES: Record<string, string> = {
  silent: "norn: no activity from you for a while. Carry on with the step, and report it with `norn done` when it is finished, `norn ask` to ask a person, or `norn stuck`.",
  turn_ended: "norn: your turn ended without a report. Finish the step and report it with `norn done`, or use `norn ask` or `norn stuck`.",
  limited: "norn: the usage limit has reset. Carry on with the step and report it with `norn done` when it is finished.",
};

export function nudgeText(reason: string): string {
  return NUDGES[reason] ?? `norn: ${reason}. Carry on with the step and report it with \`norn done\`.`;
}

/** The run on the record the decision names, as the tick's facts showed it. */
function runOnRecord(t: TickContext, unit: string, runId: string): RunInfo | null {
  const run = unitInFacts(t.facts, unit)?.state?.run ?? null;
  return run?.id === runId ? run : null;
}

/** The launch's own receipt: the intent again, now naming the session, so a replay finds the launch done. */
function launched(intent: ReceiptIntent, handle: string): ReceiptData {
  if (intent.data.kind !== "run.started") throw new Error(`a launch goes under run.started, not ${intent.data.kind}`);
  return { ...intent.data, session: handle };
}

async function launch(t: TickContext, d: DecisionOf<"start_run"> | DecisionOf<"retry_run">): Promise<PluginResult<unknown>> {
  const unit = unitOf(d);
  const worktree = await ensureWorktree(t.env, unit);
  if (!worktree.ok) return worktree;
  const request = {
    unit,
    run_id: d.run_id,
    step: d.brief.step,
    executor: d.executor,
    attended: d.attended,
    worktree: worktree.value,
    brief: d.brief,
    ...(d.kind === "start_run" && d.resume !== undefined ? { resume: d.resume } : {}),
  };
  const acted = await t.env.journal.act(unit, {
    intent: d.intent,
    perform: () => t.env.launcher.start(request),
    outcome: (v) => launched(d.intent, v.handle),
    next: () => null,
  });
  if (!acted.ok) return acted;
  return ok({ performed: acted.value.performed, handle: acted.value.value?.handle ?? null, worktree: worktree.value });
}

export async function startRun(t: TickContext, d: DecisionOf<"start_run">): Promise<PluginResult<unknown>> {
  return launch(t, d);
}

/** A fresh session in place of one that died or cannot take a nudge; the old session is stopped first in case it lingers. */
export async function retryRun(t: TickContext, d: DecisionOf<"retry_run">): Promise<PluginResult<unknown>> {
  const previous = runOnRecord(t, unitOf(d), d.previous_run_id);
  if (previous?.session) await t.env.launcher.stop(previous.session);
  return launch(t, d);
}

export async function nudge(t: TickContext, d: DecisionOf<"nudge">): Promise<PluginResult<unknown>> {
  const unit = unitOf(d);
  const handle = runOnRecord(t, unit, d.run_id)?.session;
  // checked before the intent: a nudge recorded but never sent would still count against the step's nudges
  if (!handle) return fail("not_found", `run ${d.run_id} of ${unit} has no session to nudge`, false);
  const acted = await t.env.journal.act(unit, { intent: d.intent, perform: () => t.env.launcher.nudge(handle, nudgeText(d.reason)), outcome: null, next: () => null });
  return acted.ok ? ok({ performed: acted.value.performed }) : acted;
}

/** A stop with no session on the record has nothing to reach: a check or step runs inside the tick and has ended already. */
export async function stopRun(t: TickContext, d: DecisionOf<"stop_run">): Promise<PluginResult<unknown>> {
  const unit = unitOf(d);
  const handle = runOnRecord(t, unit, d.run_id)?.session;
  const perform = async (): Promise<PluginResult<void>> => (handle ? t.env.launcher.stop(handle) : ok(undefined));
  if (!d.intent) {
    const stopped = await perform();
    return stopped.ok ? ok({ stopped: handle !== undefined }) : stopped;
  }
  const acted = await t.env.journal.act(unit, { intent: d.intent, perform, outcome: null, next: () => null });
  return acted.ok ? ok({ performed: acted.value.performed, stopped: handle !== undefined }) : acted;
}
