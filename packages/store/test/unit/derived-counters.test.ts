import { describe, expect, test } from "bun:test";
import { validateWorkflowDefinition } from "@norn/core";
import type { CounterSpec, Workflow } from "@norn/schema";
import { loadWorkflowText, sha256 } from "../../src/index.ts";

/** A workflow file's text loaded the way the listing loads it, from the main checkout. */
const load = (text: string) => loadWorkflowText("w", text, "/repo/.agents/workflows/w.yaml", "checkout", "/repo");

const loaded = (text: string) => {
  const r = load(text);
  if (!r.ok) throw new Error(JSON.stringify(r));
  return r.value;
};

/** The refusal's errors, each as `<pointer> <message>`. */
const refusal = (text: string): string[] => {
  const r = load(text);
  if (r.ok || r.reason !== "corrupt") throw new Error(`expected a refusal, got ${JSON.stringify(r)}`);
  return r.error.errors.map((e) => `${e.path} ${e.message}`);
};

/** Each counted edge `<step>.<outcome>` → its counter's name and spec, as the pinned workflow holds them. */
function counting(wf: Workflow): Record<string, { counter: string } & CounterSpec> {
  const out: Record<string, { counter: string } & CounterSpec> = {};
  for (const [step, s] of Object.entries(wf.steps))
    for (const [outcome, route] of Object.entries(s.outcomes as Record<string, unknown>)) {
      const counter = typeof route === "object" && route !== null ? (route as { counter?: string }).counter : undefined;
      if (counter) out[`${step}.${outcome}`] = { counter, ...(wf.counters?.[counter] as CounterSpec) };
    }
  return out;
}

/** A workflow of `steps`; each agent step's outcomes get the `means:` an agent's report needs, so a fixture shows only its routes. */
const workflow = (steps: string, counters = "") => `name: w
start: implement
steps:
${steps.replace(/( {4}agent: .*\n {4}outcomes: \{ (.*) \}\n)/g, (all, _m, routes: string) => `${all}    means: { ${routes.split(", ").map((r) => `${r.split(":")[0]}: it says so`).join(", ")} }\n`)}${counters}`;

const IMPLEMENT = `  implement:
    agent: Build it.
    outcomes: { done: test }
`;

