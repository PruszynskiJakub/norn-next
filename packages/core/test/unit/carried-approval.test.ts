/**
 * The carried approval at `ready`: a person's approval carries over a clean base merge
 * whose checks then passed; a resolution asks again and points at what the resolver changed.
 * Scripted receipts in (as act and the person would write them), decide and the inbox out.
 */
import { describe, expect, test } from "bun:test";
import type { Receipt, UnitState, Workflow } from "@norn/schema";
import type { Action } from "../../src/actions.ts";
import { applyReceipts } from "../../src/apply.ts";
import { receiptLine, renderBrief } from "../../src/brief.ts";
import { decide } from "../../src/decide/index.ts";
import type { NumberedReceipt, StoryBase, StoryFacts } from "../../src/facts.ts";
import { buildInbox } from "../../src/inbox/items.ts";
import { CARRIED_CLEAN, readySince } from "../../src/ready-carry.ts";
import { at, CONFIG, facts, loaded, numbered, stateFor, storyFacts, storyUnit, TICK, unitFacts } from "../fixtures.ts";

const SHA = (c: string) => c.repeat(40);

/** The light route in small: update → (test-merge | test-resolution) → open-pr → ci → ready → merge. */
const WF: Workflow = {
  name: "light",
  start: "update",
  steps: {
    update: { type: "git", action: "update", outcomes: { done: "implement", clean: "test-merge", resolved: "test-resolution", conflict: "implement" } },
    "test-merge": { type: "check", run: "true", timeout: "1m", outcomes: { pass: "open-pr", fail: "implement" } },
    "test-resolution": { type: "check", run: "true", timeout: "1m", outcomes: { pass: "open-pr", fail: "implement" } },
    implement: { type: "agent", skill: "norn-implement", outcomes: { done: { to: "open-pr", means: "done" } } },
    "open-pr": { type: "git", action: "open-pr", outcomes: { done: "ci" } },
    ci: { type: "check", run: "true", timeout: "1m", outcomes: { pass: "ready", fail: "implement", stale: "update" } },
    ready: { type: "gate", outcomes: { approve: "merge", reject: "implement", stale: "update" } },
    merge: { type: "merge", outcomes: { stale: "update" } },
  },
};

/** A story unit replayed from receipts, the way the record would hold them. */
class Story {
  state: UnitState;
  receipts: NumberedReceipt[] = [];
  constructor() {
    this.state = stateFor(storyUnit(), WF, { step: "open-pr" });
  }
  private add(kind: Receipt["kind"], body: Record<string, unknown>, by: "agent" | "human" | "norn" = "norn"): this {
    const r = { kind, receipt_id: `01JR${String(this.receipts.length).padStart(22, "0")}`, run_id: null, step: this.state.step, attempt: this.state.attempt, at: at(), by, ...body } as unknown as Receipt;
    const nr = numbered(this.receipts.length + 1, r);
    this.receipts.push(nr);
    const out = applyReceipts(this.state, [nr], { workflow: WF, now: at(), tick_id: TICK });
    expect(out.rejected).toEqual([]);
    this.state = out.state;
    return this;
  }
  /** arrive at the ready gate the first time (open-pr → ci) */
  toReady(): this {
    return this.add("classify", { outcome: "done", rule: "git.open-pr", route: "ci" }).check("pass");
  }
  approve(): this {
    return this.add("approve", { head_sha: SHA("a"), who: "jakub@mac" }, "human");
  }
  reject(): this {
    return this.add("reject", { head_sha: SHA("a"), comment: "no", who: "jakub@mac" }, "human");
  }
  stale(): this {
    return this.add("classify", { outcome: "stale", rule: "base moved", route: "update" });
  }
  update(outcome: "clean" | "resolved" | "done", merge = "1"): this {
    const history = { anchor: SHA("a"), spec_dir: ".agents/specs/gh-1-login", commits: [{ sha: SHA(merge), parents: [SHA("a"), SHA("b")], paths: ["src/x.ts"], trailers: {}, from_base: true, remerge: outcome === "clean" ? [] : ["src/x.ts"] }] };
    return this.add("classify", { outcome, rule: "git.update", route: "x", history });
  }
  check(outcome: "pass" | "fail"): this {
    return this.add("check", { outcome, command: "true", exit_code: outcome === "pass" ? 0 : 1, duration_ms: 1, output_tail: "out" });
  }
  agent(): this {
    return this.add("done", { outcome: "done", handoff: "fixed" }, "agent");
  }
  openPr(): this {
    return this.add("classify", { outcome: "done", rule: "git.open-pr", route: "ci" });
  }
  /** the gate approved, then the base moved under the merge step: clean merge, merge test, open-pr, ci */
  cleanLoop(merge = "1"): this {
    return this.stale().update("clean", merge).check("pass").openPr().check("pass");
  }
  get since() {
    return readySince(WF, this.receipts);
  }
  facts(patch: Partial<StoryFacts> = {}) {
    const uf = unitFacts(storyUnit(), WF, this.state);
    const since = this.since;
    const base: StoryBase = { ref: "refs/remotes/origin/main", sha: SHA("b"), head: SHA("9"), merge_base: SHA("b"), behind: 0, ahead: 3, conflicts: [] };
    const sf = storyFacts("gh-1", [uf], { frontmatter: { ...storyFacts("gh-1", []).frontmatter!, workflow: WF.name }, base, ...(since ? { ready_since: since } : {}), ...patch });
    return facts([sf]);
  }
  decide(patch: Partial<StoryFacts> = {}): { rule: string; action: Action } {
    const f = this.facts(patch);
    const ds = decide(f, { [WF.name]: loaded(WF) }, CONFIG);
    return ds.find((d) => d.unit === "gh-1" && d.rule !== "claim.renew") as { rule: string; action: Action };
  }
}

