import { describe, expect, test } from "bun:test";
import type { Receipt, UnitState, Workflow } from "@norn/schema";
import { type ApplyContext, applyReceipts, initialState } from "../src/apply.ts";
import { at, numbered, receipt, SLICE_WF, sliceUnit, SOLO_WF, STORY_WF, stateFor, storyUnit } from "./fixtures.ts";

const ctx = (workflow: Workflow = SLICE_WF): ApplyContext => ({ workflow, now: at(), limits: { nudges: 2, retries: 1 } });
const SLICE = sliceUnit("gh-1", "01", "form");
const RUN = "01JDDDDDDDDDDDDDDDDDDDDDDD";

/** Apply receipts one at a time, each built against the then-current cursor. */
function run(st: UnitState, wf: Workflow, ...make: Array<(s: UnitState) => Receipt>) {
  let res = applyReceipts(st, [], ctx(wf));
  for (const m of make) {
    const n = res.state.applied_through + 1;
    const next = applyReceipts(res.state, [numbered(n, m(res.state))], ctx(wf));
    res = { ...next, applied: [...res.applied, ...next.applied], rejected: [...res.rejected, ...next.rejected], log: [...res.log, ...next.log] };
  }
  return res;
}
const started = (s: UnitState) => ({ ...receipt(s, "started", { how: "manual", worktree: "/w" }), run_id: RUN });
const done = (outcome: string, extra: Record<string, unknown> = {}) => (s: UnitState) => receipt(s, "done", { outcome, handoff: "h", ...extra });
const check = (outcome: "pass" | "fail") => (s: UnitState) =>
  receipt(s, "check", { outcome, command: "bun test", exit_code: outcome === "pass" ? 0 : 1, duration_ms: 5, output_tail: "" }, "norn");
const classify = (outcome: string) => (s: UnitState) => receipt(s, "classify", { outcome, rule: "t", route: "park" }, "norn");

describe("initialState", () => {
  test("enters the start step at attempt 1 with declared counters at 0", () => {
    const st = initialState({ unit: SLICE, workflow: SLICE_WF, workflowName: "slice", workflowHash: "a".repeat(64), now: at() });
    expect(st).toMatchObject({ step: "implement", attempt: 1, visits: { implement: 1 }, status: "ready", applied_through: 0 });
    expect(st.counters).toEqual({ test_loop: 0, review_loop: 0, qa_loop: 0, conflict_loop: 0 });
  });
  test("attended start parks for a person; gates park with their prompt", () => {
    expect(stateFor(storyUnit(), STORY_WF).park?.kind).toBe("attended");
    const wf: Workflow = { name: "g", start: "ok", steps: { ok: { type: "gate", prompt: "Go?", outcomes: { approve: "$done" } } } };
    expect(stateFor(storyUnit(), wf).park).toEqual({ kind: "gate", reason: "Go?", since: at() });
  });
});

describe("transitions (W3, W4)", () => {
  test("done → next step; check fail goes back, counted; re-entry bumps attempt", () => {
    const r = run(stateFor(SLICE, SLICE_WF), SLICE_WF, started, done("done"), check("fail"));
    expect(r.state).toMatchObject({ step: "implement", attempt: 2, status: "ready", counters: { test_loop: 1 }, applied_through: 3 });
    expect(r.advance).toEqual({ from: "test", outcome: "fail", to: "implement", counter: { name: "test_loop", value: 1, max: 5 } });
    expect(r.log).toEqual(["implement#1 started (manual)", "implement.done → test", "test.fail → implement [test_loop 1/5]"]);
  });

  test("exceeding max is exhausted → $stuck with the counter reason", () => {
    let st = stateFor(SLICE, SLICE_WF, { step: "review", visits: { implement: 1, review: 1 } });
    const loop = [started, done("changes_requested"), started, done("done"), check("pass")];
    st = run(st, SLICE_WF, ...loop, ...loop, ...loop).state;
    expect(st).toMatchObject({ step: "review", counters: { review_loop: 3 } });
    const r = run(st, SLICE_WF, started, done("changes_requested"));
    expect(r.state).toMatchObject({ step: "review", status: "stuck", counters: { review_loop: 3 } });
    expect(r.state.park).toMatchObject({ kind: "exhausted", reason: "review_loop 3/3 at review.changes_requested" });
    expect(r.state.last_outcome?.outcome).toBe("exhausted");
  });

  test("$done and $stuck targets", () => {
    const r = run(stateFor(storyUnit(), SOLO_WF), SOLO_WF, done("done"));
    expect(r.state).toMatchObject({ step: "$done", status: "done", run: null });
    const s = run(stateFor(storyUnit(), STORY_WF, { step: "slices", status: "ready", park: null }), STORY_WF, classify("stuck"));
    expect(s.state).toMatchObject({ status: "stuck", park: { kind: "stuck", reason: "slices.stuck → $stuck" } });
  });
});

