import { describe, expect, test } from "bun:test";
import {
  type AgentStepSpec,
  ASKED_PARK,
  applyReceipts,
  type CompiledStep,
  type KernelReceipt,
  type LoadedWorkflow,
  newRunState,
  type ReceiptData,
  readRunState,
  RUN_STATE_FORMAT,
  type RunState,
  validateRunState,
  type WorkflowGraph,
} from "../../src/index.ts";
import { iso } from "./support.ts";

const HASH = "a".repeat(64);
const OTHER_HASH = "b".repeat(64);

const spec = (over: Partial<AgentStepSpec> = {}): AgentStepSpec => ({
  instructions: "Do it.",
  skills: [],
  inputs: [],
  executor: null,
  attended: "none",
  criteria: false,
  hand_back: {},
  writes: "worktree",
  means: {},
  verdict: {},
  deadline_ms: null,
  nudges: 2,
  retries: 1,
  ...over,
});

const agent = (name: string, routes: CompiledStep["routes"], outcomes = Object.keys(routes)): CompiledStep => ({
  name,
  kind: "agent",
  runner: { type: "builtin" },
  outcomes,
  routes,
  agent: spec(),
});

function graphOf(hash = HASH): WorkflowGraph {
  return {
    name: "story",
    hash,
    start: "implement",
    stalled_ms: null,
    steps: {
      implement: agent("implement", { done: { to: "test" }, blocked: { to: "$stuck" }, died: { to: "review" } }, ["done", "blocked"]),
      test: {
        name: "test",
        kind: "check",
        runner: { type: "builtin" },
        outcomes: ["pass", "fail"],
        routes: { pass: { to: "review" }, fail: { to: "implement", counter: "test.fail" } },
        check: { command: "bun test", timeout_ms: 60_000, exits: {} },
      },
      review: agent("review", { approve: { to: "ready" }, changes: { to: "implement", counter: "review.changes" } }),
      ready: {
        name: "ready",
        kind: "gate",
        runner: { type: "builtin" },
        outcomes: ["approve", "reject"],
        signals: [{ name: "stale" }],
        routes: { approve: { to: "slices" }, reject: { to: "implement", counter: "ready.reject" }, stale: { to: "test", counter: "ready.stale" } },
        gate: { prompt: "Approve?" },
      },
      slices: { name: "slices", kind: "slices", runner: { type: "builtin" }, outcomes: ["done", "stuck"], routes: { done: { to: "merge" }, stuck: { to: "$stuck" } } },
      merge: {
        name: "merge",
        kind: "await-merge",
        runner: { type: "plugin", mode: "wait" },
        outcomes: ["merged"],
        signals: [{ name: "stale" }],
        routes: { merged: { to: "$done" }, stale: { to: "implement", counter: "merge.stale" } },
        config: {},
      },
    },
    counters: {
      "test.fail": { max: 2, reset_on: ["review.approve"] },
      "review.changes": { max: 3, reset_on: [] },
      "ready.reject": { max: 2, reset_on: [] },
      "ready.stale": { max: 10, reset_on: [] },
      "merge.stale": { max: 10, reset_on: [] },
    },
  };
}

const GRAPH = graphOf();
const workflowOf = (graph: WorkflowGraph): LoadedWorkflow => ({
  pinned: { name: graph.name, hash: graph.hash, doc: { name: graph.name, start: graph.start, steps: { implement: { agent: "Do it." } } } },
  graph,
});
const WORKFLOW = workflowOf(GRAPH);

/** A journal of receipts numbered from `from`, each a second apart. */
function journal(from: number, ...data: ReceiptData[]): KernelReceipt[] {
  return data.map((d, i) => ({ seq: from + i, id: `r${from + i}`, at: iso(from + i), data: d }));
}

function fresh(): RunState {
  return newRunState({ unit: "gh-1", story: "gh-1", workflow: WORKFLOW });
}

/** Apply and check the state still validates: applyReceipts never hands back a state the journal would refuse. */
function apply(state: RunState, receipts: KernelReceipt[], graph = GRAPH) {
  const res = applyReceipts(state, receipts, graph);
  const checked = validateRunState(res.state);
  expect(checked.ok ? [] : checked.errors).toEqual([]);
  return res;
}

