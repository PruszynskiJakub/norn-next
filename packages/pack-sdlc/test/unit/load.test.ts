/**
 * Every workflow of the pack loads through the kernel's loader with the step kinds the real plugins
 * provide, the way the runtime loads it: no stub stands in for a step kind, so a route a plugin's
 * outcomes do not cover, or a config key its schema refuses, fails here.
 */
import { describe, expect, test } from "bun:test";
import { DEFAULT_KERNEL_CONFIG, loadWorkflow, type StepKindInfo } from "@norn/kernel";
import { HOST_INPUTS, stepsForgePlugin } from "@norn/runtime";
import { vcsGitPlugin } from "@norn/vcs-git";
import { parse } from "yaml";
import { SDLC_PACK } from "../../src/index.ts";

const STEP_KINDS: Record<string, StepKindInfo> = { ...vcsGitPlugin.provides.stepKinds, ...stepsForgePlugin.provides.stepKinds };
const SHARED = Object.fromEntries(Object.entries(SDLC_PACK.shared).map(([f, text]) => [f.replace(/\.yaml$/, ""), parse(text)]));
const load = (file: string) => loadWorkflow(parse(SDLC_PACK.workflows[file] as string), { stepKinds: STEP_KINDS, sharedFiles: SHARED, config: DEFAULT_KERNEL_CONFIG });

describe("the sdlc pack's workflows", () => {
  test("the real plugins provide every step kind the pack names", () => {
    expect(Object.keys(STEP_KINDS).sort()).toEqual(["await-merge", "integrate", "open-pr", "push", "update-branch", "verify-base"]);
  });

  test.each(Object.keys(SDLC_PACK.workflows))("%s loads with no errors", (file) => {
    const r = load(file);
    expect(r.ok ? [] : r.errors).toEqual([]);
  });

  test("every skill a loaded step names ships in the pack", () => {
    const named = new Set<string>();
    for (const file of Object.keys(SDLC_PACK.workflows)) {
      const r = load(file);
      if (!r.ok) continue;
      for (const step of Object.values(r.workflow.graph.steps)) for (const skill of step.agent?.skills ?? []) named.add(skill);
    }
    expect(named.size).toBeGreaterThan(0);
    expect([...named].filter((s) => !(s in SDLC_PACK.skills))).toEqual([]);
  });

  test.each(Object.keys(SDLC_PACK.workflows))("%s loads against the host's inputs, its flow checked", (file) => {
    const r = loadWorkflow(parse(SDLC_PACK.workflows[file] as string), { stepKinds: STEP_KINDS, sharedFiles: SHARED, config: DEFAULT_KERNEL_CONFIG, inputs: HOST_INPUTS });
    expect(r.ok ? [] : r.errors).toEqual([]);
  });

  test("describe produces the PR body open-pr reads, and open-pr's read stays optional: the light path reaches it without describe", () => {
    for (const file of ["quick.yaml", "story.yaml"]) {
      const r = load(file);
      expect(r.ok && r.workflow.graph.steps.describe?.agent?.produces).toEqual({ pr_body: { file: "pr.md", on: ["done"] } });
    }
    // were the read required, both workflows would be refused on the path that takes a base update after only the base moved
    const required = { ...STEP_KINDS, "open-pr": { ...(STEP_KINDS["open-pr"] as StepKindInfo), reads: ["pr_body"] } };
    const errors = (file: string) => {
      const r = loadWorkflow(parse(SDLC_PACK.workflows[file] as string), { stepKinds: required, sharedFiles: SHARED, config: DEFAULT_KERNEL_CONFIG, inputs: HOST_INPUTS });
      return r.ok ? [] : r.errors.map((e) => e.message);
    };
    expect(errors("quick.yaml")).toEqual([
      "shared/ship.yaml: step 'open-pr' (open-pr) reads `pr_body`, but no step produces it on the path sync.done → implement.done → update.clean → test-merge.pass → open-pr: give a step on that path produces: pr_body",
    ]);
    expect(errors("story.yaml")).toEqual([
      "shared/ship.yaml: step 'open-pr' (open-pr) reads `pr_body`, but no step produces it on the path sync.done → slice.done → approve-slices.approve → slices.done → update.clean → test-merge.pass → open-pr: give a step on that path produces: pr_body",
    ]);
  });

  test("without the routes the loader needs, the shipped ship.yaml fails: the edits are what make it load", () => {
    const shared = { ...SHARED, ship: parse(SDLC_PACK.shared["ship.yaml"] as string) };
    const merge = shared.ship.steps.merge;
    merge.outcomes = { stale: { exit: "stale" } };
    const r = loadWorkflow(parse(SDLC_PACK.workflows["quick.yaml"] as string), { stepKinds: STEP_KINDS, sharedFiles: shared, config: DEFAULT_KERNEL_CONFIG });
    expect(r.ok).toBe(false);
  });
});
