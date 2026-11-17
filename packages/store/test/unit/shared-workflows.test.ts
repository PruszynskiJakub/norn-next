import { describe, expect, test } from "bun:test";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { validateWorkflowDefinition } from "@norn/core";
import { parse as parseYaml } from "yaml";
import { loadWorkflow, loadWorkflows, parseWorkflowText, sha256, workflowsDir } from "../../src/index.ts";
import { tmp, WORKFLOW_YAML } from "../helpers.ts";

/** The loaded text as norn reads it back from a pin: parsed, each `skill` read into the model's `skills`. */
const asLoaded = (source: string) => {
  const r = parseWorkflowText(source, "pin.yaml", "copy");
  if (!r.ok) throw new Error(JSON.stringify(r));
  return r.value;
};

const BASE_UPDATE = `description: merge the base in and test it
start: update
steps:
  update:
    update-branch:
    outcomes: { done: test, conflict: resolve }
  resolve:
    agent: Use the \`merge\` skill.
    skills: [merge]
    outcomes: { done: test, stuck: $stuck, gave_up: { exit: broken } }
    means:
      done: step finished with outcome done
      gave_up: "cannot resolve"
    verdict:
      gave_up: fail
  test:
    check: bun test
    timeout: 10m
    outcomes:
      pass: { exit: tested }
      fail: { exit: broken }
`;

const STORY = `name: story
defaults: { deadline: 30m, nudges: 1 }
start: implement
steps:
  implement:
    agent: Use the \`implement\` skill.
    skills: [implement]
    outcomes: { done: base, quick: test }
    means:
      done: step finished with outcome done
      quick: step finished with outcome quick
  base:
    use: base-update
    outcomes: { tested: qa, broken: { to: implement, counter: test_loop } }
  qa:
    gate: approve or reject qa
    outcomes: { approve: $done, reject: { to: implement, counter: test_loop } }
counters: { test_loop: { max: 3 } }
base: { step: base, verify: test }
`;

/** A repo with the given files under `.agents/workflows/` (paths relative to it). */
function repo(files: Record<string, string>): string {
  const root = tmp();
  for (const [path, text] of Object.entries(files)) {
    const file = join(workflowsDir(root), path);
    mkdirSync(join(file, ".."), { recursive: true });
    writeFileSync(file, text);
  }
  return root;
}

function loaded(files: Record<string, string>, name = "story") {
  const r = loadWorkflow(repo(files), name);
  if (!r.ok) throw new Error(`not loaded: ${JSON.stringify(r)}`);
  return r.value;
}

/** The messages a refused workflow is reported with. */
function refusal(files: Record<string, string>, name = "story"): string[] {
  const l = loadWorkflows(repo(files));
  expect(l.workflows[name]).toBeUndefined();
  return l.errors.flatMap((e) => e.errors.map((x) => `${x.path} ${x.message}`));
}