const started = (run_id: string, extra: Partial<ReceiptData & { kind: "run.started" }> = {}): ReceiptData => ({
  kind: "run.started",
  run_id,
  run_kind: "agent",
  executor: "claude",
  attended: false,
  ...extra,
});
const reported = (run_id: string, outcome: string): ReceiptData => ({ kind: "run.reported", run_id, verb: "done", outcome });
const checkRun = (run_id: string): ReceiptData => ({ kind: "run.started", run_id, run_kind: "check", executor: "check", attended: false });
const checked = (run_id: string, outcome: "pass" | "fail"): ReceiptData => ({ kind: "check.finished", run_id, exit: outcome === "pass" ? 0 : 1, outcome });

/** The unit walked to the check step: implement started and done, the check started. */
function atTest(): RunState {
  return apply(fresh(), journal(1, started("a1"), reported("a1", "done"), checkRun("c1"))).state;
}

describe("applyReceipts: routing", () => {
  test("a reported outcome routes to the next step as a new attempt with no run", () => {
    const res = apply(fresh(), journal(1, started("a1", { session: "s-1" }), reported("a1", "done")));
    expect(res.state).toMatchObject({ step: "test", attempt: 1, run: null, retries_used: 0, applied_through: 2 });
    expect(res.applied).toEqual([1, 2]);
    expect(res.rejected).toEqual([]);
    expect(res.routes).toEqual([{ seq: 2, from: "implement", outcome: "done", to: "test", reset: [] }]);
  });

  test("a run started records who runs it and when, and the session once the host learns it", () => {
    const one = apply(fresh(), journal(1, started("a1")));
    expect(one.state.run).toEqual({ id: "a1", step: "implement", attempt: 1, started_at: iso(1), executor: "claude", attended: false, nudges: 0 });
    const two = apply(one.state, journal(2, started("a1", { session: "s-9" })));
    expect(two.state.run?.session).toBe("s-9");
    expect(two.state.run?.started_at).toBe(iso(1));
  });

  test("a step entered again is its next attempt; the attempt counts visits to that step", () => {
    const res = apply(atTest(), journal(4, checked("c1", "fail"), started("a2"), reported("a2", "done")));
    expect(res.state).toMatchObject({ step: "test", attempt: 2, visits: { implement: 2, test: 2 }, counters: { "test.fail": 1 } });
  });

  test("an outcome routed to $done ends the unit done at the step it left", () => {
    const at = { ...fresh(), step: "merge", run: null };
    const res = apply(at, journal(1, { kind: "run.started", run_id: "m1", run_kind: "step", executor: "await-merge", attended: false }, { kind: "step.finished", run_id: "m1", step_kind: "await-merge", outcome: "merged" }));
    expect(res.state).toMatchObject({ step: "merge", ended: "done", run: null });
    expect(res.routes.at(-1)?.to).toBe("$done");
  });

  test("an agent's stuck with no stuck route ends the unit stuck in the agent's words", () => {
    const res = apply(fresh(), journal(1, started("a1"), { kind: "run.reported", run_id: "a1", verb: "stuck", text: "the API key is missing" }));
    expect(res.state).toMatchObject({ ended: "stuck", ended_reason: "the API key is missing", run: null });
  });
});

describe("applyReceipts: counters", () => {
  test("a counted route bumps its counter and reports it", () => {
    const res = apply(atTest(), journal(4, checked("c1", "fail")));
    expect(res.state.counters["test.fail"]).toBe(1);
    expect(res.routes[0]).toEqual({ seq: 4, from: "test", outcome: "fail", to: "implement", counter: { name: "test.fail", value: 1, max: 2 }, reset: [] });
  });

  test("running a counter out routes to $stuck naming it, and leaves the unit at the step that looped", () => {
    let state = atTest();
    let seq = 4;
    for (let i = 2; i <= 3; i++) {
      state = apply(state, journal(seq, checked(`c${i - 1}`, "fail"), started(`a${i}`), reported(`a${i}`, "done"), checkRun(`c${i}`))).state;
      seq += 4;
    }
    expect(state.counters["test.fail"]).toBe(2);
    const res = apply(state, journal(seq, checked("c3", "fail")));
    expect(res.state).toMatchObject({ step: "test", ended: "stuck", exhausted: "test.fail", counters: { "test.fail": 2 } });
    expect(res.state.ended_reason).toContain("test.fail");
    expect(res.routes.at(-1)).toMatchObject({ outcome: "fail", to: "implement", exhausted: "test.fail" });
  });

  test("an edge a counter resets on puts it back to 0 and says so", () => {
    const state = apply(atTest(), journal(4, checked("c1", "fail"), started("a2"), reported("a2", "done"), checkRun("c2"), checked("c2", "pass"), started("v1"))).state;
    expect(state).toMatchObject({ step: "review", counters: { "test.fail": 1 } });
    const res = apply(state, journal(10, reported("v1", "approve")));
    expect(res.state).toMatchObject({ step: "ready", counters: { "test.fail": 0 } });
    expect(res.routes[0]?.reset).toEqual(["test.fail"]);
  });

  test("a gate's reject is counted, and runs out after its bound", () => {
    let state: RunState = { ...fresh(), step: "ready" };
    const decide = (outcome: "approve" | "reject"): ReceiptData => ({ kind: "gate.decided", outcome, by: "a-person", step: "ready", attempt: state.attempt });
    for (let seq = 1; seq <= 2; seq++) {
      state = apply(state, journal(seq, decide("reject"))).state;
      expect(state).toMatchObject({ step: "implement", counters: { "ready.reject": seq } });
      state = { ...state, step: "ready", attempt: seq + 1 };
    }
    const res = apply(state, journal(3, decide("reject")));
    expect(res.state).toMatchObject({ ended: "stuck", exhausted: "ready.reject" });
  });
});

