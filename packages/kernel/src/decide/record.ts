/**
 * How a decision puts itself on a unit's record, shared by the story and unit rules: every change
 * decide asks for is a receipt first and a state second, so the next tick's facts already show it
 * and decide never asks for the same thing twice. A refusal is written in the same act as what was
 * refused, a park and a corrupt mark each leave their receipt, and the state committed with them is
 * the one those receipts lead to.
 */
import type { DecisionOf, InboxItem } from "../model/actions.ts";
import type { UnitFacts } from "../model/facts.ts";
import type { ReceiptIntent, RejectedReceipt } from "../model/receipts.ts";
import type { RunState } from "../model/run-state.ts";
import type { DecideContext } from "./context.ts";

/** The highest seq on the unit's record as the facts show it; the store numbers the next receipt one above. */
export function lastSeq(u: UnitFacts | null): number {
  return Math.max(u?.state?.applied_through ?? 0, u?.receipts.at(-1)?.seq ?? 0);
}

/**
 * Write `intents`, then a `receipt.rejected` for each refusal, then commit `state`. When `state` has
 * applied every receipt up to the last intent, it applies the refusals too: they move nothing, and
 * left unapplied they would cost the unit a tick of its own to apply. When something is left
 * unapplied before them (a round that waits for its own graph), they wait in order like any receipt.
 */
export function applyAction(
  unit: string,
  u: UnitFacts | null,
  rule: string,
  intents: readonly ReceiptIntent[],
  state: RunState,
  rejected: readonly RejectedReceipt[],
  ctx: DecideContext,
): DecisionOf<"apply_receipts"> {
  const last = lastSeq(u) + intents.length;
  const notes: ReceiptIntent[] = rejected.map((r) => ({ id: ctx.nextId(), data: { kind: "receipt.rejected", seq: r.seq, reason: r.reason } }));
  const folded = notes.length > 0 && state.applied_through === last ? { ...state, applied_through: last + notes.length } : state;
  return { kind: "apply_receipts", unit, rule, receipts: [...intents, ...notes], state: folded, expect_version: u?.version ?? null, rejected: [...rejected] };
}

/**
 * Mark the unit corrupt. The `unit.marked` receipt is the mark: appended even to a record that fails
 * validation, it is what the host reads back as `corrupt_marked`, so the unit is marked once. A
 * readable state ends corrupt with it; receipts already waiting stay unapplied, since applying them
 * would need the graph a corrupt unit may not have.
 */
export function markCorrupt(u: UnitFacts, rule: string, reason: string, ctx: DecideContext): DecisionOf<"mark_corrupt"> {
  const intent: ReceiptIntent = { id: ctx.nextId(), data: { kind: "unit.marked", ended: "corrupt", reason } };
  const readable = u.corrupt === undefined ? u.state : null;
  let state: RunState | null = null;
  if (readable) {
    state = { ...readable, run: null, ended: "corrupt", ended_reason: reason };
    delete state.parked;
    delete state.exhausted;
    if (u.receipts.length === 0) state.applied_through = lastSeq(u) + 1;
  }
  return { kind: "mark_corrupt", unit: u.id, rule, reason, intent, state, expect_version: u.version ?? null };
}

/**
 * Park the unit for a person: a `unit.parked` receipt, and the state it leads to when the unit has
 * one. A unit with no run state keeps the receipt alone, which the story rules read back. Decide parks
 * only a unit with nothing unapplied on its record (receipts are applied first), so the state applies
 * the park receipt and nothing else.
 */
export function parkWith(unit: string, u: UnitFacts | null, state: RunState | null, rule: string, reason: string, inbox: InboxItem | null, ctx: DecideContext): DecisionOf<"park"> {
  const header = state ? { step: state.step, attempt: state.attempt } : {};
  const intent: ReceiptIntent = { id: ctx.nextId(), data: { kind: "unit.parked", reason, ...header } };
  let next: RunState | null = null;
  if (state) {
    if (u?.receipts.length) throw new Error(`decide: ${rule} parks ${unit} with receipts unapplied`);
    next = { ...state, parked: { reason, since: ctx.facts.now }, applied_through: lastSeq(u) + 1 };
  }
  return { kind: "park", unit, rule, reason, inbox, intent, state: next, expect_version: u?.version ?? null };
}
