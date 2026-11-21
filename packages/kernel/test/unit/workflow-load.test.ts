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
    expect(w.graph.steps.merge).toMatchObject({ kind: "await-merge", runner: { type: "plugin", mode: "wait" }, outcomes: ["merged", "unpushed"], signals: [{ name: "stale" }, { name: "unpushed" }] });
    expect(w.graph.steps["test-merge"]?.check).toEqual({ command: "{checks.test}", timeout_ms: 15 * 60_000, exits: {} });
    expect(w.graph.steps.ci?.outcomes).toEqual(["pass", "fail", "stale"]);
    expect(w.graph.steps["approve-slices"]?.outcomes).toEqual(["approve", "reject"]);
    expect(w.graph.steps["human-qa"]).toMatchObject({ outcomes: ["approve", "reject"], signals: [{ name: "stale" }] });
    expect(w.graph.steps.qa?.agent).toMatchObject({ criteria: true, hand_back: { fail: "findings" }, nudges: CONFIG.maxNudges, deadline_ms: CONFIG.deadlineMs });
    // a review never edits code, as its role grants only code:read, and QA's role changes code for the run alone
    expect([w.graph.steps.review?.agent?.role, w.graph.steps["resolution-review"]?.agent?.role, w.graph.steps.qa?.agent?.role]).toEqual(["reviewer", "reviewer", "qa"]);
    expect(w.graph.base).toEqual({ stale: "conflict", step: "update", verify: "test" });
  });
});

const agent = (outcomes: Record<string, unknown>, extra: Record<string, unknown> = {}) => ({ agent: "Do the work.", outcomes, ...extra });
const wf = (steps: Record<string, unknown>, extra: Record<string, unknown> = {}) => ({ name: "t", start: Object.keys(steps)[0], steps, ...extra });