describe("applyReceipts: rework", () => {
  /** The graph with its send-back edges uncounted, so only the outcome's kind says it sends the work back. */
  function uncounted(): WorkflowGraph {
    const g = graphOf();
    const review = g.steps.review as CompiledStep;
    g.steps.review = { ...review, routes: { ...review.routes, changes: { to: "implement" } }, agent: spec({ hand_back: { changes: "findings" } }) };
    const ready = g.steps.ready as CompiledStep;
    g.steps.ready = { ...ready, routes: { ...ready.routes, reject: { to: "implement" } } };
    return g;
  }

  test("an outcome that sends the work back names its receipt as the rework of the step it enters", () => {
    const failed = apply(atTest(), journal(4, checked("c1", "fail")));
    expect(failed.state).toMatchObject({ step: "implement", rework_from: 4 });
    const g = uncounted();
    const atReview: RunState = { ...fresh(), step: "review" };
    const handedBack = apply(atReview, journal(1, started("v1"), { kind: "run.reported", run_id: "v1", verb: "done", outcome: "changes", text: "rename it" }), g);
    expect(handedBack.state).toMatchObject({ step: "implement", rework_from: 2 });
    const atReady: RunState = { ...fresh(), step: "ready" };
    const rejected = apply(atReady, journal(1, { kind: "gate.decided", outcome: "reject", by: "a-person", reason: "make it blue", step: "ready", attempt: 1 }), g);
    expect(rejected.state).toMatchObject({ step: "implement", rework_from: 1 });
  });

  test("a forward route, a counted edge into a step no agent runs, and a person's move name no rework", () => {
    const atReady: RunState = { ...fresh(), step: "ready" };
    const stale = apply(atReady, journal(1, { kind: "step.finished", step_kind: "gate", outcome: "stale", step: "ready", attempt: 1 }));
    expect(stale.state.step).toBe("test");
    expect(stale.state.rework_from).toBeUndefined();
    const failed = apply(atTest(), journal(4, checked("c1", "fail"))).state;
    const forward = apply(failed, journal(5, started("a2"), reported("a2", "done")));
    expect(forward.state.step).toBe("test");
    expect(forward.state.rework_from).toBeUndefined();
    const moved = apply(failed, journal(5, { kind: "step.moved", to: "review", by: "a-person", step: "implement", attempt: 2 }));
    expect(moved.state.step).toBe("review");
    expect(moved.state.rework_from).toBeUndefined();
  });
});

describe("applyReceipts: parks", () => {
  test("a unit.parked receipt parks the unit from its time; one written for another step is refused, and an answer lifts it", () => {
    const parked = apply(fresh(), journal(1, { kind: "unit.parked", reason: "gate.park", step: "implement", attempt: 1 }));
    expect(parked.state.parked).toEqual({ reason: "gate.park", since: iso(1) });
    expect(apply(fresh(), journal(1, { kind: "unit.parked", reason: "gate.park", step: "test", attempt: 1 })).rejected[0]?.reason).toBe("stale: written for step test, the unit is at implement");
    expect(apply(parked.state, journal(2, { kind: "answer.sent", input_id: "q1", text: "yes", by: "ann" })).state.parked).toBeUndefined();
  });
});

