/**
 * Counters derived from their edge reach core already written into the pinned workflow, under
 * `<step>.<outcome>`: apply counts and parks on them, the inbox and the brief name them, exactly as
 * they do a counter declared by hand.
 */
import { describe, expect, test } from "bun:test";
import type { Receipt, UnitState, Workflow } from "@norn/schema";
import { applyReceipts } from "../../src/apply.ts";
import { type BriefInput, renderBrief } from "../../src/brief.ts";
import { buildInbox } from "../../src/inbox/items.ts";
import { at, CONFIG, facts, numbered, receipt, SLICE_WF, sliceUnit, stateFor, storyFacts, storyUnit, STORY_WF, unitFacts } from "../fixtures.ts";

const SLICE = sliceUnit("gh-1", "02", "form");
const RUN = "01JDDDDDDDDDDDDDDDDDDDDDDD";

/** The slice fixture as the loader pins it once its default counters are derived instead of declared. */
function derivedSlice(): Workflow {
  const wf = structuredClone(SLICE_WF);
  const s = wf.steps as Record<string, { outcomes: Record<string, unknown> }>;
  s.test!.outcomes.fail = { to: "implement", counter: "test.fail" };
  s.review!.outcomes.changes_requested = { to: "implement", counter: "review.changes_requested", means: "blocking findings in the receipt" };
  s.integrate!.outcomes.conflict = { to: "merge", counter: "integrate.conflict" };
  wf.counters = {
    "test.fail": { max: 5 },
    "review.changes_requested": { max: 3 },
    qa_loop: { max: 2 },
    "integrate.conflict": { max: 2, reset_on: ["integrate.done"] },
  };
  return wf;
}
const DERIVED = derivedSlice();

/** Apply receipts one at a time, each built against the then-current cursor. */
function run(st: UnitState, wf: Workflow, ...make: Array<(s: UnitState) => Receipt>): UnitState {
  for (const m of make) st = applyReceipts(st, [numbered(st.applied_through + 1, m(st))], { workflow: wf, now: at() }).state;
  return st;
}
const started = (s: UnitState) => ({ ...receipt(s, "started", { how: "manual", worktree: "/w" }), run_id: RUN });
const done = (outcome: string) => (s: UnitState) => receipt(s, "done", { outcome, handoff: "h" });
const check = (outcome: string) => (s: UnitState) => receipt(s, "check", { outcome, command: "bun test", exit_code: outcome === "pass" ? 0 : 1, duration_ms: 5, output_tail: "" }, "norn");
const classify = (outcome: string) => (s: UnitState) => receipt(s, "classify", { outcome, rule: "t", route: "park" }, "norn");

/** review sends the work back, implement and test bring it round to review again. */
const sendBack = [started, done("changes_requested"), started, done("done"), check("pass")];
const atReview = () => stateFor(SLICE, DERIVED, { step: "review", visits: { implement: 1, review: 1 } });

describe("a derived counter in apply and the inbox", () => {
  test("a fourth send-back parks exhausted naming `review.changes_requested` with its edge and target, and the Unblock item names it the same way", () => {
    const at3 = run(atReview(), DERIVED, ...sendBack, ...sendBack, ...sendBack);
    expect(at3).toMatchObject({ step: "review", counters: { "review.changes_requested": 3 } });
    const st = run(at3, DERIVED, started, done("changes_requested"));
    expect(st).toMatchObject({ step: "review", status: "stuck" });
    expect(st.park).toMatchObject({ kind: "exhausted", reason: "review.changes_requested 3/3 at review.changes_requested" });
    expect(st.park?.counter).toEqual({ name: "review.changes_requested", max: 3, outcome: "changes_requested", to: "implement" });

    const units = [unitFacts(storyUnit(), STORY_WF, stateFor(storyUnit(), STORY_WF)), unitFacts(SLICE, DERIVED, st)];
    const unblock = buildInbox(facts([storyFacts("gh-1", units)]), CONFIG).groups.unblock.map((i) => `${i.slice} | ${i.title} | ${i.command}`);
    expect(unblock).toEqual(["gh-1/02 | review.changes_requested 3/3 at review.changes_requested | norn run rerun gh-1/02 --step implement --reset review.changes_requested"]);
  });
});

describe("a derived counter in the brief", () => {
  const input = (st: UnitState): BriefInput => ({
    unit: SLICE,
    state: st,
    workflow: DERIVED,
    mode: "auto",
    runner: "herdr",
    paths: {
      worktree: "/r-worktrees/gh-1-login--02-form",
      spec_dir: ".agents/specs/gh-1-login",
      story_file: ".agents/specs/gh-1-login/story.md",
      slice_file: ".agents/specs/gh-1-login/slices/02-form.md",
      unit_dir: ".agents/specs/gh-1-login/runs/02-form",
    },
    diff_range: "gh-1-login...HEAD",
    handoff: null,
    receipts: [],
    limits: { deadline: "60m", nudges: 2, retries: 1, slot: 3, port_base: 4030 },
  });

  test("with the counter at 2 of 3, the brief for the implement step its next send-back starts warns of the last round on `review.changes_requested`", () => {
    const at2 = run(atReview(), DERIVED, ...sendBack, ...sendBack);
    expect(at2.counters["review.changes_requested"]).toBe(2);
    const st = run(at2, DERIVED, started, done("changes_requested"));
    expect(st).toMatchObject({ step: "implement", status: "ready", counters: { "review.changes_requested": 3 } });
    const b = renderBrief(input(st));
    expect(b.json.where.at_limit).toEqual([{ name: "review.changes_requested", value: 3, max: 3 }]);
    expect(b.markdown).toContain("**Last round on `review.changes_requested` (3/3):** if the work is sent back along it once more, the unit goes stuck.");
  });
});

describe("integrate.conflict keeps today's conflict_loop bound", () => {
  const atIntegrate = (wf: Workflow) => stateFor(SLICE, wf, { step: "integrate", visits: { integrate: 1 } });
  const conflictRound = [classify("conflict"), started, done("done")];

  test("two conflicts go to merge, the third parks exhausted, as with conflict_loop", () => {
    for (const [wf, name] of [[SLICE_WF, "conflict_loop"], [DERIVED, "integrate.conflict"]] as const) {
      const two = run(atIntegrate(wf), wf, ...conflictRound, ...conflictRound);
      expect(two).toMatchObject({ step: "integrate", status: "ready", counters: { [name]: 2 } });
      const third = run(two, wf, classify("conflict"));
      expect(third).toMatchObject({ step: "integrate", status: "stuck", park: { kind: "exhausted", counter: { name, max: 2, outcome: "conflict", to: "merge" } } });
    }
  });

  test("integrate.done after a conflict ends the run at $done, as with conflict_loop", () => {
    for (const wf of [SLICE_WF, DERIVED]) {
      expect(run(atIntegrate(wf), wf, ...conflictRound, classify("done"))).toMatchObject({ step: "$done", status: "done" });
    }
  });
});
