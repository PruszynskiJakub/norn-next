/**
 * Counters derived from their edge, through `norn doctor`: a workflow that writes no counter for its
 * ordinary loops passes, and each `max:` the loader refuses is reported with the edge it is about.
 */
import { afterAll, beforeAll, describe, expect, setDefaultTimeout, test } from "bun:test";
import { join } from "node:path";
import { workflowsDir } from "@norn/store";
import { createHarness, type Harness } from "../../../../test/support/harness.ts";

setDefaultTimeout(30_000);

/** Every loop bounded by its default: a check's fail, a review's send-back, a gate's reject. */
const DEFAULTS = `name: defaults
start: implement
steps:
  implement:
    agent: Use the \`norn-implement\` skill.
    skills: [norn-implement]
    outcomes: { done: test }
    means: { done: "built" }
  test:
    check: bun test
    timeout: 5m
    outcomes: { pass: review, fail: implement }
  review:
    agent: Use the \`norn-review\` skill.
    skills: [norn-review]
    outcomes: { approve: qa, changes_requested: implement }
    means: { approve: "good", changes_requested: "rework" }
  qa:
    gate: Ship it?
    outcomes: { approve: $done, reject: { to: implement, max: 3 } }
`;
const BOTH = DEFAULTS.replace("name: defaults", "name: both")
  .replace("fail: implement }", "fail: { to: implement, counter: test_loop, max: 3 } }")
  .concat("counters: { test_loop: { max: 5 } }\n");
const TO_DONE = DEFAULTS.replace("name: defaults", "name: todone").replace("approve: $done,", "approve: { to: $done, max: 2 },");

type DoctorWorkflow = { name: string; ok: boolean; issues: Array<{ path: string; message: string }> };

describe("norn doctor over counters derived from their edge", () => {
  let t: Harness;
  let workflows: DoctorWorkflow[];
  const byName = (name: string) => workflows.find((w) => w.name === name);
  beforeAll(async () => {
    t = await createHarness();
    expect((await t.norn("init")).exit).toBe(0);
    t.config("provider: gh\nworkflow: defaults\nmode: auto\n");
    t.recordVersion();
    for (const [file, text] of Object.entries({ "defaults.yaml": DEFAULTS, "both.yaml": BOTH, "todone.yaml": TO_DONE })) t.write(join(workflowsDir(t.root), file), text);
    const r = await t.norn("doctor", "--repo", "--json");
    workflows = (r.value as { repo: { workflows: DoctorWorkflow[] } }).repo.workflows;
  });
  afterAll(() => t.cleanup());

  test("a workflow that leaves every default unwritten passes", () => {
    expect(byName("defaults")).toMatchObject({ ok: true, issues: [] });
  });

  test("max: beside counter: on one edge is reported at that edge", () => {
    expect(byName("both")?.ok).toBe(false);
    expect(byName("both")?.issues).toEqual([
      expect.objectContaining({ path: "/steps/test/outcomes/fail", message: expect.stringContaining("`test.fail` sets both max and counter: a named counter's max goes under counters") }),
    ]);
  });

  test("max: on an edge to $done is reported at that edge", () => {
    expect(byName("todone")?.ok).toBe(false);
    expect(byName("todone")?.issues).toEqual([
      expect.objectContaining({ path: "/steps/qa/outcomes/approve", message: expect.stringContaining("`qa.approve` → `$done` sets max, but there is no loop to bound") }),
    ]);
  });
});
