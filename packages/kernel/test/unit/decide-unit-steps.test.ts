import { describe, expect, test } from "bun:test";
import { DEFAULT_KERNEL_CONFIG, decide } from "../../src/index.ts";
import { decideCase, factsOf, graph, kindOf, loaded, minutesAgo, receipt, run, stateAt } from "./decide-unit-fixtures.ts";

const checkRun = run({ id: "chk-1", step: "test", executor: "check" });
const shipRun = run({ id: "step-1", step: "ship", executor: "open-pr" });
const mergedRun = run({ id: "step-2", step: "merged", executor: "await-merge" });
const stale = { type: "stale", source: "vcs", id: "b1" };
const unpushed = { type: "unpushed", source: "vcs", id: "h1" };

describe("a check step", () => {
  test("starts its command, recording run.started first", () => {
    const d = kindOf(decideCase({ state: stateAt("test") }), "run_check");
    expect(d).toMatchObject({ rule: "check.run", step: "test", attempt: 1, command: "bun run test", timeout_ms: 600_000 });
    expect(d.intent?.data).toEqual({ kind: "run.started", run_id: d.run_id, run_kind: "check", executor: "check", attended: false, step: "test", attempt: 1 });
  });

  test("waits while it runs", () => {
    expect(decideCase({ state: stateAt("test", { run: checkRun }), step_run: { kind: "check", running: true } })?.rule).toBe("check.running");
  });

  test("an answered outcome is recorded as check.finished and routed", () => {
    const d = kindOf(decideCase({ state: stateAt("test", { run: checkRun }), step_run: { kind: "check", running: false, outcome: "pass" } }), "apply_receipts");
    expect(d.rule).toBe("check.finished");
    expect(d.receipts[0]?.data).toMatchObject({ kind: "check.finished", run_id: "chk-1", exit: 0, outcome: "pass" });
    expect(d.state.step).toBe("ship");
    const flaky = kindOf(decideCase({ state: stateAt("test", { run: checkRun }), step_run: { kind: "check", running: false, outcome: "flaky" } }), "apply_receipts");
    expect(flaky.receipts[0]?.data).toMatchObject({ exit: 3, outcome: "flaky" });
    expect(flaky.state.counters["test.fail"]).toBe(1);
  });

  test("a check recorded but neither running nor answered runs again under its recorded run, recorded as run.resumed, never a second run.started", () => {
    const d = kindOf(decideCase({ state: stateAt("test", { run: checkRun }), step_run: { kind: "check", running: false, error: "spawn failed" } }), "run_check");
    expect(d.rule).toBe("check.rerun");
    expect(d.run_id).toBe("chk-1");
    expect(d.intent?.data).toEqual({ kind: "run.resumed", run_id: "chk-1", reason: "spawn failed", step: "test", attempt: 1 });
  });

  test("a check cut short with its retries spent ends the unit stuck, naming the limit, instead of running again every tick", () => {
    const d = kindOf(decideCase({ state: stateAt("test", { run: { ...checkRun, resumes: 1 } }) }), "apply_receipts");
    expect(d.rule).toBe("check.rerun.exhausted");
    expect(d.receipts[0]?.data).toMatchObject({ kind: "unit.marked", ended: "stuck" });
    expect(d.state).toMatchObject({ ended: "stuck", ended_reason: "check run chk-1 at test ended without an outcome after 1/1 retries" });
    expect(decideCase({ state: stateAt("test", { run: { ...checkRun, resumes: 1 } }), config: { maxRetries: 2 } })?.rule).toBe("check.rerun");
  });

  test("an outcome the check does not declare parks the unit with the refusal and writes no receipt, so the next tick does not write it again", () => {
    const answered = { kind: "check", running: false, outcome: "bogus" } as const;
    const d = kindOf(decideCase({ state: stateAt("test", { run: checkRun }), step_run: answered }), "park");
    expect(d).toMatchObject({ rule: "check.finished.rejected", inbox: { kind: "stuck", text: "not applied: outcome bogus is not declared at test" } });
    const next = decideCase({ state: stateAt("test", { run: checkRun, parked: { reason: "check.finished.rejected", since: minutesAgo(1) } }), step_run: answered });
    expect(next).toMatchObject({ kind: "noop", rule: "unit.parked" });
  });

  test("the check's finish receipt on the record is applied", () => {
    const receipts = [{ seq: 1, id: "r-1", at: minutesAgo(1), data: { kind: "check.finished" as const, run_id: "chk-1", exit: 1, outcome: "fail", step: "test", attempt: 1 } }];
    const d = kindOf(decideCase({ state: stateAt("test", { run: checkRun }), receipts }), "apply_receipts");
    expect(d).toMatchObject({ rule: "receipts.apply", state: { step: "build", counters: { "test.fail": 1 } } });
  });
});

