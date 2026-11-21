/**
 * Unit rules: one unit's next action from its run state, unapplied receipts, session and step run.
 * Agent, check, gate and plugin steps, and the session-driven rules (silent → nudge, died → retry,
 * asking or a permission prompt → park with an inbox item, limited → wait for the reset, a turn ended
 * without a report → nudge, reported → apply). Every nudge and retry is bounded and running out is a
 * visible stuck. Manual mode leaves a ready agent step for a person; an attended step always waits for one.
 */
import type { Decision, DecisionOf } from "../model/actions.ts";
import type { StoryFacts, UnitFacts } from "../model/facts.ts";
import { ASKED_PARK, type RunState } from "../model/run-state.ts";
import type { DecideContext } from "./context.ts";
import { checkDue } from "./check-due.ts";
import { applyAction, markCorrupt } from "./record.ts";
import { decideQuestion, GATE_PARK } from "./supervisor.ts";
import { decideAgent } from "./unit-agent.ts";
import { decideCheck, decideGate, decidePluginStep } from "./unit-steps.ts";
import { applyDecision, noop, type UnitView } from "./unit-support.ts";


/**
 * Parks the unit rules derive from facts each tick, by the rule that parks. A park with any other
 * reason was put there by a receipt or the story rules and holds until a receipt lifts it.
 */
export const DERIVED_PARKS: ReadonlySet<string> = new Set([
  "agent.ready.attended",
  "agent.ready.manual",
  "agent.ready.no_headless",
  "agent.no_executor",
  "agent.unguarded",
  "agent.no_presence",
  "source.unbound",
  "agent.asking.park",
  "agent.permission.park",
  "agent.no_events.park",
  "agent.died.manual",
  "agent.silent.manual",
  "agent.turn_ended.manual",
  "agent.limited.manual",
  "agent.retry.no_headless",
  "agent.limited.unknown",
  "agent.reported.rejected",
  "agent.reporting.lost",
  "check.finished.rejected",
  "step.finished.rejected",
  GATE_PARK,
]);

/** The unit's one decision this tick, or null when nothing is to be done (a noop is still a decision). */
export function decideUnit(story: StoryFacts, unit: UnitFacts, ctx: DecideContext): Decision | null {
  const state = unit.state;
  if (unit.corrupt !== undefined) {
    if (unit.corrupt_marked === true) return { kind: "noop", unit: unit.id, rule: "unit.corrupt.held", reason: unit.corrupt };
    return markCorrupt(unit, "unit.corrupt", unit.corrupt, ctx);
  }
  // a unit's first run state comes from its story: the round start, or the slices step
  if (!state) return unit.id === story.key ? null : { kind: "noop", unit: unit.id, rule: "slice.not_started", reason: "started by the story's slices step" };
  if (state.ended === "corrupt") return { kind: "noop", unit: unit.id, rule: "unit.corrupt.held", reason: state.ended_reason ?? "corrupt" };
  // a new round is applied by the story rules, which pin its workflow, and so is a person's move,
  // which stops a live run before it applies
  if (unit.receipts.some((r) => r.data.kind === "round.started" || r.data.kind === "step.moved")) return null;
  const graph = ctx.workflows.byHash[state.workflow.hash]?.graph;
  if (!graph) return markCorrupt(unit, "unit.workflow_missing", `pinned workflow ${state.workflow.name} (${state.workflow.hash}) is not loaded`, ctx);
  const step = graph.steps[state.step];
  if (!step) return markCorrupt(unit, "unit.workflow_missing", `step '${state.step}' is not in workflow ${state.workflow.name}`, ctx);

  const parked = state.parked;
  const derived = parked !== undefined && DERIVED_PARKS.has(parked.reason);
  const view: UnitView = { story, unit, state: derived ? unparked(state) : state, graph, step, ctx };
  // receipts always win over session and step facts, once a report that may not keep code is checked
  const check = checkDue(unit, view.state, step, ctx);
  if (check) return check;
  if (unit.receipts.length) {
    const d = keepVisitPark(applyDecision(view, "receipts.apply", []), state);
    if (d.rejected.length === unit.receipts.length) return { ...d, rule: "receipts.reject" };
    const undelivered = undeliverableAnswers(unit, state, ctx);
    return undelivered.length > 0 ? { ...d, rule: "receipts.apply.undelivered", undelivered } : d;
  }
  if (state.ended) return noop(view, `unit.ended.${state.ended}`, state.ended_reason ?? state.ended);
  if (parked?.reason === ASKED_PARK) {
    const question = decideQuestion(view);
    if (question) return question;
  }
  if (parked && !derived) return noop(view, "unit.parked", parked.reason);

  const d = decideStep(view);
  if (!parked || d === null) return d;
  if (d.kind === "park" && d.reason === parked.reason) return noop(view, "unit.parked", parked.reason);
  // a park another rule now derives replaces it; an applied receipt commits a state already without it
  if (d.kind === "park" || d.kind === "apply_receipts") return d;
  // a derived park whose cause is gone is lifted first; the next tick decides from the lifted state
  return applyAction(unit.id, unit, "unit.unpark", [], view.state, [], ctx);
}

/**
 * The answers waiting on a session that can no longer take them: it ended and its executor cannot
 * resume a session to hand one over, or none of its events are here (a story taken from another
 * machine: its session and what a resume would start from stayed there, unless its process runs here).
 * Delivery would be refused on every tick and the unit would stay parked for good; applied
 * undelivered, the unit unparks, the session is judged dead and retried, and the retry's brief
 * carries the answers.
 */
function undeliverableAnswers(unit: UnitFacts, state: RunState, ctx: DecideContext): string[] {
  const run = state.run;
  if (!run?.session || run.attended) return [];
  const session = unit.session;
  if (session !== null && session.activity !== "ended") return [];
  // no event yet, but its process runs here: a dialog in its pane holds it, and takes the answer as keys
  if (session === null && unit.run_alive === true) return [];
  if (session !== null && ctx.facts.capabilities.executors[run.executor]?.resume === true) return [];
  return unit.receipts.filter((r) => r.data.kind === "answer.sent").map((r) => r.id);
}

function unparked(state: RunState): RunState {
  const { parked: _lifted, ...rest } = state;
  return rest;
}

/**
 * A gate's park is derived, so receipts apply from a view without it, yet its `since` is when the
 * visit started waiting, which a signal's clock (`timeout`) counts from. A receipt that leaves the unit
 * on the same visit (a mode change, a take, a branch update, a rejected receipt) keeps the park, or
 * each would restart that clock and could put a timeout off for good; only a new visit restarts it.
 */
function keepVisitPark(d: DecisionOf<"apply_receipts">, before: RunState): DecisionOf<"apply_receipts"> {
  const parked = before.parked;
  if (parked?.reason !== GATE_PARK) return d;
  const next = d.state;
  if (next.ended !== undefined || next.parked !== undefined || next.step !== before.step || next.attempt !== before.attempt) return d;
  return { ...d, state: { ...next, parked: { ...parked } } };
}

function decideStep(v: UnitView): Decision | null {
  const { step } = v;
  if (step.runner.type === "plugin") return decidePluginStep(v, step.runner.mode);
  if (step.agent) return decideAgent(v, step.agent);
  if (step.check) return decideCheck(v, step.check);
  if (step.gate) return decideGate(v, step.gate.prompt);
  // the slices step is the story rules': they start, wait on and finish slices
  return null;
}
