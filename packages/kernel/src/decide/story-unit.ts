/**
 * Story rules for one unit: a record that failed validation, a pinned workflow that is gone, an
 * ended unit, starting the story's first round, and a person's new round. Every state committed here
 * is either a fresh run state or the one applyReceipts computes, so routing lives in one place.
 */
import { applyReceipts, newRunState } from "../journal/apply.ts";
import type { Decision, InboxKind } from "../model/actions.ts";
import type { StoryFacts, UnitFacts } from "../model/facts.ts";
import type { KernelReceipt, ReceiptData, RejectedReceipt } from "../model/receipts.ts";
import type { RunState } from "../model/run-state.ts";
import type { LoadedWorkflow, WorkflowLoad } from "../workflow/graph.ts";
import type { DecideContext } from "./context.ts";
import { applyAction, lastSeq, markCorrupt, parkWith } from "./record.ts";

/** The seq the store gives the next receipt of the unit: receipts are numbered n+1 with no gaps. */
export function nextSeq(u: UnitFacts | null): number {
  return lastSeq(u) + 1;
}

/** A corrupt record, a unit marked corrupt, or a pinned workflow decide cannot find: never guessed at. */
export function corruptRule(u: UnitFacts | null, ctx: DecideContext): Decision | null {
  if (!u) return null;
  if (u.corrupt !== undefined) {
    if (u.corrupt_marked === true) return { kind: "noop", unit: u.id, rule: "unit.corrupt.held", reason: u.corrupt };
    return markCorrupt(u, "unit.corrupt", u.corrupt, ctx);
  }
  const state = u.state;
  if (!state) return null;
  if (state.ended === "corrupt") return { kind: "noop", unit: u.id, rule: "unit.corrupt.held", reason: state.ended_reason ?? "corrupt; never touched" };
  if (state.ended !== undefined) return null;
  const loaded = ctx.workflows.byHash[state.workflow.hash];
  if (!loaded) return markCorrupt(u, "unit.workflow_missing", `pinned workflow ${state.workflow.name} (${state.workflow.hash.slice(0, 12)}) is not loaded`, ctx);
  if (!loaded.graph.steps[state.step]) return markCorrupt(u, "unit.workflow_missing", `pinned workflow ${state.workflow.name} has no step '${state.step}'`, ctx);
  return null;
}

/** An ended unit with nothing left on its record waits; a person's receipt (a new round) is what moves it. */
export function endedRule(u: UnitFacts): Decision | null {
  const state = u.state;
  if (!state?.ended || u.receipts.length > 0) return null;
  if (state.ended === "corrupt") return { kind: "noop", unit: u.id, rule: "unit.corrupt.held", reason: state.ended_reason ?? "corrupt; never touched" };
  return { kind: "noop", unit: u.id, rule: `unit.ended.${state.ended}`, reason: state.ended_reason ?? `ended ${state.ended} at ${state.step}` };
}

/**
 * The unit waits for a person, with an inbox item saying why. A unit with no run state keeps only the
 * park's receipt, so the same park already on its record is held rather than written again.
 */
export function park(unit: string, u: UnitFacts | null, state: RunState | null, rule: string, kind: InboxKind, reason: string, ctx: DecideContext): Decision {
  if (state === null && u?.receipts.some((r) => r.data.kind === "unit.parked" && r.data.reason === reason)) return { kind: "noop", unit, rule: "unit.parked", reason };
  const inbox = { kind, unit, ...(state ? { step: state.step } : {}), text: reason, since: ctx.facts.now };
  return parkWith(unit, u, state, rule, reason, inbox, ctx);
}

/**
 * Record `data` as the unit's next receipt and commit the state applyReceipts computes from every
 * receipt not yet applied plus it, so what was already on the record is applied first.
 */
export function applyWith(u: UnitFacts, state: RunState, data: ReceiptData, rule: string, ctx: DecideContext): Decision {
  const loaded = ctx.workflows.byHash[state.workflow.hash];
  if (!loaded) return markCorrupt(u, "unit.workflow_missing", `pinned workflow ${state.workflow.name} is not loaded`, ctx);
  const receipt: KernelReceipt = { seq: nextSeq(u), id: ctx.nextId(), at: ctx.facts.now, data };
  const res = applyReceipts(state, [...u.receipts, receipt], loaded.graph);
  return applyAction(u.id, u, rule, [{ id: receipt.id, data }], res.state, res.rejected, ctx);
}

