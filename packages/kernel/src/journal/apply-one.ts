/**
 * One receipt against the run state: either the next state (and the route it took, if any) or the
 * reason it is refused. A refusal is data the journal records as `receipt.rejected`, never a throw,
 * and never a guess at what the writer meant.
 */
import type { KernelReceipt, ReceiptData, ReceiptDataOf } from "../model/receipts.ts";
import { ASKED_PARK, type RunState } from "../model/run-state.ts";
import { type CompiledStep, OVERRIDABLE_OUTCOMES, type WorkflowGraph } from "../workflow/graph.ts";
import { endStuck, enterStep, takeRoute, type Taken } from "./route.ts";

export type OneApplied = { reject: string } | { state: RunState; taken?: { outcome: string } & Taken };

const OVERRIDABLE: readonly string[] = OVERRIDABLE_OUTCOMES;

/** Kinds bound to the step and attempt they were written for; the rest apply wherever the unit is. */
const UNBOUND: ReadonlySet<ReceiptData["kind"]> = new Set(["mode.changed", "round.started", "unit.marked", "receipt.rejected"]);

export function applyOne(state: RunState, r: KernelReceipt, graph: WorkflowGraph): OneApplied {
  const d = r.data;
  // records of who holds the story and of a person's update of its branch, applied wherever the unit stands, ended or corrupt
  if (d.kind === "receipt.rejected" || d.kind === "claim.taken" || d.kind === "branch.update" || d.kind === "branch.updated") return { state };
  // a check that let its report stand records what it did; the report it follows has moved the unit on
  if (d.kind === "run.checking" || (d.kind === "run.checked" && (d.verdict === "clean" || d.verdict === "reset"))) return { state };
  if (d.kind === "round.started") return roundStarted(state, d, graph);
  if (state.ended === "corrupt") return { reject: "the unit is corrupt" };
  if (d.kind === "step.moved") return stepMoved(state, d, graph);
  if (d.kind === "mode.changed") return { state: { ...state, mode: d.mode } };
  if (d.kind === "unit.marked") return { state: marked(state, d) };
  if (state.ended !== undefined) return { reject: `the unit ended ${state.ended}` };
  if (!UNBOUND.has(d.kind)) {
    if (d.step !== undefined && d.step !== state.step) return { reject: `stale: written for step ${d.step}, the unit is at ${state.step}` };
    if (d.attempt !== undefined && d.attempt !== state.attempt)
      return { reject: `stale: written for ${state.step} attempt ${d.attempt}, the unit is at attempt ${state.attempt}` };
  }
  const step = graph.steps[state.step];
  if (!step) return { reject: `step ${state.step} is not in workflow ${graph.name}` };
  switch (d.kind) {
    case "run.started":
      return runStarted(state, d, step, r.at);
    case "run.reported":
      return runBound(state, d.run_id) ?? reported(state, d, step, graph, r.at);
    case "run.ended":
      // the run stays on the record: a run cleared here would read as a step nobody started, which
      // decide would start again uncounted; only an outcome or a counted retry replaces it
      return runBound(state, d.run_id) ?? { state };
    case "run.classified":
      return runBound(state, d.run_id) ?? classified(state, d, step, graph, r.at);
    case "check.finished":
      if (step.kind !== "check") return { reject: `${state.step} is a ${step.kind} step, not a check` };
      return runBound(state, d.run_id) ?? declared(state, step, graph, d.outcome);
    case "step.finished":
      return stepFinished(state, d, step, graph);
    case "gate.decided":
      if (step.kind !== "gate") return { reject: `${state.step} is a ${step.kind} step, not a gate` };
      if (d.run_id !== undefined) return { reject: `a step agent may not ${d.outcome} a gate (run ${d.run_id}); a person or their delegate decides it` };
      return route(state, graph, d.outcome);
    case "answer.sent":
      return { state: unparked(state) };
    case "unit.parked":
      return { state: { ...state, parked: { reason: d.reason, since: r.at } } };
    case "nudge.sent":
      return runBound(state, d.run_id) ?? nudged(state, r.at);
    case "run.resumed":
      if (step.kind === "agent") return { reject: "an agent run is retried in a fresh session, never resumed" };
      // counted even past the bound, for the reason a retry is: the run was started again before this applies
      return runBound(state, d.run_id) ?? onRun(state, (run) => ({ ...run, resumes: (run.resumes ?? 0) + 1 }));
    case "stop.sent":
      return runBound(state, d.run_id) ?? onRun(state, (run) => ({ ...run, stopped_at: r.at }));
    case "run.snapshot":
      return runBound(state, d.run_id) ?? snapshotted(state, d, r.at);
    case "run.checked":
      return runBound(state, d.run_id) ?? checkedRun(state, d, r.at);
    case "run.limited":
      return runBound(state, d.run_id) ?? onRun(state, (run) => ({ ...run, limited_until: d.resets_at }));
    case "run.requested":
      if (step.kind !== "agent") return { reject: `${state.step} is a ${step.kind} step; only an agent step is started by a person` };
      if (state.run !== null) return { reject: `${state.step} attempt ${state.attempt} already has run ${state.run.id}` };
      return { state: { ...unparked(state), requested: { by: d.by, at: r.at } } };
  }
}