const items = (s: Story) => Object.values(buildInbox(s.facts(), CONFIG).groups).flat();

describe("AC1: an approval at ready carries over a clean base merge once test and CI passed", () => {
  test("norn approves on its own with a receipt marked carried, at the head the base facts measured", () => {
    const s = new Story().toReady().approve().cleanLoop();
    expect(s.state.step).toBe("ready");
    expect(s.since).toEqual({ carry: true, resolved: false, merges: [SHA("1")] });
    const d = s.decide();
    expect(d.rule).toBe("gate.carried");
    if (d.action.kind !== "apply_receipts") throw new Error(d.action.kind);
    const r = d.action.receipts[0]?.receipt;
    expect(r).toMatchObject({ kind: "approve", by: "norn", step: "ready", carried: CARRIED_CLEAN, head_sha: SHA("9") });
    expect(d.action.state?.step).toBe("merge");
  });
  test("History shows the approval as carried, not as a person's", () => {
    const s = new Story().toReady().approve().cleanLoop();
    const d = s.decide();
    const r = (d.action as Extract<Action, { kind: "apply_receipts" }>).receipts[0]!.receipt;
    expect(receiptLine(r)).toBe("ready#2 approval carried: clean base merge");
  });
  test("two clean base moves in a row still carry; the merges of both are listed", () => {
    const s = new Story().toReady().approve().cleanLoop("1").cleanLoop("2");
    expect(s.since).toEqual({ carry: true, resolved: false, merges: [SHA("1"), SHA("2")] });
    expect(s.decide().rule).toBe("gate.carried");
  });
  test("while it carries, the inbox shows no approve item for the gate", () => {
    const s = new Story().toReady().approve().cleanLoop();
    const mine = items(s).filter((i) => i.story === "gh-1");
    expect(mine.some((i) => i.group === "approve")).toBe(false);
  });
  test("no approval to carry: the first arrival at ready waits for a person", () => {
    const s = new Story().toReady();
    expect(s.since).toBeUndefined();
    expect(s.decide().rule).toBe("unit.parked.gate");
  });
  test("without the measured story head there is no head to approve: a person approves", () => {
    const s = new Story().toReady().approve().cleanLoop();
    expect(s.decide({ base: undefined }).rule).toBe("unit.parked.gate");
  });
});

describe("AC2: a resolution since the last ready approve asks a person again", () => {
  test("a resolved update waits for a person's approval", () => {
    const s = new Story().toReady().approve().stale().update("resolved").check("pass").openPr().check("pass");
    expect(s.since).toEqual({ carry: false, resolved: true, merges: [SHA("1")] });
    expect(s.decide().rule).toBe("unit.parked.gate");
  });
  test("a resolved update followed by a clean one still asks", () => {
    const s = new Story().toReady().approve().stale().update("resolved", "1").check("pass").openPr().check("pass").cleanLoop("2");
    expect(s.since?.carry).toBe(false);
    expect(s.decide().rule).toBe("unit.parked.gate");
  });
  test("once the person approves again, the next clean merge carries that approval", () => {
    const s = new Story().toReady().approve().stale().update("resolved").check("pass").openPr().check("pass").approve().cleanLoop("2");
    expect(s.since).toEqual({ carry: true, resolved: false, merges: [SHA("2")] });
    expect(s.decide().rule).toBe("gate.carried");
  });
  test("an update that took the full path (done) asks", () => {
    const s = new Story().toReady().approve().stale().update("done").agent().openPr().check("pass");
    expect(s.state.step).toBe("ready");
    expect(s.since?.carry).toBe(false);
  });
  test("a ready reject is not an approval to carry", () => {
    const s = new Story().toReady().reject().agent().openPr().check("pass");
    expect(s.since).toBeUndefined();
  });
});

