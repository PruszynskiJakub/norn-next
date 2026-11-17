import { describe, expect, test } from "bun:test";
import { decideContext, decideIntake, type DecisionOf, type SlicePlan, type UnitFacts, type WorkflowLoad } from "../../src/index.ts";
import {
  CONFIG,
  caps,
  change,
  claim,
  facts,
  forUnit,
  HOLDER,
  item,
  letter,
  minutesAgo,
  minutesAhead,
  NEXT_HASH,
  NEXT_WF,
  receipt,
  rules,
  SLICE_HASH,
  STORY_HASH,
  STORY_WF,
  state,
  story,
  storyDecisions,
  unit,
  workflows,
} from "./decide-story-fixtures.ts";

const intake = (items: Parameters<typeof decideIntake>[0], stories = [story()], tracker = true) =>
  decideIntake(items, decideContext(facts(stories, { capabilities: caps({}, tracker), intake: [...items] }), workflows(), CONFIG));

describe("intake", () => {
  test("an open item that is not a story yet is taken in on the workflow its label names, read once as the person's choice", () => {
    const ds = intake([item(2, { labels: ["norn:state:review", "norn:wf:polish"] })]);
    expect(ds).toEqual([{ kind: "intake_story", unit: null, rule: "intake.story", item: item(2, { labels: ["norn:state:review", "norn:wf:polish"] }), workflow: "polish" }]);
  });

  test("an item with no workflow label, or one naming a workflow that does not load, takes the config's workflow", () => {
    const failing = { ok: false as const, errors: [{ path: "/steps", message: "broken" }] };
    const ds = decideIntake(
      [item(2), item(3, { labels: ["norn:wf:deploy"] }), item(4, { labels: ["norn:wf:broken", "norn:wf:polish"] })],
      decideContext(facts([story()]), workflows({ broken: failing }), CONFIG),
    );
    expect(ds.map((d) => (d as DecisionOf<"intake_story">).workflow)).toEqual(["story", "story", "polish"]);
  });

  test("the label prefix is the config's", () => {
    const labelled = [item(2, { labels: ["norn:wf:polish", "flow/polish"] })];
    const ds = decideIntake(labelled, decideContext(facts([story()]), workflows(), { ...CONFIG, intakeWorkflowLabelPrefix: "flow/" }));
    expect((ds[0] as DecisionOf<"intake_story">).workflow).toBe("polish");
    const none = decideIntake([item(2, { labels: ["norn:wf:polish"] })], decideContext(facts([story()]), workflows(), { ...CONFIG, intakeWorkflowLabelPrefix: "flow/" }));
    expect((none[0] as DecisionOf<"intake_story">).workflow).toBe("story");
  });

  test("an item already a story, a closed item, or a repeated item is not taken in again", () => {
    const ds = intake([item(1), item(3, { open: false }), item(4), item(4)]);
    expect(ds.map((d) => (d as DecisionOf<"intake_story">).item.key)).toEqual(["gh-4"]);
  });

  test("without a tracker nothing is taken in", () => {
    expect(intake([item(2)], [], false)).toEqual([]);
  });
});

