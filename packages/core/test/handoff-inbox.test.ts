import { describe, expect, test } from "bun:test";
import { HEARTBEAT_BEGIN, collapseHeartbeat, renderHandoff, renderHandoffStatus, STATUS_BEGIN, STATUS_END } from "../src/handoff.ts";
import { buildInbox } from "../src/inbox.ts";
import { at, CONFIG, facts, SLICE_WF, sliceUnit, STORY_WF, stateFor, storyFacts, storyUnit, T0, unitFacts } from "./fixtures.ts";

const SLICE = sliceUnit("gh-1", "02", "form");

describe("handoff.md (S9, O6)", () => {
  const st = stateFor(SLICE, SLICE_WF, {
    step: "review",
    attempt: 2,
    counters: { test_loop: 1, review_loop: 2, qa_loop: 0, conflict_loop: 0 },
    status: "parked",
    park: { kind: "ask", reason: "Which DB?", since: at() },
    last_outcome: { step: "test", outcome: "pass", source: "classified", at: at(), receipt_id: "01JCCCCCCCCCCCCCCCCCCCCCCC" },
  });

  test("status block is rendered from state", () => {
    expect(renderHandoffStatus(st, { workflow: SLICE_WF })).toMatchSnapshot();
  });

  test("heartbeat repeats collapse into (×n) with the newest time", () => {
    let lines: string[] = [];
    lines = collapseHeartbeat(lines, { at: "t1", text: "implement: nudged (silent)" });
    lines = collapseHeartbeat(lines, { at: "t2", text: "implement: nudged (silent)" });
    lines = collapseHeartbeat(lines, { at: "t3", text: "implement: nudged (silent)" });
    lines = collapseHeartbeat(lines, { at: "t4", text: "implement.done → test" });
    expect(lines).toEqual(["- t3 implement: nudged (silent) (×3)", "- t4 implement.done → test"]);
  });

  test("renderHandoff replaces the status block, keeps agent sections, appends heartbeat lines", () => {
    const first = renderHandoff(null, renderHandoffStatus(st), [{ at: "t1", text: "parked: ask" }]);
    expect(first).toMatchSnapshot();
    const edited = first.replace("## Progress\n", "## Progress\n- form renders\n");
    const st2 = { ...st, status: "running" as const, park: null };
    const second = renderHandoff(edited, renderHandoffStatus(st2), [{ at: "t2", text: "parked: ask" }, { at: "t3", text: "answered" }]);
    expect(second).toContain("- form renders");
    expect(second).toContain("- Status: running");
    expect(second).not.toContain("Which DB?");
    expect(second.split(STATUS_BEGIN)).toHaveLength(2);
    expect(second.split(HEARTBEAT_BEGIN)).toHaveLength(2);
    expect(second).toContain("- t2 parked: ask (×2)\n- t3 answered\n");
    expect(renderHandoff("# Notes\n", renderHandoffStatus(st2))).toStartWith(`${STATUS_BEGIN}`);
    expect(renderHandoff("# Notes\n", renderHandoffStatus(st2))).toContain(`${STATUS_END}\n\n# Notes\n`);
  });
});

