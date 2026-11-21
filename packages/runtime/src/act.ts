/**
 * Carrying out one Decision under the Journal's act protocol: intent receipt, effect, outcome receipt,
 * state committed last. A failure comes back as an outcome, never a throw, so one unit's failure never
 * stops the others.
 */
import type { Decision } from "@norn/kernel";
import type { PluginResult } from "@norn/plugin-api";
import { nudge, retryRun, startRun, stopRun } from "./act-runs.ts";
import { runCheck, runStep } from "./act-steps.ts";
import { checkRun } from "./detect.ts";
import { claim, finishStory, flush, importMailbox, intakeStory, releaseClaim, renewClaim } from "./act-story.ts";
import { applyReceipts, markCorrupt, markDone, park, startSlices } from "./act-unit.ts";
import type { TickContext } from "./env.ts";
import type { ActionOutcome } from "./types.ts";

function carryOut(t: TickContext, d: Decision, index: number): Promise<PluginResult<unknown>> | PluginResult<unknown> {
  switch (d.kind) {
    case "intake_story":
      return intakeStory(t, d, index);
    case "claim":
      return claim(t, d);
    case "renew_claim":
      return renewClaim(t, d);
    case "release_claim":
      return releaseClaim(t, d);
    case "apply_receipts":
      return applyReceipts(t, d);
    case "start_run":
      return startRun(t, d);
    case "retry_run":
      return retryRun(t, d);
    case "nudge":
      return nudge(t, d);
    case "check_run":
      return checkRun(t, d);
    case "stop_run":
      return stopRun(t, d);
    case "run_check":
      return runCheck(t, d);
    case "run_step":
      return runStep(t, d);
    case "start_slices":
      return startSlices(t, d);
    case "mark_done":
      return markDone(t, d);
    case "mark_corrupt":
      return markCorrupt(t, d);
    case "park":
      return park(t, d);
    case "import_mailbox":
      return importMailbox(t, d);
    case "finish_story":
      return finishStory(t, d);
    case "flush":
      return flush(t, d);
    // an inbox item and a noop have no effect here: the trace is their record, and a front end reads it
    case "notify":
      return { ok: true, value: { inbox: d.item } };
    case "noop":
      return { ok: true, value: undefined };
  }
}

/** `index` is the decision's place in the tick, which ids the host derives for it are keyed by. */
export async function act(t: TickContext, decision: Decision, index: number): Promise<ActionOutcome> {
  try {
    const r = await carryOut(t, decision, index);
    if (r.ok) return r.value === undefined ? { decision, ok: true } : { decision, ok: true, detail: r.value };
    return { decision, ok: false, error: `${r.failure.code}: ${r.failure.message}`, retryable: r.failure.retryable };
  } catch (e) {
    return { decision, ok: false, error: `threw: ${e instanceof Error ? e.message : String(e)}`, retryable: false };
  }
}