describe("claims", () => {
  test("a story nobody holds and nothing started is claimed, its units held until the claim is in", () => {
    const ds = storyDecisions(story({ claim: null, units: [] }));
    expect(ds).toEqual([
      { kind: "claim", unit: null, rule: "claim.take", story: "gh-1", expect_version: null },
      { kind: "noop", unit: "gh-1", rule: "claim.pending", reason: "waiting for the claim taken this tick" },
    ]);
  });

  test("a story whose round ended takes the claim again for a person's new round", () => {
    const u = unit("gh-1", state("gh-1", "split", { ended: "done" }), { receipts: [receipt(4, { kind: "round.started", workflow: NEXT_WF.pinned })] });
    expect(rules(storyDecisions(story({ claim: null, units: [u] })))).toEqual(["claim.take", "claim.pending"]);
  });

  test("a story in progress that nobody holds is left for a person: it was released on purpose", () => {
    const ds = storyDecisions(story({ claim: null }));
    expect(rules(ds)).toEqual(["claim.none"]);
    expect(ds.some((d) => d.kind === "claim")).toBe(false);
  });

  test("a claim held elsewhere is refused and holds every unit, slices included", () => {
    const s = story({ claim: claim({ holder: "machine-b" }), units: [unit("gh-1", state("gh-1", "split")), unit("gh-1/01", state("gh-1/01", "build"))] });
    const ds = storyDecisions(s);
    expect(ds.map((d) => [d.unit, d.rule, d.kind])).toEqual([
      ["gh-1", "claim.held_elsewhere", "noop"],
      ["gh-1/01", "claim.held_elsewhere", "noop"],
    ]);
  });

  test("another holder's expired claim is not taken over", () => {
    const ds = storyDecisions(story({ claim: claim({ holder: "machine-b", expires_at: minutesAgo(1) }) }));
    expect(rules(ds)).toEqual(["claim.held_elsewhere"]);
    expect((ds[0] as DecisionOf<"noop">).reason).toContain("expired");
  });

  test("this machine's expired claim is reacquired against the version it read", () => {
    const ds = storyDecisions(story({ claim: claim({ expires_at: minutesAgo(1) }) }));
    expect(ds[0]).toEqual({ kind: "claim", unit: null, rule: "claim.reacquire", story: "gh-1", expect_version: 7 });
    expect(rules(ds)).toEqual(["claim.reacquire", "claim.pending"]);
  });

  test("a claim near its expiry is renewed as a story action that leaves the units their one action", () => {
    const ds = storyDecisions(story({ claim: claim({ expires_at: minutesAhead(5) }) }));
    expect(ds).toEqual([{ kind: "renew_claim", unit: null, rule: "claim.renew", story: "gh-1" }]);
  });

  test("a claim far from expiry is left as it is", () => {
    expect(storyDecisions(story())).toEqual([]);
  });

  test("the claim is released once every unit ended, after the units' noops", () => {
    const s = story({ units: [unit("gh-1", state("gh-1", "split", { ended: "done" })), unit("gh-1/01", state("gh-1/01", "build", { ended: "done" }))] });
    expect(storyDecisions(s).map((d) => [d.unit, d.rule])).toEqual([
      ["gh-1", "unit.ended.done"],
      ["gh-1/01", "unit.ended.done"],
      [null, "claim.release"],
    ]);
  });

  test("a letter still in the mailbox keeps the claim", () => {
    const s = story({ units: [unit("gh-1", state("gh-1", "split", { ended: "done" }))], mailbox: [letter("m1", { unit: "gh-1", receipt: { kind: "mode.changed", mode: "auto", by: "ann" } })] });
    expect(rules(storyDecisions(s))).not.toContain("claim.release");
  });
});