describe("AC3: the ready item lists the remerge-diff commands after a resolution", () => {
  test("the approve item names one git show --remerge-diff per merge since the last approval", () => {
    const s = new Story().toReady().approve().stale().update("resolved", "1").check("pass").openPr().check("pass").cleanLoop("2");
    const item = items(s).find((i) => i.story === "gh-1" && i.group === "approve");
    expect(item?.full).toContain(`git show --remerge-diff ${SHA("1")}`);
    expect(item?.full).toContain(`git show --remerge-diff ${SHA("2")}`);
    expect(item?.detail).toContain("resolved base merge");
  });
  test("an approve item with no resolution since the approval lists none", () => {
    const s = new Story().toReady();
    const item = items(s).find((i) => i.story === "gh-1" && i.group === "approve");
    expect(item?.full ?? "").not.toContain("remerge-diff");
  });
});

describe("AC4: a red test or CI after a clean merge never reaches ready with a carried approval", () => {
  test("a red merge test sends the story to implement; back at ready, a person approves", () => {
    const s = new Story().toReady().approve().stale().update("clean").check("fail");
    expect(s.state.step).toBe("implement");
    s.agent().openPr().check("pass");
    expect(s.state.step).toBe("ready");
    expect(s.since?.carry).toBe(false);
    expect(s.decide().rule).toBe("unit.parked.gate");
  });
  test("a red CI after a clean merge: the fix is a person's to approve", () => {
    const s = new Story().toReady().approve().stale().update("clean").check("pass").openPr().check("fail");
    expect(s.state.step).toBe("implement");
    s.agent().openPr().check("pass");
    expect(s.since?.carry).toBe(false);
    expect(s.decide().rule).toBe("unit.parked.gate");
  });
  test("no check passed since the last clean update: nothing to carry", () => {
    const s = new Story().toReady().approve().stale().update("clean");
    expect(s.since?.carry).toBe(false);
  });
});

describe("AC3: the brief lists the remerge-diff commands after a resolution", () => {
  const brief = (s: Story) =>
    renderBrief({
      unit: storyUnit(),
      state: s.state,
      workflow: WF,
      mode: "auto",
      runner: "herdr",
      paths: { worktree: "/w", spec_dir: "/w/spec", story_file: "/w/spec/spec.md", slice_file: null, unit_dir: "/w/spec/runs/_story" },
      diff_range: null,
      handoff: null,
      receipts: s.receipts,
      limits: { deadline: "60m", nudges: 2, retries: 1, slot: null, port_base: null },
    });
  test("a step after a resolved base merge sees one git show --remerge-diff per merge since the ready approval", () => {
    const s = new Story().toReady().approve().stale().update("resolved", "1").check("fail");
    expect(s.state.step).toBe("implement");
    const b = brief(s);
    expect(b.json.resolved_merges).toEqual([`git show --remerge-diff ${SHA("1")}`]);
    expect(b.markdown).toContain("## Resolved base merges");
    expect(b.markdown).toContain(`git show --remerge-diff ${SHA("1")}`);
  });
  test("after a clean merge only, the brief has no such section", () => {
    const s = new Story().toReady().approve().stale().update("clean").check("fail");
    const b = brief(s);
    expect(b.json.resolved_merges).toBeNull();
    expect(b.markdown).not.toContain("## Resolved base merges");
  });
});

describe("AC3: the PR evidence lists the remerge-diff commands after a resolution", () => {
  const prBody = (s: Story) => {
    const d = s.decide();
    if (d.action.kind !== "run_git" || !d.action.pr) throw new Error(`${d.rule}: ${d.action.kind}`);
    return d.action.pr.body;
  };
  test("open-pr after a resolved base merge puts one git show --remerge-diff per merge since the ready approval in the PR body", () => {
    const s = new Story().toReady().approve().stale().update("resolved", "1").check("pass");
    expect(s.state.step).toBe("open-pr");
    const body = prBody(s);
    expect(body).toContain(`git show --remerge-diff ${SHA("1")}`);
    expect(body).toContain("Closes https://github.com/o/r/issues/1");
  });
  test("after a clean merge the PR body names none", () => {
    const s = new Story().toReady().approve().stale().update("clean").check("pass");
    expect(prBody(s)).not.toContain("remerge-diff");
  });
});
