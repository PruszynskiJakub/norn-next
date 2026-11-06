/**
 * H12 (bypass #265): which performed actions leave the next tick something to do at once. decide does
 * one thing per unit per tick (H3), so a tick that applies a receipt, writes a git step's `classify`
 * receipt or starts a unit leaves the follow-up (the next step's start, the receipt's apply) to the
 * next tick. `norn watch` runs that tick at once instead of after its interval, up to a bound.
 *
 * Kinds that only wait on someone else afterwards — an agent launched or nudged (`start_run`, `nudge`,
 * `retry_fresh`), a detached check started (`run_check`: the receipt the detached `norn check-run` writes wakes watch, H13), a person asked
 * (`park`, `notify`), a renewal or a release, housekeeping — leave nothing for an immediate tick.
 * Pure: read from the decided action alone, never from prose (P8).
 */
import type { Action } from "./actions.ts";

export function leavesFollowUp(action: Action): boolean {
  switch (action.kind) {
    case "apply_receipts": // the cursor moved: the next step starts (or a delivery follows)
    case "run_git": // its `classify` receipt waits to be applied
    case "classify": // a route was taken: the step it led to is ready
    case "reject_receipt": // applied_through moved: later receipts may apply
    case "import_mailbox": // mailbox receipts wait to be applied
    case "start_unit":
    case "start_slices":
    case "mark_done": // the story's slices step may move on
    case "round_start":
    case "round_migrate":
    case "intake_story": // the claim follows
    case "reclaim_leases": // freed slots: a queued step may start
      return true;
    case "claim":
      return action.op === "acquire"; // the unit starts next
    default:
      return false;
  }
}