describe("applyReceipts: refusals", () => {
  test("an outcome the step does not declare is refused, and applied_through moves past it", () => {
    const state = apply(fresh(), journal(1, started("a1"))).state;
    const res = apply(state, journal(2, reported("a1", "shipped")));
    expect(res.rejected).toEqual([{ seq: 2, reason: "outcome shipped is not declared at implement" }]);
    expect(res.state).toEqual({ ...state, applied_through: 2 });
    expect(res.applied).toEqual([2]);
  });

  test("a step route for a classified outcome does not make it reportable", () => {
    const state = apply(fresh(), journal(1, started("a1"))).state;
    const res = apply(state, journal(2, reported("a1", "died")));
    expect(res.rejected[0]?.reason).toContain("classified by norn");
    expect(res.state.step).toBe("implement");
  });

  test("a gate decision written by a step agent is refused, whether it comes as gate.decided or as a step outcome", () => {
    const state: RunState = { ...fresh(), step: "ready" };
    const res = apply(state, journal(1, { kind: "gate.decided", outcome: "approve", by: "claude", run_id: "a1" }, { kind: "step.finished", step_kind: "gate", outcome: "approve" }));
    expect(res.rejected.map((r) => r.seq)).toEqual([1, 2]);
    expect(res.rejected[0]?.reason).toContain("step agent may not approve");
    expect(res.rejected[1]?.reason).toContain("only through gate.decided");
    expect(res.state).toMatchObject({ step: "ready", applied_through: 2 });
  });

  test("a delegated decision is a person's and routes", () => {
    const res = apply({ ...fresh(), step: "ready" }, journal(1, { kind: "gate.decided", outcome: "approve", by: "supervisor", delegated: true }));
    expect(res.state.step).toBe("slices");
  });

  test("a report from a replaced run, or one written for another step or attempt, moves nothing", () => {
    const state = apply(fresh(), journal(1, started("a1"), { kind: "run.ended", run_id: "a1", reason: "crash" }, started("a2", { retry_of: "a1" }))).state;
    const res = apply(state, journal(4, reported("a1", "done"), { ...reported("a2", "done"), step: "test" }, { ...reported("a2", "done"), attempt: 2 }));
    expect(res.rejected.map((r) => r.seq)).toEqual([4, 5, 6]);
    expect(res.rejected[0]?.reason).toBe("stale run a1; the current run is a2");
    expect(res.state).toMatchObject({ step: "implement", run: { id: "a2" }, applied_through: 6 });
  });

  test("receipts for a unit that ended are refused; a receipt.rejected record is applied as the record it is", () => {
    const ended = apply(fresh(), journal(1, { kind: "unit.marked", ended: "stuck", reason: "the item closed" })).state;
    expect(ended).toMatchObject({ ended: "stuck", ended_reason: "the item closed" });
    const res = apply(ended, journal(2, started("a1"), { kind: "receipt.rejected", seq: 2, reason: "the unit ended stuck" }));
    expect(res.rejected).toEqual([{ seq: 2, reason: "the unit ended stuck" }]);
    expect(res.applied).toEqual([2, 3]);
  });

  test("a claim takeover is applied as the record it is, wherever the unit stands, ended or corrupt", () => {
    const taken: ReceiptData = { kind: "claim.taken", from: "machine-a", to: "machine-b", version: 3, by: "machine-b" };
    const going = apply(fresh(), journal(1, started("a1"))).state;
    const res = apply(going, journal(2, taken));
    expect(res).toMatchObject({ rejected: [], applied: [2] });
    expect(res.state).toEqual({ ...going, applied_through: 2 });
    for (const ended of ["stuck", "done", "corrupt"] as const) {
      const state = apply(fresh(), journal(1, { kind: "unit.marked", ended })).state;
      expect(apply(state, journal(2, taken))).toMatchObject({ rejected: [], applied: [2], state: { ended, applied_through: 2 } });
    }
  });

  test("a person's branch update, its intent and its outcome, is applied as the record it is, wherever the unit stands, ended or corrupt", () => {
    const intent: ReceiptData = { kind: "branch.update", base: "origin/main", base_sha: "b1", from: "h1", merge: true, by: "ann" };
    const updated: ReceiptData = { kind: "branch.updated", base: "origin/main", base_sha: "b1", merged: true, from: "h1", head: "h2", pushed: true, by: "ann" };
    const going = apply(fresh(), journal(1, started("a1"))).state;
    expect(apply(going, journal(2, intent, updated))).toMatchObject({ rejected: [], applied: [2, 3], state: { ...going, applied_through: 3 } });
    for (const ended of ["stuck", "done", "corrupt"] as const) {
      const state = apply(fresh(), journal(1, { kind: "unit.marked", ended })).state;
      expect(apply(state, journal(2, intent, updated))).toMatchObject({ rejected: [], applied: [2, 3], state: { ended, applied_through: 3 } });
    }
  });

  test("a second run on the same attempt is refused; only a counted retry replaces a run", () => {
    const state = apply(fresh(), journal(1, started("a1"))).state;
    const res = apply(state, journal(2, started("a2"), started("a3", { retry_of: "a1" })));
    expect(res.rejected.map((r) => r.seq)).toEqual([2]);
    expect(res.state).toMatchObject({ run: { id: "a3", nudges: 0 }, retries_used: 1 });
  });

  test("a check's outcome at an agent step is refused", () => {
    const state = apply(fresh(), journal(1, started("a1"))).state;
    expect(apply(state, journal(2, checked("a1", "pass"))).rejected[0]?.reason).toBe("implement is a agent step, not a check");
  });
});