describe("rejections and idempotence (S6, T9)", () => {
  test("stale step/attempt is rejected and skipped past, never applied", () => {
    const st = stateFor(SLICE, SLICE_WF);
    const stale = { ...done("done")(st), attempt: 7 };
    const r = applyReceipts(st, [numbered(1, stale)], ctx());
    expect(r.applied).toEqual([]);
    expect(r.rejected).toEqual([{ n: 1, receipt_id: stale.receipt_id, reason: "stale: receipt for implement#7, cursor at implement#1" }]);
    expect(r.state).toEqual({ ...st, applied_through: 1 });
  });

  test("receipts ≤ applied_through are skipped: re-applying is a no-op", () => {
    const st = stateFor(SLICE, SLICE_WF);
    const rs = [numbered(1, started(st)), numbered(2, done("done")({ ...st, run: { run_id: RUN } as UnitState["run"] }))];
    const once = applyReceipts(st, rs, ctx());
    expect(once.applied).toEqual([1, 2]);
    const twice = applyReceipts(once.state, rs, ctx());
    expect(twice.state).toEqual(once.state);
    expect(twice.applied).toEqual([]);
  });

  test("undeclared outcome, stale run, wrong kind for the step and second run are rejected", () => {
    const st = run(stateFor(SLICE, SLICE_WF), SLICE_WF, started).state;
    const reasons = (r: Receipt) => applyReceipts(st, [numbered(2, r)], ctx()).rejected[0]?.reason;
    expect(reasons(done("nope")(st))).toBe("outcome 'nope' is not declared at implement");
    expect(reasons(done("silent")(st))).toBe("outcome 'silent' is not declared at implement");
    expect(reasons({ ...done("done")(st), run_id: "01JEEEEEEEEEEEEEEEEEEEEEEE" })).toContain("stale run");
    expect(reasons(receipt(st, "approve", {}, "human"))).toBe("implement is not a gate waiting for a decision");
    expect(reasons({ ...started(st), run_id: "01JEEEEEEEEEEEEEEEEEEEEEEE" })).toContain("already has run");
  });

  test("a receipt naming another unit is rejected; naming this unit applies", () => {
    const st = stateFor(SLICE, SLICE_WF);
    const other = { ...started(st), slice: "gh-1/02" };
    expect(applyReceipts(st, [numbered(1, other)], ctx()).rejected[0]?.reason).toBe("receipt for unit gh-1/02, not gh-1/01");
    expect(applyReceipts(st, [numbered(1, { ...started(st), slice: null })], ctx()).rejected[0]?.reason).toBe("receipt for unit gh-1, not gh-1/01");
    expect(applyReceipts(st, [numbered(1, { ...started(st), slice: SLICE.slice })], ctx()).applied).toEqual([1]);
  });
});

