/**
 * What the unit rules share: the unit as they read it, receipts built for the current step and
 * attempt, the apply decision that commits them, inbox items, and agent capacity for the tick.
 */
import type { DecisionOf, InboxItem, InboxKind } from "../model/actions.ts";
import type { StoryFacts, UnitFacts } from "../model/facts.ts";
import type { KernelReceipt, ReceiptData, ReceiptIntent } from "../model/receipts.ts";
import type { RunState } from "../model/run-state.ts";
import type { CompiledStep, WorkflowGraph } from "../workflow/graph.ts";
import { applyReceipts } from "../journal/apply.ts";
import type { DecideContext } from "./context.ts";
import { applyAction, lastSeq, parkWith } from "./record.ts";

/** One unit at its current step, as every step rule reads it. */
export interface UnitView {
  story: StoryFacts;
  unit: UnitFacts;
  /** the run state the rules decide from: a park decide itself derives is already lifted from it */
  state: RunState;
  graph: WorkflowGraph;
  step: CompiledStep;
  ctx: DecideContext;
}

type Unheaded<D> = D extends unknown ? Omit<D, "step" | "attempt"> : never;
/** Receipt data before the step and attempt it was written for are stamped on it. */
export type ReceiptBody = Unheaded<ReceiptData>;

/** A receipt for the unit's current step and attempt, under the next id of the tick. */
export function intentFor(v: UnitView, body: ReceiptBody): ReceiptIntent {
  return { id: v.ctx.nextId(), data: { ...body, step: v.state.step, attempt: v.state.attempt } as ReceiptData };
}

/**
 * Write `intents` and commit the state applyReceipts computes from the unit's unapplied receipts and
 * them, in that order, with any refusal recorded in the same act. The new receipts are numbered after
 * the last one the facts show; the store numbers them for real, and a replay reads them back.
 */
export function applyDecision(v: UnitView, rule: string, intents: readonly ReceiptIntent[]): DecisionOf<"apply_receipts"> {
  const pending = v.unit.receipts;
  let seq = lastSeq(v.unit);
  const fresh: KernelReceipt[] = intents.map((i) => ({ seq: ++seq, id: i.id, at: v.ctx.facts.now, data: i.data }));
  const res = applyReceipts(v.state, [...pending, ...fresh], v.graph);
  return applyAction(v.unit.id, v.unit, rule, intents, res.state, res.rejected, v.ctx);
}

/**
 * Apply what a run answered, or park the unit for a person when applyReceipts would refuse it (an
 * outcome the step does not declare). The answer stays in the facts each tick, so writing its refused
 * receipt would repeat every tick with no bound; parked under `rejectedRule`, nothing is written and a
 * changed answer (a new report) is applied as soon as it comes.
 */
export function applyOrPark(v: UnitView, rule: string, rejectedRule: string, intents: readonly ReceiptIntent[]): DecisionOf<"apply_receipts"> | DecisionOf<"park"> {
  const d = applyDecision(v, rule, intents);
  const through = lastSeq(v.unit);
  const refused = d.rejected.filter((r) => r.seq > through);
  if (!refused.length) return d;
  return parkDecision(v, rejectedRule, "stuck", { text: `not applied: ${refused.map((r) => r.reason).join("; ")}` });
}

/** End the unit stuck, naming why: a bound on something decide repeats ran out. */
export function endStuckDecision(v: UnitView, rule: string, reason: string): DecisionOf<"apply_receipts"> {
  return applyDecision(v, rule, [intentFor(v, { kind: "unit.marked", ended: "stuck", reason })]);
}

export interface InboxDetail {
  text?: string;
  options?: string[];
  input_id?: string;
}

export function inboxItem(v: UnitView, kind: InboxKind, detail: InboxDetail = {}): InboxItem {
  const item: InboxItem = { kind, unit: v.unit.id, step: v.state.step, since: v.ctx.facts.now };
  if (detail.text !== undefined) item.text = detail.text;
  if (detail.options !== undefined) item.options = [...detail.options];
  if (detail.input_id !== undefined) item.input_id = detail.input_id;
  return item;
}

/**
 * The unit waits for a person. The park's reason is the rule that parked it, so a later tick can tell
 * a park decide derives from facts (and lifts when they change) from one a receipt put there.
 */
export function parkDecision(v: UnitView, rule: string, kind: InboxKind, detail: InboxDetail = {}): DecisionOf<"park"> {
  return parkWith(v.unit.id, v.unit, v.state, rule, rule, inboxItem(v, kind, detail), v.ctx);
}

export function noop(v: UnitView, rule: string, reason: string): DecisionOf<"noop"> {
  return { kind: "noop", unit: v.unit.id, rule, reason };
}

/** Milliseconds from `since` to the tick's now. */
export function ageMs(ctx: DecideContext, since: string): number {
  return Date.parse(ctx.facts.now) - Date.parse(since);
}

/**
 * Slots in use this tick: runs on the record at an agent or a check step, plus the ones this tick
 * started. A check runs detached beside the agents, on the same machine's cores, so it counts as one.
 * Kept per tick beside the context, so decide stays a function of its facts.
 */
const startedThisTick = new WeakMap<DecideContext, number>();

function agentRunsOnRecord(ctx: DecideContext): number {
  let n = 0;
  for (const story of ctx.facts.stories) {
    // a shared store shows other machines' stories too; their runs take those machines' slots, not this one's
    if (story.claim && story.claim.holder !== ctx.facts.holder) continue;
    for (const unit of story.units) {
      const st = unit.state;
      if (!st?.run || st.ended) continue;
      const graph = ctx.workflows.byHash[st.workflow.hash]?.graph;
      const kind = graph?.steps[st.run.step]?.kind;
      if (kind === "agent" || kind === "check") n++;
    }
  }
  return n;
}

/** Take one slot for a new agent or check run; false when `maxAgents` are in use. */
export function takeAgentSlot(ctx: DecideContext): boolean {
  const started = startedThisTick.get(ctx) ?? 0;
  if (agentRunsOnRecord(ctx) + started >= ctx.config.maxAgents) return false;
  startedThisTick.set(ctx, started + 1);
  return true;
}