describe("a counter derived per edge at load", () => {
  test("a check's fail, and an outcome its exits map names, count at 5 with no reset; stale on a check counts at 10", () => {
    const wf = loaded(
      workflow(`${IMPLEMENT}  test:
    check: bun test
    timeout: 5m
    exits: { "3": flaky, "4": stale }
    outcomes: { pass: $done, fail: implement, flaky: implement, stale: implement }
`),
    );
    expect(counting(wf.workflow)).toEqual({
      "test.fail": { counter: "test.fail", max: 5 },
      "test.flaky": { counter: "test.flaky", max: 5 },
      "test.stale": { counter: "test.stale", max: 10 },
    });
    expect(validateWorkflowDefinition(wf.workflow).issues).toEqual([]);
  });

  test("a gate's reject counts at 2, a conflict at 2 resetting on the step's other outcomes, stale on a gate and a merge step at 10", () => {
    const wf = loaded(
      workflow(`${IMPLEMENT.replace("done: test", "done: update")}  update:
    update-branch:
    outcomes: { done: ready, conflict: implement, clean: ready }
  ready:
    gate: Ship it?
    outcomes: { approve: merge, reject: implement, stale: update }
  merge:
    await-merge:
    outcomes: { stale: update }
  integrate:
    integrate:
    outcomes: { done: $done, conflict: implement }
`),
    );
    expect(counting(wf.workflow)).toEqual({
      "update.conflict": { counter: "update.conflict", max: 2, reset_on: ["update.done", "update.clean"] },
      "ready.reject": { counter: "ready.reject", max: 2 },
      "ready.stale": { counter: "ready.stale", max: 10 },
      "merge.stale": { counter: "merge.stale", max: 10 },
      "integrate.conflict": { counter: "integrate.conflict", max: 2, reset_on: "integrate.done" },
    });
  });

  test("an agent's send-back on a loop nothing else counts counts at 3; forward edges and an agent outcome on no uncounted loop get none", () => {
    const wf = loaded(
      workflow(`  implement:
    agent: Build it.
    outcomes: { done: review, blocked: triage }
  triage:
    agent: Look at it.
    outcomes: { done: $done }
  review:
    agent: Review it.
    outcomes: { approve: qa, changes_requested: implement, pass: $done }
  qa:
    gate: QA it?
    outcomes: { approve: $done, reject: fix }
  fix:
    agent: Fix it.
    outcomes: { done: qa, rethink: fixed }
  fixed:
    agent: Recheck.
    outcomes: { done: $done, again: fix }
`),
    );
    // fix ⇄ fixed is a loop of agent send-backs only: both count. qa.reject → fix → qa is counted by the reject.
    expect(counting(wf.workflow)).toEqual({
      "review.changes_requested": { counter: "review.changes_requested", max: 3 },
      "qa.reject": { counter: "qa.reject", max: 2 },
      "fix.rethink": { counter: "fix.rethink", max: 3 },
      "fixed.again": { counter: "fixed.again", max: 3 },
    });
  });

  test("max: on a deriving edge replaces only its max; on an edge that derives nothing it counts that edge with no reset", () => {
    const wf = loaded(
      workflow(`${IMPLEMENT}  test:
    check: bun test
    timeout: 5m
    outcomes: { pass: update, fail: { to: implement, max: 3 } }
  update:
    update-branch:
    outcomes: { done: ready, conflict: { to: implement, max: 4 } }
  ready:
    gate: Ship it?
    outcomes: { approve: { to: implement, max: 4 }, reject: $done }
`),
    );
    expect(counting(wf.workflow)).toEqual({
      "test.fail": { counter: "test.fail", max: 3 },
      "update.conflict": { counter: "update.conflict", max: 4, reset_on: "update.done" },
      "ready.approve": { counter: "ready.approve", max: 4 },
    });
    expect(JSON.stringify(wf.workflow)).not.toContain('"max":3,');
  });

  test("max: together with counter: on one edge is refused at that edge", () => {
    expect(
      refusal(
        workflow(
          `${IMPLEMENT}  test:
    check: bun test
    timeout: 5m
    outcomes: { pass: $done, fail: { to: implement, counter: test_loop, max: 3 } }
`,
          "counters: { test_loop: { max: 5 } }\n",
        ),
      ),
    ).toEqual(["/steps/test/outcomes/fail `test.fail` sets both max and counter: a named counter's max goes under counters"]);
  });

  test("max: on an edge to $done or $stuck is refused: there is no loop to bound", () => {
    expect(
      refusal(
        workflow(`${IMPLEMENT}  test:
    check: bun test
    timeout: 5m
    outcomes: { pass: { to: $done, max: 2 }, fail: { to: $stuck, max: 1 } }
`),
      ),
    ).toEqual([
      "/steps/test/outcomes/pass `test.pass` → `$done` sets max, but there is no loop to bound",
      "/steps/test/outcomes/fail `test.fail` → `$stuck` sets max, but there is no loop to bound",
    ]);
  });

  test("named counters work as today: edges naming one keep it, derive nothing, and its reset_on stays", () => {
    const text = workflow(
      `${IMPLEMENT}  test:
    check: bun test
    timeout: 5m
    outcomes: { pass: qa, fail: { to: implement, counter: qa_loop } }
  qa:
    gate: QA it?
    outcomes: { approve: $done, reject: { to: implement, counter: qa_loop } }
`,
      "counters: { qa_loop: { max: 2, reset_on: implement.done } }\n",
    );
    const wf = loaded(text);
    expect(counting(wf.workflow)).toEqual({
      "test.fail": { counter: "qa_loop", max: 2, reset_on: "implement.done" },
      "qa.reject": { counter: "qa_loop", max: 2, reset_on: "implement.done" },
    });
    expect(Object.keys(wf.workflow.counters ?? {})).toEqual(["qa_loop"]);
  });

  test("a dotted name under counters, or on counter: with no such declared counter, is refused", () => {
    const steps = `${IMPLEMENT}  test:
    check: bun test
    timeout: 5m
    outcomes: { pass: $done, fail: { to: implement, counter: test.fail } }
`;
    expect(refusal(workflow(steps, "counters: { test.fail: { max: 5 } }\n"))).toEqual([
      "/counters/test.fail counter name 'test.fail' is not a valid name: a dotted name is derived from its edge, never declared",
    ]);
    expect(refusal(workflow(steps))).toEqual(["/steps/test/outcomes/fail counter 'test.fail' is not declared in counters"]);
  });

  test("a dotted step or outcome name in a file is refused as corrupt, never thrown, and derives nothing", () => {
    const dottedStep = workflow(`  implement:
    agent: Build it.
    outcomes: { done: a.b }
  a.b:
    check: bun test
    timeout: 5m
    outcomes: { pass: $done, fail: implement }
`);
    expect(refusal(dottedStep)).toContain("/steps unknown property 'a.b'");
    expect(refusal(dottedStep).join("\n")).not.toContain("a.b.fail");
    const dottedOutcome = workflow(`${IMPLEMENT}  test:
    check: bun test
    timeout: 5m
    exits: { "3": x.y }
    outcomes: { pass: $done, fail: implement, x.y: implement }
`);
    expect(refusal(dottedOutcome).join("\n")).not.toContain("test.x.y");
  });

  test("a counters: that is not a map is refused as corrupt whether or not the workflow derives a counter", () => {
    for (const bad of ["hello", "null", "[1]"]) {
      const deriving = workflow(`${IMPLEMENT}  test:
    check: bun test
    timeout: 5m
    outcomes: { pass: $done, fail: implement }
`, `counters: ${bad}\n`);
      expect(refusal(deriving)).toContain("/counters must be object");
    }
  });

  test("steps sharing one outcomes map through a YAML alias each count their own edge", () => {
    const wf = loaded(`name: w
start: a
steps:
  a:
    check: x
    timeout: 5m
    outcomes: &o { pass: $done, fail: b }
  b:
    check: y
    timeout: 5m
    outcomes: *o
`);
    expect(counting(wf.workflow)).toEqual({
      "a.fail": { counter: "a.fail", max: 5 },
      "b.fail": { counter: "b.fail", max: 5 },
    });
  });

  test("a loop no edge counts even after derivation is refused as a cycle without a counter", () => {
    const wf = loaded(
      workflow(`  implement:
    agent: Build it.
    outcomes: { done: review }
  review:
    agent: Review it.
    outcomes: { done: implement, pass: test }
  test:
    check: bun test
    timeout: 5m
    outcomes: { pass: $done, fail: implement }
`),
    );
    const issues = validateWorkflowDefinition(wf.workflow).issues;
    expect(issues.map((i) => [i.code, i.message])).toEqual([["uncounted_cycle", "cycle without a counter: implement.done → review.done → implement"]]);
  });

  test("a workflow that derives nothing keeps its pinned text byte for byte; one that derives is pinned as the derived text", () => {
    const counted = workflow(
      `${IMPLEMENT}  test:
    check: bun test   # the test tier
    timeout: 5m
    outcomes: { pass: $done, fail: { to: implement, counter: test_loop } }
`,
      "counters: { test_loop: { max: 5 } }\n",
    );
    const kept = loaded(counted);
    expect(kept.source).toBe(counted);
    expect(kept.hash).toBe(sha256(counted));

    const deriving = counted.replace("{ to: implement, counter: test_loop }", "implement").replace("counters: { test_loop: { max: 5 } }\n", "");
    const derived = loaded(deriving);
    expect(derived.source).not.toBe(deriving);
    expect(derived.hash).toBe(sha256(derived.source));
    expect(derived.source).toContain("counter: test.fail");
    expect(derived.workflow.counters).toEqual({ "test.fail": { max: 5 } });
  });
});

