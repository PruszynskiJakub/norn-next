import { describe, expect, test } from "bun:test";
import { parse } from "yaml";
import { outcomeEdge, toJsonSchema, validate } from "../../src/index.ts";

/** §11 slice workflow example of the rules, as a file writes it: one head key per step. */
export const SLICE_EXAMPLE = `
name: slice
start: implement
steps:
  implement:
    agent: Build the slice test-first.
    skills: [implement]
    outcomes: { done: test }
    means: { done: "every acceptance criterion (or rework point) has a passing test" }
  test:
    check: bun test
    timeout: 10m
    outcomes: { pass: review, fail: { to: implement, counter: test_loop } }
  review:
    agent: Review the slice.
    skills: [review]
    outcomes:
      approve:           qa
      changes_requested: { to: implement, counter: review_loop }
    means:
      approve: "all criteria met, no blocking findings"
      changes_requested: "blocking findings in the receipt"
  qa:
    agent: Check every criterion from the user's side.
    skills: [qa]
    criteria: required
    outcomes:
      pass:    integrate
      fail:    { to: implement, counter: qa_loop }
      partial: human-qa
    means:
      pass: "every criterion verified with evidence"
      fail: "a criterion fails; repro in the receipt"
      partial: "criteria only a person can check are listed with prepared evidence"
    verdict: { pass: pass, fail: fail, partial: person }
  human-qa:
    gate: Approve the slice's QA?
    outcomes: { approve: integrate, reject: { to: implement, counter: qa_loop } }
  integrate:
    integrate:
    outcomes: { done: $done, conflict: { to: merge, counter: conflict_loop } }
  merge:
    agent: Resolve the conflicts.
    skills: [merge]
    outcomes: { done: integrate }
    means: { done: "conflicts resolved" }
counters: { test_loop: { max: 5 }, review_loop: { max: 3 }, qa_loop: { max: 2 }, conflict_loop: { max: 2 } }
`;

const example = () => parse(SLICE_EXAMPLE) as Record<string, any>;
const errorsOf = (v: unknown) => {
  const r = validate("workflow-source", v);
  return r.ok ? [] : r.errors;
};
const modelErrorsOf = (v: unknown) => {
  const r = validate("workflow", v);
  return r.ok ? [] : r.errors;
};