/** A refusal unless `runId` is the run on the record: a late word from a replaced run moves nothing. */
function runBound(state: RunState, runId: string): OneApplied | null {
  if (state.run?.id === runId) return null;
  return { reject: `stale run ${runId}; the current run is ${state.run?.id ?? "none"}` };
}

function route(state: RunState, graph: WorkflowGraph, outcome: string, stuckReason?: string): OneApplied {
  const taken = takeRoute(state, graph, outcome, stuckReason);
  return { state: taken.state, taken: { outcome, ...taken } };
}

/** Route an outcome the step declares; one it does not declare is refused. */
function declared(state: RunState, step: CompiledStep, graph: WorkflowGraph, outcome: string): OneApplied {
  if (!step.outcomes.includes(outcome)) return { reject: `outcome ${outcome} is not declared at ${step.name}` };
  return route(state, graph, outcome);
}

function unparked(state: RunState): RunState {
  const next = { ...state };
  delete next.parked;
  return next;
}

const RUN_KIND_OF_STEP = (step: CompiledStep): "agent" | "check" | "step" | null =>
  step.kind === "agent" ? "agent" : step.kind === "check" ? "check" : step.runner.type === "plugin" ? "step" : null;

function runStarted(state: RunState, d: ReceiptDataOf<"run.started">, step: CompiledStep, at: string): OneApplied {
  const want = RUN_KIND_OF_STEP(step);
  if (want === null) return { reject: `a ${step.kind} step has no run` };
  if (d.run_kind !== want) return { reject: `${step.name} is a ${step.kind} step; a ${d.run_kind} run cannot start there` };
  if (want === "step" && d.executor !== step.kind) return { reject: `${step.name} runs step kind ${step.kind}, not ${d.executor}` };
  if (state.run?.id === d.run_id) {
    // the same run again: the host learned its session after recording the launch
    return { state: { ...state, run: { ...state.run, ...(d.session !== undefined ? { session: d.session } : {}) } } };
  }
  if (d.retry_of !== undefined && want !== "agent") return { reject: `only an agent run is retried in a fresh session, not a ${want} run` };
  if (d.retry_of !== undefined && d.retry_of !== state.run?.id) return { reject: `retry of ${d.retry_of}, but the current run is ${state.run?.id ?? "none"}` };
  if (d.retry_of === undefined && state.run !== null) return { reject: `${step.name} attempt ${state.attempt} already has run ${state.run.id}` };
  const run: NonNullable<RunState["run"]> = {
    id: d.run_id,
    step: state.step,
    attempt: state.attempt,
    started_at: at,
    executor: d.executor,
    attended: d.attended,
    nudges: 0,
  };
  if (d.session !== undefined) run.session = d.session;
  if (d.code !== undefined) run.code = d.code;
  // a retry is counted even past the step's bound: refusing it would leave a launch that already
  // happened uncounted, and decide reads the count to stop retrying
  const retries_used = state.retries_used + (d.retry_of !== undefined ? 1 : 0);
  return { state: { ...unparked(state), run, retries_used } };
}

/** The park of a unit whose run's snapshot could not be taken: nothing would check what its agent changed. */
export const SNAPSHOT_FAILED_PARK = "run.snapshot.failed";