/** A workflow text with shared files (by name, without `.yaml`), loaded the way the listing loads it. */
const loadUsing = (text: string, shared: Record<string, string>) =>
  loadWorkflowText("w", text, "/repo/.agents/workflows/w.yaml", "checkout", "/repo", (n) => shared[n] ?? null);
const loadedUsing = (text: string, shared: Record<string, string>) => {
  const r = loadUsing(text, shared);
  if (!r.ok) throw new Error(JSON.stringify(r));
  return r.value;
};
const refusalUsing = (text: string, shared: Record<string, string>): string[] => {
  const r = loadUsing(text, shared);
  if (r.ok || r.reason !== "corrupt") throw new Error(`expected a refusal, got ${JSON.stringify(r)}`);
  return r.error.errors.map((e) => `${e.path} ${e.message}`);
};

/** A workflow whose `implement` hands to use step `use`, which brings in shared file `file` and routes its exits by `routes`. */
const using = (use: string, file: string, routes: string) => `name: w
start: implement
steps:
  implement:
    agent: Build it.
    outcomes: { done: ${use} }
    means: { done: built }
  ${use}:
    use: ${file}
    outcomes: { ${routes} }
`;

// three test steps leaving through one exit, as the shipped base update does
const BASE_UPDATE = `start: update
steps:
  update:
    update-branch:
    outcomes: { done: test, clean: test-merge, resolved: test-resolution }
  test:
    check: bun test
    timeout: 5m
    outcomes: { pass: { exit: tested }, fail: { exit: broken } }
  test-merge:
    check: bun test
    timeout: 5m
    outcomes: { pass: { exit: tested }, fail: { exit: broken } }
  test-resolution:
    check: bun test
    timeout: 5m
    outcomes: { pass: { exit: tested }, fail: { exit: broken } }
`;

