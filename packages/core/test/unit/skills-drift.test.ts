/**
 * A unit whose worktree holds bundled skills that differ from the running norn's runs
 * as any other: its agent steps start with the worktree's copies, its gates, checks and base syncs
 * go on, and the inbox shows the difference as a Check item. Hand-built Facts.
 */
import { describe, expect, test } from "bun:test";
import type { Workflow } from "@norn/schema";
import type { Decision } from "../../src/actions.ts";
import { decide } from "../../src/decide/index.ts";
import type { Facts, StoryFacts, UnitFacts } from "../../src/facts.ts";
import { buildInbox } from "../../src/inbox/items.ts";
import { at, CONFIG, facts, loaded, numbered, receipt, SLICE_WF, sliceFile, sliceUnit, STORY_WF, stateFor, storyFacts, storyUnit, unitFacts, WORKFLOWS } from "../fixtures.ts";

const NORN = { running: "0.19.0", repo: "0.19.0" };
const DRIFT = ["norn", "norn-implement"];

/** gh-1 at its slices step with two slice units ready at implement; `drifted` slices carry skills_drift. */
function twoSlices(drifted: readonly string[], sf: Partial<StoryFacts> = {}): Facts {
  const storyU = storyUnit();
  const story = unitFacts(storyU, STORY_WF, stateFor(storyU, STORY_WF, { step: "slices", status: "ready", park: null }));
  const slice = (nn: string, slug: string): UnitFacts => {
    const u = sliceUnit("gh-1", nn, slug);
    return unitFacts(u, SLICE_WF, stateFor(u, SLICE_WF), drifted.includes(nn) ? { skills_drift: DRIFT } : {});
  };
  const s = storyFacts("gh-1", [story, slice("01", "form"), slice("02", "api")], {
    slices: [sliceFile("gh-1", "01", "form", [], "active"), sliceFile("gh-1", "02", "api", [], "active")],
    ...sf,
  });
  return facts([s], { norn: NORN });
}

const of = (ds: Decision[], key: string) => {
  const d = ds.find((x) => x.unit === key);
  return d ? { kind: d.action.kind, rule: d.rule } : undefined;
};

/** A story unit of `wf` with skills_drift, its cursor patched. */
function driftedStory(wf: Workflow, patch: Parameters<typeof stateFor>[2], uf: Partial<UnitFacts> = {}, sf: Partial<StoryFacts> = {}): Facts {
  const u = storyUnit();
  const st = stateFor(u, wf, { status: "ready", park: null, ...patch });
  const fm = storyFacts("gh-1", []).frontmatter!;
  return facts([storyFacts("gh-1", [unitFacts(u, wf, st, { skills_drift: DRIFT, ...uf })], { frontmatter: { ...fm, workflow: wf.name, refined_body_hash: fm.body_hash }, ...sf })], { norn: NORN });
}

