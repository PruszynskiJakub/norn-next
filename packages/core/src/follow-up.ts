/**
 * Which performed actions leave the next tick something to do at once. decide does one thing per
 * unit per tick, so `norn watch` runs the follow-up tick at once instead of after its interval.
 * Kinds that only wait on someone else (an agent launched, a detached check whose receipt wakes
 * watch, a person asked, a renewal, housekeeping) leave nothing for an immediate tick.
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