describe("use: brings in a shared file's steps", () => {
  test("the included steps stand in place of the use step under their own names", () => {
    const wf = loaded({ "story.yaml": STORY, "shared/base-update.yaml": BASE_UPDATE });
    expect(Object.keys(wf.workflow.steps)).toEqual(["implement", "update", "resolve", "test", "qa"]);
    expect(wf.workflow.steps.base).toBeUndefined();
    expect(wf.workflow.steps.update).toEqual({ type: "git", action: "update", outcomes: { done: "test", conflict: { to: "resolve", counter: "update.conflict" } } });
    expect(wf.included).toEqual({ update: "base-update", resolve: "base-update", test: "base-update" });
  });

  test("routes, start and base.step naming the use step enter at the shared start; an included step is named directly", () => {
    const wf = loaded({ "story.yaml": STORY.replace("start: implement", "start: base"), "shared/base-update.yaml": BASE_UPDATE });
    expect(wf.workflow.start).toBe("update");
    expect(wf.workflow.steps.implement?.outcomes).toMatchObject({ done: { to: "update" }, quick: { to: "test" } });
    expect(wf.workflow.base).toEqual({ step: "update", verify: "test" });
  });

  test("reset_on or base.verify naming the use step is refused, asking for the included step", () => {
    const files = { "shared/base-update.yaml": BASE_UPDATE };
    expect(refusal({ ...files, "story.yaml": STORY.replace("{ max: 3 }", "{ max: 3, reset_on: base.tested }") })).toEqual([
      "/counters/test_loop/reset_on `base` is a use step: name the step of shared/base-update.yaml whose edge resets the counter",
    ]);
    expect(refusal({ ...files, "story.yaml": STORY.replace("verify: test", "verify: base") })).toEqual([
      "/base/verify `base` is a use step: name the check step of shared/base-update.yaml",
    ]);
  });

  test("an exit takes its target and counter from the use step and an agent step's means and verdict from the shared side; an unrouted exit goes to $stuck", () => {
    const wf = loaded({ "story.yaml": STORY, "shared/base-update.yaml": BASE_UPDATE });
    expect(wf.workflow.steps.test?.outcomes).toEqual({
      pass: "qa",
      fail: { to: "implement", counter: "test_loop" },
    });
    expect((wf.workflow.steps.resolve?.outcomes as Record<string, unknown>).gave_up).toEqual({ to: "implement", counter: "test_loop", means: "cannot resolve", verdict: "fail" });
    const unrouted = loaded({ "story.yaml": STORY.replace(", broken: { to: implement, counter: test_loop }", ""), "shared/base-update.yaml": BASE_UPDATE });
    expect(unrouted.workflow.steps.test?.outcomes).toEqual({ pass: "qa", fail: "$stuck" });
  });

  test("shared routes to $done and $stuck and to a workflow counter stay as written, and the loaded workflow validates", () => {
    const shared = BASE_UPDATE.replace("done: test, stuck: $stuck,", "done: { to: test, counter: test_loop }, stuck: $stuck, skip: $done,").replace('      gave_up: "cannot resolve"\n', '      gave_up: "cannot resolve"\n      skip: step finished with outcome skip\n');
    const wf = loaded({ "story.yaml": STORY, "shared/base-update.yaml": shared });
    expect(wf.workflow.steps.resolve?.outcomes).toMatchObject({ done: { to: "test", counter: "test_loop" }, stuck: "$stuck", skip: { to: "$done" } });
    expect(validateWorkflowDefinition(wf.workflow).issues).toEqual([]);
  });

  test("a shared route naming a step outside the shared file is refused", () => {
    expect(refusal({ "story.yaml": STORY, "shared/base-update.yaml": BASE_UPDATE.replace("stuck: $stuck", "stuck: qa") })).toEqual([
      "/steps/resolve/outcomes/stuck shared/base-update.yaml: `qa` is not a step of this file; a shared file leaves through an exit (`{ exit: <name> }`)",
    ]);
    expect(refusal({ "story.yaml": STORY, "shared/base-update.yaml": BASE_UPDATE.replace("stuck: $stuck", "stuck: { to: implement, counter: test_loop }") })).toEqual([
      "/steps/resolve/outcomes/stuck shared/base-update.yaml: `implement` is not a step of this file; a shared file leaves through an exit (`{ exit: <name> }`)",
    ]);
  });

  test("the workflow's defaults cover included steps: they carry no limits of their own", () => {
    const wf = loaded({ "story.yaml": STORY, "shared/base-update.yaml": BASE_UPDATE });
    expect(wf.workflow.defaults).toEqual({ deadline: "30m", nudges: 1 });
    expect(Object.keys(wf.workflow.steps.resolve ?? {})).toEqual(["type", "instructions", "skills", "outcomes"]);
  });
});