describe("workflow schema", () => {
  test("§11 slice example of the rules validates", () => {
    const r = validate("workflow-source", example());
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
          instructions: "Refine the story with the person.",
          skills: ["refine"],
          attended: true,
          inputs: ["spec", "handoff"],
          outcomes: { done: "plan", questions: "clarify" },
        },
        clarify: { type: "agent", instructions: "Settle the open questions.", skills: ["clarify", "norn-interview"], attended: true, outcomes: { done: "plan" } },
        plan: {
          type: "agent",
          skills: ["plan"],
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
        ready: { type: "gate", prompt: "approve or reject ready", outcomes: { approve: "$done" } },
      },
      counters: { plan_loop: { max: 2 } },
    };
    expect(modelErrorsOf(wf)).toEqual([]);
  });

  test("a loaded agent step holds a list of skills, maybe none; a single `skill` is the file's wording, not the model's", () => {
    const wf = (step: Record<string, unknown>) => ({ name: "x", start: "a", steps: { a: { type: "agent", instructions: "do it", ...step, outcomes: { done: "$done" } } } });
    expect(modelErrorsOf(wf({}))).toEqual([]);
    expect(modelErrorsOf(wf({ skills: [] }))).toEqual([]);
    expect(modelErrorsOf(wf({ skills: ["a", "b", "c"] }))).toEqual([]);
    expect(modelErrorsOf(wf({ skills: ["a", "a"] })).length).toBeGreaterThan(0);
    expect(modelErrorsOf(wf({ skills: [""] })).length).toBeGreaterThan(0);
    expect(modelErrorsOf(wf({ skill: "a" })).length).toBeGreaterThan(0);
  });

  test("a loaded agent step needs its orientation and a gate the decision it shows", () => {
    expect(modelErrorsOf({ name: "x", start: "a", steps: { a: { type: "agent", outcomes: { done: "$done" } } } })).toEqual([{ path: "/steps/a", message: "must have required property 'instructions'" }]);
    expect(modelErrorsOf({ name: "x", start: "a", steps: { a: { type: "gate", outcomes: { approve: "$done" } } } })).toEqual([{ path: "/steps/a", message: "must have required property 'prompt'" }]);
  });

  test.each([
    ["reserved step name", (w: any) => (w.steps.done = { type: "gate", outcomes: { approve: "$done" } })],
    ["step name starting with $", (w: any) => (w.steps.$x = { type: "gate", outcomes: { approve: "$done" } })],
    ["target is a reserved word", (w: any) => (w.steps.merge.outcomes.done = "stuck")],
    ["unknown reserved target", (w: any) => (w.steps.merge.outcomes.done = "$later")],
    ["check without timeout", (w: any) => delete w.steps.test.timeout],
    ["malformed duration", (w: any) => (w.steps.test.timeout = "10 minutes")],
    ["check exit code 0", (w: any) => (w.steps.test.exits = { 0: "flaky" })],
    ["check exit code above 255", (w: any) => (w.steps.test.exits = { 256: "flaky" })],
    ["check exit code not a number", (w: any) => (w.steps.test.exits = { x: "flaky" })],
    ["check exit naming a malformed outcome", (w: any) => (w.steps.test.exits = { 3: "Flaky!" })],
    ["gate outcome other than approve/reject", (w: any) => (w.steps["human-qa"].outcomes.answer = "qa")],
    ["integrate outcome other than done/conflict", (w: any) => (w.steps.integrate.outcomes.clean = "$done")],
    ["a verb given a value", (w: any) => (w.steps.integrate.integrate = "now")],
    ["unknown head key", (w: any) => (w.steps.merge = { script: "x", outcomes: { done: "integrate" } })],
    ["agent without orientation", (w: any) => delete w.steps.merge.agent],
    ["agent with an empty orientation", (w: any) => (w.steps.merge.agent = " ")],
    ["two head keys", (w: any) => (w.steps.merge.check = "bun test")],
    ["a skill named twice", (w: any) => (w.steps.merge.skills = ["merge", "merge"])],
    ["a meaning inside a route", (w: any) => (w.steps.merge.outcomes.done = { to: "integrate", means: "x" })],
    ["a verdict inside a route", (w: any) => (w.steps.qa.outcomes.pass = { to: "integrate", verdict: "pass" })],
    ["means on a check", (w: any) => (w.steps.test.means = { pass: "green" })],
    ["a verdict that is not one", (w: any) => (w.steps.qa.verdict.pass = "great")],
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

  test("a check may declare outcomes by exit code beside pass and fail", () => {
    const wf = example();
    wf.steps.test.exits = { 3: "stale" };
    wf.steps.test.outcomes.stale = "implement";
    expect(errorsOf(wf)).toEqual([]);
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

describe("workflow-source and workflow-shared schemas", () => {
  const gate = { gate: "Approve?", outcomes: { approve: "$done" } };
  test("a workflow file as written may hold a `use` step; the strict workflow schema refuses it", () => {
    const wf = { name: "story", start: "review", steps: { review: gate, base: { use: "base-update", outcomes: { tested: "review", broken: { to: "review", counter: "loop" } } } } };
    expect(validate("workflow-source", wf).ok).toBe(true);
    expect(validate("workflow", wf).ok).toBe(false);
    expect(validate("workflow-source", { ...wf, steps: { ...wf.steps, base: { use: "base-update", skills: ["x"] } } }).ok).toBe(false);
  });
  test("an agent step's produces: and writes: validate as a file writes them, closed", () => {
    const wf = (review: Record<string, unknown>) => ({ name: "t", start: "review", steps: { review: { agent: "Review it.", outcomes: { done: "$done" }, ...review } } });
    expect(validate("workflow-source", wf({ writes: "docs", produces: { notes: { file: "notes.md" }, pr_body: { file: "pr.md", on: ["done"] } } })).ok).toBe(true);
    for (const bad of [{ produces: {} }, { produces: { notes: { file: "" } } }, { produces: { notes: { file: "n.md", extra: 1 } } }, { produces: { notes: { file: "n.md", on: [] } } }, { writes: "all" }])
      expect({ bad, ok: validate("workflow-source", wf(bad)).ok }).toEqual({ bad, ok: false });
  });
  test("a shared file holds start, steps and a description, and its routes may leave through an exit", () => {
    const shared = { description: "d", start: "test", steps: { test: { check: "bun test", timeout: "5m", outcomes: { pass: { exit: "tested" }, fail: "$stuck" } } } };
    expect(validate("workflow-shared", shared).ok).toBe(true);
    for (const key of ["name", "counters", "defaults", "mode", "base"]) expect(validate("workflow-shared", { ...shared, [key]: {} }).ok).toBe(false);
    expect(validate("workflow", { name: "x", ...shared }).ok).toBe(false);
  });

  /** One step of each head key, as a file writes it. */
  const ONE_OF_EACH: Record<string, Record<string, unknown>> = {
    agent: { agent: "Do the work.", skills: ["a"], by: "codex", outcomes: { done: "$done" }, means: { done: "the work is done" } },
    check: { check: "bun test", timeout: "5m", outcomes: { pass: "$done" } },
    gate: { gate: "Approve the work?", outcomes: { approve: "$done" } },
    "update-branch": { "update-branch": null, outcomes: { done: "$done", clean: "$done", resolved: "$done" } },
    "open-pr": { "open-pr": null, outcomes: { done: "$done" } },
    integrate: { integrate: null, outcomes: { done: "$done" } },
    push: { push: null, outcomes: { done: "$done" } },
    "await-merge": { "await-merge": null, outcomes: { stale: "$done" } },
    slices: { slices: null, outcomes: { done: "$done" } },
  };
  const source = (step: unknown) => ({ name: "x", start: "a", steps: { a: step } });
  const shared = (step: unknown) => ({ start: "a", steps: { a: step } });

  test("each schema has one step shape per head key, besides `use` and `like`", () => {
    const shapes = (name: "workflow-source" | "workflow-shared") => {
      const steps = (toJsonSchema(name) as any).properties.steps.patternProperties;
      const union = (Object.values(steps)[0] as { anyOf: Array<{ properties: Record<string, unknown>; required?: string[] }> }).anyOf;
      return union.map((v) => (v.required ?? []).filter((k) => k in ONE_OF_EACH || k === "use" || k === "like"));
    };
    const expected = [...Object.keys(ONE_OF_EACH).map((k) => [k]), ["like"]];
    expect(shapes("workflow-source")).toEqual([...expected.slice(0, -1), ["use"], ["like"]]);
    expect(shapes("workflow-shared")).toEqual(expected);
    for (const [head, step] of Object.entries(ONE_OF_EACH)) {
      expect({ head, source: errorsOf(source(step)), shared: validate("workflow-shared", shared(step)).ok }).toEqual({ head, source: [], shared: true });
    }
  });

  test.each([
    ["type", { type: "check" }],
    ["skill", { skill: "a" }],
    ["instructions", { instructions: "Do it." }],
    ["run", { run: "bun test" }],
    ["prompt", { prompt: "Approve?" }],
    ["action", { action: "open-pr" }],
  ])("neither schema accepts the old key `%s` on any step", (_key, extra) => {
    for (const step of Object.values(ONE_OF_EACH)) {
      expect(validate("workflow-source", source({ ...step, ...extra })).ok).toBe(false);
      expect(validate("workflow-shared", shared({ ...step, ...extra })).ok).toBe(false);
      expect(validate("workflow-source", source({ like: "b", ...extra })).ok).toBe(false);
    }
  });

  test("neither schema accepts a meaning or verdict inside a route, nor a step in the old wording", () => {
    const routed = { agent: "Do it.", outcomes: { done: { to: "$done", means: "done" } } };
    const judged = { agent: "Do it.", outcomes: { done: { to: "$done", verdict: "pass" } }, means: { done: "done" } };
    const exitMeans = { check: "bun test", timeout: "5m", outcomes: { pass: { exit: "tested", means: "green" } } };
    for (const step of [routed, judged]) expect(validate("workflow-source", source(step)).ok).toBe(false);
    expect(validate("workflow-shared", shared(exitMeans)).ok).toBe(false);
    const old = { type: "agent", skill: "a", instructions: "Do it.", outcomes: { done: { to: "$done", means: "done" } } };
    expect(validate("workflow-source", source(old)).ok).toBe(false);
    expect(validate("workflow-shared", shared(old)).ok).toBe(false);
  });
});

describe("like steps in the workflow-source and workflow-shared schemas", () => {
  const check = { check: "bun test", timeout: "5m", outcomes: { pass: "$done" } };
  test("a like step holds the known step keys loosely; an unknown key is refused; the strict schema refuses it", () => {
    const wf = { name: "story", start: "test", steps: { test: check, "test-merge": { like: "test", check: "bun test --again", outcomes: { pass: "test" } } } };
    expect(validate("workflow-source", wf).ok).toBe(true);
    expect(validate("workflow", wf).ok).toBe(false);
    expect(validate("workflow-source", { ...wf, steps: { ...wf.steps, "test-merge": { like: "test", runn: "x" } } }).ok).toBe(false);
    const shared = { start: "test", steps: { test: check, retest: { like: "test", outcomes: { pass: { exit: "tested" } } } } };
    expect(validate("workflow-shared", shared).ok).toBe(true);
  });
});

describe("counters derived from their edge, and max on an edge", () => {
  const loaded = (counter: string) => ({
    name: "slice",
    start: "review",
    steps: { review: { type: "agent", instructions: "Review.", outcomes: { approve: "$done", changes_requested: { to: "review", counter } } } },
    counters: { [counter]: { max: 3 } },
  });
  test("the pinned workflow holds a dotted counter name on its edge and under counters", () => {
    expect(modelErrorsOf(loaded("review.changes_requested"))).toEqual([]);
  });
  test("a workflow file as written refuses a dotted name under counters and on counter:", () => {
    const wf = { name: "slice", start: "review", steps: { review: { agent: "Review.", outcomes: { approve: "$done", changes_requested: { to: "review", counter: "review.changes_requested" } } } }, counters: { "review.changes_requested": { max: 3 } } };
    const paths = errorsOf(wf).map((e) => e.path);
    expect(paths).toContainEqual(expect.stringContaining("/counters"));
    expect(paths).toContainEqual(expect.stringContaining("/steps/review/outcomes/changes_requested"));
    const shared = { start: "review", steps: { review: { agent: "Review.", outcomes: { approve: { exit: "ok" }, changes_requested: { to: "review", counter: "review.changes_requested" } } } } };
    expect(validate("workflow-shared", shared).ok).toBe(false);
  });
  test("max: on an edge is written in a file, never in the pinned workflow", () => {
    const wf = { name: "slice", start: "review", steps: { review: { agent: "Review.", outcomes: { approve: "$done", changes_requested: { to: "review", max: 4 } } } } };
    expect(errorsOf(wf)).toEqual([]);
    expect(errorsOf({ ...wf, steps: { review: { ...wf.steps.review, outcomes: { approve: "$done", changes_requested: { to: "review", max: 0 } } } } })).not.toEqual([]);
    const use = { name: "story", start: "base", steps: { base: { use: "base-update", outcomes: { broken: { to: "base", max: 3 } } } } };
    expect(errorsOf(use)).toEqual([]);
    const model = loaded("review_loop") as any;
    model.steps.review.outcomes.changes_requested.max = 4;
    expect(modelErrorsOf(model)).not.toEqual([]);
  });
});
