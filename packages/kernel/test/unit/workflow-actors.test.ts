/**
 * A step written with `by`/`do`/`with` names its actor by value and pins the document its older
 * spelling (one head key per step) pins, so a unit's pin and the golden cases never see which one a
 * file used.
 */
import { describe, expect, test } from "bun:test";
import { Type } from "@sinclair/typebox";
import { DEFAULT_KERNEL_CONFIG, type LoadedWorkflow, type LoadWorkflowOptions, loadWorkflow, type WorkflowError, type WorkflowLoad } from "../../src/index.ts";
import { kind, STEP_KINDS } from "../shipped.ts";

const HOST = ["spec", "handoff", "diff", "last_findings", "slices"];
const KINDS = {
  ...STEP_KINDS,
  // a kind over no slot is named after its plugin; this one takes a setting
  preview: { ...kind("preview", ["done"], "effect", Type.Object({ env: Type.Optional(Type.String()) }, { additionalProperties: false })), namespace: "vercel" },
};
const SIGNALS = { "ci-failed": { name: "ci-failed", source: "forge-ci", namespace: "forge" } };
const opts = (over: Partial<LoadWorkflowOptions> = {}): LoadWorkflowOptions => ({ stepKinds: KINDS, signals: SIGNALS, sharedFiles: {}, config: DEFAULT_KERNEL_CONFIG, inputs: HOST, ...over });
const wf = (steps: Record<string, unknown>, extra: Record<string, unknown> = {}) => ({ name: "t", start: Object.keys(steps)[0], steps, ...extra });

function loaded(r: WorkflowLoad): LoadedWorkflow {
  if (!r.ok) throw new Error(JSON.stringify(r.errors, null, 2));
  return r.workflow;
}
const errorsOf = (r: WorkflowLoad): WorkflowError[] => (r.ok ? [] : r.errors);
const refusals = (doc: unknown, o: Partial<LoadWorkflowOptions> = {}) => errorsOf(loadWorkflow(doc, opts(o))).map(({ path, message }) => ({ path, message }));

function pinsAlike(written: unknown, older: unknown, o: Partial<LoadWorkflowOptions> = {}): void {
  const a = loaded(loadWorkflow(written, opts(o))).pinned;
  const b = loaded(loadWorkflow(older, opts(o))).pinned;
  expect(a.doc).toEqual(b.doc);
  expect(a.hash).toBe(b.hash);
}

