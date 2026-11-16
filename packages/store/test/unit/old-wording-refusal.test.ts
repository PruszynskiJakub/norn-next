/**
 * The main checkout takes only the new wording: a workflow file (or a shared file it uses) with any
 * step in the old or a mixed wording is one `old_wording` error naming its steps and keys and
 * `norn upgrade`. A copy of the same text (a pin, a branch file) still loads through the translator.
 */
import { describe, expect, test } from "bun:test";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { loadWorkflow, loadWorkflows, loadWorkflowText, parseWorkflowText, workflowsDir } from "../../src/index.ts";
import { tmp } from "../helpers.ts";

const wf = (steps: string) => `name: x\nstart: a\nsteps:\n${steps}`;

const NEW_STEPS = `  a:
    agent: Build it.
    skills: [norn-implement]
    outcomes: { done: g }
    means: { done: built }
  g:
    gate: Approve?
    outcomes: { approve: $done, reject: $stuck }
`;

const OLD_STEPS = `  a:
    type: agent
    skill: norn-implement
    instructions: Build it.
    outcomes: { done: { to: g, means: built } }
  g:
    type: gate
    prompt: Approve?
    outcomes: { approve: $done, reject: $stuck }
`;

// one step in the new wording that still carries one old key, and an edge with an old verdict
const MIXED_STEPS = `  a:
    agent: Build it.
    skill: norn-implement
    outcomes: { done: { to: g, verdict: pass } }
    means: { done: built }
  g:
    gate: Approve?
    outcomes: { approve: $done, reject: $stuck }
`;

function repo(files: Record<string, string>): string {
  const root = tmp();
  for (const [path, text] of Object.entries(files)) {
    const file = join(workflowsDir(root), path);
    mkdirSync(join(file, ".."), { recursive: true });
    writeFileSync(file, text);
  }
  return root;
}

function refusal(r: ReturnType<typeof loadWorkflow> | ReturnType<typeof parseWorkflowText>) {
  if (r.ok || r.reason !== "corrupt") throw new Error(`not refused: ${JSON.stringify(r)}`);
  return r.error;
}

describe("the main checkout refuses the old wording", () => {
  test("a file in the old wording is one old_wording error naming each old step, its keys and norn upgrade", () => {
    const e = refusal(loadWorkflow(repo({ "x.yaml": wf(OLD_STEPS) }), "x"));
    expect(e).toEqual({
      file: ".agents/workflows/x.yaml",
      code: "old_wording",
      errors: [
        {
          path: "",
          message: "written in the old wording: step 'a' (type, skill, instructions, means inside an edge), step 'g' (type, prompt); run `norn upgrade` to rewrite it and commit",
        },
      ],
    });
  });

  test("a step mixing both wordings is refused as old", () => {
    const e = refusal(loadWorkflow(repo({ "x.yaml": wf(MIXED_STEPS) }), "x"));
    expect(e.code).toBe("old_wording");
    expect(e.errors.map((x) => x.message)).toEqual(["written in the old wording: step 'a' (skill, verdict inside an edge); run `norn upgrade` to rewrite it and commit"]);
  });

  test("each of every old key is enough on its own, and a means inside an exit route too", () => {
    for (const key of ["type: agent", "skill: s", "instructions: i", "run: r", "prompt: p", "action: push"]) {
      const text = wf(`  a:\n    agent: Build it.\n    ${key}\n    outcomes: { done: $done }\n    means: { done: built }\n`);
      expect(refusal(parseWorkflowText(text, "x.yaml", "checkout")).code).toBe("old_wording");
    }
    const shared = "start: fix\nsteps:\n  fix:\n    agent: Fix it.\n    outcomes: { done: { exit: fixed, means: resolved } }\n";
    const r = loadWorkflow(repo({ "x.yaml": "name: x\nstart: b\nsteps:\n  b:\n    use: fixer\n    outcomes: { fixed: $done }\n", "shared/fixer.yaml": shared }), "x");
    expect(refusal(r).errors.map((x) => x.message)).toEqual([
      "written in the old wording: shared/fixer.yaml: step 'fix' (means inside an edge); run `norn upgrade` to rewrite it and commit",
    ]);
  });

  test("a shared file in the old wording refuses the workflow that uses it, naming the shared file", () => {
    const shared = "start: fix\nsteps:\n  fix:\n    type: agent\n    skill: merge\n    outcomes: { done: { exit: fixed } }\n";
    const story = "name: story\nstart: base\nsteps:\n  base:\n    use: fixer\n    outcomes: { fixed: $done }\n";
    const e = refusal(loadWorkflow(repo({ "story.yaml": story, "shared/fixer.yaml": shared }), "story"));
    expect(e.file).toBe(".agents/workflows/story.yaml");
    expect(e.code).toBe("old_wording");
    expect(e.errors[0]?.message).toContain("shared/fixer.yaml: step 'fix' (type, skill)");
  });

  test("the listing reports one error per old file and still loads the new ones", () => {
    const listing = loadWorkflows(repo({ "a.yaml": wf(OLD_STEPS).replace("name: x", "name: a"), "b.yaml": wf(OLD_STEPS).replace("name: x", "name: b"), "c.yaml": wf(NEW_STEPS).replace("name: x", "name: c") }));
    expect(listing.errors.map((e) => [e.file, e.code, e.errors.length])).toEqual([
      [".agents/workflows/a.yaml", "old_wording", 1],
      [".agents/workflows/b.yaml", "old_wording", 1],
    ]);
    expect(Object.keys(listing.workflows)).toEqual(["c"]);
  });

  test("a file in the new wording loads from the main checkout as written", () => {
    const r = loadWorkflow(repo({ "x.yaml": wf(NEW_STEPS) }), "x");
    expect(r.ok && r.value.source).toBe(wf(NEW_STEPS));
  });
});

describe("a copy in the old wording still loads", () => {
  test("a pin or a branch file loads through the translator, to the same workflow as its new wording, its text kept", () => {
    const fromNew = loadWorkflow(repo({ "x.yaml": wf(NEW_STEPS) }), "x");
    const text = wf(OLD_STEPS);
    const pin = parseWorkflowText(text, "pin.yaml", "copy");
    expect(pin.ok && pin.value).toEqual(fromNew.ok ? fromNew.value.workflow : (null as never));
    const branch = loadWorkflowText("x", text, ".agents/workflows/x.yaml", "copy");
    expect(branch.ok && branch.value.source).toBe(text);
  });
});