describe("a gate", () => {
  test("waits for a person with the gate's prompt in the inbox", () => {
    const d = kindOf(decideCase({ state: stateAt("approve") }), "park");
    expect(d).toMatchObject({ rule: "gate.park", inbox: { kind: "gate", text: "Ship it?", step: "approve" } });
    expect(decideCase({ state: stateAt("approve", { parked: { reason: "gate.park", since: minutesAgo(9) } }) })?.rule).toBe("unit.parked");
  });

  test("takes the route its on: block gives a signal in the facts, parked or not, its receipt naming the occurrence", () => {
    const parked = { reason: "gate.park", since: minutesAgo(9) };
    const d = kindOf(decideCase({ state: stateAt("approve", { parked }), story: { signals: [stale] } }), "apply_receipts");
    expect(d.rule).toBe("gate.signal");
    expect(d.receipts[0]?.data).toEqual({ kind: "step.finished", step_kind: "gate", outcome: "stale", signal: { type: "stale", source: "vcs", id: "b1" }, step: "approve", attempt: 1 });
    expect(d.state).toMatchObject({ step: "build", counters: { "approve.stale": 1 }, signals_fired: [{ type: "stale", id: "b1" }] });
    expect(d.state.parked).toBeUndefined();
  });

  test("takes a signal for the story's own unit only, and only one the step routes", () => {
    const wf = loaded(graph({ approve: { routes: { approve: { to: "$done" }, reject: { to: "build", counter: "approve.reject" }, unpushed: { to: "ship" } }, signals: [{ name: "unpushed" }] } }));
    const parked = { reason: "gate.park", since: minutesAgo(9) };
    const d = kindOf(decideCase({ state: stateAt("approve", { parked }, wf), workflows: [wf], story: { signals: [unpushed] } }), "apply_receipts");
    expect(d).toMatchObject({ rule: "gate.signal", state: { step: "ship" } });
    expect(decideCase({ state: stateAt("approve", { parked }), story: { signals: [unpushed] } })?.rule).toBe("unit.parked");
    expect(decideCase({ state: stateAt("approve", { parked }, wf), workflows: [wf], story: { signals: [unpushed] }, unitId: "gh-1/02" })?.rule).toBe("unit.parked");
  });

  test("fires each occurrence once a round: the same id waits for a person, a new id fires again", () => {
    const parked = { reason: "gate.park", since: minutesAgo(9) };
    const fired = stateAt("approve", { parked, signals_fired: [{ type: "stale", id: "b1" }] });
    expect(decideCase({ state: fired, story: { signals: [stale] } })?.rule).toBe("unit.parked");
    const again = kindOf(decideCase({ state: fired, story: { signals: [{ ...stale, id: "b2" }] } }), "apply_receipts");
    expect(again.rule).toBe("gate.signal");
    expect(again.state.signals_fired).toEqual([
      { type: "stale", id: "b1" },
      { type: "stale", id: "b2" },
    ]);
    // an id is fired per signal: another signal with the same id is its own occurrence
    const both = loaded(graph({ approve: { routes: { ...graph().steps.approve?.routes, unpushed: { to: "ship" } }, signals: [{ name: "stale" }, { name: "unpushed" }] } }));
    expect(kindOf(decideCase({ state: stateAt("approve", { parked, signals_fired: [{ type: "stale", id: "b1" }] }, both), workflows: [both], story: { signals: [stale, { ...unpushed, id: "b1" }] } }), "apply_receipts").state.step).toBe("ship");
  });

  test("weighs signals in the order its on: block lists them, not the order the facts hold them", () => {
    const routes = { ...graph().steps.approve?.routes, unpushed: { to: "ship" } };
    const unpushedFirst = loaded(graph({ approve: { routes, signals: [{ name: "unpushed" }, { name: "stale" }] } }));
    const staleFirst = loaded(graph({ approve: { routes, signals: [{ name: "stale" }, { name: "unpushed" }] } }));
    const at = (wf: typeof staleFirst) => kindOf(decideCase({ state: stateAt("approve", {}, wf), workflows: [wf], story: { signals: [stale, unpushed] } }), "apply_receipts");
    expect(at(unpushedFirst).receipts[0]?.data).toMatchObject({ outcome: "unpushed" });
    expect(at(staleFirst).receipts[0]?.data).toMatchObject({ outcome: "stale" });
    // the first listed already fired: the next one present is taken
    const fired = kindOf(decideCase({ state: stateAt("approve", { signals_fired: [{ type: "unpushed", id: "h1" }] }, unpushedFirst), workflows: [unpushedFirst], story: { signals: [stale, unpushed] } }), "apply_receipts");
    expect(fired.receipts[0]?.data).toMatchObject({ outcome: "stale" });
  });

  test("a receipt that leaves it on the same visit keeps its park, so the visit's wait is still counted from when it began", () => {
    const parked = { reason: "gate.park", since: minutesAgo(3000) };
    const receipts = [{ seq: 1, id: "r-1", at: minutesAgo(1), data: { kind: "mode.changed" as const, mode: "manual" as const, by: "a-person" } }];
    const d = kindOf(decideCase({ state: stateAt("approve", { parked }), receipts }), "apply_receipts");
    expect(d.state).toMatchObject({ step: "approve", attempt: 1, mode: "manual" });
    expect(d.state.parked).toEqual(parked);
    // the next tick sees the same park and holds, rather than parking again from now
    expect(decideCase({ state: d.state })?.rule).toBe("unit.parked");
  });

  test("a gate.decided receipt from a person moves it", () => {
    const receipts = [{ seq: 1, id: "r-1", at: minutesAgo(1), data: { kind: "gate.decided" as const, outcome: "approve" as const, by: "a-person", step: "approve", attempt: 1 } }];
    const d = kindOf(decideCase({ state: stateAt("approve", { parked: { reason: "gate.park", since: minutesAgo(9) } }), receipts }), "apply_receipts");
    expect(d.state.ended).toBe("done");
    expect(d.state.parked).toBeUndefined();
    const reject = [{ seq: 1, id: "r-1", at: minutesAgo(1), data: { kind: "gate.decided" as const, outcome: "reject" as const, by: "a-person", step: "approve", attempt: 1 } }];
    const back = kindOf(decideCase({ state: stateAt("approve", { parked: { reason: "gate.park", since: minutesAgo(9) } }), receipts: reject }), "apply_receipts");
    expect(back.state.step).toBe("build");
    expect(back.state.parked).toBeUndefined();
  });
});

