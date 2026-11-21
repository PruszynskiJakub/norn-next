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
import { stopDetachedCheck } from "./checks-detached.ts";
import type { TickContext } from "./env.ts";
import { appendEvents } from "./events/log.ts";
import { nudgePromptId } from "./launcher.ts";
import { unitInFacts } from "./record.ts";
import { readStepRun } from "./step-runs.ts";

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

/**
 * A launch that failed leaves a run on the record with no session and no process to probe, which
 * would otherwise read as a slow start for the whole silent window and then die with no reason.
 * Its session is ended here naming the failure, so the next tick retries or ends it at once with it.
 * Best effort: a log that cannot take it leaves the silent window to find the run dead.
 */
async function endUnlaunched(t: TickContext, unit: string, runId: string, why: string): Promise<void> {
  const at = t.env.ctx.now();
  await appendEvents(t.env.ctx, unit, runId, [
    { type: "turn.ended", run_id: runId, seq: 0, at, error: `the agent could not be launched: ${why}` },
    { type: "session.ended", run_id: runId, seq: 1, at, reason: "crash" },
  ]);
}

async function launch(t: TickContext, d: DecisionOf<"start_run"> | DecisionOf<"retry_run">): Promise<PluginResult<unknown>> {
  const unit = unitOf(d);
  const worktree = await ensureWorktree(t.env, unit);
  if (!worktree.ok) return worktree;
  const writes = unitInFacts(t.facts, unit)?.state?.workflow.doc.steps[d.brief.step]?.writes;
  const request = {
    unit,
    run_id: d.run_id,
    step: d.brief.step,
    executor: d.executor,
    attended: d.attended,
    worktree: worktree.value,
    brief: d.brief,
    ...(d.kind === "start_run" && d.resume !== undefined ? { resume: d.resume } : {}),
    ...(writes !== undefined && { writes }),
  };
  const acted = await t.env.journal.act(unit, {
    intent: d.intent,
    perform: async () => {
      const started = await t.env.launcher.start(request);
      if (!started.ok) await endUnlaunched(t, unit, d.run_id, started.failure.message);
      return started;
    },
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
  const acted = await t.env.journal.act(unit, { intent: d.intent, perform: () => t.env.launcher.nudge(handle, nudgeText(d.reason), nudgePromptId(d.intent.id)), outcome: null, next: () => null });
  return acted.ok ? ok({ performed: acted.value.performed }) : acted;
}

/** The handle of the run's detached check while it still runs: a stop must reach it, as no session stands for it. */
async function runningCheck(t: TickContext, unit: string, runId: string): Promise<string | undefined> {
  const record = await readStepRun(t.env.ctx, unit);
  return record?.run_id === runId && record.running === true ? record.handle : undefined;
}

/**
 * A stop with no session on the record reaches the run's detached check when one runs; else there
 * is nothing to reach: a plugin step runs inside the tick and has ended already.
 */
export async function stopRun(t: TickContext, d: DecisionOf<"stop_run">): Promise<PluginResult<unknown>> {
  const unit = unitOf(d);
  const session = runOnRecord(t, unit, d.run_id)?.session;
  const check = session ? undefined : await runningCheck(t, unit, d.run_id);
  const handle = session ?? check;
  const perform = async (): Promise<PluginResult<void>> => {
    if (session) return t.env.launcher.stop(session);
    if (check) await stopDetachedCheck(t.env.ctx, check);
    return ok(undefined);
  };
  if (!d.intent) {
    const stopped = await perform();
    return stopped.ok ? ok({ stopped: handle !== undefined }) : stopped;
  }
  const acted = await t.env.journal.act(unit, { intent: d.intent, perform, outcome: null, next: () => null });
  return acted.ok ? ok({ performed: acted.value.performed, stopped: handle !== undefined }) : acted;
}