describe("use: refusals", () => {
  test("a missing shared file names the file and the folder", () => {
    expect(refusal({ "story.yaml": STORY.replace("use: base-update", "use: nope") })).toEqual([
      "/steps/base/use shared file `shared/nope.yaml` not found in `.agents/workflows/shared/`",
    ]);
  });

  test("an included step named like a workflow step, a use step or another shared file's step, or a shared file used twice, names both places", () => {
    const files = { "shared/base-update.yaml": BASE_UPDATE };
    expect(refusal({ ...files, "story.yaml": STORY.replace("  qa:\n", "  resolve:\n    gate: approve or reject resolve\n    outcomes: { approve: qa }\n  qa:\n") })).toEqual([
      "/steps/resolve step `resolve` comes from shared/base-update.yaml and from the workflow",
    ]);
    expect(refusal({ ...files, "story.yaml": STORY.replace(/\bbase:\n    use/, "test:\n    use").replace("done: base, quick: test", "done: test") })).toEqual([
      "/steps/test step `test` comes from shared/base-update.yaml and is the name of the use step that brings it in",
    ]);
    const ship = "start: test\nsteps:\n  test:\n    gate: approve or reject test\n    outcomes: { approve: $done }\n";
    expect(refusal({ ...files, "shared/ship.yaml": ship, "story.yaml": STORY.replace("  qa:\n", "  ship:\n    use: ship\n  qa:\n") })).toEqual([
      "/steps/test step `test` comes from shared/base-update.yaml and from shared/ship.yaml",
    ]);
    expect(refusal({ ...files, "story.yaml": STORY.replace("  qa:\n", "  again:\n    use: base-update\n  qa:\n") })).toEqual([
      "/steps/again/use shared/base-update.yaml is used twice, by `base` and `again`: its step `update` would come from both",
    ]);
  });

  test("an exit the shared file lacks, a use step in a shared file, and a workflow key in a shared file are refused", () => {
    const files = { "shared/base-update.yaml": BASE_UPDATE };
    expect(refusal({ ...files, "story.yaml": STORY.replace("tested: qa", "tested: qa, flaky: qa") })).toEqual([
      "/steps/base/outcomes/flaky `flaky` is not an exit of shared/base-update.yaml (its exits: broken, tested)",
    ]);
    expect(refusal({ "story.yaml": STORY, "shared/base-update.yaml": BASE_UPDATE.replace("  resolve:\n", "  more:\n    use: other\n  resolve:\n") })).toEqual([
      "/steps/more/use shared/base-update.yaml: a shared file cannot use another shared file",
    ]);
    for (const key of ["name: x", "counters: {}", "defaults: {}", "mode: auto", "base: {}"]) {
      const k = key.split(":")[0];
      expect(refusal({ "story.yaml": STORY, "shared/base-update.yaml": `${key}\n${BASE_UPDATE}` })).toEqual([`/${k} shared/base-update.yaml: \`${k}\` belongs in the workflow`]);
    }
  });

  test("a shared file's own schema error names the file and the step", () => {
    expect(refusal({ "story.yaml": STORY, "shared/base-update.yaml": BASE_UPDATE.replace("skills: [merge]", "skils: [merge]") })[0]).toStartWith("/steps/resolve shared/base-update.yaml: ");
  });
});

describe("shared files and the loaded text", () => {
  test("files in shared/ are never listed as workflows", () => {
    const l = loadWorkflows(repo({ "story.yaml": STORY, "shared/base-update.yaml": BASE_UPDATE, "shared/story.yaml": STORY }));
    expect(Object.keys(l.workflows)).toEqual(["story"]);
    expect(l.errors).toEqual([]);
  });

  test("a workflow with no use loads byte for byte; one with use loads as its flattened text", () => {
    const plain = loaded({ "slice.yaml": WORKFLOW_YAML }, "slice");
    expect(plain.source).toBe(WORKFLOW_YAML);
    expect(plain.hash).toBe(sha256(WORKFLOW_YAML));
    expect(plain.included).toBeUndefined();
    const wf = loaded({ "story.yaml": STORY, "shared/base-update.yaml": BASE_UPDATE });
    expect(wf.source).not.toContain("use:");
    expect(wf.hash).toBe(sha256(wf.source));
    expect(asLoaded(wf.source)).toEqual(wf.workflow);
  });

  test("each flat edge that left through a shared exit reports the use step's exit and that route's counter; the pinned text is unchanged", () => {
    // every route back names a counter, so the pin is the flat text with nothing derived into it
    const files = { "story.yaml": STORY, "shared/base-update.yaml": BASE_UPDATE.replace("conflict: resolve", "conflict: { to: resolve, counter: test_loop }") };
    const wf = loaded(files);
    expect(wf.exits).toEqual({
      "resolve.gave_up": { exit: "base.broken", counter: "test_loop" },
      "test.fail": { exit: "base.broken", counter: "test_loop" },
      "test.pass": { exit: "base.tested" },
    });
    const flat = loaded({ "story.yaml": wf.source.replace(/^name: .*$/m, "name: story") });
    expect(flat.exits).toBeUndefined();
    expect(wf.source).toBe(flat.source);
    expect(wf.hash).toBe(sha256(flat.source));
  });
});

const LIKE = `name: story
start: implement
steps:
  implement:
    agent: Use the \`implement\` skill.
    skills: [implement]
    outcomes: { done: test }
    means:
      done: step finished with outcome done
  test:
    check: bun test
    description: the suite
    timeout: 10m
    outcomes: { pass: review, fail: implement }
  review:
    gate: approve or reject review
    outcomes: { approve: test-merge }
  test-merge:
    like: test
    outcomes: { pass: $done, fail: review }
    check: bun test --merge
`;