describe("applyReceipts: runs, nudges and classified outcomes", () => {
  test("a nudge is counted on the run, with when it was sent", () => {
    const res = apply(fresh(), journal(1, started("a1"), { kind: "nudge.sent", run_id: "a1", reason: "silent" }));
    expect(res.state.run).toMatchObject({ nudges: 1, last_nudge_at: iso(2) });
  });

  test("a check run again under its run is counted on it; an agent run is never resumed", () => {
    const state = atTest();
    const run = state.run?.id as string;
    const seq = state.applied_through + 1;
    const res = apply(state, journal(seq, { kind: "run.resumed", run_id: run, reason: "spawn failed" }, { kind: "run.resumed", run_id: run }));
    expect(res.rejected).toEqual([]);
    expect(res.state.run).toMatchObject({ id: run, resumes: 2 });
    const agentRun = apply(fresh(), journal(1, started("a1"), { kind: "run.resumed", run_id: "a1" }));
    expect(agentRun.rejected[0]?.reason).toBe("an agent run is retried in a fresh session, never resumed");
  });

  test("a stop order and a usage limit's reset are kept on the run, for the current run only", () => {
    const res = apply(fresh(), journal(1, started("a1"), { kind: "stop.sent", run_id: "a1", reason: "timeout" }, { kind: "run.limited", run_id: "a1", resets_at: iso(30) }));
    expect(res.state.run).toMatchObject({ stopped_at: iso(2), limited_until: iso(30) });
    const stale = apply(res.state, journal(4, { kind: "stop.sent", run_id: "old", reason: "timeout" }));
    expect(stale.rejected[0]?.reason).toBe("stale run old; the current run is a1");
  });

  test("a classified outcome the step routes takes the route", () => {
    const res = apply(fresh(), journal(1, started("a1"), { kind: "run.classified", run_id: "a1", outcome: "died", rule: "agent.died.exhausted" }));
    expect(res.state.step).toBe("review");
  });

  test("a classified outcome the step does not route ends the unit stuck, naming the limit that ran out", () => {
    const state = apply(fresh(), journal(1, started("a1"), { kind: "nudge.sent", run_id: "a1", reason: "silent" }, { kind: "nudge.sent", run_id: "a1", reason: "silent" })).state;
    const res = apply(state, journal(4, { kind: "run.classified", run_id: "a1", outcome: "silent", rule: "agent.silent.exhausted" }));
    expect(res.state).toMatchObject({ ended: "stuck", ended_reason: "silent: nudges 2/2 used at implement", run: null });
  });

  test("a classified outcome carrying the session's error keeps it in the stuck reason, before the limit", () => {
    const res = apply(fresh(), journal(1, started("a1"), { kind: "run.classified", run_id: "a1", outcome: "silent", rule: "agent.silent.exhausted", error: "pi stopped on an error: Codex error: model not supported" }));
    expect(res.state).toMatchObject({ ended: "stuck", ended_reason: "silent: pi stopped on an error: Codex error: model not supported; nudges 0/2 used at implement", run: null });
  });

  test("an ask with no ask route parks the unit under a reason code, the question beside it; an answer lifts the park and keeps the run", () => {
    const parked = apply(fresh(), journal(1, started("a1"), { kind: "run.reported", run_id: "a1", verb: "ask", text: "which base?" })).state;
    expect(parked.parked).toEqual({ reason: ASKED_PARK, since: iso(2), text: "which base?" });
    const res = apply(parked, journal(3, { kind: "answer.sent", input_id: "q1", text: "main", by: "a-person" }));
    expect(res.state.parked).toBeUndefined();
    expect(res.state.run?.id).toBe("a1");
  });
});