/** A shared gate whose `back` exit is fed by the outcome `feeder`. */
const GATE_BACK = (feeder: string) => `start: ready
steps:
  ready:
    gate: Ship it?
    outcomes: { approve: { exit: ok }, ${feeder}: { exit: back } }
`;

// a check's fail and a gate's reject behind one exit
const MIXED = `start: test
steps:
  test:
    check: bun test
    timeout: 5m
    outcomes: { pass: ready, fail: { exit: broken } }
  ready:
    gate: Ship it?
    outcomes: { approve: { exit: ok }, reject: { exit: broken } }
`;

describe("one counter per shared-file exit", () => {
  test("three check fail edges leaving through one exit share the counter `<use step>.<exit>` at 5", () => {
    const wf = loadedUsing(using("base-update", "base-update", "tested: $done, broken: implement"), { "base-update": BASE_UPDATE });
    expect(counting(wf.workflow)).toEqual({
      "test.fail": { counter: "base-update.broken", max: 5 },
      "test-merge.fail": { counter: "base-update.broken", max: 5 },
      "test-resolution.fail": { counter: "base-update.broken", max: 5 },
    });
    expect(wf.workflow.counters).toEqual({ "base-update.broken": { max: 5 } });
    expect(validateWorkflowDefinition(wf.workflow).issues).toEqual([]);
  });

  test("an exit fed only by a gate's reject counts at 2, only by stale at 10; max: on the use route overrides it", () => {
    const route = "ok: $done, back: implement";
    expect(counting(loadedUsing(using("ship", "gate", route), { gate: GATE_BACK("reject") }).workflow)).toEqual({ "ready.reject": { counter: "ship.back", max: 2 } });
    expect(counting(loadedUsing(using("ship", "gate", route), { gate: GATE_BACK("stale") }).workflow)).toEqual({ "ready.stale": { counter: "ship.back", max: 10 } });
    const overridden = loadedUsing(using("ship", "gate", "ok: $done, back: { to: implement, max: 3 }"), { gate: GATE_BACK("reject") });
    expect(counting(overridden.workflow)).toEqual({ "ready.reject": { counter: "ship.back", max: 3 } });
    expect(overridden.source).not.toContain("max: 3\n      ");
  });

  test("a feeder that derives nothing stays uncounted; a use route to $done or $stuck derives nothing", () => {
    const shared = `start: test
steps:
  test:
    check: bun test
    timeout: 5m
    outcomes: { pass: fix, fail: { exit: broken } }
  fix:
    agent: Fix it.
    outcomes: { done: { exit: broken } }
    means: { done: fixed }
`;
    expect(counting(loadedUsing(using("base", "s", "broken: implement"), { s: shared }).workflow)).toEqual({ "test.fail": { counter: "base.broken", max: 5 } });
    for (const end of ["$done", "$stuck"])
      expect(counting(loadedUsing(using("base", "s", `broken: ${end}`), { s: shared }).workflow)).toEqual({});
  });

  test("max: on a use route to $done is refused at that route: there is no loop to bound", () => {
    expect(refusalUsing(using("ship", "gate", "ok: $done, back: { to: $done, max: 3 }"), { gate: GATE_BACK("reject") })).toEqual([
      "/steps/ship/outcomes/back `ship.back` → `$done` sets max, but there is no loop to bound",
    ]);
  });

  test("an exit fed by conflict edges counts at 2 and resets on every other outcome of every feeder step", () => {
    const shared = `start: update
steps:
  update:
    update-branch:
    outcomes: { done: again, clean: again, conflict: { exit: clash } }
  again:
    update-branch:
    outcomes: { done: { exit: ok }, conflict: { exit: clash } }
`;
    const wf = loadedUsing(using("base", "s", "ok: $done, clash: implement"), { s: shared });
    const spec = { counter: "base.clash", max: 2, reset_on: ["update.done", "update.clean", "again.done"] };
    expect(counting(wf.workflow)).toEqual({ "update.conflict": spec, "again.conflict": spec });
  });

  test("an exit fed by edges of different kinds is refused at the use route without max:, and shares max: with no reset when given", () => {
    expect(refusalUsing(using("base", "mixed", "ok: $done, broken: implement"), { mixed: MIXED })).toEqual([
      "/steps/base/outcomes/broken shared/mixed.yaml: exit `broken` of `base` is fed by edges of different kinds (check fail: `test.fail`; gate reject: `ready.reject`): give max: on `base`'s route",
    ]);
    const wf = loadedUsing(using("base", "mixed", "ok: $done, broken: { to: implement, max: 4 }"), { mixed: MIXED });
    expect(counting(wf.workflow)).toEqual({
      "test.fail": { counter: "base.broken", max: 4 },
      "ready.reject": { counter: "base.broken", max: 4 },
    });
  });
});
