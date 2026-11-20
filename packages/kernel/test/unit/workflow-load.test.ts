import { describe, expect, test } from "bun:test";
import { Type } from "@sinclair/typebox";
import {
  DEFAULT_KERNEL_CONFIG,
  type LoadedWorkflow,
  type LoadWorkflowOptions,
  loadWorkflow,
  validateWorkflowDocument,
  validateWorkflowGraph,
  type WorkflowError,
  type WorkflowLoad,
} from "../../src/index.ts";
import { kind, shipped, STEP_KINDS } from "../shipped.ts";

const CONFIG = DEFAULT_KERNEL_CONFIG;
const opts = (over: Partial<LoadWorkflowOptions> = {}): LoadWorkflowOptions => ({ stepKinds: STEP_KINDS, sharedFiles: {}, config: CONFIG, ...over });

function loaded(r: WorkflowLoad): LoadedWorkflow {
  if (!r.ok) throw new Error(JSON.stringify(r.errors, null, 2));
  return r.workflow;
}
const errorsOf = (r: WorkflowLoad): WorkflowError[] => (r.ok ? [] : r.errors);

/** edge → counter and counter → bound, as the graph holds them. */
function countersOf(w: LoadedWorkflow) {
  const edges: Record<string, string> = {};
  for (const [s, step] of Object.entries(w.graph.steps)) for (const [o, r] of Object.entries(step.routes)) if (r.counter) edges[`${s}.${o}`] = r.counter;
  return { edges, counters: w.graph.counters };
}

const c = (max: number, ...reset_on: string[]) => ({ max, reset_on });
const UPDATE_CONFLICT = c(2, "update.done", "update.clean", "update.resolved");
// edits 1 and 2 route sync's light outcomes, so its conflict counter resets on them too, as on done
const SYNC_CONFLICT = c(2, "sync.done", "sync.clean", "sync.resolved");

/**
 * The counters the old engine derived for each shipped workflow, pinned so the kernel keeps its bounds. Only `sync.conflict`'s resets differ, by the edits,
 * and the edits' `unpushed` routes back to open-pr, which the old engine took with no edge and no
 * counter, each get a counter bounded as a stale one is.
 */
const OLD_COUNTERS: Record<string, { edges: Record<string, string>; counters: Record<string, { max: number; reset_on: string[] }> }> = {
  "quick.yaml": {
    edges: {
      "sync.conflict": "sync.conflict",
      "update.conflict": "update.conflict",
      "test.fail": "base-update.broken",
      "test-merge.fail": "base-update.broken",
      "test-resolution.fail": "base-update.broken",
      "resolution-review.changes_requested": "resolution-review.changes_requested",
      "review.changes_requested": "review.changes_requested",
      "ci.fail": "ship.ci-failed",
      "ci.stale": "ship.stale",
      "ready.reject": "ship.rejected",
      "ready.stale": "ship.stale",
      "merge.stale": "ship.stale",
      "ready.unpushed": "ready.unpushed",
      "merge.unpushed": "merge.unpushed",
    },
    counters: {
      "sync.conflict": SYNC_CONFLICT,
      "update.conflict": UPDATE_CONFLICT,
      "resolution-review.changes_requested": c(2),
      "review.changes_requested": c(3),
      "base-update.broken": c(5),
      "ship.ci-failed": c(3),
      "ship.stale": c(10),
      "ship.rejected": c(2),
      "ready.unpushed": c(10),
      "merge.unpushed": c(10),
    },
  },
  "refinement.yaml": { edges: { "sync.conflict": "sync.conflict" }, counters: { "sync.conflict": SYNC_CONFLICT } },
  "reproduce.yaml": { edges: {}, counters: {} },
  "slice.yaml": {
    edges: { "test.fail": "test.fail", "review.changes_requested": "review.changes_requested", "integrate.conflict": "integrate.conflict" },
    counters: { "test.fail": c(5), "integrate.conflict": c(2, "integrate.done"), "review.changes_requested": c(3) },
  },
  "story.yaml": {
    edges: {
      "sync.conflict": "sync.conflict",
      "approve-slices.reject": "approve-slices.reject",
      "update.conflict": "update.conflict",
      "test.fail": "base-update.broken",
      "test-merge.fail": "base-update.broken",
      "test-resolution.fail": "base-update.broken",
      "resolution-review.changes_requested": "resolution-review.changes_requested",
      "qa.fail": "qa_loop",
      "human-qa.reject": "qa_loop",
      "human-qa.stale": "stale_loop",
      "review.changes_requested": "review.changes_requested",
      "ci.fail": "ship.ci-failed",
      "ci.stale": "stale_loop",
      "ready.reject": "ship.rejected",
      "ready.stale": "stale_loop",
      "merge.stale": "stale_loop",
      "ready.unpushed": "ready.unpushed",
      "merge.unpushed": "merge.unpushed",
    },
    counters: {
      qa_loop: c(2),
      stale_loop: c(10),
      "sync.conflict": SYNC_CONFLICT,
      "approve-slices.reject": c(3),
      "update.conflict": UPDATE_CONFLICT,
      "resolution-review.changes_requested": c(2),
      "review.changes_requested": c(3),
      "base-update.broken": c(5),
      "ship.ci-failed": c(3),
      "ship.rejected": c(2),
      "ready.unpushed": c(10),
      "merge.unpushed": c(10),
    },
  },
  "triage.yaml": { edges: {}, counters: {} },
};

