import { describe, expect, test } from "bun:test";
import { workflowHash } from "../src/hash.ts";
import { checkWorkflowLevel, elementaryCycles, validateWorkflowDefinition } from "../src/workflow.ts";
import { SLICE_WF, STORY_WF } from "./fixtures.ts";

const clone = <T>(v: T): T => structuredClone(v);
const codes = (v: unknown, skills?: string[]) => {
  const r = validateWorkflowDefinition(v, skills ? { skills } : {});
  return r.issues.map((i) => i.code);
};

describe("validateWorkflowDefinition (W5)", () => {
  test("PRD slice example and the story fixture are valid", () => {
    expect(validateWorkflowDefinition(SLICE_WF, { skills: ["implement", "review", "qa", "merge"] })).toEqual({ ok: true, workflow: SLICE_WF, issues: [] });
    expect(validateWorkflowDefinition(STORY_WF).ok).toBe(true);
  });

  test("every uncounted elementary cycle is listed with its path (W4)", () => {
    const wf = clone(SLICE_WF) as any;
    wf.steps.review.outcomes.changes_requested = { to: "implement" };
    wf.steps.test.outcomes.fail = "implement";
    const r = validateWorkflowDefinition(wf);
    const cycles = r.issues.filter((i) => i.code === "uncounted_cycle");
    expect(cycles.map((c) => c.cycle)).toEqual([
      ["implement", "test"],
      ["implement", "test", "review"],
    ]);
    expect(cycles[1]?.message).toBe("cycle without a counter: implement.done → test.pass → review.changes_requested → implement (W4)");
  });

  test("a cycle with one counted edge among parallel edges is still uncounted via the other", () => {
    const wf = {
      name: "x",
      start: "a",
      steps: {
        a: { type: "agent", skill: "s", outcomes: { done: "$done", retry: { to: "b", counter: "c" }, again: "b" } },
        b: { type: "agent", skill: "s", outcomes: { done: "a" } },
      },
      counters: { c: { max: 1 } },
    };
    const r = validateWorkflowDefinition(wf);
    expect(r.issues.map((i) => i.message)).toEqual(["cycle without a counter: a.again → b.done → a (W4)"]);
  });

  test("self-loop without counter is a cycle", () => {
    const wf = { name: "x", start: "a", steps: { a: { type: "agent", skill: "s", outcomes: { done: "$done", more: "a" } } } };
    expect(validateWorkflowDefinition(wf).issues.map((i) => [i.code, i.cycle])).toEqual([["uncounted_cycle", ["a"]]]);
  });

  test("steps that cannot reach $done", () => {
    const wf = { name: "x", start: "a", steps: { a: { type: "agent", skill: "s", outcomes: { done: "b", out: "$done" } }, b: { type: "agent", skill: "s", outcomes: { done: "$stuck" } } } };
    expect(validateWorkflowDefinition(wf).issues).toEqual([{ code: "cannot_reach_done", path: "/steps/b", message: "step 'b' cannot reach $done" }]);
  });

  test("reserved step names, unknown targets/counters/start, unknown skills, declared exhausted", () => {
    expect(codes({ name: "x", start: "done", steps: { done: { type: "agent", skill: "s", outcomes: { ok: "$done" } } } })).toContain("reserved_name");
    expect(codes({ name: "x", start: "a", steps: { $a: { type: "agent", skill: "s", outcomes: { ok: "$done" } } } })).toContain("reserved_name");
    expect(codes({ name: "x", start: "a", steps: { a: { type: "agent", skill: "s", outcomes: { ok: "$done", no: "nowhere" } } } })).toEqual(["unknown_target"]);
    expect(codes({ name: "x", start: "zz", steps: { a: { type: "agent", skill: "s", outcomes: { ok: "$done" } } } })).toEqual(["unknown_start"]);
    expect(codes({ name: "x", start: "a", steps: { a: { type: "agent", skill: "s", outcomes: { ok: "$done", r: { to: "a", counter: "nope" } } } } })).toEqual(["unknown_counter"]);
    expect(codes(SLICE_WF, ["implement", "review"])).toEqual(["unknown_skill", "unknown_skill"]);
    expect(codes({ name: "x", start: "a", steps: { a: { type: "agent", skill: "s", outcomes: { ok: "$done", exhausted: "$done" } } } })).toEqual(["reserved_outcome"]);
  });

  test("a step's skill must be installed for the agent that runs it (W5, SK1)", () => {
    const wf = { name: "x", start: "a", steps: { a: { type: "agent", skill: "s", outcomes: { ok: "b" } }, b: { type: "agent", skill: "t", agent: "codex", outcomes: { ok: "$done" } } } };
    const check = (visible: Record<string, string[]>) => validateWorkflowDefinition(wf, { agentSkills: { default_agent: "claude", visible } }).issues.map((i) => i.path);
    expect(check({ claude: ["s"], codex: ["t"] })).toEqual([]);
    expect(check({ claude: ["t"], codex: ["s"] })).toEqual(["/steps/a/skill", "/steps/b/skill"]);
    expect(check({})).toEqual([]); // agents without a skill folder are not checked
    expect(validateWorkflowDefinition(wf, { agentSkills: { default_agent: "claude", visible: { claude: [] } } }).issues[0]?.message).toBe(
      "skill 's' is not installed for agent 'claude' (run norn init, or add it to that agent's skill folder)",
    );
  });

  test("schema errors are reported with paths", () => {
    const r = validateWorkflowDefinition({ name: "x", start: "a", steps: { a: { type: "check", outcomes: { pass: "$done" } } } });
    expect(r.ok).toBe(false);
    expect(r.issues.every((i) => i.code === "schema")).toBe(true);
  });
});

describe("elementaryCycles (Johnson)", () => {
  test("complete digraph on 3 nodes has 5 elementary cycles", () => {
    const adj = new Map([
      ["a", ["b", "c"]],
      ["b", ["a", "c"]],
      ["c", ["a", "b"]],
    ]);
    const cycles = elementaryCycles(["a", "b", "c"], adj);
    expect(cycles.map((c) => c.join(""))).toEqual(["ab", "abc", "ac", "acb", "bc"]);
  });
  test("acyclic graph has none", () => {
    expect(elementaryCycles(["a", "b"], new Map([["a", ["b"]]]))).toEqual([]);
  });
});

describe("checkWorkflowLevel (W8)", () => {
  test("slices/open-pr only on a story, integrate only on a slice", () => {
    expect(checkWorkflowLevel(STORY_WF, "story")).toEqual([]);
    expect(checkWorkflowLevel(STORY_WF, "slice").map((i) => i.path)).toEqual(["/steps/slices", "/steps/open-pr"]);
    expect(checkWorkflowLevel(SLICE_WF, "slice")).toEqual([]);
    expect(checkWorkflowLevel(SLICE_WF, "story")[0]?.message).toBe("step 'integrate' (git: integrate) runs only on a slice, not on a story (W8)");
  });
});

test("workflowHash is stable across key order", () => {
  const reordered = JSON.parse(JSON.stringify({ counters: SLICE_WF.counters, steps: SLICE_WF.steps, start: SLICE_WF.start, name: SLICE_WF.name }));
  expect(workflowHash(reordered)).toBe(workflowHash(SLICE_WF));
  expect(workflowHash(STORY_WF)).not.toBe(workflowHash(SLICE_WF));
  expect(workflowHash(SLICE_WF)).toMatch(/^[0-9a-f]{64}$/);
});