describe("a gate the person's policy grants to a stand-in", () => {
  const granted = { standIn: { gates: ["story.approve"], attended: [] } };

  test("still waits for the person while no executor runs in an OS sandbox, and says why", () => {
    const d = kindOf(decideCase({ state: stateAt("approve"), config: granted }), "park");
    expect(d.rule).toBe("gate.park");
    expect(d.inbox?.kind).toBe("gate");
    expect(d.inbox?.text).toStartWith("Ship it?");
    expect(d.inbox?.text).toContain("policy.stand_in.gates");
    expect(d.inbox?.text).toContain("sandbox");
  });

  test("a gate of another workflow, or one nobody grants, waits with its prompt alone", () => {
    const other = { standIn: { gates: ["quick.approve"], attended: [] } };
    expect(kindOf(decideCase({ state: stateAt("approve"), config: other }), "park").inbox?.text).toBe("Ship it?");
  });
});

describe("a plugin step kind", () => {
  test("an effect kind runs once, recorded first, with the step's config", () => {
    const d = kindOf(decideCase({ state: stateAt("ship") }), "run_step");
    expect(d).toMatchObject({ rule: "step.run", step_kind: "open-pr", mode: "effect", config: { draft: true } });
    expect(d.intent?.data).toEqual({ kind: "run.started", run_id: d.run_id, run_kind: "step", executor: "open-pr", attended: false, step: "ship", attempt: 1 });
  });

  test("waits while it runs, and its answer is recorded as step.finished and routed", () => {
    expect(decideCase({ state: stateAt("ship", { run: shipRun }), step_run: { kind: "open-pr", running: true } })?.rule).toBe("step.running");
    const d = kindOf(decideCase({ state: stateAt("ship", { run: shipRun }), step_run: { kind: "open-pr", running: false, outcome: "opened" } }), "apply_receipts");
    expect(d.rule).toBe("step.finished");
    expect(d.receipts[0]?.data).toMatchObject({ kind: "step.finished", run_id: "step-1", step_kind: "open-pr", outcome: "opened" });
    expect(d.state.step).toBe("merged");
  });

  test("the step kind's detail travels with its answer into step.finished, for the briefs that name what it found", () => {
    const detail = { base: { ref: "origin/main", sha: "b".repeat(40) }, conflicts: ["a.txt"] };
    const d = kindOf(decideCase({ state: stateAt("ship", { run: shipRun }), step_run: { kind: "open-pr", running: false, outcome: "opened", detail } }), "apply_receipts");
    expect(d.receipts[0]?.data).toEqual({ kind: "step.finished", run_id: "step-1", step_kind: "open-pr", outcome: "opened", detail, step: "ship", attempt: 1 });
  });

  test("an effect cut short is run again under its own run, recorded as run.resumed rather than a second run.started", () => {
    const d = kindOf(decideCase({ state: stateAt("ship", { run: shipRun }) }), "run_step");
    expect(d).toMatchObject({ rule: "step.resume", run_id: "step-1" });
    expect(d.intent?.data).toEqual({ kind: "run.resumed", run_id: "step-1", step: "ship", attempt: 1 });
  });

  test("an effect whose plugin keeps failing ends the unit stuck once its retries are spent, naming the failure", () => {
    const failed = { kind: "open-pr", running: false, error: "forge: 401 bad credentials" } as const;
    const d = kindOf(decideCase({ state: stateAt("ship", { run: { ...shipRun, resumes: 1 } }), step_run: failed }), "apply_receipts");
    expect(d.rule).toBe("step.resume.exhausted");
    expect(d.state.ended_reason).toBe("open-pr run step-1 at ship ended without an outcome after 1/1 retries: forge: 401 bad credentials");
  });

  test("an outcome the step kind does not declare parks the unit rather than writing a refused receipt each tick", () => {
    const d = kindOf(decideCase({ state: stateAt("ship", { run: shipRun }), step_run: { kind: "open-pr", running: false, outcome: "done" } }), "park");
    expect(d).toMatchObject({ rule: "step.finished.rejected", inbox: { kind: "stuck", text: "not applied: outcome done is not declared at ship" } });
  });

  test("a wait kind is polled every tick until it answers something other than waiting", () => {
    const first = kindOf(decideCase({ state: stateAt("merged") }), "run_step");
    expect(first).toMatchObject({ rule: "step.run", mode: "wait", step_kind: "await-merge" });
    expect(first.intent).toBeDefined();
    const poll = kindOf(decideCase({ state: stateAt("merged", { run: mergedRun }), step_run: { kind: "await-merge", running: false, outcome: "waiting" } }), "run_step");
    expect(poll).toMatchObject({ rule: "step.poll", run_id: "step-2" });
    expect(poll.intent).toBeUndefined();
    expect(decideCase({ state: stateAt("merged", { run: mergedRun }) })?.rule).toBe("step.poll");
    const done = kindOf(decideCase({ state: stateAt("merged", { run: mergedRun }), step_run: { kind: "await-merge", running: false, outcome: "merged" } }), "apply_receipts");
    expect(done.state.step).toBe("approve");
  });

  test("a story polled at a wait step takes the route its on: block gives a signal between polls; a step that does not route it is polled", () => {
    const waiting = { kind: "await-merge", running: false, outcome: "waiting" } as const;
    const d = kindOf(decideCase({ state: stateAt("merged", { run: mergedRun }), story: { signals: [stale] }, step_run: waiting }), "apply_receipts");
    expect(d.rule).toBe("step.signal");
    expect(d.receipts[0]?.data).toMatchObject({ kind: "step.finished", run_id: "step-2", step_kind: "await-merge", outcome: "stale", signal: { type: "stale", source: "vcs", id: "b1" } });
    expect(d.state.step).toBe("build");
    const plain = loaded(graph({ merged: { routes: { merged: { to: "approve" } }, signals: [] } }));
    expect(decideCase({ state: stateAt("merged", { run: mergedRun }, plain), workflows: [plain], story: { signals: [stale] } })?.rule).toBe("step.poll");
    expect(decideCase({ state: stateAt("merged", { run: mergedRun }), story: { signals: [unpushed] } })?.rule).toBe("step.poll");
    expect(decideCase({ state: stateAt("merged", { run: mergedRun, signals_fired: [{ type: "stale", id: "b1" }] }), story: { signals: [stale] } })?.rule).toBe("step.poll");
  });

  test("the wait kind's own answer on the same tick wins over a signal", () => {
    const d = kindOf(decideCase({ state: stateAt("merged", { run: mergedRun }), story: { signals: [stale] }, step_run: { kind: "await-merge", running: false, outcome: "merged" } }), "apply_receipts");
    expect(d).toMatchObject({ rule: "step.finished", state: { step: "approve" } });
  });

  test("a step run of another kind is not this step's", () => {
    expect(decideCase({ state: stateAt("merged", { run: mergedRun }), step_run: { kind: "open-pr", running: true } })?.rule).toBe("step.poll");
  });
});