describe("the shipped workflows", () => {
  const edited = shipped();
  const files = Object.keys(edited.workflows);

  test("every shipped workflow has pinned counters here", () => {
    expect(files.sort()).toEqual(Object.keys(OLD_COUNTERS).sort());
  });

  test.each(files)("%s loads with the step kinds it uses", (file) => {
    const w = loaded(loadWorkflow(edited.workflows[file], opts({ sharedFiles: edited.shared })));
    expect(validateWorkflowGraph(w.graph).ok).toBe(true);
    expect(validateWorkflowDocument(w.pinned.doc).ok).toBe(true);
    for (const step of Object.values(w.pinned.doc.steps)) expect(step.use ?? step.like).toBeUndefined();
  });

  test.each(files)("%s derives the counters the old engine did", (file) => {
    const w = loaded(loadWorkflow(edited.workflows[file], opts({ sharedFiles: edited.shared })));
    expect(countersOf(w)).toEqual(OLD_COUNTERS[file] as ReturnType<typeof countersOf>);
  });

  test.each(files)("%s: its pinned document loads again to the same hash and graph", (file) => {
    const w = loaded(loadWorkflow(edited.workflows[file], opts({ sharedFiles: edited.shared })));
    const again = loaded(loadWorkflow(structuredClone(w.pinned.doc), opts()));
    expect(again.pinned.hash).toBe(w.pinned.hash);
    expect(again.graph).toEqual(w.graph);
  });

  test("an unrouted outcome inside a shared file is refused, naming the file", () => {
    const shared = structuredClone(edited.shared) as Record<string, { steps: Record<string, { outcomes: Record<string, unknown> }> }>;
    delete shared.ship?.steps.merge?.outcomes.merged;
    const errors = errorsOf(loadWorkflow(edited.workflows["quick.yaml"], opts({ sharedFiles: shared })));
    expect(errors.map((e) => e.shared)).toEqual(["ship"]);
    expect(errors[0]?.message).toBe("shared/ship.yaml: step 'merge' can end with 'merged' but routes it nowhere");
  });

  test("a story workflow's graph: use steps brought in, entered at their file's start, exits routed", () => {
    const w = loaded(loadWorkflow(edited.workflows["story.yaml"], opts({ sharedFiles: edited.shared })));
    expect(w.graph.start).toBe("sync");
    expect(w.graph.steps["sync-base"]).toBeUndefined();
    expect(w.graph.steps.sync?.routes.done).toEqual({ to: "slice" });
    expect(w.graph.steps.merge).toMatchObject({ kind: "await-merge", runner: { type: "plugin", mode: "wait" }, outcomes: ["merged", "stale", "unpushed"] });
    expect(w.graph.steps["test-merge"]?.check).toEqual({ command: "{checks.test}", timeout_ms: 15 * 60_000, exits: {} });
    expect(w.graph.steps.ci?.outcomes).toEqual(["pass", "fail", "stale"]);
    expect(w.graph.steps["approve-slices"]?.outcomes).toEqual(["approve", "reject"]);
    expect(w.graph.steps["human-qa"]?.outcomes).toEqual(["approve", "reject", "stale"]);
    expect(w.graph.steps.qa?.agent).toMatchObject({ criteria: true, hand_back: { fail: "findings" }, nudges: CONFIG.maxNudges, deadline_ms: CONFIG.deadlineMs });
    expect(w.graph.base).toEqual({ stale: "conflict", step: "update", verify: "test" });
  });
});