function snapshotted(state: RunState, d: ReceiptDataOf<"run.snapshot">, at: string): OneApplied {
  if (d.failed === undefined) return d.snapshot === undefined ? { reject: "a snapshot names what it noted, or why it failed" } : { state };
  return { state: { ...state, parked: { reason: SNAPSHOT_FAILED_PARK, since: at, text: `the snapshot run ${d.run_id} is checked against could not be taken: ${d.failed}` } } };
}

/** A check that refused a run's report, or could not be done, parks the unit; its report is refused before it (`vetoedReports`). */
function checkedRun(state: RunState, d: ReceiptDataOf<"run.checked">, at: string): OneApplied {
  if (d.verdict === "clean" || d.verdict === "reset") return { state };
  const text = `the check after run ${d.run_id} reported ${d.verdict === "refused" ? "refused it" : "could not be done"}${d.detail ? `: ${d.detail}` : ""}`;
  return { state: { ...state, parked: { reason: `run.check.${d.verdict}`, since: at, text } } };
}

function onRun(state: RunState, change: (run: NonNullable<RunState["run"]>) => NonNullable<RunState["run"]>): OneApplied {
  return state.run ? { state: { ...state, run: change(state.run) } } : { reject: "no run on the record" };
}

function nudged(state: RunState, at: string): OneApplied {
  const run = state.run;
  if (!run) return { reject: "no run to nudge" };
  // counted even past the bound, for the reason a retry is: the nudge was typed before this applies
  return { state: { ...state, run: { ...run, nudges: run.nudges + 1, last_nudge_at: at } } };
}

function reported(state: RunState, d: ReceiptDataOf<"run.reported">, step: CompiledStep, graph: WorkflowGraph, at: string): OneApplied {
  if (step.kind !== "agent") return { reject: `${step.name} is a ${step.kind} step; only an agent step takes a report` };
  const text = d.text?.trim() ? d.text.trim() : undefined;
  if (d.verb === "done") {
    if (d.outcome === undefined) return { reject: "done without an outcome" };
    if (OVERRIDABLE.includes(d.outcome)) return { reject: `outcome ${d.outcome} is classified by norn, never reported` };
    return declared(state, step, graph, d.outcome);
  }
  if (d.verb === "ask") {
    if (step.routes.ask) return route(state, graph, "ask");
    return { state: { ...state, parked: { reason: ASKED_PARK, since: at, ...(text !== undefined && { text }) } } };
  }
  if (step.routes.stuck) return route(state, graph, "stuck", text);
  return { state: endStuck(state, text ?? `${step.name}: the agent reported stuck`) };
}

/**
 * An outcome read off the session. A route the step writes wins; otherwise the built-in handling has
 * run out by the time decide classifies one (nudges for a quiet session, fresh-session retries for one
 * that died or hit its deadline), so the unit ends stuck naming the limit, or parks on an ask.
 */
function classified(state: RunState, d: ReceiptDataOf<"run.classified">, step: CompiledStep, graph: WorkflowGraph, at: string): OneApplied {
  const o = d.outcome;
  if (step.routes[o]) return route(state, graph, o);
  if (step.kind !== "agent") return { reject: `outcome ${o} cannot be classified at a ${step.kind} step that does not route it` };
  const spec = step.agent;
  // the error first: it says why the agent stopped, which the limit used up does not
  const why = d.error ? `${o}: ${d.error}; ` : `${o}: `;
  switch (o) {
    case "silent":
    case "stalled":
      return { state: endStuck(state, `${why}nudges ${state.run?.nudges ?? 0}/${spec?.nudges ?? 0} used at ${step.name}`) };
    case "died":
    case "timeout":
      return { state: endStuck(state, `${why}retries ${state.retries_used}/${spec?.retries ?? 0} used at ${step.name}`) };
    case "ask":
      return { state: { ...state, parked: { reason: ASKED_PARK, since: at } } };
    case "stuck":
      return { state: endStuck(state, `${step.name}: the agent is stuck`) };
  }
}