describe("writes", () => {
  test("an agent step writes its worktree unless it declares writes: docs", () => {
    const w = loaded(loadWorkflow(wf({ build: agent({ done: "review" }), review: agent({ done: "again" }, { writes: "docs" }), again: agent({ done: "$done" }, { writes: "worktree" }) }), opts()));
    expect([w.graph.steps.build?.agent?.writes, w.graph.steps.review?.agent?.writes]).toEqual(["worktree", "docs"]);
  });

  test("a step that never names writes pins none, so the hash of a workflow written before it stays", () => {
    const w = loaded(loadWorkflow(wf({ build: agent({ done: "$done" }) }), opts()));
    expect(w.pinned.doc.steps.build).not.toHaveProperty("writes");
  });

  test("writes takes worktree or docs, and only on an agent step", () => {
    expect(new Set(errorsOf(loadWorkflow(wf({ build: agent({ done: "$done" }, { writes: "everything" }) }), opts())).map((e) => e.path))).toEqual(new Set(["/steps/build/writes"]));
    const errors = errorsOf(loadWorkflow(wf({ test: { check: "bun test", timeout: "5m", writes: "docs", outcomes: { pass: "$done", fail: "$stuck" } } }), opts()));
    expect(errors).toEqual([{ path: "/steps/test/writes", message: "`writes` is not a key of a check step" }]);
  });
});

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

  test("an input name the host does not provide, naming the inputs it does", () => {
    const doc = wf({ work: agent({ done: "fix" }, { inputs: ["spec", "last_finding"] }), fix: agent({ done: "$done" }, { inputs: ["handoff", { file: "docs/x.md" }, "mystery"] }) });
    const errors = errorsOf(loadWorkflow(doc, opts({ inputs: ["spec", "handoff", "last_findings"] })));
    expect(errors).toEqual([
      { path: "/steps/work/inputs/1", message: "`last_finding` is not an input norn provides: name one of spec, handoff, last_findings, or a file as {file: <path>}" },
      { path: "/steps/fix/inputs/2", message: "`mystery` is not an input norn provides: name one of spec, handoff, last_findings, or a file as {file: <path>}" },
    ]);
  });

  test("an unknown input inside a shared file is refused, naming the file", () => {
    const shared = { start: "go", steps: { go: agent({ done: { exit: "done" } }, { inputs: ["nope"] }) } };
    const errors = errorsOf(loadWorkflow(wf({ p: { use: "p", outcomes: { done: "$done" } } }), opts({ sharedFiles: { p: shared }, inputs: ["spec"] })));
    expect(errors).toEqual([{ path: "/steps/go/inputs/0", message: "shared/p.yaml: `nope` is not an input norn provides: name one of spec, or a file as {file: <path>}", shared: "p" }]);
  });

  test("without the host's inputs, as a pinned revision loads, any input name loads to the same hash", () => {
    const doc = wf({ work: agent({ done: "$done" }, { inputs: ["spec", "mystery", { file: "docs/x.md", label: "Design" }] }) });
    const pinned = loaded(loadWorkflow(doc, opts()));
    expect(pinned.graph.steps.work?.agent?.inputs).toEqual(["spec", "mystery", { file: "docs/x.md", label: "Design" }]);
    expect(loaded(loadWorkflow(structuredClone(pinned.pinned.doc), opts())).pinned.hash).toBe(pinned.pinned.hash);
    expect(loaded(loadWorkflow(wf({ work: agent({ done: "$done" }, { inputs: ["spec", { file: "docs/x.md" }] }) }), opts({ inputs: ["spec"] }))).graph.steps.work?.agent?.inputs).toEqual(["spec", { file: "docs/x.md" }]);
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

  test("a gate or a wait step kind routing unpushed under outcomes: routes it back to the push as a signal, counted as a stale route is; an effect step kind never ends unpushed", () => {
    const doc = wf({
      push: { "open-pr": null, outcomes: { done: "ok" } },
      ok: { gate: "Approve?", outcomes: { approve: "merge", reject: "$stuck", unpushed: "push" } },
      merge: { "await-merge": null, outcomes: { merged: "$done", stale: "$stuck", unpushed: "push" } },
    });
    const w = loaded(loadWorkflow(doc, opts()));
    expect(w.graph.steps.ok).toMatchObject({ outcomes: ["approve", "reject"], signals: [{ name: "unpushed" }] });
    expect(w.graph.steps.merge).toMatchObject({ outcomes: ["merged", "unpushed"], signals: [{ name: "stale" }, { name: "unpushed" }] });
    expect(countersOf(w)).toEqual({ edges: { "ok.unpushed": "ok.unpushed", "merge.unpushed": "merge.unpushed" }, counters: { "ok.unpushed": c(10), "merge.unpushed": c(10) } });
    const effect = wf({ push: { "open-pr": null, outcomes: { done: "$done", unpushed: "push" } } });
    expect(errorsOf(loadWorkflow(effect, opts()))).toEqual([{ path: "/steps/push/outcomes/unpushed", message: "step 'push' (open-pr) never ends with 'unpushed'" }]);
  });
});