const agent = (outcomes: Record<string, unknown>, extra: Record<string, unknown> = {}) => ({ agent: "Do the work.", outcomes, ...extra });
const wf = (steps: Record<string, unknown>, extra: Record<string, unknown> = {}) => ({ name: "t", start: Object.keys(steps)[0], steps, ...extra });

describe("refusals", () => {
  test("an unknown head key names the missing step kind", () => {
    const errors = errorsOf(loadWorkflow(wf({ work: agent({ done: "ship" }), ship: { deploy: null, outcomes: { done: "$done" } } }), opts()));
    expect(errors).toEqual([
      { path: "/steps/ship/deploy", message: "`deploy` is not a step kind the kernel or a configured plugin provides: add the plugin that provides it", missing_kind: "deploy" },
    ]);
  });

  test("a step kind's name, registered, makes the same step load", () => {
    const doc = wf({ work: agent({ done: "ship" }), ship: { deploy: null, outcomes: { done: "$done" } } });
    expect(loadWorkflow(doc, opts({ stepKinds: { ...STEP_KINDS, deploy: kind("deploy", ["done"]) } })).ok).toBe(true);
  });

  test("an outcome a step can end with, unrouted", () => {
    const errors = errorsOf(loadWorkflow(wf({ work: agent({ done: "test" }), test: { check: "bun test", timeout: "1m", outcomes: { pass: "$done" } } }), opts()));
    expect(errors).toEqual([{ path: "/steps/test/outcomes", message: "step 'test' can end with 'fail' but routes it nowhere" }]);
  });

  test("a plugin step leaving one of its kind's outcomes unrouted", () => {
    const errors = errorsOf(loadWorkflow(wf({ integrate: { integrate: null, outcomes: { done: "$done" } } }), opts()));
    expect(errors).toEqual([{ path: "/steps/integrate/outcomes", message: "step 'integrate' can end with 'conflict' but routes it nowhere" }]);
  });

  test("a route for an outcome the step never ends with", () => {
    const errors = errorsOf(loadWorkflow(wf({ ok: { gate: "Approve?", outcomes: { approve: "$done", reject: "$stuck", maybe: "$done" } } }), opts()));
    expect(errors).toEqual([{ path: "/steps/ok/outcomes/maybe", message: "step 'ok' (gate) never ends with 'maybe'" }]);
  });

  test("an unreachable step", () => {
    const errors = errorsOf(loadWorkflow(wf({ work: agent({ done: "$done" }), orphan: agent({ done: "$done" }) }), opts()));
    expect(errors).toEqual([{ path: "/steps/orphan", message: "no route reaches step 'orphan' from start 'work'" }]);
  });

  test("a step that cannot reach $done", () => {
    const errors = errorsOf(loadWorkflow(wf({ work: agent({ done: "$done", blocked: "wait" }), wait: agent({ give_up: "$stuck" }) }), opts()));
    expect(errors).toEqual([{ path: "/steps/wait", message: "step 'wait' cannot reach $done" }]);
  });

  test("a missing target", () => {
    const errors = errorsOf(loadWorkflow(wf({ work: agent({ done: "reveiw" }) }), opts()));
    expect(errors).toEqual([{ path: "/steps/work/outcomes/done", message: "work.done → 'reveiw', which is not a step, $done or $stuck" }]);
  });

  test("a missing start", () => {
    expect(errorsOf(loadWorkflow({ ...wf({ work: agent({ done: "$done" }) }), start: "nope" }, opts()))).toEqual([{ path: "/start", message: "start step 'nope' does not exist" }]);
  });

  test("two head keys", () => {
    const errors = errorsOf(loadWorkflow(wf({ work: { agent: "Do it.", check: "bun test", outcomes: { done: "$done" } } }), opts()));
    expect(errors).toEqual([{ path: "/steps/work", message: "step 'work' has 2 head keys (agent, check): a step does exactly one thing" }]);
  });

  test("a built-in head and a plugin head together", () => {
    const errors = errorsOf(loadWorkflow(wf({ work: { gate: "Ok?", push: null, outcomes: { approve: "$done", reject: "$stuck" } } }), opts()));
    expect(errors.map((e) => e.message)).toEqual(["step 'work' has 2 head keys (gate, push): a step does exactly one thing"]);
  });

  test("no head key at all", () => {
    const errors = errorsOf(loadWorkflow(wf({ work: { outcomes: { done: "$done" } } }), opts()));
    expect(errors[0]?.path).toBe("/steps/work");
    expect(errors[0]?.message).toStartWith("step 'work' has no head key");
  });

  test("a loop that no counter can bound: an agent's forward outcome and a check's pass", () => {
    const errors = errorsOf(loadWorkflow(wf({ work: agent({ done: "verify" }), verify: { check: "bun test", timeout: "1m", outcomes: { pass: "work", fail: "$done" } } }), opts()));
    expect(errors).toEqual([
      { path: "/steps/work", message: "a route back no counter bounds: work.done → verify.pass → work; give one of these routes max: or a counter" },
    ]);
  });

  test("the same loop with a bound on one of its routes loads", () => {
    const doc = wf({ work: agent({ done: "verify" }), verify: { check: "bun test", timeout: "1m", outcomes: { pass: { to: "work", max: 4 }, fail: "$done" } } });
    const w = loaded(loadWorkflow(doc, opts()));
    expect(w.graph.steps.verify?.routes.pass).toEqual({ to: "work", counter: "verify.pass" });
    expect(w.graph.counters["verify.pass"]).toEqual({ max: 4, reset_on: [] });
  });

  test("a step that routes to itself with no counter", () => {
    const errors = errorsOf(loadWorkflow(wf({ sync: { push: null, outcomes: { done: "sync" } }, end: agent({ done: "$done" }) }), opts()));
    expect(errors.map((e) => e.message)).toContain("a route back no counter bounds: sync.done → sync; give one of these routes max: or a counter");
  });

  test("an agent's route back is bounded by a derived counter of 3", () => {
    const w = loaded(loadWorkflow(wf({ implement: agent({ done: "review" }), review: agent({ approve: "$done", changes_requested: "implement" }) }), opts()));
    expect(w.graph.steps.review?.routes.changes_requested).toEqual({ to: "implement", counter: "review.changes_requested" });
    expect(w.graph.counters).toEqual({ "review.changes_requested": { max: 3, reset_on: [] } });
  });

  test("a check without a timeout", () => {
    const errors = errorsOf(loadWorkflow(wf({ test: { check: "bun test", outcomes: { pass: "$done", fail: "$stuck" } } }), opts()));
    expect(errors).toEqual([{ path: "/steps/test", message: "a check needs a timeout" }]);
  });

  test("an exit code naming an outcome a check reaches anyway", () => {
    const errors = errorsOf(loadWorkflow(wf({ test: { check: "x", timeout: "1m", exits: { 3: "fail" }, outcomes: { pass: "$done", fail: "$stuck" } } }), opts()));
    expect(errors).toEqual([{ path: "/steps/test/exits/3", message: "exit 3 names 'fail', which a check reaches without exits" }]);
  });

  test("a key that does not belong to the head's kind", () => {
    const errors = errorsOf(loadWorkflow(wf({ ok: { gate: "Ok?", skills: ["x"], outcomes: { approve: "$done", reject: "$stuck" } } }), opts()));
    expect(errors).toEqual([{ path: "/steps/ok/skills", message: "`skills` is not a key of a gate step" }]);
  });

  test("a plugin step's extra keys are checked against its kind's configSchema", () => {
    const withConfig = { ...STEP_KINDS, push: kind("push", ["done"], "effect", Type.Object({ remote: Type.String() }, { additionalProperties: false })) };
    const good = loaded(loadWorkflow(wf({ push: { push: null, remote: "origin", outcomes: { done: "$done" } } }), opts({ stepKinds: withConfig })));
    expect(good.graph.steps.push?.config).toEqual({ remote: "origin" });
    const bad = errorsOf(loadWorkflow(wf({ push: { push: null, remote: 7, outcomes: { done: "$done" } } }), opts({ stepKinds: withConfig })));
    expect(bad.map((e) => e.path)).toEqual(["/steps/push/remote"]);
    const missing = errorsOf(loadWorkflow(wf({ push: { push: null, outcomes: { done: "$done" } } }), opts({ stepKinds: withConfig })));
    expect(missing).toHaveLength(1);
  });

  test("a plugin head that carries a value", () => {
    const errors = errorsOf(loadWorkflow(wf({ push: { push: "origin", outcomes: { done: "$done" } } }), opts()));
    expect(errors).toEqual([{ path: "/steps/push/push", message: "`push` takes no value: its settings are the step's other keys" }]);
  });

  test("hand_back, means and verdict name only outcomes the agent reports", () => {
    const errors = errorsOf(loadWorkflow(wf({ work: agent({ done: "$done", silent: "$stuck" }, { hand_back: { silent: "findings" }, means: { nope: "x" } }) }), opts()));
    expect(errors.map((e) => e.path)).toEqual(["/steps/work/hand_back/silent", "/steps/work/means/nope"]);
  });

  test("a counter a file declares with a dotted name", () => {
    const errors = errorsOf(loadWorkflow(wf({ work: agent({ done: "$done" }) }, { counters: { "work.done": { max: 2 } } }), opts()));
    expect(errors).toEqual([{ path: "/counters/work.done", message: "counter name 'work.done' is derived from its edge, never declared" }]);
  });

  test("a route naming an undeclared counter, and a reset on an edge that does not exist", () => {
    const errors = errorsOf(
      loadWorkflow(wf({ a: agent({ done: "b" }), b: agent({ back: { to: "a", counter: "loop" }, done: "$done" }) }, { counters: { other: { max: 2, reset_on: "a.nope" } } }), opts()),
    );
    expect(errors.map((e) => e.path)).toEqual(["/counters/other/reset_on"]);
    const undeclared = errorsOf(loadWorkflow(wf({ a: agent({ done: "b" }), b: agent({ back: { to: "a", counter: "loop" }, done: "$done" }) }), opts()));
    expect(undeclared).toEqual([{ path: "/steps/b/outcomes/back", message: "counter 'loop' is not declared in counters" }]);
  });

  test("base.verify names a check step", () => {
    const errors = errorsOf(loadWorkflow(wf({ work: agent({ done: "$done" }) }, { base: { verify: "work" } }), opts()));
    expect(errors).toEqual([{ path: "/base/verify", message: "base.verify 'work' must name a check step" }]);
  });

  test("a use step naming a shared file that is not there", () => {
    const errors = errorsOf(loadWorkflow(wf({ work: agent({ done: "ship" }), ship: { use: "ship", outcomes: {} } }), opts()));
    expect(errors).toEqual([{ path: "/steps/ship/use", message: "shared file `shared/ship.yaml` not found", shared: "ship" }]);
  });

  test("a use step routing an exit its file does not have", () => {
    const shared = { start: "go", steps: { go: { push: null, outcomes: { done: { exit: "pushed" } } } } };
    const errors = errorsOf(loadWorkflow(wf({ p: { use: "p", outcomes: { pushed: "$done", landed: "$done" } } }), opts({ sharedFiles: { p: shared } })));
    expect(errors).toEqual([{ path: "/steps/p/outcomes/landed", message: "`landed` is not an exit of shared/p.yaml (its exits: pushed)" }]);
  });

  test("a schema failure is data, never a throw", () => {
    for (const junk of [null, 7, "x", {}, { name: "t", start: "a", steps: [] }, { name: "t", start: "a", steps: { a: null } }])
      expect(loadWorkflow(junk, opts()).ok).toBe(false);
  });
});