describe("the unit's record", () => {
  test("a corrupt record is marked corrupt once, by a receipt the record keeps, then held", () => {
    const d = kindOf(decideCase({ state: null, corrupt: "state failed validation" }), "mark_corrupt");
    expect({ rule: d.rule, mark: d.intent.data, state: d.state }).toEqual({ rule: "unit.corrupt", mark: { kind: "unit.marked", ended: "corrupt", reason: "state failed validation" }, state: null });
    expect(decideCase({ state: null, corrupt: "state failed validation", corrupt_marked: true })).toEqual({ kind: "noop", unit: "gh-1", rule: "unit.corrupt.held", reason: "state failed validation" });
  });

  test("a readable unit marked corrupt ends corrupt with its mark applied, so the next tick holds it", () => {
    const d = kindOf(decideCase({ state: stateAt("build", { run: run(), applied_through: 4, parked: { reason: "gate.park", since: minutesAgo(2) } }), workflows: [] }), "mark_corrupt");
    expect(d.state).toMatchObject({ ended: "corrupt", run: null, applied_through: 5 });
    expect(d.state?.parked).toBeUndefined();
    expect(decideCase({ state: d.state, receipts: [] })?.rule).toBe("unit.corrupt.held");
    // receipts already waiting stay unapplied: applying them would need the graph that is gone
    const waiting = kindOf(decideCase({ state: stateAt("build", { applied_through: 4 }), receipts: [receipt(5, { kind: "nudge.sent", run_id: "run-1", reason: "silent" })], workflows: [] }), "mark_corrupt");
    expect(waiting.state?.applied_through).toBe(4);
  });

  test("a pinned workflow that is not loaded, or lacks the unit's step, marks it corrupt", () => {
    expect(decideCase({ state: stateAt("build"), workflows: [] })).toMatchObject({ kind: "mark_corrupt", rule: "unit.workflow_missing" });
    expect(decideCase({ state: stateAt("gone") })?.rule).toBe("unit.workflow_missing");
  });

  test("an ended unit takes no action", () => {
    expect(decideCase({ state: stateAt("build", { ended: "done" }) })?.rule).toBe("unit.ended.done");
    expect(decideCase({ state: stateAt("build", { ended: "stuck", ended_reason: "counter ran out" }) })).toMatchObject({ kind: "noop", rule: "unit.ended.stuck", reason: "counter ran out" });
  });

  test("a slice not started waits for its story; the story's own unit is the story rules'", () => {
    expect(decideCase({ state: null, unitId: "gh-1/02" })?.rule).toBe("slice.not_started");
    expect(decideCase({ state: null })).toBeNull();
  });

  test("a pending new round is left to the story rules", () => {
    const wf = loaded();
    const receipts = [{ seq: 1, id: "r-1", at: minutesAgo(1), data: { kind: "round.started" as const, workflow: wf.pinned } }];
    expect(decideCase({ state: stateAt("build", { ended: "done" }), receipts })).toBeNull();
  });
});

