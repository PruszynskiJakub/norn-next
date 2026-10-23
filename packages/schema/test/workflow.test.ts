import { describe, expect, test } from "bun:test";
import { parse } from "yaml";
import { outcomeEdge, validateWorkflow } from "../src/index.ts";

/** PRD §11 slice workflow example, verbatim. */
export const SLICE_EXAMPLE = `
name: slice
start: implement
steps:
  implement:
    type: agent
    skill: implement
    outcomes: { done: { to: test, means: "every acceptance criterion (or rework point) has a passing test" } }
  test:
    type: check
    run: bun test
    timeout: 10m
    outcomes: { pass: review, fail: { to: implement, counter: test_loop } }
  review:
    type: agent
    skill: review
    outcomes:
      approve:           { to: qa, means: "all criteria met, no blocking findings" }
      changes_requested: { to: implement, counter: review_loop, means: "blocking findings in the receipt" }
  qa:
    type: agent
    skill: qa
    outcomes:
      pass:    { to: integrate, means: "every criterion verified with evidence" }
      fail:    { to: implement, counter: qa_loop, means: "a criterion fails; repro in the receipt" }
      partial: { to: human-qa, means: "criteria only a person can check are listed with prepared evidence" }
  human-qa:
    type: gate
    outcomes: { approve: integrate, reject: { to: implement, counter: qa_loop } }
  integrate:
    type: git
    action: integrate
    outcomes: { done: $done, conflict: { to: merge, counter: conflict_loop } }
  merge:
    type: agent
    skill: merge
    outcomes: { done: integrate }
counters: { test_loop: { max: 5 }, review_loop: { max: 3 }, qa_loop: { max: 2 }, conflict_loop: { max: 2 } }
`;

const example = () => parse(SLICE_EXAMPLE) as Record<string, any>;
const errorsOf = (v: unknown) => {
  const r = validateWorkflow(v);
  return r.ok ? [] : r.errors;
};

describe("workflow schema", () => {
  test("PRD §11 slice example validates", () => {
    const r = validateWorkflow(example());
    if (!r.ok) console.error(r.errors);
    expect(r.ok).toBe(true);
  });

  test("story workflow with every step type, inputs, limits and attended", () => {
    const wf = {
      name: "story",
      start: "refine",
      steps: {
        refine: {
          type: "agent",
          skill: "refine",
          attended: true,
          inputs: ["spec", "handoff"],
          outcomes: { done: "plan", questions: "clarify" },
        },
        clarify: { type: "agent", skill: "clarify", attended: true, outcomes: { done: "plan" } },
        plan: {
          type: "agent",
          skill: "plan",
          agent: "codex",
          model: "gpt-5",
          deadline: "1h30m",
          nudges: 2,
          retries: 1,
          instructions: "Keep it short.",
          inputs: ["spec", { file: "notes.md", label: "notes" }, "last_findings", "last_check"],
          outcomes: { done: "approve-plan", silent: "$stuck" },
        },
        "approve-plan": { type: "gate", prompt: "Approve the plan?", outcomes: { approve: "slices", reject: { to: "plan", counter: "plan_loop" } } },
        slices: { type: "slices", outcomes: { done: "open-pr", stuck: "$stuck" } },
        "open-pr": { type: "git", action: "open-pr", outcomes: { done: "ready" } },
        ready: { type: "gate", outcomes: { approve: "$done" } },
      },
      counters: { plan_loop: { max: 2 } },
    };
    expect(errorsOf(wf)).toEqual([]);
  });

  test.each([
    ["reserved step name", (w: any) => (w.steps.done = { type: "gate", outcomes: { approve: "$done" } })],
    ["step name starting with $", (w: any) => (w.steps.$x = { type: "gate", outcomes: { approve: "$done" } })],
    ["target is a reserved word", (w: any) => (w.steps.merge.outcomes.done = "stuck")],
    ["unknown reserved target", (w: any) => (w.steps.merge.outcomes.done = "$later")],
    ["check without timeout", (w: any) => delete w.steps.test.timeout],
    ["malformed duration", (w: any) => (w.steps.test.timeout = "10 minutes")],
    ["check outcome other than pass/fail", (w: any) => (w.steps.test.outcomes.flaky = "review")],
    ["gate outcome other than approve/reject", (w: any) => (w.steps["human-qa"].outcomes.answer = "qa")],
    ["git outcome other than done/conflict", (w: any) => (w.steps.integrate.outcomes.ok = "$done")],
    ["unknown git action", (w: any) => (w.steps.integrate.action = "merge")],
    ["unknown step type", (w: any) => (w.steps.merge.type = "script")],
    ["agent without skill", (w: any) => delete w.steps.merge.skill],
    ["agent with no outcomes", (w: any) => (w.steps.merge.outcomes = {})],
    ["unknown step property", (w: any) => (w.steps.merge.when = "x")],
    ["edge with unknown property", (w: any) => (w.steps.merge.outcomes.done = { to: "integrate", when: "x" })],
    ["edge without to", (w: any) => (w.steps.merge.outcomes.done = { counter: "x" })],
    ["counter max 0", (w: any) => (w.counters.test_loop.max = 0)],
    ["unknown input kind", (w: any) => (w.steps.implement.inputs = ["everything"])],
    ["negative nudges", (w: any) => (w.steps.implement.nudges = -1)],
    ["missing start", (w: any) => delete w.start],
    ["unknown top-level property", (w: any) => (w.lifecycle = "story")],
  ])("rejects: %s", (_name, mutate) => {
    const wf = example();
    mutate(wf);
    expect(errorsOf(wf).length).toBeGreaterThan(0);
  });

  test("errors carry a JSON pointer to the offending field", () => {
    const wf = example();
    wf.steps.test.timeout = "soon";
    expect(errorsOf(wf)).toContainEqual(expect.objectContaining({ path: "/steps/test/timeout" }));
  });

  test("outcomeEdge normalizes bare targets", () => {
    expect(outcomeEdge("review")).toEqual({ to: "review" });
    expect(outcomeEdge({ to: "implement", counter: "c" })).toEqual({ to: "implement", counter: "c" });
  });
});