describe("loading", () => {
  test("built-in outcomes need no route, and an agent step may override one", () => {
    const w = loaded(loadWorkflow(wf({ work: agent({ done: "$done", silent: "$stuck" }) }), opts()));
    expect(w.graph.steps.work?.outcomes).toEqual(["done"]);
    expect(w.graph.steps.work?.routes).toEqual({ done: { to: "$done" }, silent: { to: "$stuck" } });
  });

  test("a gate may leave stale unrouted: it then never ends stale", () => {
    const w = loaded(loadWorkflow(wf({ ok: { gate: "Approve?", outcomes: { approve: "$done", reject: "$stuck" } } }), opts()));
    expect(w.graph.steps.ok?.outcomes).toEqual(["approve", "reject"]);
  });

  test("a gate or a wait step kind may route unpushed back to the push, counted as a stale route is; an effect step kind never ends unpushed", () => {
    const doc = wf({
      push: { "open-pr": null, outcomes: { done: "ok" } },
      ok: { gate: "Approve?", outcomes: { approve: "merge", reject: "$stuck", unpushed: "push" } },
      merge: { "await-merge": null, outcomes: { merged: "$done", stale: "$stuck", unpushed: "push" } },
    });
    const w = loaded(loadWorkflow(doc, opts()));
    expect(w.graph.steps.ok?.outcomes).toEqual(["approve", "reject", "unpushed"]);
    expect(w.graph.steps.merge?.outcomes).toEqual(["merged", "stale", "unpushed"]);
    expect(countersOf(w)).toEqual({ edges: { "ok.unpushed": "ok.unpushed", "merge.unpushed": "merge.unpushed" }, counters: { "ok.unpushed": c(10), "merge.unpushed": c(10) } });
    const effect = wf({ push: { "open-pr": null, outcomes: { done: "$done", unpushed: "push" } } });
    expect(errorsOf(loadWorkflow(effect, opts()))).toEqual([{ path: "/steps/push/outcomes/unpushed", message: "step 'push' (open-pr) never ends with 'unpushed'" }]);
  });

  test("like copies a step of its own file, the copy's keys replacing the target's", () => {
    const doc = wf({
      test: { check: "bun test", timeout: "5m", outcomes: { pass: "again", fail: "$stuck" } },
      again: { like: "test", outcomes: { pass: "$done", fail: "$stuck" } },
    });
    const w = loaded(loadWorkflow(doc, opts()));
    expect(w.pinned.doc.steps.again).toEqual({ check: "bun test", timeout: "5m", outcomes: { pass: "$done", fail: "$stuck" } });
  });

  test("limits come from the step, then the workflow's defaults, then the config", () => {
    const doc = wf({ a: agent({ done: "b" }, { nudges: 0, deadline: "10m" }), b: agent({ done: "$done" }) }, { defaults: { retries: 4, stalled: "2m" } });
    const w = loaded(loadWorkflow(doc, opts()));
    expect(w.graph.steps.a?.agent).toMatchObject({ nudges: 0, retries: 4, deadline_ms: 600_000 });
    expect(w.graph.steps.b?.agent).toMatchObject({ nudges: CONFIG.maxNudges, retries: 4, deadline_ms: CONFIG.deadlineMs });
    expect(w.graph.stalled_ms).toBe(120_000);
  });

  test("the hash does not depend on key order", () => {
    const a = loaded(loadWorkflow({ name: "t", start: "w", steps: { w: { agent: "Do.", outcomes: { done: "$done" } } } }, opts()));
    const b = loaded(loadWorkflow({ steps: { w: { outcomes: { done: "$done" }, agent: "Do." } }, start: "w", name: "t" }, opts()));
    expect(a.pinned.hash).toBe(b.pinned.hash);
    expect(a.pinned.hash).toMatch(/^[0-9a-f]{64}$/);
  });

  test("a counter's bound comes from the config's defaults", () => {
    const doc = wf({ work: agent({ done: "test" }), test: { check: "x", timeout: "1m", outcomes: { pass: "$done", fail: "work" } } });
    const w = loaded(loadWorkflow(doc, opts({ config: { ...CONFIG, counterDefaults: { ...CONFIG.counterDefaults, checkFail: 9 } } })));
    expect(w.graph.counters["test.fail"]).toEqual({ max: 9, reset_on: [] });
  });
});