describe("like: copies a step of its own file", () => {
  test("a copy keeps the target's keys and replaces only those it writes, whole; its text lists the target's keys then its own", () => {
    const wf = loaded({ "story.yaml": LIKE.replace("    check: bun test --merge\n", "    exits: { '3': flaky }\n") });
    expect(wf.workflow.steps["test-merge"]).toEqual({
      type: "check",
      description: "the suite",
      run: "bun test",
      timeout: "10m",
      outcomes: { pass: "$done", fail: { to: "review", counter: "test-merge.fail" } },
      exits: { "3": "flaky" },
    } as never);
    expect(Object.keys(parseYaml(wf.source).steps["test-merge"])).toEqual(["check", "description", "timeout", "outcomes", "exits"]);
  });

  test("a workflow with like but no use loads as its flattened text, with no like left", () => {
    const wf = loaded({ "story.yaml": LIKE });
    expect(wf.source).not.toContain("like:");
    expect(wf.hash).toBe(sha256(wf.source));
    expect(asLoaded(wf.source)).toEqual(wf.workflow);
    expect(wf.workflow.steps["test-merge"]).toMatchObject({ run: "bun test --merge", timeout: "10m" });
    expect(wf.included).toBeUndefined();
  });

  test("a copy that keeps an object value of its target writes it out in full, with no YAML anchor or alias", () => {
    const keeps = LIKE.replace("    outcomes: { pass: $done, fail: review }\n", "");
    const wf = loaded({ "story.yaml": keeps });
    expect(wf.source).not.toMatch(/[&*]a\d/);
    expect(asLoaded(wf.source)).toEqual(wf.workflow);
    expect(wf.workflow.steps["test-merge"]?.outcomes).toEqual({ pass: "review", fail: { to: "implement", counter: "test-merge.fail" } });
  });

  test("a like in a shared file is resolved within the shared file before its steps come in", () => {
    const shared = BASE_UPDATE.replace("  test:\n", "  retest:\n    like: test\n    outcomes: { pass: $done }\n  test:\n");
    const wf = loaded({ "story.yaml": STORY, "shared/base-update.yaml": shared });
    expect(wf.workflow.steps.retest).toEqual({ type: "check", run: "bun test", timeout: "10m", outcomes: { pass: "$done" } } as never);
    expect(wf.included?.retest).toBe("base-update");
    expect(wf.source).not.toContain("like:");
  });
});

describe("like: refusals", () => {
  const step = (s: string) => LIKE.replace("    like: test\n", `    like: ${s}\n`);
  test("a like naming a missing step, itself, a like step or a use step is refused with its reason", () => {
    expect(refusal({ "story.yaml": step("nope") })).toEqual(["/steps/test-merge/like `nope` is not a step of this file"]);
    expect(refusal({ "story.yaml": step("test-merge") })).toEqual(["/steps/test-merge/like a step cannot be like itself"]);
    const chain = `${LIKE}  test-again:\n    like: test-merge\n`;
    expect(refusal({ "story.yaml": chain })).toEqual(["/steps/test-again/like `test-merge` is a like step: name the step it copies, `test`"]);
    const onUse = `${STORY}`.replace("  qa:\n", "  qa2:\n    like: base\n  qa:\n");
    expect(refusal({ "story.yaml": onUse, "shared/base-update.yaml": BASE_UPDATE })).toEqual([
      "/steps/qa2/like `base` is a use step: like copies a step written in its own file",
    ]);
  });

  test("a like naming a step of another file is refused, from the workflow and from the shared file", () => {
    const fromWorkflow = STORY.replace("  qa:\n", "  test2:\n    like: test\n  qa:\n");
    expect(refusal({ "story.yaml": fromWorkflow, "shared/base-update.yaml": BASE_UPDATE })).toEqual([
      "/steps/test2/like `test` is a step of shared/base-update.yaml: like copies a step of its own file",
    ]);
    const fromShared = BASE_UPDATE.replace("  test:\n", "  ask:\n    like: qa\n  test:\n");
    expect(refusal({ "story.yaml": STORY, "shared/base-update.yaml": fromShared })).toEqual([
      "/steps/ask/like shared/base-update.yaml: `qa` is a step of the workflow: like copies a step of its own file",
    ]);
  });

  test("a use step carrying like is refused", () => {
    const both = STORY.replace("    use: base-update\n", "    use: base-update\n    like: qa\n");
    expect(refusal({ "story.yaml": both, "shared/base-update.yaml": BASE_UPDATE })).toEqual(["/steps/base/like a use step cannot carry `like`"]);
  });
});