describe("the change and the item", () => {
  test("a merged change marks every unit not ended done, and leaves ended units waiting", () => {
    const s = story({
      change: change({ state: "merged" }),
      units: [unit("gh-1", state("gh-1", "split")), unit("gh-1/01", state("gh-1/01", "build", { ended: "done" })), unit("gh-1/02", state("gh-1/02", "build"))],
    });
    const ds = storyDecisions(s);
    expect(ds.map((d) => [d.unit, d.rule])).toEqual([
      ["gh-1", "story.change_merged"],
      ["gh-1/01", "unit.ended.done"],
      ["gh-1/02", "story.change_merged"],
    ]);
    const done = forUnit(ds, "gh-1") as DecisionOf<"mark_done">;
    expect(done.intent.data).toEqual({ kind: "unit.marked", ended: "done", reason: "the change merged", step: "split", attempt: 1 });
  });

  test("a mark already on the record is left to the unit rules to apply", () => {
    const u = unit("gh-1", state("gh-1", "plan"), { receipts: [receipt(1, { kind: "unit.marked", ended: "done" })] });
    expect(storyDecisions(story({ change: change({ state: "merged" }), units: [u] }))).toEqual([]);
  });

  test("a merged change before the story started ends it with nothing to start", () => {
    const ds = storyDecisions(story({ claim: null, change: change({ state: "merged" }), units: [unit("gh-1", null)] }));
    expect(rules(ds)).toEqual(["story.ended"]);
  });

  test("a closed item marks the open units stuck, applying what was on the record first", () => {
    const u = unit("gh-1", state("gh-1", "plan"), { receipts: [receipt(1, { kind: "mode.changed", mode: "auto", by: "ann" })] });
    const d = storyDecisions(story({ item: item(1, { open: false }), units: [u] }))[0] as DecisionOf<"apply_receipts">;
    expect(d.rule).toBe("story.item_closed");
    expect(d.receipts.map((r) => r.data)).toEqual([{ kind: "unit.marked", ended: "stuck", reason: "the item closed", step: "plan", attempt: 1 }]);
    expect(d.state).toMatchObject({ ended: "stuck", ended_reason: "the item closed", mode: "auto", applied_through: 2 });
    expect(d.expect_version).toBe(3);
  });

  test("a merged change or a closed item stops a live run first, the order recorded, and marks the unit the tick after", () => {
    const live = { id: "run-1", step: "plan", attempt: 1, started_at: minutesAgo(5), executor: "claude", attended: false, nudges: 0 };
    const working = { activity: "working" as const, silent: false, pending_tools: 0, subagents: 0, pane_answers: 0, errors: [] };
    for (const [over, rule, why] of [
      [{ change: change({ state: "merged" }) }, "story.change_merged.stop", "the change merged"],
      [{ item: item(1, { open: false }) }, "story.item_closed.stop", "the item closed"],
    ] as const) {
      const u = unit("gh-1", state("gh-1", "plan", { run: live, applied_through: 1 }), { session: working });
      const d = storyDecisions(story({ ...over, units: [u] }))[0] as DecisionOf<"stop_run">;
      expect({ kind: d.kind, rule: d.rule, run: d.run_id, reason: d.reason, intent: d.intent?.data }).toEqual({
        kind: "stop_run",
        rule,
        run: "run-1",
        reason: why,
        intent: { kind: "stop.sent", run_id: "run-1", reason: why, step: "plan", attempt: 1 },
      });
      // the order is on the record, not yet applied: the mark follows, the order applied with it
      const ordered = unit("gh-1", state("gh-1", "plan", { run: live, applied_through: 1 }), { session: working, receipts: [receipt(2, { kind: "stop.sent", run_id: "run-1", reason: why, step: "plan", attempt: 1 })] });
      const next = storyDecisions(story({ ...over, units: [ordered] }))[0];
      expect(next?.rule).toBe(rule.replace(".stop", ""));
      if (next?.kind === "apply_receipts") expect(next.state).toMatchObject({ ended: "stuck", run: null, applied_through: 3 });
    }
  });

  test("a run already over is not stopped before the mark: a session that ended, a step run not running, or a stop already ordered", () => {
    const run = { id: "run-1", step: "plan", attempt: 1, started_at: minutesAgo(5), executor: "claude", attended: false, nudges: 0 };
    const ended = { activity: "ended" as const, silent: false, pending_tools: 0, subagents: 0, pane_answers: 0, errors: [] };
    const merged = { change: change({ state: "merged" }) };
    expect(rules(storyDecisions(story({ ...merged, units: [unit("gh-1", state("gh-1", "plan", { run }), { session: ended })] })))).toEqual(["story.change_merged"]);
    expect(rules(storyDecisions(story({ ...merged, units: [unit("gh-1", state("gh-1", "plan", { run: { ...run, stopped_at: minutesAgo(1) } }))] })))).toEqual(["story.change_merged"]);
    const slices = { ...run, step: "split", executor: "slices" };
    expect(rules(storyDecisions(story({ ...merged, units: [unit("gh-1", state("gh-1", "split", { run: slices }), { step_run: { kind: "slices", running: false } })] })))).toEqual(["story.change_merged"]);
    expect(rules(storyDecisions(story({ ...merged, units: [unit("gh-1", state("gh-1", "split", { run: slices }), { step_run: { kind: "slices", running: true } })] })))).toEqual(["story.change_merged.stop"]);
  });

  test("a change closed without merging parks the story unit for a person", () => {
    const d = storyDecisions(story({ change: change({ state: "closed", url: "https://x/5" }) }))[0] as DecisionOf<"park">;
    expect(d).toMatchObject({ kind: "park", unit: "gh-1", rule: "story.change_closed" });
    expect(d.inbox).toEqual({ kind: "stuck", unit: "gh-1", step: "plan", text: "the change https://x/5 closed without merging", since: "2026-11-17T10:00:00.000Z" });
    // the park is a receipt, and the state committed with it applies it
    expect(d.intent.data).toEqual({ kind: "unit.parked", reason: "the change https://x/5 closed without merging", step: "plan", attempt: 1 });
    expect(d.state).toMatchObject({ parked: { reason: "the change https://x/5 closed without merging", since: "2026-11-17T10:00:00.000Z" }, applied_through: 1 });
    expect(d.expect_version).toBe(3);
  });

  test("a closed change does not park a unit already parked or with a live run", () => {
    const parked = unit("gh-1", state("gh-1", "plan", { parked: { reason: "ask", since: minutesAgo(3) } }));
    expect(storyDecisions(story({ change: change({ state: "closed" }), units: [parked] }))).toEqual([]);
    const run = { id: "run-1", step: "plan", attempt: 1, started_at: minutesAgo(5), executor: "claude", attended: false, nudges: 0 };
    const working = unit("gh-1", state("gh-1", "plan", { run }));
    expect(rules(storyDecisions(story({ change: change({ state: "closed" }), units: [working] })))).not.toContain("story.change_closed");
  });

  test("a closed change parks a story waiting at a wait step, whose run stays on the record between polls", () => {
    const run = { id: "run-1", step: "split", attempt: 1, started_at: minutesAgo(5), executor: "slices", attended: false, nudges: 0 };
    const waiting = unit("gh-1", state("gh-1", "split", { run }), { step_run: { kind: "slices", running: false } });
    expect(rules(storyDecisions(story({ change: change({ state: "closed" }), units: [waiting] })))).toEqual(["story.change_closed"]);
  });
});