/** Why a workflow file cannot start a round, naming any step kind no configured plugin provides. */
export function loadProblem(name: string, load: WorkflowLoad | undefined): string | null {
  if (!load) return `workflow ${name} is not loaded`;
  if (load.ok) return null;
  const kinds = [...new Set(load.errors.flatMap((e) => (e.missing_kind ? [e.missing_kind] : [])))];
  const missing = kinds.length ? `; no configured plugin provides step kind ${kinds.join(", ")}` : "";
  return `workflow ${name} is invalid: ${load.errors.map((e) => `${e.path || "/"} ${e.message}`).join("; ")}${missing}`;
}

const rejectAll = (receipts: readonly KernelReceipt[], reason: string): RejectedReceipt[] => receipts.map((r) => ({ seq: r.seq, reason }));

/**
 * The story's own unit has no run state: start its first round. A `round.started` already on the
 * record (written at intake) pins its workflow; otherwise the config's workflow is pinned now.
 * Receipts before any round started belong to no round and are refused.
 */
export function startRule(story: StoryFacts, u: UnitFacts | null, ctx: DecideContext): Decision {
  const unit = story.key;
  const receipts = u?.receipts ?? [];
  const at = receipts.findIndex((r) => r.data.kind === "round.started");
  const round = receipts[at];
  if (round?.data.kind === "round.started") {
    const pinned = round.data.workflow;
    const loaded = ctx.workflows.byHash[pinned.hash];
    if (!loaded) return park(unit, u, null, "round.workflow_invalid", "workflow", `workflow ${pinned.name} (${pinned.hash.slice(0, 12)}) is not loaded`, ctx);
    const state = { ...firstState(story, loaded), applied_through: round.seq };
    return applyAction(unit, u, "round.start", [], state, rejectAll(receipts.slice(0, at), "no round had started"), ctx);
  }
  const name = ctx.config.workflow;
  const load = ctx.workflows.byName[name];
  const problem = loadProblem(name, load);
  if (problem || !load?.ok) return park(unit, u, null, "round.workflow_invalid", "workflow", problem ?? `workflow ${name} is not loaded`, ctx);
  const intent = { id: ctx.nextId(), data: { kind: "round.started" as const, workflow: structuredClone(load.workflow.pinned) } };
  const state = { ...firstState(story, load.workflow), applied_through: nextSeq(u) };
  return applyAction(unit, u, "round.start", [intent], state, rejectAll(receipts, "no round had started"), ctx);
}

function firstState(story: StoryFacts, workflow: LoadedWorkflow): RunState {
  return newRunState({ unit: story.key, story: story.key, workflow });
}

/**
 * A person's `round.started` on the record. It is applied alone: the receipts before it go first,
 * through applyReceipts against the round they were made for. Applying it pins its workflow in a
 * fresh run state at the start step, the story's mode carried over; one written for another step or
 * attempt than the unit is at, or pinning a workflow decide cannot find, is refused.
 */
export function roundRule(u: UnitFacts, state: RunState, ctx: DecideContext): Decision | null {
  const at = u.receipts.findIndex((r) => r.data.kind === "round.started");
  if (at < 0) return null;
  const current = ctx.workflows.byHash[state.workflow.hash];
  if (at > 0) {
    if (!current) return markCorrupt(u, "unit.workflow_missing", `pinned workflow ${state.workflow.name} is not loaded`, ctx);
    const res = applyReceipts(state, u.receipts.slice(0, at), current.graph);
    return applyAction(u.id, u, "receipts.apply", [], res.state, res.rejected, ctx);
  }
  const r = u.receipts[0] as KernelReceipt;
  if (r.data.kind !== "round.started") return null;
  const refuse = (rule: string, reason: string): Decision => applyAction(u.id, u, rule, [], { ...state, applied_through: r.seq }, [{ seq: r.seq, reason }], ctx);
  const { step, attempt } = r.data;
  if ((step !== undefined && step !== state.step) || (attempt !== undefined && attempt !== state.attempt))
    return refuse("receipts.reject", `stale: written for ${step ?? state.step}#${attempt ?? state.attempt}, the unit is at ${state.step}#${state.attempt}`);
  const pinned = r.data.workflow;
  const loaded = ctx.workflows.byHash[pinned.hash];
  if (!loaded) return refuse("round.workflow_invalid", `workflow ${pinned.name} (${pinned.hash.slice(0, 12)}) is not loaded`);
  const res = applyReceipts(state, [r], loaded.graph);
  return applyAction(u.id, u, "round.start", [], res.state, res.rejected, ctx);
}
