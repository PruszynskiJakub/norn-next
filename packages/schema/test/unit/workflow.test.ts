import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { parse } from "yaml";
import { REPO_ROOT } from "../../../../test/support/repo-root.ts";
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
const sharedErrorsOf = (v: unknown) => {
  const r = validate("workflow-shared", v);
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

  test("a step reads a produced name or a source by the name the workflow may give it, hyphens included, optional or not", () => {
    const wf = (inputs: unknown[]) => ({ name: "x", start: "a", steps: { a: { type: "agent", instructions: "do it", inputs, outcomes: { done: "$done" } } } });
    expect(modelErrorsOf(wf(["brand-assets", "pr_body?", "brand-kit?"]))).toEqual([]);
    expect(modelErrorsOf(wf(["Brand"])).length).toBeGreaterThan(0);
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
    ["a meaning inside a check's route", (w: any) => (w.steps.test.outcomes.pass = { to: "review", means: "x" })],
    ["a verdict inside a gate's route", (w: any) => (w.steps["human-qa"].outcomes.approve = { to: "integrate", verdict: "pass" })],
    ["a verdict on an outcome that is not one", (w: any) => (w.steps.qa.outcomes.pass = { to: "integrate", verdict: "great" })],
    ["means on a check", (w: any) => (w.steps.test.means = { pass: "green" })],
    ["a verdict that is not one", (w: any) => (w.steps.qa.verdict.pass = "great")],
    ["agent with no outcomes", (w: any) => (w.steps.merge.outcomes = {})],
    ["unknown step property", (w: any) => (w.steps.merge.when = "x")],
    ["edge with unknown property", (w: any) => (w.steps.merge.outcomes.done = { to: "integrate", when: "x" })],
    ["edge without to", (w: any) => (w.steps.merge.outcomes.done = { counter: "x" })],
    ["counter max 0", (w: any) => (w.counters.test_loop.max = 0)],
    // which names a step may read is the loader's check: a produced name or a source is the workflow's own
    ["an input that is no name", (w: any) => (w.steps.implement.inputs = ["Every thing"])],
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

  test("each schema has one step shape per actor written with by:, one per head key of the older form, besides `use` and `like`", () => {
    const shapes = (name: "workflow-source" | "workflow-shared") => {
      const steps = (toJsonSchema(name) as any).properties.steps.patternProperties;
      const union = (Object.values(steps)[0] as { anyOf: Array<{ properties: Record<string, unknown>; required?: string[] }> }).anyOf;
      return union.map((v) => (v.required ?? []).filter((k) => k in ONE_OF_EACH || k === "use" || k === "like" || k === "by"));
    };
    // an agent role, person, shell, a step kind, norn.each
    const actors = [["by"], ["by"], ["by"], ["by"], ["by"]];
    const expected = [...actors, ...Object.keys(ONE_OF_EACH).map((k) => [k]), ["like"]];
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

  test("an agent step says what an outcome means, needs and produces on the outcome, and lists what every outcome produces", () => {
    const qa = {
      agent: "Check it.",
      produces: ["criteria", { name: "notes", file: "notes.md" }],
      outcomes: {
        pass: { to: "$done", verdict: "pass", means: "every criterion observed" },
        fail: { to: "$stuck", max: 2, verdict: "fail", means: "a criterion fails", produces: ["criteria", "findings"] },
      },
    };
    expect(errorsOf(source(qa))).toEqual([]);
    const leaves = { agent: "Review it.", outcomes: { approve: { exit: "approved", means: "no blocking findings" }, rework: { exit: "rework", produces: ["findings"] } } };
    expect(sharedErrorsOf(shared(leaves))).toEqual([]);
    expect(sharedErrorsOf(shared(qa))).toEqual([]);
  });

  test("neither schema accepts an outcome's meaning, verdict or produces beside a route a person or a command takes, nor a step in the old wording", () => {
    const gateMeans = { gate: "Approve?", outcomes: { approve: { to: "$done", means: "fine" } } };
    const checkVerdict = { check: "bun test", timeout: "5m", outcomes: { pass: { to: "$done", verdict: "pass" } } };
    const exitMeans = { check: "bun test", timeout: "5m", outcomes: { pass: { exit: "tested", means: "green" } } };
    const gateProduces = { gate: "Approve?", produces: ["findings"], outcomes: { approve: "$done" } };
    for (const step of [gateMeans, checkVerdict, gateProduces]) expect({ step, ok: validate("workflow-source", source(step)).ok }).toEqual({ step, ok: false });
    for (const step of [gateMeans, exitMeans, gateProduces]) expect({ step, ok: validate("workflow-shared", shared(step)).ok }).toEqual({ step, ok: false });
    const old = { type: "agent", skill: "a", instructions: "Do it.", outcomes: { done: { to: "$done", means: "done" } } };
    expect(validate("workflow-source", source(old)).ok).toBe(false);
    expect(validate("workflow-shared", shared(old)).ok).toBe(false);
  });

  test("an outcome object refuses a key it has no use for, and a produced file entry holds its name and file only", () => {
    const step = (outcome: unknown, extra: Record<string, unknown> = {}) => source({ agent: "Do it.", outcomes: { done: outcome }, ...extra });
    for (const bad of [step({ to: "$done", mean: "x" }), step({ to: "$done", produces: [{ name: "n", file: "n.md", on: ["done"] }] }), step("$done", { produces: [{ name: "n" }] }), step({ to: "$done", produces: ["Not A Name"] })])
      expect({ bad, ok: validate("workflow-source", bad).ok }).toEqual({ bad, ok: false });
  });
});

describe("the shipped workflows against the schemas a person writes against", () => {
  const dir = join(REPO_ROOT, "packages", "pack-sdlc", "assets", "workflows");
  const yamls = (d: string) => readdirSync(d).filter((f) => f.endsWith(".yaml"));
  test.each(yamls(dir))("%s validates against workflow-source", (file) => {
    expect(errorsOf(parse(readFileSync(join(dir, file), "utf8")))).toEqual([]);
  });
  test.each(yamls(join(dir, "shared")))("shared/%s validates against workflow-shared", (file) => {
    expect(sharedErrorsOf(parse(readFileSync(join(dir, "shared", file), "utf8")))).toEqual([]);
  });
});

describe("a step written with by: in the workflow-source and workflow-shared schemas", () => {
  const source = (steps: Record<string, unknown>, extra: Record<string, unknown> = {}) => ({ name: "x", start: Object.keys(steps)[0], steps, ...extra });
  const shared = (steps: Record<string, unknown>) => ({ start: Object.keys(steps)[0], steps });
  /** One step per actor, as a file writes it. */
  const ACTORS: Record<string, Record<string, unknown>> = {
    agent: {
      by: "reviewer",
      do: "Review it.",
      with: { skills: ["norn-review"] },
      reads: ["spec", "diff"],
      produces: ["criteria"],
      allow: ["docs:write"],
      attended: "person",
      limits: { deadline: "2h", nudges: 1, retries: 0 },
      outcomes: { approve: { to: "$done", verdict: "pass", means: "fine" }, changes_requested: { to: "$stuck", produces: ["criteria", "findings"] } },
    },
    person: { by: "person", do: "Approve?", outcomes: { approve: "$done", reject: { to: "$stuck", max: 2 } }, on: { "vcs.stale": "$stuck", "norn.timeout": { to: "$stuck", after: "48h" } } },
    shell: { by: "shell", do: "bun test", with: { exits: { 3: "stale" } }, limits: { timeout: "5m" }, outcomes: { pass: "$done", fail: "$stuck", stale: "$stuck" } },
    kind: { by: "forge.await-merge", with: { note: "x" }, outcomes: { merged: "$done" }, on: { "vcs.stale": "$stuck", "vcs.unpushed": "$stuck" } },
    each: { by: "norn.each", reads: ["slices"], outcomes: { done: "$done", stuck: "$stuck" } },
  };

  test("an agent role, a person, shell, a step kind and norn.each each validate as a file writes them", () => {
    for (const [actor, step] of Object.entries(ACTORS)) expect({ actor, source: errorsOf(source({ a: step })), shared: sharedErrorsOf(shared({ a: step })) }).toEqual({ actor, source: [], shared: [] });
    expect(validate("workflow", source({ a: ACTORS.person })).ok).toBe(false);
  });

  test("a step written with by: takes none of the older form's keys, and each actor only its own", () => {
    for (const [actor, extra] of [
      ["agent", { skills: ["x"] }],
      ["agent", { inputs: ["spec"] }],
      ["agent", { writes: "docs" }],
      ["agent", { attended: true }],
      ["agent", { limits: { timeout: "5m" } }],
      ["shell", { timeout: "5m" }],
      ["shell", { exits: { 3: "stale" } }],
      ["person", { reads: ["spec"] }],
      ["person", { on: { stale: "$stuck" } }],
      ["kind", { do: "Wait." }],
    ] as const) {
      const step = { ...ACTORS[actor], ...extra };
      expect({ actor, extra, ok: validate("workflow-source", source({ a: step })).ok }).toEqual({ actor, extra, ok: false });
    }
  });

  test("an agent step reads a produced name or a source, bare or with a trailing ? for optional, and the open findings as findings?", () => {
    const wf = source({ a: { ...ACTORS.agent, reads: ["spec", "findings?", "brand", "notes?"] } }, { sources: { brand: { type: "folder" }, adr: { type: "folder", path: "docs/adr" } } });
    expect(errorsOf(wf)).toEqual([]);
    expect(validate("workflow-source", source({ a: ACTORS.shell }, { sources: { brand: { type: "url" } } })).ok).toBe(false);
    expect(validate("workflow-source", source({ a: { ...ACTORS.agent, reads: ["Brand"] } })).ok).toBe(false);
  });

  test("a workflow file holds signals: and entries:, which neither a shared file nor the pinned workflow holds", () => {
    const wf = source({ a: ACTORS.shell }, { signals: { "vcs.stale": { when: "conflict", verify: "a" } }, entries: { "update-branch": "a" } });
    expect(errorsOf(wf)).toEqual([]);
    expect(validate("workflow", wf).ok).toBe(false);
    expect(validate("workflow-shared", { ...shared({ a: ACTORS.shell }), signals: {} }).ok).toBe(false);
    expect(validate("workflow-source", source({ a: ACTORS.shell }, { signals: { "vcs.stale": { when: "sometimes" } } })).ok).toBe(false);
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