describe("the on: block", () => {
  const MERGE_KIND = { ...STEP_KINDS, "await-merge": kind("await-merge", ["merged"], "wait") };
  const legacy = wf({
    build: agent({ done: "push" }),
    push: { "open-pr": null, outcomes: { done: "ok" } },
    ok: { gate: "Approve?", outcomes: { approve: "merge", reject: "build", unpushed: "push", stale: "build" } },
    merge: { "await-merge": null, outcomes: { merged: "$done", stale: { to: "build", max: 3 } } },
  });
  const modern = wf({
    build: agent({ done: "push" }),
    push: { "open-pr": null, outcomes: { done: "ok" } },
    ok: { gate: "Approve?", outcomes: { approve: "merge", reject: "build" }, on: { stale: "build", unpushed: "push" } },
    merge: { "await-merge": null, outcomes: { merged: "$done" }, on: { stale: { to: "build", max: 3 } } },
  });

  test("compiles to the graph the old form under outcomes: gives, so a pinned revision decides the same", () => {
    const old = loaded(loadWorkflow(legacy, opts({ stepKinds: MERGE_KIND })));
    const now = loaded(loadWorkflow(modern, opts({ stepKinds: MERGE_KIND })));
    expect({ ...now.graph, hash: "" }).toEqual({ ...old.graph, hash: "" });
    expect(now.graph.steps.ok).toMatchObject({ outcomes: ["approve", "reject"], signals: [{ name: "stale" }, { name: "unpushed" }] });
    expect(countersOf(now)).toEqual({
      edges: { "ok.reject": "ok.reject", "ok.stale": "ok.stale", "ok.unpushed": "ok.unpushed", "merge.stale": "merge.stale" },
      counters: { "ok.reject": c(2), "ok.stale": c(10), "ok.unpushed": c(10), "merge.stale": c(3) },
    });
    // the old form's own document is pinned as it was written, so its hash does not move
    expect(old.pinned.doc.steps.ok).toEqual({ gate: "Approve?", outcomes: { approve: "merge", reject: { to: "build", counter: "ok.reject" }, unpushed: { to: "push", counter: "ok.unpushed" }, stale: { to: "build", counter: "ok.stale" } } });
  });

  test("the pinned document keeps the block apart, with its derived counters and the signal's parameters, and loads again to the same hash", () => {
    const doc = wf({
      build: agent({ done: "ok" }),
      ok: { gate: "Approve?", outcomes: { approve: "$done", reject: "build" }, on: { timeout: { after: "48h", to: "build" }, stale: "$stuck" } },
    });
    const w = loaded(loadWorkflow(doc, opts()));
    expect(w.pinned.doc.steps.ok as unknown).toEqual({
      gate: "Approve?",
      outcomes: { approve: "$done", reject: { to: "build", counter: "ok.reject" } },
      on: { timeout: { to: "build", counter: "ok.timeout", after: "48h" }, stale: "$stuck" },
    });
    expect(w.graph.steps.ok?.signals).toEqual([{ name: "timeout", params: { after: "48h" } }, { name: "stale" }]);
    expect(w.graph.counters["ok.timeout"]).toEqual(c(10));
    const again = loaded(loadWorkflow(w.pinned.doc, opts()));
    expect(again.pinned.hash).toBe(w.pinned.hash);
    expect(again.graph).toEqual(w.graph);
  });

  test("weighs signals in the block's order; the old form keeps the order the kernel always weighed them in", () => {
    const at = (ok: Record<string, unknown>) => loaded(loadWorkflow(wf({ build: agent({ done: "ok" }), ok: { gate: "Approve?", ...ok } }), opts())).graph.steps.ok?.signals;
    expect(at({ outcomes: { approve: "$done", reject: "build" }, on: { unpushed: "build", stale: "build" } })).toEqual([{ name: "unpushed" }, { name: "stale" }]);
    expect(at({ outcomes: { approve: "$done", reject: "build", unpushed: "build", stale: "build" } })).toEqual([{ name: "stale" }, { name: "unpushed" }]);
  });

  test("takes a signal a configured plugin declares, with the parameters it declares", () => {
    const signals = { "ci-failed": { name: "ci-failed", source: "forge", params: Type.Object({ checks: Type.Array(Type.String()) }, { additionalProperties: false }) } };
    const doc = wf({ build: agent({ done: "ok" }), ok: { gate: "Approve?", outcomes: { approve: "$done", reject: "build" }, on: { "ci-failed": { to: "build", checks: ["test"] } } } });
    expect(loaded(loadWorkflow(doc, opts({ signals }))).graph.steps.ok?.signals).toEqual([{ name: "ci-failed", params: { checks: ["test"] } }]);
    expect(errorsOf(loadWorkflow(doc, opts()))).toEqual([{ path: "/steps/ok/on/ci-failed", message: "`ci-failed` is not a signal the host or a configured plugin reports: add the plugin that provides it" }]);
  });

  test("a wait kind's own outcome that the host also reports routes once under on:, to the graph the old form gives", () => {
    const steps = (merge: Record<string, unknown>) => wf({ push: { "open-pr": null, outcomes: { done: "merge" } }, merge: { "await-merge": null, ...merge } });
    const now = loaded(loadWorkflow(steps({ outcomes: { merged: "$done" }, on: { stale: "$stuck", unpushed: "push" } }), opts()));
    const old = loaded(loadWorkflow(steps({ outcomes: { merged: "$done", stale: "$stuck", unpushed: "push" } }), opts()));
    expect(now.graph.steps.merge).toMatchObject({ outcomes: ["merged", "unpushed"], routes: { unpushed: { to: "push", counter: "merge.unpushed" } }, signals: [{ name: "stale" }, { name: "unpushed" }] });
    expect({ ...now.graph, hash: "" }).toEqual({ ...old.graph, hash: "" });
    // a name still sits in one block, and an outcome the kind declares is still routed somewhere
    expect(errorsOf(loadWorkflow(steps({ outcomes: { merged: "$done", unpushed: "push" }, on: { unpushed: "push" } }), opts()))).toEqual([
      { path: "/steps/merge/on/unpushed", message: "step 'merge' routes 'unpushed' under both outcomes and on: a name sits in one block" },
    ]);
    expect(errorsOf(loadWorkflow(steps({ outcomes: { merged: "$done" }, on: { stale: "$stuck" } }), opts()))).toEqual([
      { path: "/steps/merge/outcomes", message: "step 'merge' can end with 'unpushed' but routes it nowhere" },
    ]);
  });

  test("is refused on a step that runs rather than waits: an agent, a check, an effect step kind, slices", () => {
    const on = { on: { stale: "$stuck" } };
    const steps = {
      work: agent({ done: "test" }, on),
      test: { check: "bun test", timeout: "5m", outcomes: { pass: "push", fail: "$stuck" }, ...on },
      push: { "open-pr": null, outcomes: { done: "split" }, ...on },
      split: { slices: null, outcomes: { done: "$done", stuck: "$stuck" }, ...on },
    };
    expect(errorsOf(loadWorkflow(wf(steps), opts()))).toEqual([
      { path: "/steps/work/on", message: "`on` is only for a gate or a wait step, and step 'work' is a agent step" },
      { path: "/steps/test/on", message: "`on` is only for a gate or a wait step, and step 'test' is a check step" },
      { path: "/steps/push/on", message: "`on` is only for a gate or a wait step, and step 'push' is a open-pr (an effect) step" },
      { path: "/steps/split/on", message: "`on` is only for a gate or a wait step, and step 'split' is a slices step" },
    ]);
  });

  test("refuses a name in both blocks, a signal left under outcomes: beside an on: block, and parameters the signal does not take", () => {
    const at = (ok: Record<string, unknown>) => errorsOf(loadWorkflow(wf({ build: agent({ done: "ok" }), ok: { gate: "Approve?", ...ok } }), opts()));
    expect(at({ outcomes: { approve: "$done", reject: "build", stale: "build" }, on: { stale: "build" } })).toEqual([
      { path: "/steps/ok/outcomes/stale", message: "step 'ok' (gate) never ends with 'stale': 'stale' is a signal, routed under on:" },
      { path: "/steps/ok/on/stale", message: "step 'ok' routes 'stale' under both outcomes and on: a name sits in one block" },
    ]);
    expect(at({ outcomes: { approve: "$done", reject: "build", unpushed: "build" }, on: { stale: "build" } })).toEqual([
      { path: "/steps/ok/outcomes/unpushed", message: "step 'ok' (gate) never ends with 'unpushed': 'unpushed' is a signal, routed under on:" },
    ]);
    expect(at({ outcomes: { approve: "$done", reject: "build" }, on: { timeout: "build" } }).map((e) => e.path)).toEqual(["/steps/ok/on/timeout"]);
    expect(at({ outcomes: { approve: "$done", reject: "build" }, on: { stale: { to: "build", after: "1h" } } }).map((e) => e.path)).toEqual(["/steps/ok/on/stale"]);
    expect(at({ outcomes: { approve: "$done", reject: "build" }, on: { stale: "nowhere" } })).toEqual([{ path: "/steps/ok/on/stale", message: "ok.stale → 'nowhere', which is not a step, $done or $stuck" }]);
  });

  test("a shared file's waiting step leaves through an exit under on:, and the use step routes it", () => {
    const shared = {
      ship: { start: "ok", steps: { ok: { gate: "Approve?", outcomes: { approve: "$done", reject: { exit: "rejected" } }, on: { timeout: { exit: "late", after: "2d" } } } } },
    };
    const doc = wf({ build: agent({ done: "ship" }), ship: { use: "ship", outcomes: { rejected: "build", late: "build" } } });
    const w = loaded(loadWorkflow(doc, opts({ sharedFiles: shared })));
    expect(w.graph.steps.ok?.routes.timeout).toEqual({ to: "build", counter: "ship.late" });
    expect(w.graph.steps.ok?.signals).toEqual([{ name: "timeout", params: { after: "2d" } }]);
  });
});

describe("loading: copies, limits and hashes", () => {
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
