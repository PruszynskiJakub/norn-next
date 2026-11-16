/**
 * What an outcome must hand back: an agent step's `hand_back` map refuses `norn done` without the
 * findings or evidence it names, the brief's finish line shows that flag, and load refuses a map that
 * names an outcome the agent cannot report.
 */
import { describe, expect, test } from "bun:test";
import type { AgentStep, Workflow } from "@norn/schema";
import { renderBrief } from "../../src/brief.ts";
import { checkHandBack } from "../../src/hand-back.ts";
import { validateWorkflowDefinition } from "../../src/workflow.ts";
import { stateFor, storyUnit } from "../fixtures.ts";

const REVIEW: AgentStep = {
  type: "agent",
  instructions: "Use the `review` skill.",
  skills: ["review"],
  hand_back: { changes_requested: "findings", reject: "evidence" },
  outcomes: {
    approve: { to: "$done", means: "no blocking findings" },
    changes_requested: { to: "fix", counter: "review_loop", means: "blocking findings in the receipt" },
    reject: { to: "$stuck", means: "not worth fixing" },
  },
};
const WF: Workflow = {
  name: "review-flow",
  start: "review",
  steps: {
    review: REVIEW,
    fix: { type: "agent", instructions: "Use the `implement` skill.", skills: ["implement"], outcomes: { done: "review" } },
  },
  counters: { review_loop: { max: 3 } },
};
const withHandBack = (hand_back: Record<string, "findings" | "evidence">): Workflow => ({ ...WF, steps: { ...WF.steps, review: { ...REVIEW, hand_back } } });

const check = (outcome: string, given: { findings?: number; evidence?: boolean } = {}) =>
  checkHandBack({ step: REVIEW, step_name: "review", outcome, findings: given.findings ?? null, evidence: given.evidence ?? false });

describe("hand_back on norn done", () => {
  test("an outcome that must hand back findings is refused without them, naming the flag and the file format", () => {
    const r = check("changes_requested");
    expect(r).toMatchObject({ code: "hand_back_required", details: { outcome: "changes_requested", hand_back: "findings" } });
    expect(r?.do_instead).toContain('norn done changes_requested --findings <file> --handoff "…"');
    expect(r?.do_instead).toContain('{"findings": [');
  });

  test("an empty findings file hands back nothing, so it is refused too", () => {
    expect(check("changes_requested", { findings: 0 })).toMatchObject({ code: "hand_back_required" });
    expect(check("changes_requested", { findings: 1 })).toBeNull();
  });

  test("an outcome that must hand back evidence is refused without an evidence folder", () => {
    const r = check("reject");
    expect(r).toMatchObject({ code: "hand_back_required", details: { hand_back: "evidence" } });
    expect(r?.do_instead).toContain('norn done reject --evidence <dir> --handoff "…"');
    expect(check("reject", { evidence: true })).toBeNull();
  });

  test("an outcome hand_back does not name needs nothing", () => {
    expect(check("approve")).toBeNull();
  });
});

describe("hand_back in the brief", () => {
  test("the finish line of an outcome that must hand back shows its flag, beside --criteria", () => {
    const step: AgentStep = { ...REVIEW, criteria: "required" };
    const wf: Workflow = { ...WF, steps: { ...WF.steps, review: step } };
    const brief = renderBrief({
      unit: storyUnit(),
      state: stateFor(storyUnit(), wf, { step: "review" }),
      workflow: wf,
      mode: "auto",
      runner: "herdr",
      paths: { worktree: "/w", spec_dir: "/w/spec", story_file: "/w/spec/story.md", slice_file: null, unit_dir: "/w/spec/runs/_story" },
      diff_range: null,
      handoff: null,
      receipts: [],
      limits: { deadline: "60m", nudges: 2, retries: 1, slot: null, port_base: null },
    });
    expect(brief.json.finish.map((f) => f.command).slice(0, 3)).toEqual([
      'norn done approve --criteria <file> --handoff "…"',
      'norn done changes_requested --criteria <file> --findings <file> --handoff "…"',
      'norn done reject --criteria <file> --evidence <dir> --handoff "…"',
    ]);
  });
});

describe("hand_back at load", () => {
  test("a map naming outcomes the step reports loads", () => {
    expect(validateWorkflowDefinition(WF).issues).toEqual([]);
  });

  test("an outcome the step does not declare is unknown_outcome", () => {
    const issues = validateWorkflowDefinition(withHandBack({ fail: "findings" })).issues;
    expect(issues.map((i) => [i.code, i.path])).toEqual([["unknown_outcome", "/steps/review/hand_back/fail"]]);
  });

  test("an overridable route is unknown_outcome, even when the step declares it", () => {
    const wf = withHandBack({ stuck: "findings" });
    (wf.steps.review as AgentStep).outcomes.stuck = "$stuck";
    const issues = validateWorkflowDefinition(wf).issues;
    expect(issues.map((i) => [i.code, i.path])).toEqual([["unknown_outcome", "/steps/review/hand_back/stuck"]]);
  });
});