function stepFinished(state: RunState, d: ReceiptDataOf<"step.finished">, step: CompiledStep, graph: WorkflowGraph): OneApplied {
  if (d.step_kind !== step.kind) return { reject: `${state.step} is a ${step.kind} step, not ${d.step_kind}` };
  if (step.kind === "agent" || step.kind === "check") return { reject: `a ${step.kind} step ends through its own receipts, not step.finished` };
  if (step.kind === "gate" && (d.outcome === "approve" || d.outcome === "reject"))
    return { reject: `a gate's ${d.outcome} comes only through gate.decided` };
  if (d.run_id !== undefined) {
    const bound = runBound(state, d.run_id);
    if (bound) return bound;
  }
  // a wait step polled and still waiting, or slices still running: recorded, nothing moves
  if (d.outcome === "waiting") return step.kind === "slices" || step.runner.type === "plugin" ? { state } : { reject: `a ${step.kind} step does not wait` };
  // a routed signal's outcome routes alike with or without its occurrence on the receipt; only one that carries it counts as fired
  if (step.signals?.some((s) => s.name === d.outcome)) {
    if (d.signal !== undefined && d.signal.type !== d.outcome) return { reject: `signal ${d.signal.type} recorded as outcome ${d.outcome}` };
    const routed = route(state, graph, d.outcome);
    if (d.signal === undefined || "reject" in routed) return routed;
    const fired = [...(state.signals_fired ?? []), { type: d.signal.type, id: d.signal.id }];
    return { ...routed, state: { ...routed.state, signals_fired: fired } };
  }
  if (d.signal !== undefined) return { reject: `${state.step} routes no signal ${d.signal.type}` };
  return declared(state, step, graph, d.outcome);
}

function marked(state: RunState, d: ReceiptDataOf<"unit.marked">): RunState {
  const next: RunState = { ...state, run: null, ended: d.ended };
  delete next.parked;
  delete next.exhausted;
  if (d.reason !== undefined) next.ended_reason = d.reason;
  else if (d.ended === "done") delete next.ended_reason;
  else next.ended_reason = `marked ${d.ended}`;
  return next;
}

/**
 * A new round: the workflow the receipt pins, entered at its `at` step (its start step when absent)
 * with every counter at 0. An `at` the workflow has no step of is refused, never moved to the start.
 */
function roundStarted(state: RunState, d: ReceiptDataOf<"round.started">, graph: WorkflowGraph): OneApplied {
  const step = d.at ?? graph.start;
  if (!graph.steps[step]) return { reject: `workflow ${graph.name} has no step ${step}` };
  const next: RunState = {
    format: state.format,
    unit: state.unit,
    story: state.story,
    workflow: structuredClone(d.workflow),
    step,
    attempt: 1,
    counters: Object.fromEntries(Object.keys(graph.counters).map((name) => [name, 0])),
    retries_used: 0,
    run: null,
    applied_through: state.applied_through,
  };
  if (state.mode !== undefined) next.mode = state.mode;
  return { state: next };
}

/**
 * A person's move: the unit enters step `to` as a new visit, with no run, no park and the named
 * counters at 0, and a unit that ended stuck is taken up again. One that ended done is refused: what
 * it finished is on the record, and new work there is a new round. A step or counter the pinned
 * workflow lacks is refused, never guessed at, and so is a move written for another visit, since the
 * person chose it from where the unit stood.
 */
function stepMoved(state: RunState, d: ReceiptDataOf<"step.moved">, graph: WorkflowGraph): OneApplied {
  if (state.ended === "done") return { reject: "the unit ended done; a new round takes it further" };
  if ((d.step !== undefined && d.step !== state.step) || (d.attempt !== undefined && d.attempt !== state.attempt))
    return { reject: `stale: written for ${d.step ?? state.step}#${d.attempt ?? state.attempt}, the unit is at ${state.step}#${state.attempt}` };
  if (!graph.steps[d.to]) return { reject: `workflow ${graph.name} has no step ${d.to}` };
  const reset = d.reset ?? [];
  const unknown = reset.filter((name) => !graph.counters[name]);
  if (unknown.length) return { reject: `workflow ${graph.name} has no counter ${unknown.join(", ")}` };
  const counters = { ...state.counters, ...Object.fromEntries(reset.map((name) => [name, 0])) };
  const next = enterStep({ ...state, counters }, d.to);
  delete next.ended;
  delete next.ended_reason;
  delete next.exhausted;
  return { state: next };
}
