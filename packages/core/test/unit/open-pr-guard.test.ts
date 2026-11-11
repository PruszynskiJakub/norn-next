/**
 * The open-pr guard: no change outside the spec folder reaches a gate or a merge step that lets the
 * round end without going back through `open-pr`, so the head a person merges is the commit `ci` watched.
 */
import { describe, expect, test } from "bun:test";
import { deriveUlid, type UnitState, type Workflow } from "@norn/schema";
import type { Decision } from "../../src/actions.ts";
import { decide } from "../../src/decide/index.ts";
import type { StoryFacts } from "../../src/facts.ts";
import { validateWorkflowDefinition } from "../../src/workflow.ts";
import { at, CONFIG, facts, HB, loaded, stateFor, storyFacts, storyUnit, T0, unitFacts } from "../fixtures.ts";

/** open-pr → ci → ready → merge; every rework (agent or base update) goes back through open-pr. */
const GUARD_WF: Workflow = {
  name: "guarded",
  start: "implement",
  steps: {
    implement: { type: "agent", skill: "impl", inputs: ["spec"], outcomes: { done: { to: "open-pr", means: "built" } } },
    "open-pr": { type: "git", action: "open-pr", outcomes: { done: "ci" } },
    ci: { type: "check", run: "true", timeout: "5m", outcomes: { pass: "ready", fail: { to: "fix", counter: "ci_loop" } } },
    // a gate past rework that still goes through open-pr before the round can end
    fix: { type: "agent", skill: "impl", inputs: ["spec"], outcomes: { done: { to: "check-fix", means: "fixed" } } },
    "check-fix": { type: "gate", outcomes: { approve: "open-pr", reject: { to: "fix", counter: "fix_loop" } } },
    ready: { type: "gate", outcomes: { approve: "merge", reject: { to: "implement", counter: "ready_loop" }, stale: { to: "update", counter: "stale_loop" } } },
    merge: { type: "merge", outcomes: { stale: { to: "update", counter: "stale_loop" } } },
    update: { type: "git", action: "update", outcomes: { done: "open-pr", conflict: { to: "resolve", counter: "conflict_loop" } } },
    resolve: { type: "agent", skill: "impl", inputs: ["spec"], outcomes: { done: { to: "update", means: "resolved" } } },
  },
  counters: { ci_loop: { max: 3 }, fix_loop: { max: 3 }, ready_loop: { max: 2 }, stale_loop: { max: 5 }, conflict_loop: { max: 2 } },
};

const SHA = (c: string) => c.repeat(40);
const SPEC = ".agents/specs/gh-1-login";
const OPEN_PR: NonNullable<StoryFacts["pr"]> = { number: 7, url: "https://github.com/o/r/pull/7", state: "open", is_draft: false, head_sha: SHA("a"), base_branch: "main" };

function parkedAt(step: "ready" | "merge" | "check-fix"): UnitState {
  const kind = step === "merge" ? "merge" : "gate";
  return stateFor(storyUnit(), GUARD_WF, { step, status: "parked", park: { kind, reason: "waiting", since: at() }, visits: { [step]: 1 } });
}

function tick(st: UnitState, patch: Partial<StoryFacts>): Decision {
  const uf = unitFacts(storyUnit(), GUARD_WF, st);
  const fm = { ...storyFacts("gh-1", []).frontmatter!, workflow: GUARD_WF.name };
  const claim: StoryFacts["claim"] = { state: "mine", sha: "c", blob: { version: 1, story: "gh-1", holder: "jakub@mac", heartbeat_id: HB, acquired_at: at(), renewed_at: at(), expires_at: at(T0 + 600_000), last_tick_id: null } };
  const sf = storyFacts("gh-1", [uf], { frontmatter: fm, claim, spec_dir: SPEC, pr: OPEN_PR, ...patch });
  const f = facts([sf], { tick_id: deriveUlid("01JAAAAAAAAAAAAAAAAAAAAAAA", 1) });
  return decide(f, { [GUARD_WF.name]: loaded(GUARD_WF) }, CONFIG).find((d) => d.unit === "gh-1" && d.rule !== "claim.renew") as Decision;
}