describe("drifted skills hold nothing", () => {
  test("a drifted slice is launched like its sibling", () => {
    const ds = decide(twoSlices(["01"]), WORKFLOWS, CONFIG);
    expect(of(ds, "gh-1/01")?.kind).toBe("start_run");
    expect(of(ds, "gh-1/02")?.kind).toBe("start_run");
  });

  test("a drifted manual unit waits for a person like any manual unit", () => {
    const ds = decide(twoSlices(["01", "02"], { mode: "manual" }), WORKFLOWS, CONFIG);
    expect(of(ds, "gh-1/01")).toMatchObject({ kind: "noop", rule: "agent.ready.manual" });
    expect(of(ds, "gh-1/02")).toMatchObject({ kind: "noop", rule: "agent.ready.manual" });
  });

  test("a drifted unit at its resolve step starts the merge agent (the base cannot come in otherwise)", () => {
    const BASED: Workflow = {
      name: "based",
      start: "resolve",
      steps: {
        update: { type: "git", action: "update", outcomes: { done: "$done", conflict: { to: "resolve", counter: "loop" } } },
        resolve: { type: "agent", skill: "merge", outcomes: { done: "update" } },
      },
      counters: { loop: { max: 3 } },
    };
    const ds = decide(driftedStory(BASED, { step: "resolve" }), { ...WORKFLOWS, based: loaded(BASED) }, CONFIG);
    expect(of(ds, "gh-1")?.kind).toBe("start_run");
  });

  test("no skills_drift observed, or an empty list, launches as before", () => {
    const ds = decide(twoSlices([]), WORKFLOWS, CONFIG);
    expect(ds.filter((d) => d.action.kind === "start_run")).toHaveLength(2);
  });

  test("the drifted unit's check still starts", () => {
    const ds = decide(driftedStory(STORY_WF, { step: "test" }), WORKFLOWS, CONFIG);
    expect(of(ds, "gh-1")?.kind).toBe("run_check");
  });

  test("the drifted unit's gate approval is still applied", () => {
    const u = storyUnit();
    const st = stateFor(u, STORY_WF, { step: "ready", status: "parked", park: { kind: "gate", reason: "PR ready for review?", since: at() } });
    const approve = numbered(1, receipt(st, "approve", { outcome: "approve" }, "human"));
    const ds = decide(driftedStory(STORY_WF, { step: "ready", status: "parked", park: st.park }, { unapplied: [approve] }), WORKFLOWS, CONFIG);
    expect(of(ds, "gh-1")).toMatchObject({ rule: "receipts.apply" });
  });

  test("the drifted unit's base sync still runs", () => {
    const BASED: Workflow = {
      name: "based",
      start: "update",
      steps: {
        update: { type: "git", action: "update", outcomes: { done: "resolve" } },
        resolve: { type: "agent", skill: "merge", outcomes: { done: "$done" } },
      },
    };
    const SHA = (c: string) => c.repeat(40);
    const base = { ref: "refs/remotes/origin/main", sha: SHA("b"), head: SHA("h"), merge_base: SHA("m"), behind: 3, ahead: 1, conflicts: [] };
    const ds = decide(driftedStory(BASED, { step: "update" }, {}, { base }), { ...WORKFLOWS, based: loaded(BASED) }, CONFIG);
    expect(of(ds, "gh-1")?.kind).toBe("run_git");
  });
});

describe("drifted skills in the inbox", () => {
  test("a drifted unit is a Check item, never Unblock", () => {
    const inbox = buildInbox(twoSlices(["01"]), CONFIG);
    const items = inbox.groups.check.filter((i) => i.slice === "gh-1/01");
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({
      story: "gh-1",
      step: "implement",
      title: "skills differ from norn 0.19.0 (norn, norn-implement): runs use this worktree's copies until the base is merged in",
      command: "norn story view gh-1",
    });
    expect(inbox.groups.unblock).toEqual([]);
    expect(inbox.groups.check.some((i) => i.slice === "gh-1/02")).toBe(false);
  });

  test("a drifted manual unit is offered a start like its sibling", () => {
    const inbox = buildInbox(twoSlices(["01"], { mode: "manual" }), CONFIG);
    expect(inbox.groups.your_turn.some((i) => i.slice === "gh-1/01")).toBe(true);
    expect(inbox.groups.your_turn.some((i) => i.slice === "gh-1/02")).toBe(true);
  });

  test("B19: a drifted main checkout gives one repo-level item", () => {
    const f = twoSlices([]);
    const inbox = buildInbox({ ...f, norn: { ...NORN, skills_drift: ["norn"] } }, CONFIG);
    const repo = inbox.groups.unblock.filter((i) => i.story === "*");
    expect(repo).toHaveLength(1);
    expect(repo[0]).toMatchObject({ slice: null, step: null, title: "skills differ from norn 0.19.0: run `norn upgrade` and commit", command: "norn upgrade" });
  });

  test("B21: no drift observed (repo-local skills are never compared) → no item", () => {
    const inbox = buildInbox({ ...twoSlices([]), norn: { ...NORN, skills_drift: [] } }, CONFIG);
    expect(inbox.groups.unblock).toEqual([]);
  });

  test("a drifted unit at a check step is the same Check item, and nothing under Unblock", () => {
    const inbox = buildInbox(driftedStory(STORY_WF, { step: "test" }), CONFIG);
    expect(inbox.groups.unblock).toEqual([]);
    expect(inbox.groups.check.filter((i) => i.story === "gh-1" && i.id.startsWith("skills_drift:"))).toHaveLength(1);
  });
});