describe("an await step", () => {
  const ci = (extra: Record<string, unknown> = {}, outcomes: Record<string, unknown> = { "ci.passed": "$done", "ci.failed": "fix", "ci.none": "$done" }) => ({
    await: ["ci.passed", "ci.failed", "ci.none"],
    outcomes,
    ...extra,
  });
  const fix = agent({ done: "ci" });

  test("lists the signal kinds it waits on and routes each, with stale, unpushed and a deadline's timeout routed only where written", () => {
    const doc = wf({ ci: ci({ deadline: "30m", grace: "2m" }, { "ci.passed": "$done", "ci.failed": "fix", "ci.none": "$done", stale: "$stuck", timeout: "$stuck" }), fix });
    const w = loaded(loadWorkflow(doc, opts()));
    expect(w.graph.steps.ci?.kind).toBe("await");
    expect(w.graph.steps.ci?.runner).toEqual({ type: "builtin" });
    expect(w.graph.steps.ci?.outcomes).toEqual(["ci.passed", "ci.failed", "ci.none", "stale", "timeout"]);
    expect(w.graph.steps.ci?.await).toEqual({ on: ["ci.passed", "ci.failed", "ci.none"], deadline_ms: 1_800_000, grace_ms: 120_000 });
  });

  test("waits out a 5m grace before ci.none by default, and has no deadline unless it sets one", () => {
    const w = loaded(loadWorkflow(wf({ ci: ci(), fix }), opts()));
    expect(w.graph.steps.ci?.await).toEqual({ on: ["ci.passed", "ci.failed", "ci.none"], deadline_ms: null, grace_ms: 300_000 });
    const merge = loaded(loadWorkflow(wf({ merge: { await: ["change.merged"], outcomes: { "change.merged": "$done" } } }), opts()));
    expect(merge.graph.steps.merge?.await).toEqual({ on: ["change.merged"], deadline_ms: null, grace_ms: null });
  });

  test("a route back on a signal is bounded by a signal counter with a check fail's default", () => {
    const w = loaded(loadWorkflow(wf({ ci: ci(), fix }), opts()));
    expect(countersOf(w)).toEqual({ edges: { "ci.ci.failed": "ci.ci.failed" }, counters: { "ci.ci.failed": c(CONFIG.counterDefaults.checkFail) } });
    expect(w.pinned.doc.steps.ci?.outcomes).toEqual({ "ci.passed": "$done", "ci.failed": { to: "fix", counter: "ci.ci.failed" }, "ci.none": "$done" });
    expect(loaded(loadWorkflow(w.pinned.doc, opts())).pinned.hash).toBe(w.pinned.hash);
  });

  test("an unknown kind, a kind routed but not listed, a listed kind left unrouted, timeout without deadline and grace without ci.none are refused, naming the key", () => {
    expect(errorsOf(loadWorkflow(wf({ ci: { await: ["ci.passed", "ci.faild"], outcomes: { "ci.passed": "$done", "ci.faild": "$stuck" } } }), opts()))).toEqual([
      { path: "/steps/ci/await/1", message: "`ci.faild` is not a signal kind: one of ci.pending, ci.passed, ci.failed, ci.none, change.merged, change.closed" },
    ]);
    expect(errorsOf(loadWorkflow(wf({ ci: { await: ["ci.passed"], outcomes: { "ci.passed": "$done", "ci.failed": "$stuck" } } }), opts()))).toEqual([
      { path: "/steps/ci/outcomes/ci.failed", message: "step 'ci' (await) never ends with 'ci.failed'" },
    ]);
    expect(errorsOf(loadWorkflow(wf({ ci: { await: ["ci.passed", "ci.failed"], outcomes: { "ci.passed": "$done" } } }), opts()))).toEqual([
      { path: "/steps/ci/outcomes", message: "step 'ci' can end with 'ci.failed' but routes it nowhere" },
    ]);
    expect(errorsOf(loadWorkflow(wf({ ci: { await: ["ci.passed"], outcomes: { "ci.passed": "$done", timeout: "$stuck" } } }), opts()))).toEqual([
      { path: "/steps/ci/outcomes/timeout", message: "step 'ci' (await) never ends with 'timeout'" },
    ]);
    expect(errorsOf(loadWorkflow(wf({ ci: { await: ["ci.passed"], grace: "1m", outcomes: { "ci.passed": "$done" } } }), opts()))).toEqual([
      { path: "/steps/ci/grace", message: "grace counts down to ci.none, which step 'ci' does not wait on" },
    ]);
  });

  test("only an await step routes a signal kind: an agent reporting a dotted outcome is refused", () => {
    expect(errorsOf(loadWorkflow(wf({ work: agent({ "ci.failed": "$done" }) }), opts()))).toEqual([
      { path: "/steps/work/outcomes/ci.failed", message: "'ci.failed' is a signal kind's spelling: an agent reports a plain outcome" },
    ]);
  });

  test("takes a list of kinds and only its own keys", () => {
    expect(errorsOf(loadWorkflow(wf({ ci: { await: [], outcomes: { stale: "$done" } } }), opts()))[0]?.path).toBe("/steps/ci/await");
    expect(errorsOf(loadWorkflow(wf({ ci: { await: "ci.passed", outcomes: { "ci.passed": "$done" } } }), opts()))[0]?.path).toBe("/steps/ci/await");
    expect(errorsOf(loadWorkflow(wf({ ci: { await: ["ci.passed"], timeout: "1m", outcomes: { "ci.passed": "$done" } } }), opts()))).toEqual([
      { path: "/steps/ci/timeout", message: "`timeout` is not a key of an await step" },
    ]);
  });
});