describe("corrupt units and pinned workflows", () => {
  test("a unit whose record failed validation is marked corrupt once: the mark is a receipt, with no state to commit", () => {
    const ds = storyDecisions(story({ units: [unit("gh-1", null, { corrupt: "state: /step must be string" })] }));
    expect(ds).toEqual([
      {
        kind: "mark_corrupt",
        unit: "gh-1",
        rule: "unit.corrupt",
        reason: "state: /step must be string",
        intent: { id: "01JD000000R7NNCSVTM7HP3B33", data: { kind: "unit.marked", ended: "corrupt", reason: "state: /step must be string" } },
        state: null,
        expect_version: null,
      },
    ]);
    const marked = storyDecisions(story({ units: [unit("gh-1", null, { corrupt: "state: /step must be string", corrupt_marked: true })] }));
    expect(marked).toEqual([{ kind: "noop", unit: "gh-1", rule: "unit.corrupt.held", reason: "state: /step must be string" }]);
  });

  test("a unit already marked corrupt is never touched", () => {
    const ds = storyDecisions(story({ units: [unit("gh-1", state("gh-1", "plan", { ended: "corrupt", ended_reason: "bad" })), unit("gh-1/01", null)] }));
    expect(rules(ds)).toEqual(["unit.corrupt.held", "story.ended", "claim.release"]);
  });

  test("a unit whose pinned workflow is not loaded is marked corrupt", () => {
    const st = state("gh-1", "plan", { workflow: { ...STORY_WF.pinned, hash: "e".repeat(64) } });
    expect(storyDecisions(story({ units: [unit("gh-1", st)] }))).toMatchObject([{ kind: "mark_corrupt", rule: "unit.workflow_missing" }]);
  });

  test("a unit at a step its pinned workflow lacks is marked corrupt", () => {
    const ds = storyDecisions(story({ units: [unit("gh-1", state("gh-1", "gone"))] }));
    const d = ds[0] as DecisionOf<"mark_corrupt">;
    expect(ds).toHaveLength(1);
    expect({ rule: d.rule, reason: d.reason, mark: d.intent.data }).toEqual({
      rule: "unit.workflow_missing",
      reason: "pinned workflow story has no step 'gone'",
      mark: { kind: "unit.marked", ended: "corrupt", reason: "pinned workflow story has no step 'gone'" },
    });
    // the readable state ends corrupt with its mark applied, so the next tick holds it
    expect({ ended: d.state?.ended, run: d.state?.run, through: d.state?.applied_through }).toEqual({ ended: "corrupt", run: null, through: 1 });
  });
});