test("an ask classified off the session parks under the same reason code, with no question of its own", () => {
  const res = apply(fresh(), journal(1, started("a1"), { kind: "run.classified", run_id: "a1", outcome: "ask", rule: "agent.ask" }));
  expect(res.state.parked).toEqual({ reason: ASKED_PARK, since: iso(2) });
});

describe("applyReceipts: waiting steps", () => {
  test("a wait step polled and still waiting moves nothing; its real outcome routes", () => {
    const at: RunState = { ...fresh(), step: "merge" };
    const poll = (outcome: string): ReceiptData => ({ kind: "step.finished", run_id: "m1", step_kind: "await-merge", outcome });
    const waiting = apply(at, journal(1, { kind: "run.started", run_id: "m1", run_kind: "step", executor: "await-merge", attended: false }, poll("waiting"), poll("waiting")));
    expect(waiting.state).toMatchObject({ step: "merge", run: { id: "m1" }, applied_through: 3 });
    expect(waiting.routes).toEqual([]);
    expect(apply(waiting.state, journal(4, poll("stale"))).state).toMatchObject({ step: "implement", counters: { "merge.stale": 1 } });
  });

  test("a signal's firing routes like an outcome and records its occurrence for the round; a receipt without its occurrence routes alike", () => {
    const at: RunState = { ...fresh(), step: "ready" };
    const fired = (id: string): ReceiptData => ({ kind: "step.finished", step_kind: "gate", outcome: "stale", signal: { type: "stale", source: "vcs", id }, step: "ready" });
    const once = apply(at, journal(1, fired("b1")));
    expect(once.state).toMatchObject({ step: "test", counters: { "ready.stale": 1 }, signals_fired: [{ type: "stale", id: "b1" }] });
    const twice = apply({ ...once.state, step: "ready" }, journal(2, fired("b2")));
    expect(twice.state.signals_fired).toEqual([
      { type: "stale", id: "b1" },
      { type: "stale", id: "b2" },
    ]);
    const unnamed = apply(at, journal(1, { kind: "step.finished", step_kind: "gate", outcome: "stale", step: "ready" }));
    expect(unnamed.state).toMatchObject({ step: "test" });
    expect(unnamed.state.signals_fired).toBeUndefined();
  });

  test("a signal the step does not route, or one recorded under another outcome, is refused", () => {
    const at: RunState = { ...fresh(), step: "ready" };
    const res = apply(
      at,
      journal(
        1,
        { kind: "step.finished", step_kind: "gate", outcome: "unpushed", signal: { type: "unpushed", source: "vcs", id: "h1" } },
        { kind: "step.finished", step_kind: "gate", outcome: "stale", signal: { type: "timeout", source: "clock", id: "ready#1" } },
      ),
    );
    expect(res.rejected.map((r) => r.reason)).toEqual(["ready routes no signal unpushed", "signal timeout recorded as outcome stale"]);
    expect(res.state.step).toBe("ready");
  });

  test("a new round starts with no signal fired", () => {
    const at: RunState = { ...fresh(), step: "ready", signals_fired: [{ type: "stale", id: "b1" }] };
    const res = apply(at, journal(1, { kind: "round.started", workflow: WORKFLOW.pinned, by: "a-person" }));
    expect(res.state.step).toBe("implement");
    expect(res.state.signals_fired).toBeUndefined();
  });

  test("a slices step waits while its slices run, then routes on done", () => {
    const at: RunState = { ...fresh(), step: "slices" };
    const waiting = apply(at, journal(1, { kind: "step.finished", step_kind: "slices", outcome: "waiting" }));
    expect(waiting.state).toMatchObject({ step: "slices", applied_through: 1 });
    expect(apply(waiting.state, journal(2, { kind: "step.finished", step_kind: "slices", outcome: "done" })).state.step).toBe("merge");
  });

  test("a check does not wait, and a plugin kind's outcome at another kind's step is refused", () => {
    const res = apply(atTest(), journal(4, { kind: "step.finished", step_kind: "await-merge", outcome: "merged" }));
    expect(res.rejected[0]?.reason).toBe("test is a check step, not await-merge");
  });
});