describe("no cap on runs at once", () => {
  test("with 5 agents and 5 checks due in one tick, all 10 start", () => {
    // the fixture keys the other stories gh-10 on, in order: four more agents, then five checks
    const due = (step: string, n: number) => ({ id: `gh-${n}`, state: stateAt(step, { unit: `gh-${n}`, story: `gh-${n}` }), receipts: [], session: null });
    const others = [...[10, 11, 12, 13].map((n) => due("build", n)), ...[14, 15, 16, 17, 18].map((n) => due("test", n))];
    const f = factsOf({ state: stateAt("build"), others });
    for (const s of f.stories) s.claim = { story: s.key, holder: f.holder, acquired_at: minutesAgo(1), expires_at: "2026-11-17T11:00:00.000Z", version: 1 };
    const wf = loaded();
    const ds = decide(f, { byName: {}, byHash: { [wf.pinned.hash]: wf } }, { ...DEFAULT_KERNEL_CONFIG, mode: "auto" });
    expect(ds.filter((d) => d.kind === "start_run").map((d) => d.unit)).toEqual(["gh-1", "gh-10", "gh-11", "gh-12", "gh-13"]);
    expect(ds.filter((d) => d.kind === "run_check").map((d) => d.unit)).toEqual(["gh-14", "gh-15", "gh-16", "gh-17", "gh-18"]);
    expect(ds.filter((d) => d.unit !== null && d.kind === "noop")).toEqual([]);
  });
});