describe("round start", () => {
  test("a held story with no run state starts its first round on the config's workflow", () => {
    const d = storyDecisions(story({ units: [unit("gh-1", null)] }))[0] as DecisionOf<"apply_receipts">;
    expect(d).toMatchObject({ kind: "apply_receipts", unit: "gh-1", rule: "round.start", expect_version: null, rejected: [] });
    expect(d.receipts.map((r) => r.data)).toEqual([{ kind: "round.started", workflow: STORY_WF.pinned }]);
    expect(d.state).toMatchObject({ unit: "gh-1", story: "gh-1", step: "plan", attempt: 1, applied_through: 1, run: null });
    expect(d.state.workflow.hash).toBe(STORY_HASH);
  });

  test("a story with no unit on the record at all starts the same way", () => {
    expect(storyDecisions(story({ units: [] })).map((d) => [d.unit, d.rule])).toEqual([["gh-1", "round.start"]]);
  });

  test("a round.started written at intake pins its workflow", () => {
    const u = unit("gh-1", null, { receipts: [receipt(1, { kind: "round.started", workflow: NEXT_WF.pinned })] });
    const d = storyDecisions(story({ units: [u] }))[0] as DecisionOf<"apply_receipts">;
    expect(d).toMatchObject({ rule: "round.start", receipts: [], rejected: [] });
    expect(d.state).toMatchObject({ step: "polish", applied_through: 1 });
  });

  test("a missing workflow parks the story with a workflow item, once: the park's receipt is all a unit with no state keeps", () => {
    const d = storyDecisions(story({ units: [unit("gh-1", null)] }), {}, workflows({ story: undefined }))[0] as DecisionOf<"park">;
    expect(d).toMatchObject({ kind: "park", rule: "round.workflow_invalid", reason: "workflow story is not loaded", inbox: { kind: "workflow", unit: "gh-1" } });
    expect({ mark: d.intent.data, state: d.state, expect: d.expect_version }).toEqual({ mark: { kind: "unit.parked", reason: "workflow story is not loaded" }, state: null, expect: null });
    const parked = unit("gh-1", null, { receipts: [receipt(1, d.intent.data)] });
    expect(storyDecisions(story({ units: [parked] }), {}, workflows({ story: undefined }))).toEqual([{ kind: "noop", unit: "gh-1", rule: "unit.parked", reason: "workflow story is not loaded" }]);
    // once the workflow loads, the round starts and the park, written before any round, is refused onto the record in the same act
    const started = storyDecisions(story({ units: [parked] }))[0] as DecisionOf<"apply_receipts">;
    expect(started.rule).toBe("round.start");
    expect(started.receipts.map((r) => r.data.kind)).toEqual(["round.started", "receipt.rejected"]);
    expect(started.state.applied_through).toBe(3);
  });

  test("an invalid workflow parks the story naming the step kind no plugin provides", () => {
    const bad: WorkflowLoad = { ok: false, errors: [{ path: "/steps/ship", message: "unknown step kind open-pr", missing_kind: "open-pr" }] };
    const d = storyDecisions(story({ units: [unit("gh-1", null)] }), {}, workflows({ story: bad }))[0] as DecisionOf<"park">;
    expect(d.rule).toBe("round.workflow_invalid");
    expect(d.reason).toContain("no configured plugin provides step kind open-pr");
  });

  test("a person's new round on an ended unit pins its workflow, the mode carried over", () => {
    const u = unit("gh-1", state("gh-1", "split", { ended: "done", mode: "auto", applied_through: 6 }), { receipts: [receipt(7, { kind: "round.started", workflow: NEXT_WF.pinned, by: "ann" })] });
    const d = storyDecisions(story({ units: [u] }))[0] as DecisionOf<"apply_receipts">;
    expect(d).toMatchObject({ rule: "round.start", receipts: [], rejected: [], expect_version: 3 });
    expect(d.state).toMatchObject({ step: "polish", attempt: 1, mode: "auto", applied_through: 7 });
    expect(d.state.ended).toBeUndefined();
    expect(d.state.workflow.hash).toBe(NEXT_HASH);
  });

  test("a round written for another step is refused onto the record", () => {
    const u = unit("gh-1", state("gh-1", "split", { applied_through: 2 }), { receipts: [receipt(3, { kind: "round.started", workflow: NEXT_WF.pinned, step: "plan" })] });
    const d = storyDecisions(story({ units: [u] }))[0] as DecisionOf<"apply_receipts">;
    expect(d.rule).toBe("receipts.reject");
    expect(d.rejected).toEqual([{ seq: 3, reason: "stale: written for plan#1, the unit is at split#1" }]);
    // the refusal is written in the same act and applied with it, so it costs no tick of its own
    expect(d.receipts.map((r) => r.data)).toEqual([{ kind: "receipt.rejected", seq: 3, reason: "stale: written for plan#1, the unit is at split#1" }]);
    expect({ step: d.state.step, through: d.state.applied_through }).toEqual({ step: "split", through: 4 });
  });

  test("a round pinning a workflow decide cannot find is refused", () => {
    const pinned = { ...NEXT_WF.pinned, hash: "f".repeat(64) };
    const u = unit("gh-1", state("gh-1", "split", { ended: "done" }), { receipts: [receipt(1, { kind: "round.started", workflow: pinned })] });
    const d = storyDecisions(story({ units: [u] }))[0] as DecisionOf<"apply_receipts">;
    expect(d.rule).toBe("round.workflow_invalid");
    expect(d.rejected[0]?.seq).toBe(1);
  });

  test("the receipts before a round are applied first, against the round they were made for", () => {
    const u = unit("gh-1", state("gh-1", "plan"), {
      receipts: [receipt(1, { kind: "mode.changed", mode: "auto", by: "ann" }), receipt(2, { kind: "round.started", workflow: NEXT_WF.pinned })],
    });
    const d = storyDecisions(story({ units: [u] }))[0] as DecisionOf<"apply_receipts">;
    expect(d.rule).toBe("receipts.apply");
    expect(d.state).toMatchObject({ step: "plan", mode: "auto", applied_through: 1 });
  });
});

