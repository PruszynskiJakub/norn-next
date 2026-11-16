import { load, show, eq } from "./lib.ts";
const NEW = `name: wf
start: build
steps:
  build:
    agent: Build the thing; orientation text.
    description: Build step.
    skills: [norn-implement, norn-tdd]
    inputs: [spec, handoff]
    by: codex
    model: gpt-5
    attended: true
    deadline: 30m
    nudges: 2
    retries: 1
    criteria: required
    outcomes:
      done: test
      blocked: { to: build, counter: loop }
    means:
      done: "built"
      blocked: "try again"
    verdict:
      done: pass
  test:
    check: bun test
    timeout: 15m
    exits: { 3: flaky }
    outcomes: { pass: ready, fail: { to: build, counter: loop }, flaky: { to: test, counter: loop } }
  ready:
    gate: Approve the change?
    outcomes: { approve: $done, reject: { to: build, counter: loop } }
counters: { loop: { max: 3 } }
`;
const OLD = `name: wf
start: build
steps:
  build:
    type: agent
    instructions: Build the thing; orientation text.
    description: Build step.
    skills: [norn-implement, norn-tdd]
    inputs: [spec, handoff]
    agent: codex
    model: gpt-5
    attended: true
    deadline: 30m
    nudges: 2
    retries: 1
    criteria: required
    outcomes:
      done: { to: test, means: "built", verdict: pass }
      blocked: { to: build, counter: loop, means: "try again" }
  test:
    type: check
    run: bun test
    timeout: 15m
    exits: { 3: flaky }
    outcomes: { pass: ready, fail: { to: build, counter: loop }, flaky: { to: test, counter: loop } }
  ready:
    type: gate
    prompt: Approve the change?
    outcomes: { approve: $done, reject: { to: build, counter: loop } }
counters: { loop: { max: 3 } }
`;
const n = load(NEW, "checkout"); const o = load(OLD, "copy");
show("new (checkout)", { ok: n.ok, issues: n.issues, build: n.workflow.steps.build, test: n.workflow.steps.test, ready: n.workflow.steps.ready }); show("old (copy, translated)", { ok: o.ok, issues: o.issues });
console.log("MODELS EQUAL:", eq(n.workflow, o.workflow));
