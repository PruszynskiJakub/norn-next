import { describe, expect, test } from "bun:test";
import type { StoryFacts } from "../../src/facts.ts";
import { baseClosed, prProblem, type StoryPhase, storyFinished, storyLanded, storyMerged, storyPhase } from "../../src/policy.ts";
import { STORY_WF, stateFor, storyFacts, storyUnit, unitFacts } from "../fixtures.ts";

type Rec = "new" | "active" | "done" | "dropped";
type Unit = "none" | "running" | "done_at_end" | "done_mid";

const PR = { number: 7, url: "u", is_draft: false, head_sha: "h".repeat(40) };

function story(record: Rec, unit: Unit, patch: Partial<StoryFacts> = {}): StoryFacts {
  const ref = storyUnit();
  const state =
    unit === "none"
      ? null
      : unit === "running"
        ? stateFor(ref, STORY_WF, { status: "running" })
        : stateFor(ref, STORY_WF, { status: "done", step: unit === "done_at_end" ? "$done" : "refine", park: null, run: null });
  const s = storyFacts("gh-1", [unitFacts(ref, STORY_WF, state)], patch);
  s.frontmatter = { ...s.frontmatter!, status: record };
  return s;
}

const mergedInto = (base_branch: string): StoryFacts["pr"] => ({ ...PR, state: "merged", base_branch });

describe("storyPhase", () => {
  const rows: Array<[string, StoryFacts, StoryPhase]> = [
    ["no run state, spec.md new", story("new", "none"), { phase: "not_started" }],
    ["no run state, spec.md active (after a reset)", story("active", "none"), { phase: "not_started" }],
    ["running", story("active", "running"), { phase: "active" }],
    ["done at $done", story("active", "done_at_end"), { phase: "round_done" }],
    ["done mid-workflow (where a merged clean-up leaves it)", story("active", "done_mid"), { phase: "round_done" }],
    ["record done", story("done", "running"), { phase: "landed", merged: null }],
    ["record done and a PR merged into the base", story("done", "running", { pr: mergedInto("main") }), { phase: "landed", merged: "pr" }],
    ["a PR merged into the base", story("active", "running", { pr: mergedInto("main") }), { phase: "merged", via: "pr", record: null, round_done: false }],
    ["a PR with no known target", story("active", "running", { pr: { ...PR, state: "merged" } }), { phase: "merged", via: "pr", record: null, round_done: false }],
    ["an older norn's PR naming its target as base", story("active", "running", { pr: { ...PR, state: "merged", base: "main" } }), { phase: "merged", via: "pr", record: null, round_done: false }],
    ["a PR merged into another branch", story("active", "running", { pr: mergedInto("release") }), { phase: "active" }],
    ["on the base by ancestry", story("active", "running", { merged_by_ancestry: true }), { phase: "merged", via: "ancestry", record: null, round_done: false }],
    ["record dropped and a merge", story("dropped", "running", { pr: mergedInto("main") }), { phase: "merged", via: "pr", record: "dropped", round_done: false }],
    ["a merge with the round done", story("active", "done_at_end", { pr: mergedInto("main") }), { phase: "merged", via: "pr", record: null, round_done: true }],
    ["record dropped, nothing merged", story("dropped", "running"), { phase: "dropped" }],
  ];
  for (const [name, s, phase] of rows) test(name, () => expect(storyPhase(s, "main")).toEqual(phase));

  test("a PR merged into another branch is still a problem with the PR", () => {
    expect(prProblem(story("active", "running", { pr: mergedInto("release") }), "main")).toBe("remote: PR merged into release, not main");
  });

  test("the base's record never moves the phase; baseClosed reads it", () => {
    const s = story("active", "running", { base_status: "dropped" });
    expect(storyPhase(s, "main")).toEqual({ phase: "active" });
    expect(storyFinished(storyPhase(s, "main"))).toBe(false);
    expect(baseClosed(s)).toBe(true);
    expect(baseClosed(story("active", "running"))).toBe(false);
  });
});

describe("what callers read off the phase", () => {
  const cases: Array<[string, StoryFacts, { finished: boolean; merged: "pr" | "ancestry" | null; landed: boolean }]> = [
    ["not started", story("new", "none"), { finished: false, merged: null, landed: false }],
    ["running", story("active", "running"), { finished: false, merged: null, landed: false }],
    ["round done", story("active", "done_at_end"), { finished: true, merged: null, landed: false }],
    ["merged, record owed", story("active", "running", { pr: mergedInto("main") }), { finished: false, merged: "pr", landed: true }],
    ["merged by ancestry with the round done", story("active", "done_mid", { merged_by_ancestry: true }), { finished: true, merged: "ancestry", landed: true }],
    ["merged while spec.md says dropped", story("dropped", "running", { pr: mergedInto("main") }), { finished: true, merged: "pr", landed: true }],
    ["landed", story("done", "running"), { finished: true, merged: null, landed: true }],
    ["landed by a merge", story("done", "running", { pr: mergedInto("main") }), { finished: true, merged: "pr", landed: true }],
    ["dropped", story("dropped", "running"), { finished: true, merged: null, landed: false }],
    ["merged elsewhere", story("active", "running", { pr: mergedInto("release") }), { finished: false, merged: null, landed: false }],
  ];
  for (const [name, s, want] of cases)
    test(name, () => {
      const p = storyPhase(s, "main");
      expect({ finished: storyFinished(p), merged: storyMerged(p), landed: storyLanded(p) }).toEqual(want);
    });
});