describe("slices", () => {
  const at = (units: UnitFacts[] = [], plan?: SlicePlan) =>
    story({ units: [unit("gh-1", state("gh-1", "split")), ...units], ...(plan ? { plan } : {}) });
  const slice = (n: string, depends_on: string[] = [], workflow?: string) => ({ unit: `gh-1/${n}`, depends_on, ...(workflow ? { workflow } : {}) });

  test("no slice files end the step stuck", () => {
    const d = storyDecisions(at())[0] as DecisionOf<"apply_receipts">;
    expect(d.rule).toBe("slices.none");
    expect(d.receipts[0]?.data).toMatchObject({ kind: "step.finished", step_kind: "slices", outcome: "stuck", step: "split", attempt: 1 });
    expect(d.state.ended).toBe("stuck");
  });

  test("slice files that failed validation park the story", () => {
    const d = storyDecisions(at([], { slices: [], invalid: "02-x.md: depends_on must be array" }))[0] as DecisionOf<"park">;
    expect(d).toMatchObject({ rule: "slices.plan_invalid", inbox: { kind: "stuck", step: "split" } });
  });

  test("every slice whose dependencies are done starts, on its workflow; the others wait", () => {
    const ds = storyDecisions(at([unit("gh-1/01", null), unit("gh-1/02", null)], { slices: [slice("01"), slice("02", ["gh-1/01"]), slice("03", [], "slice")] }));
    expect(ds.map((d) => [d.unit, d.rule])).toEqual([
      ["gh-1", "slices.start"],
      ["gh-1/01", "slice.not_started"],
      ["gh-1/02", "slice.not_started"],
    ]);
    expect((ds[0] as DecisionOf<"start_slices">).slices).toEqual([
      { unit: "gh-1/01", workflow: "slice", hash: SLICE_HASH },
      { unit: "gh-1/03", workflow: "slice", hash: SLICE_HASH },
    ]);
  });

  test("a slice once its dependency is done starts", () => {
    const ds = storyDecisions(at([unit("gh-1/01", state("gh-1/01", "build", { ended: "done" }))], { slices: [slice("01"), slice("02", ["gh-1/01"])] }));
    expect((ds[0] as DecisionOf<"start_slices">).slices.map((s) => s.unit)).toEqual(["gh-1/02"]);
  });

  test("a slice whose workflow fails to load parks the story", () => {
    const d = storyDecisions(at([], { slices: [slice("01", [], "missing")] }))[0] as DecisionOf<"park">;
    expect(d).toMatchObject({ rule: "slices.workflow_invalid", reason: "slice gh-1/01: workflow missing is not loaded", inbox: { kind: "workflow" } });
  });

  test("no slice running and none startable ends the step stuck as blocked", () => {
    const d = storyDecisions(at([], { slices: [slice("01", ["gh-1/09"])] }))[0] as DecisionOf<"apply_receipts">;
    expect(d.rule).toBe("slices.blocked");
    expect(d.receipts[0]?.data).toMatchObject({ outcome: "stuck", detail: "no slice can start: gh-1/01 waits for gh-1/09" });
  });

  test("every active slice stuck ends the step stuck, naming them", () => {
    const stuck = unit("gh-1/01", state("gh-1/01", "build", { ended: "stuck", ended_reason: "nudges ran out" }));
    const d = storyDecisions(at([stuck, unit("gh-1/02", null, { corrupt: "bad" })], { slices: [slice("01"), slice("02"), slice("03", ["gh-1/01"])] })).find(
      (x) => x.unit === "gh-1",
    ) as DecisionOf<"apply_receipts">;
    expect(d.rule).toBe("slices.slice_stuck");
    expect(d.receipts[0]?.data).toMatchObject({ detail: "gh-1/01 stuck: nudges ran out; gh-1/02 corrupt" });
  });

  test("a slice still running keeps the step waiting", () => {
    const ds = storyDecisions(at([unit("gh-1/01", state("gh-1/01", "build"))], { slices: [slice("01"), slice("02", ["gh-1/01"])] }));
    expect(forUnit(ds, "gh-1")).toEqual({ kind: "noop", unit: "gh-1", rule: "slices.wait", reason: "0/2 slice(s) done" });
    expect(forUnit(ds, "gh-1/01")).toBeUndefined();
  });

  test("every slice done ends the step done", () => {
    const done = (n: string) => unit(`gh-1/${n}`, state(`gh-1/${n}`, "build", { ended: "done" }));
    const d = storyDecisions(at([done("01"), done("02")], { slices: [slice("01"), slice("02", ["gh-1/01"])] }))[0] as DecisionOf<"apply_receipts">;
    expect(d.rule).toBe("slices.done");
    expect(d.receipts[0]?.data).toMatchObject({ kind: "step.finished", outcome: "done" });
    expect(d.state.ended).toBe("done");
  });

  test("the slices step waits while the story unit has receipts to apply", () => {
    const s = story({ units: [unit("gh-1", state("gh-1", "split"), { receipts: [receipt(1, { kind: "mode.changed", mode: "auto", by: "ann" })] })] });
    expect(storyDecisions(s)).toEqual([]);
  });
});