describe("a step names its actor with by:", () => {
  test("an agent role does what do: says, with: holds its skills, reads: what its brief gives it, and allow, attended and limits bound it", () => {
    pinsAlike(
      wf({
        review: {
          by: "reviewer",
          do: "Review the change.",
          with: { skills: ["norn-review"] },
          reads: ["spec", "diff"],
          allow: ["docs:write"],
          attended: "person",
          limits: { deadline: "2h", nudges: 1, retries: 0 },
          outcomes: { approve: "$done", changes_requested: { to: "fix", produces: ["findings"] } },
        },
        fix: { by: "builder", do: "Fix it.", outcomes: { done: { to: "review", max: 3 } } },
      }),
      wf({
        review: {
          agent: "Review the change.",
          skills: ["norn-review"],
          inputs: ["spec", "diff"],
          writes: "docs",
          attended: true,
          deadline: "2h",
          nudges: 1,
          retries: 0,
          outcomes: { approve: "$done", changes_requested: "fix" },
          hand_back: { changes_requested: "findings" },
        },
        fix: { agent: "Fix it.", outcomes: { done: { to: "review", max: 3 } } },
      }),
    );
  });

  test("shell runs do: as its command, with: names its exit codes, and limits: its timeout", () => {
    pinsAlike(
      wf({ test: { by: "shell", do: "bun test", with: { exits: { 3: "flaky" } }, limits: { timeout: "5m" }, outcomes: { pass: "$done", fail: "$stuck", flaky: "$stuck" } } }),
      wf({ test: { check: "bun test", timeout: "5m", exits: { 3: "flaky" }, outcomes: { pass: "$done", fail: "$stuck", flaky: "$stuck" } } }),
    );
  });

  test("a person decides what do: says, and its on: names each signal by its namespace", () => {
    pinsAlike(
      wf({
        ready: {
          by: "person",
          do: "Approve?",
          outcomes: { approve: "$done", reject: "$stuck" },
          on: { "vcs.stale": { to: "$stuck" }, "norn.timeout": { to: "$stuck", after: "48h" }, "forge.ci-failed": "$stuck" },
        },
      }),
      wf({ ready: { gate: "Approve?", outcomes: { approve: "$done", reject: "$stuck" }, on: { stale: { to: "$stuck" }, timeout: { to: "$stuck", after: "48h" }, "ci-failed": "$stuck" } } }),
    );
  });

  test("a step kind is named <slot>.<kind> or <plugin>.<kind>, its settings under with:, and a wait kind takes on:", () => {
    pinsAlike(
      wf({
        update: { by: "vcs.update-branch", outcomes: { done: "open", conflict: "$stuck", clean: "open", resolved: "open" } },
        open: { by: "forge.open-pr", outcomes: { done: "preview" } },
        preview: { by: "vercel.preview", with: { env: "staging" }, outcomes: { done: "merge" } },
        merge: { by: "forge.await-merge", outcomes: { merged: "$done" }, on: { "vcs.stale": { to: "update", max: 3 }, "vcs.unpushed": "open" } },
      }),
      wf({
        update: { "update-branch": null, outcomes: { done: "open", conflict: "$stuck", clean: "open", resolved: "open" } },
        open: { "open-pr": null, outcomes: { done: "preview" } },
        preview: { preview: null, env: "staging", outcomes: { done: "merge" } },
        merge: { "await-merge": null, outcomes: { merged: "$done" }, on: { stale: { to: "update", max: 3 }, unpushed: "open" } },
      }),
    );
  });

  test("norn.each runs the slices it reads", () => {
    pinsAlike(wf({ slices: { by: "norn.each", reads: ["slices"], outcomes: { done: "$done", stuck: "$stuck" } } }), wf({ slices: { slices: null, outcomes: { done: "$done", stuck: "$stuck" } } }));
  });

  test("a copy of a step written with by: takes the keys it writes whole", () => {
    pinsAlike(
      wf({
        test: { by: "shell", do: "bun test", limits: { timeout: "5m" }, outcomes: { pass: "again", fail: "$stuck" } },
        again: { like: "test", outcomes: { pass: "$done", fail: "$stuck" } },
      }),
      wf({ test: { check: "bun test", timeout: "5m", outcomes: { pass: "again", fail: "$stuck" } }, again: { check: "bun test", timeout: "5m", outcomes: { pass: "$done", fail: "$stuck" } } }),
    );
  });

  test("a shared file's steps are written the same way, and leave through its exits", () => {
    const shared = (steps: Record<string, unknown>) => ({ base: { start: "update", steps } });
    const doc = wf({ work: { use: "base", outcomes: { synced: "$done" } } });
    const a = loaded(loadWorkflow(doc, opts({ sharedFiles: shared({ update: { by: "vcs.update-branch", outcomes: { done: { exit: "synced" }, conflict: "$stuck", clean: { exit: "synced" }, resolved: { exit: "synced" } } } }) })));
    const b = loaded(loadWorkflow(doc, opts({ sharedFiles: shared({ update: { "update-branch": null, outcomes: { done: { exit: "synced" }, conflict: "$stuck", clean: { exit: "synced" }, resolved: { exit: "synced" } } } }) })));
    expect(a.pinned.hash).toBe(b.pinned.hash);
  });
});

describe("the workflow's signals: and entries:", () => {
  test("signals: holds vcs.stale's settings once and entries: the step update-branch re-enters, as base: did", () => {
    const steps = {
      update: { by: "vcs.update-branch", outcomes: { done: "test", conflict: "$stuck", clean: "test", resolved: "test" } },
      test: { by: "shell", do: "bun test", limits: { timeout: "5m" }, outcomes: { pass: "ready", fail: "$stuck" } },
      ready: { by: "person", do: "Approve?", outcomes: { approve: "$done", reject: "$stuck" }, on: { "vcs.stale": { to: "update", max: 3 } } },
    };
    pinsAlike(
      wf(steps, { signals: { "vcs.stale": { when: "conflict", verify: "test" } }, entries: { "update-branch": "update" } }),
      wf(steps, { base: { stale: "conflict", verify: "test", step: "update" } }),
    );
  });

  test("base: beside them, another signal's settings, and an entry norn never re-enters are refused", () => {
    const steps = { ready: { by: "person", do: "Approve?", outcomes: { approve: "$done", reject: "$stuck" } } };
    expect(refusals(wf(steps, { base: { stale: "behind" }, signals: { "vcs.stale": { when: "conflict" } } }))).toEqual([
      { path: "/base", message: "base: is written as signals: and entries:, never beside them" },
    ]);
    expect(refusals(wf(steps, { signals: { stale: { when: "conflict" }, "forge.ci-failed": {} }, entries: { start: "ready" } }))).toEqual([
      { path: "/signals/stale", message: "`stale` is named `vcs.stale`" },
      { path: "/signals/forge.ci-failed", message: "only vcs.stale takes settings here (when, verify)" },
      { path: "/entries/start", message: "`start` is not an entry norn re-enters: name update-branch" },
    ]);
  });
});

