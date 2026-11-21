/**
 * Taking an outcome's route out of the current step: the counter on the edge bumps (or runs out and
 * ends the unit stuck, naming it), counters that reset on the edge go back to 0, and entering a step
 * starts a new attempt with no run. Pure, like everything applyReceipts calls.
 */
import type { RunState } from "../model/run-state.ts";
import type { WorkflowGraph } from "../workflow/graph.ts";

export interface Taken {
  state: RunState;
  /** the route's target; when `exhausted` is set the unit went to `$stuck` instead */
  to: string;
  counter?: { name: string; value: number; max: number };
  exhausted?: string;
  reset: string[];
}

/** The unit ended stuck where it is: no run, no park, the reason a person reads. */
export function endStuck(state: RunState, reason: string, exhausted?: string): RunState {
  const next: RunState = { ...state, run: null, ended: "stuck", ended_reason: reason };
  delete next.parked;
  if (exhausted !== undefined) next.exhausted = exhausted;
  return next;
}

/** Enter `to` as a new visit: attempt from its visits, the step's limits fresh, no run, no park, no start a person asked for. */
export function enterStep(state: RunState, to: string): RunState {
  const visits = { ...(state.visits ?? { [state.step]: state.attempt }) };
  const attempt = (visits[to] ?? 0) + 1;
  visits[to] = attempt;
  const next: RunState = { ...state, step: to, attempt, visits, retries_used: 0, run: null };
  delete next.parked;
  delete next.requested;
  delete next.supervisor;
  delete next.supervised;
  // the rework belongs to the visit it sent back to; the caller that knows the receipt sets it again
  delete next.rework_from;
  return next;
}

/**
 * Take the route of `outcome` at the current step. `stuckReason` is what a route to `$stuck` reads as
 * (an agent's own words when it reported stuck); a route the graph lacks ends the unit stuck too,
 * since the loader refuses a workflow that leaves an outcome unrouted and guessing a step is worse.
 */
export function takeRoute(state: RunState, graph: WorkflowGraph, outcome: string, stuckReason?: string): Taken {
  const from = state.step;
  const route = graph.steps[from]?.routes[outcome];
  if (!route) return { state: endStuck(state, `${from}.${outcome} has no route`), to: "$stuck", reset: [] };
  let counters = state.counters;
  let counter: Taken["counter"];
  if (route.counter !== undefined) {
    const name = route.counter;
    const max = graph.counters[name]?.max ?? 0;
    const value = counters[name] ?? 0;
    if (value + 1 > max) {
      // the edge is not taken: the unit stops where it is, so a person sees the step that looped
      const reason = `counter ${name} ran out (${value}/${max}) at ${from}.${outcome}`;
      return { state: endStuck(state, reason, name), to: route.to, exhausted: name, reset: [] };
    }
    counters = { ...counters, [name]: value + 1 };
    counter = { name, value: value + 1, max };
  }
  const edge = `${from}.${outcome}`;
  const reset = Object.entries(graph.counters)
    .filter(([name, c]) => c.reset_on.includes(edge) && (counters[name] ?? 0) > 0)
    .map(([name]) => name);
  if (reset.length > 0) counters = { ...counters, ...Object.fromEntries(reset.map((name) => [name, 0])) };
  const moved: RunState = { ...state, counters };
  const taken = (next: RunState): Taken => ({ state: next, to: route.to, ...(counter ? { counter } : {}), reset });
  if (route.to === "$done") {
    const done: RunState = { ...moved, run: null, ended: "done" };
    delete done.parked;
    return taken(done);
  }
  if (route.to === "$stuck") return taken(endStuck(moved, stuckReason ?? `${edge} routes to $stuck`));
  return taken(enterStep(moved, route.to));
}
