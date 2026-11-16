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