describe("refusals of the step form", () => {
  const person = { by: "person", do: "Approve?", outcomes: { approve: "$done", reject: "$stuck" } };

  test("a head key beside the step form's keys", () => {
    expect(refusals(wf({ a: { agent: "Do it.", do: "Do it.", outcomes: { done: "$done" } } }))).toEqual([
      { path: "/steps/a", message: "step 'a' is written with the head key `agent` and with `do`: write it with by: and do: alone" },
    ]);
  });

  test("a step with do: and no actor", () => {
    expect(refusals(wf({ a: { do: "Do it.", outcomes: { done: "$done" } } }))).toEqual([
      { path: "/steps/a", message: "step 'a' names no actor: give it by: (an agent role, person, shell, or a step kind as <namespace>.<kind>)" },
    ]);
  });

  test("the older form's keys, each told where it is written now", () => {
    const old = { skills: ["x"], inputs: ["spec"], timeout: "5m", exits: { 3: "x" }, model: "opus", writes: "docs", means: { done: "d" }, criteria: "required", deadline: "1h" };
    expect(refusals(wf({ a: { by: "builder", do: "Do it.", ...old, outcomes: { done: "$done" } } }))).toEqual([
      { path: "/steps/a/skills", message: "step 'a' is written with by:, so `skills` is written under with: (`with: { skills: [...] }`)" },
      { path: "/steps/a/inputs", message: "step 'a' is written with by:, so `inputs` is written as reads:" },
      { path: "/steps/a/timeout", message: "step 'a' is written with by:, so `timeout` is written under limits: (`limits: { timeout: ... }`)" },
      { path: "/steps/a/exits", message: "step 'a' is written with by:, so `exits` is written under with: (`with: { exits: { 3: stale } }`)" },
      { path: "/steps/a/model", message: "step 'a' is written with by:, so `model` is not written: the config chooses the executor and its model; a step that must name one keeps the older form (agent: with by: and model:)" },
      { path: "/steps/a/writes", message: "step 'a' is written with by:, so `writes` is written as allow: (`allow: [docs:write]`)" },
      { path: "/steps/a/means", message: "step 'a' is written with by:, so `means` is written on the outcome (`done: { to: ..., means: ... }`)" },
      { path: "/steps/a/criteria", message: "step 'a' is written with by:, so `criteria` is written in what the outcomes produce (`produces: [criteria]`)" },
      { path: "/steps/a/deadline", message: "step 'a' is written with by:, so `deadline` is written under limits: (`limits: { deadline: ... }`)" },
    ]);
  });

  test("an actor that is no role, a step kind named bare or under another namespace, and a kind no plugin provides", () => {
    expect(refusals(wf({ a: { by: "robot", do: "Do it.", outcomes: { done: "$done" } } }))).toEqual([
      { path: "/steps/a/by", message: "`robot` is not an actor: name an agent role (builder, reviewer, qa, investigator, writer), person, shell, or a step kind as <namespace>.<kind>" },
    ]);
    expect(refusals(wf({ a: { by: "open-pr", outcomes: { done: "$done" } } }))).toEqual([{ path: "/steps/a/by", message: "`open-pr` is a step kind: name it `forge.open-pr`" }]);
    expect(refusals(wf({ a: { by: "vcs.open-pr", outcomes: { done: "$done" } } }))).toEqual([{ path: "/steps/a/by", message: "`vcs.open-pr` is named `forge.open-pr`" }]);
    expect(refusals(wf({ a: { by: "norn.loop", outcomes: { done: "$done" } } }))).toEqual([{ path: "/steps/a/by", message: "`norn.loop` is not a step kind of the core: the core's is norn.each" }]);
    expect(errorsOf(loadWorkflow(wf({ a: { by: "netlify.deploy", outcomes: { done: "$done" } } }), opts()))).toEqual([
      { path: "/steps/a/by", message: "`netlify.deploy` is not a step kind the kernel or a configured plugin provides: add the plugin that provides it", missing_kind: "deploy" },
    ]);
  });

  test("a signal named bare or one no source reports under on:, and a signal routed under outcomes:", () => {
    expect(refusals(wf({ a: { ...person, on: { stale: "$stuck", "forge.merged": "$done" } } }))).toEqual([
      { path: "/steps/a/on/stale", message: "`stale` is named `vcs.stale`" },
      { path: "/steps/a/on/forge.merged", message: "`forge.merged` is not a signal the host or a configured plugin reports: add the plugin that provides it" },
    ]);
    expect(refusals(wf({ a: { ...person, outcomes: { ...person.outcomes, stale: "$stuck" } } }))).toEqual([
      { path: "/steps/a/outcomes/stale", message: "`stale` is a signal: route it under on: as `vcs.stale`" },
    ]);
  });

  test("each actor takes its own keys and with: its own settings", () => {
    expect(refusals(wf({ a: { ...person, reads: ["spec"], limits: { timeout: "1h" } } }))).toEqual([
      { path: "/steps/a/reads", message: "`reads` is not a key of a person step" },
      { path: "/steps/a/limits", message: "`limits` is not a key of a person step" },
    ]);
    expect(refusals(wf({ a: { by: "builder", do: "Do it.", with: { skills: ["x"], executor: "deep", depth: 2 }, outcomes: { done: "$done" } } }))).toEqual([
      { path: "/steps/a/with/executor", message: "`executor` is not written: the config chooses the executor and its model; a step that must name one keeps the older form (agent: with by: and model:)" },
      { path: "/steps/a/with/depth", message: "`depth` is not a setting of an agent step: with: holds skills" },
    ]);
    expect(refusals(wf({ a: { by: "shell", do: "bun test", with: { skills: ["x"] }, limits: { timeout: "1m" }, outcomes: { pass: "$done", fail: "$stuck" } } }))).toEqual([
      { path: "/steps/a/with/skills", message: "`skills` is not a setting of a shell step: with: holds exits" },
    ]);
    expect(refusals(wf({ a: { by: "forge.open-pr", do: "Open it.", with: { outcomes: {} }, outcomes: { done: "$done" } } }))).toEqual([
      { path: "/steps/a/do", message: "`do` is not a key of a forge.open-pr step" },
      { path: "/steps/a/with/outcomes", message: "`outcomes` is a step key, never a setting of forge.open-pr" },
    ]);
    expect(refusals(wf({ a: { by: "norn.each", reads: ["spec"], with: { workflow: "slice" }, outcomes: { done: "$done", stuck: "$stuck" } } }))).toEqual([
      { path: "/steps/a/with", message: "norn.each runs the config's slice_workflow and takes no with:" },
      { path: "/steps/a/reads", message: "norn.each reads the story's slices: write reads: [slices], or leave it out" },
    ]);
    expect(refusals(wf({ a: { by: "forge.open-pr", on: { "vcs.stale": "$stuck" }, outcomes: { done: "$done" } } }))).toEqual([
      { path: "/steps/a/on", message: "`on` is only for a person step or a wait step, and step 'a' is a forge.open-pr step (an effect)" },
    ]);
  });

  test("do: is required of an agent, a person and a shell step, and a shell step's timeout", () => {
    expect(refusals(wf({ a: { by: "builder", outcomes: { done: "$done" } } }))).toEqual([{ path: "/steps/a", message: "step 'a' says what to do with do:" }]);
    expect(refusals(wf({ a: { by: "person", outcomes: { approve: "$done" } } }))).toEqual([{ path: "/steps/a", message: "step 'a' says what the person decides with do:" }]);
    expect(refusals(wf({ a: { by: "shell", do: "bun test", outcomes: { pass: "$done", fail: "$stuck" } } }))).toEqual([{ path: "/steps/a/limits", message: "a shell step needs limits: { timeout }" }]);
  });

  test("limits and attended take what the pinned document can hold", () => {
    expect(refusals(wf({ a: { by: "builder", do: "Do it.", limits: { timeout: "1h", asks: 3 }, attended: "none", outcomes: { done: "$done" } } }))).toEqual([
      { path: "/steps/a/attended", message: "attended: takes person; agent and none come with supervised and unattended steps: leave attended out for a step nobody stays beside" },
      { path: "/steps/a/limits/timeout", message: "an agent step is bounded by deadline, never timeout" },
      { path: "/steps/a/limits/asks", message: "`asks` bounds a supervisor's answers, and no step has a supervisor yet" },
    ]);
    expect(refusals(wf({ a: { by: "shell", do: "bun test", limits: { timeout: "1m", retries: 2 }, outcomes: { pass: "$done", fail: "$stuck" } } }))).toEqual([
      { path: "/steps/a/limits/retries", message: "`retries` bounds an agent step: a shell step is bounded by timeout" },
    ]);
    expect(refusals(wf({ a: { agent: "Do it.", attended: "person", outcomes: { done: "$done" } } }))).toEqual([
      { path: "/steps/a/attended", message: "`attended: person` belongs to a step written with by:; an agent: step takes attended: true" },
    ]);
  });

  test("allow: asks for code:write or docs:write", () => {
    expect(refusals(wf({ a: { by: "builder", do: "Do it.", allow: ["docs:write", "net:any"], outcomes: { done: "$done" } } }))).toEqual([
      { path: "/steps/a/allow/1", message: "`net:any` is not a capability a step may ask for: name code:write or docs:write" },
    ]);
  });
});