describe("universal reports and human receipts", () => {
  test("ask parks; answer resumes the same session and delivers the text (B2)", () => {
    const withSession = (s: UnitState) => ({ ...started(s), how: "auto" as const, session: { runner: "herdr", session_id: "s1" } });
    const asked = run(stateFor(SLICE, SLICE_WF), SLICE_WF, withSession, (s) => receipt(s, "ask", { question: "Which DB?" }));
    expect(asked.state).toMatchObject({ status: "parked", park: { kind: "ask", reason: "Which DB?" } });
    const answered = run(asked.state, SLICE_WF, (s) => receipt(s, "answer", { answer: "Postgres" }, "human"));
    expect(answered.state).toMatchObject({ status: "running", park: null });
    expect(answered.deliver).toBe("Postgres");
  });

  test("answer without a live session resumes as ready for a fresh session; restart never answers (C3)", () => {
    const auto = (s: UnitState) => ({ ...started(s), how: "auto" as const });
    const asked = run(stateFor(SLICE, SLICE_WF), SLICE_WF, auto, (s) => receipt(s, "ask", { question: "Q" }));
    const again = run(asked.state, SLICE_WF, (s) => ({ ...auto(s), run_id: "01JGGGGGGGGGGGGGGGGGGGGGGG" }));
    expect(again.rejected[0]?.reason).toBe("unit is parked on ask");
    const answered = run(asked.state, SLICE_WF, (s) => receipt(s, "answer", { answer: "A" }, "human"));
    expect(answered.state).toMatchObject({ status: "ready", run: null });
    expect(answered.deliver).toBeNull();
  });

  test("stuck report parks under Unblock; unstick --to --reset re-enters", () => {
    const st = run(stateFor(SLICE, SLICE_WF, { counters: { test_loop: 4, review_loop: 0, qa_loop: 0, conflict_loop: 0 } }), SLICE_WF, started, (s) =>
      receipt(s, "stuck", { reason: "no DB" }),
    ).state;
    expect(st).toMatchObject({ status: "stuck", park: { kind: "stuck", reason: "no DB" } });
    expect(run(st, SLICE_WF, done("done")).rejected[0]?.reason).toBe("unit is stuck: no DB; use norn unstick");
    const un = run(st, SLICE_WF, (s) => receipt(s, "unstick", { to: "review", reset: ["test_loop"] }, "human"));
    expect(un.state).toMatchObject({ step: "review", attempt: 1, status: "ready", counters: { test_loop: 0 } });
    expect(run(st, SLICE_WF, (s) => receipt(s, "unstick", { reset: ["zzz"] }, "human")).rejected[0]?.reason).toBe("unknown counter(s): zzz");
    expect(run(st, SLICE_WF, (s) => receipt(s, "unstick", {}, "human")).state).toMatchObject({ step: "implement", attempt: 2 });
  });

  test("gate approve / reject take the gate's edges", () => {
    const gate = stateFor(SLICE, SLICE_WF, { step: "human-qa", visits: { "human-qa": 1 }, status: "parked", park: { kind: "gate", reason: "x", since: at() } });
    expect(run(gate, SLICE_WF, (s) => receipt(s, "approve", {}, "human")).state).toMatchObject({ step: "integrate", status: "ready" });
    expect(run(gate, SLICE_WF, (s) => receipt(s, "reject", {}, "human")).state).toMatchObject({ step: "implement", counters: { qa_loop: 1 } });
    expect(run(gate, SLICE_WF, (s) => receipt(s, "answer", { answer: "?" }, "human")).rejected[0]?.reason).toBe("gate needs approve or reject");
  });

  test("mode applies regardless of cursor", () => {
    const st = stateFor(storyUnit(), SOLO_WF, { mode: "manual" });
    const r = applyReceipts(st, [numbered(1, { ...receipt(st, "mode", { mode: "auto", previous: "manual" }, "human"), step: "implement", attempt: 9 })], ctx(SOLO_WF));
    expect(r.state.mode).toBe("auto");
  });

  test("workflow switch enters the target step (S7)", () => {
    const st = stateFor(SLICE, SLICE_WF);
    const r = run(st, SLICE_WF, (s) => receipt(s, "workflow", { name: "slice2", from_hash: st.workflow_hash, to_hash: "b".repeat(64), to: "review" }, "human"));
    expect(r.state).toMatchObject({ workflow: "slice2", workflow_hash: "b".repeat(64), step: "review" });
  });
});

describe("classified outcomes (C1)", () => {
  const live = run(stateFor(storyUnit(), SOLO_WF), SOLO_WF, (s) => ({ ...started(s), how: "auto" as const, session: { runner: "herdr", session_id: "s" } })).state;

  test("silent nudges up to step.nudges, then $stuck as exhausted", () => {
    const r = run(live, SOLO_WF, classify("silent"), classify("timeout"));
    expect(r.state).toMatchObject({ status: "running", nudges_used: 2 });
    expect(r.route).toBe("nudge");
    const s = run(r.state, SOLO_WF, classify("stalled"));
    expect(s.state).toMatchObject({ status: "stuck", park: { kind: "exhausted", reason: "stalled: nudges 2/2 at implement" } });
    expect(s.route).toBeNull();
  });

  test("died retries in a fresh session up to step.retries, then $stuck", () => {
    const r = run(live, SOLO_WF, classify("died"));
    expect(r.state).toMatchObject({ status: "ready", run: null, retries_used: 1 });
    expect(r.route).toBe("retry");
    const relaunched = run(r.state, SOLO_WF, (s) => ({ ...started(s), run_id: "01JFFFFFFFFFFFFFFFFFFFFFFF" }), classify("died"));
    expect(relaunched.state.park?.reason).toBe("died: retries 1/1 at implement");
  });

  test("a workflow may override a classified route", () => {
    const wf: Workflow = { ...SOLO_WF, steps: { implement: { type: "agent", skill: "s", outcomes: { done: "$done", silent: "$stuck" } } } };
    const st = run(stateFor(storyUnit(), wf), wf, started).state;
    expect(run(st, wf, classify("silent")).state).toMatchObject({ status: "stuck", park: { kind: "stuck", reason: "implement.silent → $stuck" } });
  });

  test("git/slices classify take edges; foreign outcomes are rejected", () => {
    const integ = stateFor(SLICE, SLICE_WF, { step: "integrate", visits: { integrate: 1 } });
    expect(run(integ, SLICE_WF, classify("conflict")).state).toMatchObject({ step: "merge", counters: { conflict_loop: 1 } });
    expect(run(integ, SLICE_WF, classify("silent")).rejected[0]?.reason).toBe("outcome 'silent' cannot be classified for a git step");
  });
});