describe("applyReceipts: replay and workflows", () => {
  test("receipts at or below applied_through are skipped, so applying twice is applying once", () => {
    const receipts = journal(1, started("a1"), reported("a1", "done"), checkRun("c1"), checked("c1", "fail"));
    const once = apply(fresh(), receipts);
    const twice = apply(once.state, receipts);
    expect(twice.state).toEqual(once.state);
    expect(twice.applied).toEqual([]);
    const shuffled = apply(fresh(), [...receipts].reverse());
    expect(shuffled.state).toEqual(once.state);
  });

  test("a graph that is not the unit's pinned workflow applies nothing and names the hash it needs", () => {
    const res = apply(fresh(), journal(1, started("a1")), graphOf(OTHER_HASH));
    expect(res.blocked).toEqual({ seq: 1, hash: HASH });
    expect(res.applied).toEqual([]);
    expect(res.state.applied_through).toBe(0);
  });

  test("a new round enters the new workflow's start with counters at 0, from any end", () => {
    const next = graphOf(OTHER_HASH);
    const ended = apply(atTest(), journal(4, checked("c1", "fail"), { kind: "unit.marked", ended: "stuck" })).state;
    const round: ReceiptData = { kind: "round.started", workflow: workflowOf(next).pinned, by: "a-person" };
    const blocked = apply(ended, journal(6, round));
    expect(blocked.blocked).toEqual({ seq: 6, hash: OTHER_HASH });
    const res = apply(ended, journal(6, round, started("a9")), next);
    expect(res.state).toMatchObject({ step: "implement", attempt: 1, counters: { "test.fail": 0 }, run: { id: "a9" }, workflow: { hash: OTHER_HASH } });
    expect(res.state.ended).toBeUndefined();
    expect(res.state.ended_reason).toBeUndefined();
  });

  test("a new round names the step it enters; one the workflow has no step of is refused", () => {
    const next = graphOf(OTHER_HASH);
    const ended = apply(atTest(), journal(4, { kind: "unit.marked", ended: "done" })).state;
    const pinned = workflowOf(next).pinned;
    const res = apply(ended, journal(5, { kind: "round.started", workflow: pinned, at: "review", by: "a-person", reason: "rework the review" }), next);
    expect(res.state).toMatchObject({ step: "review", attempt: 1, counters: { "test.fail": 0 }, workflow: { hash: OTHER_HASH } });
    const bad = apply(ended, journal(5, { kind: "round.started", workflow: pinned, at: "nowhere" }), next);
    expect(bad.rejected).toEqual([{ seq: 5, reason: "workflow story has no step nowhere" }]);
    expect(bad.state).toMatchObject({ ended: "done", workflow: { hash: HASH } });
  });

  test("the story's mode follows a mode change wherever the unit is", () => {
    expect(apply(fresh(), journal(1, { kind: "mode.changed", mode: "auto", by: "a-person" })).state.mode).toBe("auto");
  });
});