describe("inbox (O1)", () => {
  test("groups items with reason, age and exact command", () => {
    const now = T0 + 90 * 60_000;
    const ask = stateFor(sliceUnit("gh-1", "01", "a"), SLICE_WF, { status: "parked", park: { kind: "ask", reason: "Which DB?", since: at(T0), receipt_id: "01JCCCCCCCCCCCCCCCCCCCCCCC" } });
    const gate = stateFor(sliceUnit("gh-1", "02", "b"), SLICE_WF, { step: "human-qa", status: "parked", park: { kind: "gate", reason: "approve or reject human-qa", since: at(T0) } });
    const stuck = stateFor(sliceUnit("gh-1", "03", "c"), SLICE_WF, { status: "stuck", park: { kind: "exhausted", reason: "review_loop 3/3 at review.changes_requested", since: at(T0) } });
    const runningSt = stateFor(sliceUnit("gh-1", "04", "d"), SLICE_WF, { status: "running", run: { run_id: "01JDDDDDDDDDDDDDDDDDDDDDDD", step: "implement", attempt: 1, started_at: at(T0), how: "auto" } });
    const story = stateFor(storyUnit(), STORY_WF);
    const units = [
      unitFacts(storyUnit(), STORY_WF, story),
      unitFacts(sliceUnit("gh-1", "01", "a"), SLICE_WF, ask),
      unitFacts(sliceUnit("gh-1", "02", "b"), SLICE_WF, gate),
      unitFacts(sliceUnit("gh-1", "03", "c"), SLICE_WF, stuck),
      unitFacts(sliceUnit("gh-1", "04", "d"), SLICE_WF, runningSt),
    ];
    const released = storyFacts("gh-2", [unitFacts(storyUnit("gh-2"), STORY_WF, stateFor(storyUnit("gh-2"), STORY_WF))], { claim: { state: "none" } });
    const inbox = buildInbox(facts([storyFacts("gh-1", units), released], {}, now), CONFIG);
    const view = Object.fromEntries(Object.entries(inbox.groups).map(([g, items]) => [g, items.map((i) => `${i.slice ?? i.story} | ${i.title} | ${i.age} | ${i.command}`)]));
    expect(view).toEqual({
      your_turn: [`gh-1 | refine: attended step — work with the agent | 1h | cd /r-worktrees/gh-1-login && claude 'Use the norn skill, then run \`norn brief\`.'`],
      answer: ['gh-1/01 | Which DB? | 1h | norn answer gh-1/01 "…"'],
      approve: ["gh-1/02 | approve or reject human-qa | 1h | norn approve gh-1/02"],
      unblock: ["gh-1/03 | review_loop 3/3 at review.changes_requested | 1h | norn unstick gh-1/03"],
      unclaimed: ["gh-2 | Unclaimed — Login form | 2h | norn take gh-2"],
      running: ["gh-1/04 | implement #1 (auto) | 1h | norn trace gh-1/04"],
      recently_done: [],
    });
    expect(inbox.pending).toBe(5);
    expect(inbox.groups.answer[0]?.id).toBe("01JCCCCCCCCCCCCCCCCCCCCCCC");
  });

  test("manual ready step under Your turn notes the MO2 downgrade", () => {
    const st = stateFor(SLICE, SLICE_WF);
    const f = facts([storyFacts("gh-1", [unitFacts(SLICE, SLICE_WF, st)])]);
    f.machine.runner = null;
    const item = buildInbox(f, CONFIG).groups.your_turn[0];
    expect(item).toMatchObject({ title: "implement is ready (manual): start an agent in the worktree", detail: "auto requested, no runner; running manual (MO2)" });
  });
});

describe("inbox audit fixes", () => {
  test("GR6: a finished story with no claim is not 'Unclaimed'", () => {
    const unit = storyUnit("gh-7");
    const done = storyFacts("gh-7", [unitFacts(unit, STORY_WF, stateFor(unit, STORY_WF, { step: "$done", status: "done", updated_at: at() }))], { claim: { state: "none" } });
    const inbox = buildInbox(facts([done]), CONFIG);
    expect(inbox.groups.unclaimed).toEqual([]);
    const recorded = storyFacts("gh-7", [unitFacts(unit, STORY_WF, stateFor(unit, STORY_WF))], { claim: { state: "none" } });
    recorded.frontmatter = { ...recorded.frontmatter!, status: "done" };
    expect(buildInbox(facts([recorded]), CONFIG).groups.unclaimed).toEqual([]);
  });

  test("C1: a manual run that ended its turn without reporting is surfaced, once per counted nudge", () => {
    const unit = storyUnit();
    const wf = { ...STORY_WF, steps: { ...STORY_WF.steps, fix: { type: "agent" as const, skill: "implement", outcomes: { done: "test" } } } };
    const st = stateFor(unit, wf, {
      step: "fix",
      status: "running",
      park: null,
      nudges_used: 1,
      run: { run_id: "01JDDDDDDDDDDDDDDDDDDDDDDD", step: "fix", attempt: 1, started_at: at(T0 - 60_000), how: "manual" },
      last_outcome: { step: "fix", outcome: "silent", source: "classified", at: at(T0 - 1000), receipt_id: "01JCCCCCCCCCCCCCCCCCCCCCCC" },
    });
    const s = storyFacts("gh-1", [unitFacts(unit, wf, st)], { mode: "manual" });
    const item = buildInbox(facts([s]), CONFIG).groups.your_turn[0];
    expect(item).toMatchObject({ id: "silent:gh-1:fix#1:1", title: "agent ended its turn without reporting — reopen the agent and run norn brief" });
    // activity after the classification → the agent is back; nothing to surface
    s.units[0]!.run = { run_id: "01JDDDDDDDDDDDDDDDDDDDDDDD", session: null, process_alive: null, pane: null, hooks: [], last_hook_at: T0, last_activity_at: T0, transcript: null };
    expect(buildInbox(facts([s]), CONFIG).groups.your_turn).toEqual([]);
  });
});
