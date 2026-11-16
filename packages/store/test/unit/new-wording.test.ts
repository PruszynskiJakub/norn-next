import { describe, expect, test } from "bun:test";
import { cpSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { validateWorkflowDefinition } from "@norn/core";
import type { Workflow } from "@norn/schema";
import { loadWorkflow, loadWorkflows, loadWorkflowText, parseWorkflowText, sharedFile, workflowsDir } from "../../src/index.ts";
import { tmp } from "../helpers.ts";

/** The shipped workflows and shared files as they were written in the old wording, and their translations. */
const SHIPPED = join(import.meta.dir, "../fixtures/wording/old");
const TRANSLATED = join(import.meta.dir, "../fixtures/wording/new");

const wf = (steps: string, rest = "") => `name: x\nstart: a\n${rest}steps:\n${steps}`;

function loads(text: string): Workflow {
  const r = parseWorkflowText(text, "x.yaml", "checkout");
  if (!r.ok) throw new Error(`refused: ${JSON.stringify(r)}`);
  return r.value;
}

/** A text read as a copy (a pin, a branch file): the old wording still loads, translated. */
function asCopy(text: string): Workflow {
  const r = parseWorkflowText(text, "pin.yaml", "copy");
  if (!r.ok) throw new Error(`refused: ${JSON.stringify(r)}`);
  return r.value;
}

/** `path message` for each error a refused text is reported with. */
function refused(text: string): string[] {
  const r = parseWorkflowText(text, "x.yaml", "checkout");
  if (r.ok) throw new Error(`loaded: ${JSON.stringify(r.value)}`);
  return r.reason === "corrupt" ? r.error.errors.map((e) => `${e.path} ${e.message}`) : [r.reason];
}

function repo(files: Record<string, string>): string {
  const root = tmp();
  for (const [path, text] of Object.entries(files)) {
    const file = join(workflowsDir(root), path);
    mkdirSync(join(file, ".."), { recursive: true });
    writeFileSync(file, text);
  }
  return root;
}

const OLD = wf(`  a:
    type: agent
    description: build it
    skill: norn-implement
    instructions: Build what the spec asks.
    inputs: [spec, handoff]
    agent: codex
    model: gpt-5
    attended: true
    deadline: 1h
    nudges: 2
    retries: 1
    criteria: required
    outcomes:
      done: { to: t, means: "built", verdict: pass }
      partial: { to: t, counter: loop, means: "half built", verdict: person }
      silent: $stuck
  t:
    type: check
    description: the suite
    run: bun test
    timeout: 10m
    exits: { '3': flaky }
    outcomes: { pass: g, fail: { to: a, counter: loop }, flaky: a }
  g:
    type: gate
    prompt: Approve the build?
    outcomes: { approve: $done, reject: a }
`, "counters: { loop: { max: 2 } }\n");

const NEW = wf(`  a:
    agent: Build what the spec asks.
    description: build it
    skills: [norn-implement]
    inputs: [spec, handoff]
    by: codex
    model: gpt-5
    attended: true
    deadline: 1h
    nudges: 2
    retries: 1
    criteria: required
    outcomes:
      done: t
      partial: { to: t, counter: loop }
      silent: $stuck
    means:
      done: built
      partial: half built
    verdict: { done: pass, partial: person }
  t:
    check: bun test
    description: the suite
    timeout: 10m
    exits: { '3': flaky }
    outcomes: { pass: g, fail: { to: a, counter: loop }, flaky: a }
  g:
    gate: Approve the build?
    outcomes: { approve: $done, reject: a }
`, "counters: { loop: { max: 2 } }\n");

describe("a step written by its head key", () => {
  test("agent, check and gate steps load to the same workflow as today's wording", () => {
    const loaded = loads(NEW);
    expect(loaded).toEqual(asCopy(OLD));
    expect(loaded.steps.a).toMatchObject({ type: "agent", instructions: "Build what the spec asks.", skills: ["norn-implement"], agent: "codex" });
    expect(loaded.steps.t).toMatchObject({ type: "check", run: "bun test", timeout: "10m" });
    expect(loaded.steps.g).toMatchObject({ type: "gate", prompt: "Approve the build?" });
  });

  test.each([
    ["update-branch", { type: "git", action: "update" }, "{ done: $done, conflict: $stuck, clean: $done, resolved: $done }"],
    ["open-pr", { type: "git", action: "open-pr" }, "{ done: $done, conflict: $stuck }"],
    ["integrate", { type: "git", action: "integrate" }, "{ done: $done, conflict: $stuck }"],
    ["push", { type: "git", action: "push" }, "{ done: $done }"],
    ["await-merge", { type: "merge" }, "{ stale: $stuck }"],
    ["slices", { type: "slices" }, "{ done: $done, stuck: $stuck }"],
  ])("`%s:` with no value loads as today's step of its kind", (verb, model, outcomes) => {
    expect(loads(wf(`  a:\n    ${verb}:\n    outcomes: ${outcomes}\n`)).steps.a).toEqual({ ...model, outcomes: expect.any(Object) } as never);
  });

  test("a verb takes only its kind's outcomes: `clean` and `resolved` only on update-branch", () => {
    const issues = (verb: string, outcomes: string) => validateWorkflowDefinition(loads(wf(`  a:\n    ${verb}:\n    outcomes: ${outcomes}\n`))).issues.map((i) => i.path);
    expect(issues("update-branch", "{ done: $done, clean: $done, resolved: $done }")).toEqual([]);
    for (const verb of ["open-pr", "integrate", "push"]) expect(issues(verb, "{ done: $done, clean: $done, resolved: $done }")).toEqual(["/steps/a/outcomes/clean", "/steps/a/outcomes/resolved"]);
    expect(refused(wf("  a:\n    await-merge:\n    outcomes: { done: $done }\n")).length).toBeGreaterThan(0);
    expect(refused(wf("  a:\n    slices:\n    outcomes: { approve: $done }\n")).length).toBeGreaterThan(0);
  });

  test("a verb given a value is refused, naming the step", () => {
    expect(refused(wf("  a:\n    open-pr: now\n    outcomes: { done: $done }\n"))).toEqual(["/steps/a/open-pr `open-pr:` takes no value"]);
  });

  test("a step with two head keys, or none, is refused naming the step", () => {
    expect(refused(wf("  a:\n    agent: do it\n    check: bun test\n    timeout: 1m\n    outcomes: { pass: $done }\n"))).toEqual(["/steps/a a step has one head key, this one has 2: `agent`, `check`"]);
    expect(refused(wf("  a:\n    description: what\n    outcomes: { done: $done }\n"))[0]).toStartWith("/steps/a a step opens with one head key: `agent`, `check`, `gate`");
  });

  test("a like copy has its target's head key; a copy writing a different one has two", () => {
    const steps = "  a:\n    check: bun test\n    timeout: 1m\n    outcomes: { pass: b, fail: $stuck }\n  b:\n    like: a\n    check: bun test --again\n    outcomes: { pass: $done, fail: $stuck }\n";
    const copy = loadWorkflow(repo({ "x.yaml": wf(steps) }), "x");
    expect(copy.ok && copy.value.workflow.steps.b).toEqual({ type: "check", run: "bun test --again", timeout: "1m", outcomes: { pass: "$done", fail: "$stuck" } });
    const other = loadWorkflows(repo({ "x.yaml": wf(steps.replace("    check: bun test --again\n", "    agent: test it again\n")) }));
    expect(other.errors.flatMap((e) => e.errors.map((x) => `${x.path} ${x.message}`))).toEqual(["/steps/b a step has one head key, this one has 2: `agent`, `check`"]);
  });
});

describe("an agent step: orientation, skills and the agent that runs it", () => {
  test.each([["", "null"], ["''", "empty"], ["'  '", "blank"]])("an orientation that is missing or empty (%s) is refused naming the step", (value) => {
    expect(refused(wf(`  a:\n    agent: ${value}\n    skills: [s]\n    outcomes: { stuck: $stuck }\n`))).toEqual(["/steps/a/agent `agent:` needs an orientation: what the step is for"]);
  });

  test("skills are optional and a set: a skill named twice is refused naming it", () => {
    expect(loads(wf("  a:\n    agent: Triage the issue.\n    outcomes: { stuck: $stuck }\n")).steps.a).toEqual({ type: "agent", instructions: "Triage the issue.", outcomes: { stuck: "$stuck" } });
    expect(refused(wf("  a:\n    agent: do it\n    skills: [s, t, s]\n    outcomes: { stuck: $stuck }\n"))).toEqual(["/steps/a/skills names the skill `s` twice"]);
  });

  test("`by:` picks the configured agent that runs the step, and its skills are the ones checked", () => {
    const text = wf("  a:\n    agent: do it\n    skills: [s]\n    outcomes: { done: b }\n    means: { done: did }\n  b:\n    agent: do it again\n    skills: [s]\n    by: codex\n    outcomes: { done: $done }\n    means: { done: did }\n");
    const loaded = loads(text);
    expect(loaded.steps.a).not.toHaveProperty("agent");
    expect(loaded.steps.b).toMatchObject({ agent: "codex" });
    const issues = validateWorkflowDefinition(loaded, { agentSkills: { agent: "claude", visible: { claude: ["s"], codex: [] } } }).issues;
    expect(issues.map((i) => [i.code, i.path])).toEqual([["unknown_skill", "/steps/b/skills/0"]]);
  });
});

describe("outcomes, meanings and verdicts", () => {
  test("each route carries the meaning and verdict its sibling maps give it", () => {
    expect(loads(NEW).steps.a?.outcomes).toEqual({
      done: { to: "t", means: "built", verdict: "pass" },
      partial: { to: "t", counter: "loop", means: "half built", verdict: "person" },
      silent: "$stuck",
    });
  });

  test("a routed outcome the agent may report with no meaning is refused; the overridable routes need none", () => {
    expect(refused(wf("  a:\n    agent: do it\n    outcomes: { done: $done, partial: $stuck }\n    means: { done: built }\n"))).toEqual([
      "/steps/a/outcomes/partial the agent may report `partial`: say what it means in `means:`",
    ]);
    const overrides = "{ done: $done, silent: $stuck, died: $stuck, timeout: $stuck, stalled: $stuck, ask: $stuck, stuck: $stuck }";
    expect(() => loads(wf(`  a:\n    agent: do it\n    outcomes: ${overrides}\n    means: { done: built }\n`))).not.toThrow();
  });

  test("a meaning or verdict for an outcome the step does not route is refused naming it", () => {
    const step = "  a:\n    agent: do it\n    outcomes: { done: $done }\n    means: { done: built, gone: left }\n    verdict: { lost: pass }\n";
    expect(refused(wf(step))).toEqual(["/steps/a/means/gone `gone` is not an outcome this step routes", "/steps/a/verdict/lost `lost` is not an outcome this step routes"]);
  });

  test.each([
    ["means", "    means: hello\n", "/steps/a/means `means:` is a map from outcome to meaning"],
    ["verdict", "    means: { done: built }\n    verdict: pass\n", "/steps/a/verdict `verdict:` is a map from outcome to verdict"],
  ])("a `%s:` that is not a map is refused naming the step", (_key, prose, error) => {
    expect(refused(wf(`  a:\n    agent: do it\n    outcomes: { done: $done }\n${prose}`))).toContain(error);
  });

  test("`means:` and `verdict:` on a step that is not an agent step are refused naming it", () => {
    expect(refused(wf("  a:\n    check: bun test\n    timeout: 1m\n    outcomes: { pass: $done }\n    means: { pass: green }\n"))).toEqual(["/steps/a/means only an agent step has `means:`"]);
    expect(refused(wf("  a:\n    gate: ok?\n    outcomes: { approve: $done }\n    verdict: { approve: pass }\n"))).toEqual(["/steps/a/verdict only an agent step has `verdict:`"]);
  });

  test("a shared file's exits leave through the use step's routes, meanings from the shared file's `means:`", () => {
    const shared = "start: fix\nsteps:\n  fix:\n    agent: Resolve the conflicts.\n    skills: [merge]\n    outcomes: { done: { exit: fixed }, gave_up: { exit: broken } }\n    means: { done: resolved, gave_up: cannot resolve }\n    verdict: { gave_up: fail }\n";
    const story = "name: story\nstart: base\nsteps:\n  base:\n    use: fixer\n    outcomes: { fixed: $done, broken: { to: base, counter: loop } }\ncounters: { loop: { max: 2 } }\n";
    const r = loadWorkflow(repo({ "story.yaml": story, "shared/fixer.yaml": shared }), "story");
    if (!r.ok) throw new Error(JSON.stringify(r));
    expect(r.value.workflow.steps.fix?.outcomes).toEqual({
      done: { to: "$done", means: "resolved" },
      gave_up: { to: "fix", counter: "loop", means: "cannot resolve", verdict: "fail" },
    });
  });
});

describe("either wording loads to the same workflow", () => {
  /** Each workflow of a folder laid out as `.agents/workflows/`, loaded as a copy (a story branch's files), by name. */
  const copies = (dir: string) => {
    const root = tmp();
    cpSync(dir, workflowsDir(root), { recursive: true });
    const out: Record<string, Workflow> = {};
    for (const f of readdirSync(workflowsDir(root)).filter((n) => n.endsWith(".yaml"))) {
      const name = f.slice(0, -".yaml".length);
      const r = loadWorkflowText(name, readFileSync(join(workflowsDir(root), f), "utf8"), f, "copy", root, (n) => readFileSync(join(workflowsDir(root), sharedFile(n)), "utf8"));
      if (!r.ok) throw new Error(`${f} refused: ${JSON.stringify(r)}`);
      out[name] = r.value.workflow;
    }
    return out;
  };

  test("each shipped workflow and shared file, read as a copy, loads to the same workflow as its translation from the main checkout", () => {
    const old = copies(SHIPPED);
    const root = tmp();
    cpSync(TRANSLATED, workflowsDir(root), { recursive: true });
    const translated = loadWorkflows(root);
    expect(translated.errors).toEqual([]);
    expect(Object.keys(translated.workflows).sort()).toEqual(Object.keys(old).sort());
    for (const [name, w] of Object.entries(old)) expect(translated.workflows[name]?.workflow).toEqual(w);
  });

  test("a file in today's wording loads as a copy and is refused from the main checkout", () => {
    expect(asCopy(OLD).steps.a).toMatchObject({ type: "agent", skills: ["norn-implement"], agent: "codex" });
    const r = parseWorkflowText(OLD, "x.yaml", "checkout");
    expect(!r.ok && r.reason === "corrupt" && r.error.code).toBe("old_wording");
  });
});