describe("mailbox", () => {
  const good = letter("m1", { unit: "gh-1", receipt: { kind: "answer.sent", input_id: "i1", text: "yes", by: "ann" } });
  test("letters that validate and name a unit of the story are imported, the rest rejected", () => {
    const s = story({ mailbox: [good, letter("m2", { unit: "gh-1", receipt: { kind: "nope" } }), letter("m3", { unit: "gh-9", receipt: { kind: "mode.changed", mode: "auto", by: "x" } })] });
    expect(storyDecisions(s)).toEqual([
      { kind: "import_mailbox", unit: null, rule: "mailbox.import", story: "gh-1", ids: ["m1"] },
      { kind: "import_mailbox", unit: null, rule: "mailbox.reject", story: "gh-1", ids: ["m2", "m3"] },
    ]);
  });

  test("a store without a mailbox imports nothing", () => {
    expect(storyDecisions(story({ mailbox: [good] }), { capabilities: caps({ mailbox: false }) })).toEqual([]);
  });

  test("a story held elsewhere imports nothing", () => {
    expect(rules(storyDecisions(story({ claim: claim({ holder: "machine-b" }), mailbox: [good] })))).toEqual(["claim.held_elsewhere"]);
  });
});

describe("flush", () => {
  test("a held story on a shared store is flushed after its other decisions", () => {
    const ds = storyDecisions(story({ claim: claim({ expires_at: minutesAhead(5) }) }), { capabilities: caps({ shared: true, claims: "distributed" }) });
    expect(rules(ds)).toEqual(["claim.renew", "store.flush"]);
  });

  test("a store that is not shared is never flushed", () => {
    expect(storyDecisions(story())).toEqual([]);
  });

  test("a story this machine does not hold is never flushed", () => {
    const ds = storyDecisions(story({ claim: claim({ holder: "machine-b" }) }), { capabilities: caps({ shared: true }) });
    expect(rules(ds)).not.toContain("store.flush");
  });

  test("a story released this tick is flushed before the release", () => {
    const s = story({ units: [unit("gh-1", state("gh-1", "split", { ended: "done" }))] });
    expect(rules(storyDecisions(s, { capabilities: caps({ shared: true }) }))).toEqual(["unit.ended.done", "store.flush", "claim.release"]);
  });
});

test("the holder in the facts is who the claim is compared with", () => {
  expect(HOLDER).toBe("machine-a");
  expect(rules(storyDecisions(story(), { holder: "machine-b" }))).toEqual(["claim.held_elsewhere"]);
});