describe("open-pr guard: workflow validation", () => {
  test("a workflow whose every change goes back through open-pr before ready or merge validates", () => {
    expect(validateWorkflowDefinition(GUARD_WF).issues).toEqual([]);
  });

  test("an agent step between open-pr and a gate that lets the round end is refused with the path", () => {
    const wf = { ...GUARD_WF, steps: { ...GUARD_WF.steps, ready: { type: "gate", outcomes: { approve: "merge", reject: { to: "rework", counter: "ready_loop" } } }, rework: { type: "agent", skill: "impl", inputs: ["spec"], outcomes: { done: { to: "ready", means: "reworked" } } } } };
    const check = validateWorkflowDefinition(wf);
    expect(check.ok).toBe(false);
    const issue = check.issues.find((i) => i.code === "open_pr_bypass");
    expect(issue).toMatchObject({ path: "/steps/ready" });
    expect(issue?.message).toContain("open-pr → ci → ready → rework → ready");
    expect(issue?.message).toContain("without going through open-pr again");
  });

  test("a git: update between open-pr and the merge step is refused; a gate the round cannot end from is not", () => {
    const wf = { ...GUARD_WF, steps: { ...GUARD_WF.steps, update: { type: "git", action: "update", outcomes: { done: "merge", conflict: { to: "resolve", counter: "conflict_loop" } } } } };
    const check = validateWorkflowDefinition(wf);
    expect(check.ok).toBe(false);
    const issues = check.issues.filter((i) => i.code === "open_pr_bypass");
    expect(issues.map((i) => i.path)).toEqual(["/steps/merge"]);
    expect(issues[0]?.message).toContain("update → merge");
  });
});

describe("open-pr guard: a story waiting where the round can end", () => {
  test("a change outside the spec folder that the PR head lacks sends the story back to open-pr with a receipt", () => {
    for (const step of ["ready", "merge"] as const) {
      const d = tick(parkedAt(step), { pr_unpushed: ["src/a.ts", `${SPEC}/handoffs/story.md`] });
      expect(d.rule).toBe("open_pr.guard");
      expect(d.action).toMatchObject({ kind: "classify", outcome: "unpushed", state: { step: "open-pr", status: "ready" } });
      const r = "receipts" in d.action ? d.action.receipts[0]?.receipt : undefined;
      expect(r).toMatchObject({ kind: "classify", step, outcome: "unpushed", route: "open-pr", detail: "changes since open-pr are not on the PR: src/a.ts" });
    }
  });

  test("spec-folder-only differences stay local and the story keeps waiting", () => {
    expect(tick(parkedAt("ready"), { pr_unpushed: [`${SPEC}/handoffs/story.md`, `${SPEC}/spec.md`] }).rule).toBe("unit.parked.gate");
    expect(tick(parkedAt("merge"), { pr_unpushed: [`${SPEC}/pr.md`] }).rule).toBe("unit.parked.merge");
    expect(tick(parkedAt("merge"), {}).rule).toBe("unit.parked.merge");
  });

  test("a gate the round cannot end from without open-pr keeps waiting; between syncs the guard waits for one", () => {
    expect(tick(parkedAt("check-fix"), { pr_unpushed: ["src/a.ts"] }).rule).toBe("unit.parked.gate");
    expect(tick(parkedAt("ready"), { pr: undefined, pr_seen: { pr: OPEN_PR, observed_at: T0 }, pr_unpushed: ["src/a.ts"] }).rule).toBe("open_pr.guard.awaits_sync");
    // no open PR: nothing to guard
    expect(tick(parkedAt("ready"), { pr: null, pr_unpushed: ["src/a.ts"] }).rule).toBe("unit.parked.gate");
  });
});