describe("applyReceipts: a person's move", () => {
  const moved = (to: string, at: { step: string; attempt: number }, extra: { reset?: string[]; reason?: string } = {}): ReceiptData => ({ kind: "step.moved", to, by: "a-person", ...extra, ...at });

  /** The check failed until test.fail ran out: the unit ended stuck at test attempt 3. */
  function stuckOnCounter(): RunState {
    const res = apply(
      atTest(),
      journal(4, checked("c1", "fail"), started("a2"), reported("a2", "done"), checkRun("c2"), checked("c2", "fail"), started("a3"), reported("a3", "done"), checkRun("c3"), checked("c3", "fail")),
    );
    expect(res.state).toMatchObject({ step: "test", attempt: 3, ended: "stuck", exhausted: "test.fail", counters: { "test.fail": 2 } });
    return res.state;
  }

  test("a stuck unit goes to the step named as a fresh visit, the counters named back to 0", () => {
    const stuck = stuckOnCounter();
    const res = apply(stuck, journal(13, moved("implement", { step: "test", attempt: 3 }, { reset: ["test.fail"], reason: "the flake is fixed" })));
    expect(res.rejected).toEqual([]);
    expect(res.state).toMatchObject({ step: "implement", attempt: 4, run: null, retries_used: 0, counters: { "test.fail": 0 }, applied_through: 13 });
    expect(res.state.ended).toBeUndefined();
    expect(res.state.ended_reason).toBeUndefined();
    expect(res.state.exhausted).toBeUndefined();
  });

  test("a counter not named keeps its value; the unit's own step again is its next attempt", () => {
    const stuck = stuckOnCounter();
    const res = apply(stuck, journal(13, moved("test", { step: "test", attempt: 3 })));
    expect(res.state).toMatchObject({ step: "test", attempt: 4, counters: { "test.fail": 2 }, run: null });
    expect(res.state.ended).toBeUndefined();
  });

  test("a run on the record and a park are taken off with the move", () => {
    const parked = apply(fresh(), journal(1, started("a1"), { kind: "unit.parked", reason: "agent.asking.park" }, { kind: "nudge.sent", run_id: "a1", reason: "silent" })).state;
    const res = apply(parked, journal(4, moved("implement", { step: "implement", attempt: 1 })));
    expect(res.state).toMatchObject({ step: "implement", attempt: 2, run: null, retries_used: 0 });
    expect(res.state.parked).toBeUndefined();
  });

  test("refused, never guessed at: a unit that ended done or corrupt, another visit, a step or counter the workflow lacks", () => {
    const done = apply(atTest(), journal(4, { kind: "unit.marked", ended: "done" })).state;
    expect(apply(done, journal(5, moved("implement", { step: "test", attempt: 1 }))).rejected).toEqual([{ seq: 5, reason: "the unit ended done; a new round takes it further" }]);
    const corrupt = apply(atTest(), journal(4, { kind: "unit.marked", ended: "corrupt", reason: "bad record" })).state;
    expect(apply(corrupt, journal(5, moved("implement", { step: "test", attempt: 1 }))).rejected).toEqual([{ seq: 5, reason: "the unit is corrupt" }]);
    const at = atTest();
    expect(apply(at, journal(4, moved("implement", { step: "implement", attempt: 1 }))).rejected).toEqual([{ seq: 4, reason: "stale: written for implement#1, the unit is at test#1" }]);
    expect(apply(at, journal(4, moved("deploy", { step: "test", attempt: 1 }))).rejected).toEqual([{ seq: 4, reason: "workflow story has no step deploy" }]);
    const unknown = apply(at, journal(4, moved("implement", { step: "test", attempt: 1 }, { reset: ["test.fail", "qa.loop"] })));
    expect(unknown.rejected).toEqual([{ seq: 4, reason: "workflow story has no counter qa.loop" }]);
    expect(unknown.state).toMatchObject({ step: "test", attempt: 1, run: { id: "c1" }, applied_through: 4 });
  });
});

describe("readRunState: formats", () => {
  const state = fresh();

  test("the current format reads as it is", () => {
    expect(readRunState(state)).toEqual({ ok: true, state });
  });

  test("format N-1 is accepted through its upgrade rule, and the result is validated", () => {
    const old = { ...state, format: RUN_STATE_FORMAT - 1, cursor: state.step };
    delete (old as Partial<RunState>).step;
    const upgrade = ({ cursor, ...rest }: Record<string, unknown>) => ({ ...rest, step: cursor, format: RUN_STATE_FORMAT });
    expect(readRunState(old, { [RUN_STATE_FORMAT - 1]: upgrade })).toEqual({ ok: true, state, upgradedFrom: RUN_STATE_FORMAT - 1 });
    const broken = readRunState(old, { [RUN_STATE_FORMAT - 1]: (doc) => doc });
    expect(broken.ok).toBe(false);
  });

  test("any other format is refused with the formats this build reads", () => {
    for (const format of [RUN_STATE_FORMAT + 1, RUN_STATE_FORMAT - 2]) {
      const res = readRunState({ ...state, format }, { [format]: (doc) => doc });
      expect(res).toEqual({ ok: false, reason: `run state format ${format} is not readable: this build reads ${RUN_STATE_FORMAT} and ${RUN_STATE_FORMAT - 1}` });
    }
    expect(readRunState({ ...state, format: RUN_STATE_FORMAT - 1 }).ok).toBe(false);
    expect(readRunState("{}")).toEqual({ ok: false, reason: "the run state is not an object" });
  });
});
