import { describe, expect, test } from "bun:test";
import type { HookEventKind, HookFact, UnitState } from "@norn/schema";
import type { RunFacts } from "../../src/facts.ts";
import { attendedWaitSince, buildInbox } from "../../src/inbox/items.ts";
import type { PaneState } from "../../src/ports.ts";
import { at, CONFIG, facts, SLICE_WF, sliceUnit, STORY_WF, stateFor, storyFacts, storyUnit, T0, unitFacts } from "../fixtures.ts";

const RUN = "01JDDDDDDDDDDDDDDDDDDDDDDD";
const MIN = 60_000;
const STORY = storyUnit();
const WT = "/r-worktrees/gh-1-login";

const hook = (event: HookEventKind, ms: number, native = "Stop"): HookFact => ({ event, at: at(ms), agent: "claude", native, cwd: WT, run_id: RUN, agent_session_id: "sess-1" });

function runFacts(hooks: HookFact[], patch: Partial<RunFacts> = {}): RunFacts {
  const last = hooks.at(-1);
  return { run_id: RUN, session: null, process_alive: true, pane: null, hooks, last_hook_at: last ? Date.parse(last.at) : null, last_activity_at: null, transcript: null, ...patch };
}

function refining(run: RunFacts | null, patch: Partial<UnitState> = {}) {
  const st = stateFor(STORY, STORY_WF, {
    status: "running",
    run: { run_id: RUN, step: "refine", attempt: 1, started_at: at(T0), how: "manual", agent: "claude", agent_session_id: "sess-1" },
    ...patch,
  });
  return unitFacts(STORY, STORY_WF, st, { run });
}

const inboxAt = (now: number, uf: ReturnType<typeof refining>, config = CONFIG) => buildInbox(facts([storyFacts("gh-1", [uf])], {}, now), config);

describe("attended wait (HC1)", () => {
  test("starts at the first trailing waiting hook; idle_prompt does not restart it", () => {
    const uf = refining(runFacts([hook("turn_start", T0), hook("tool_use", T0 + MIN), hook("turn_end", T0 + 2 * MIN), hook("turn_end", T0 + 3 * MIN, "Notification")]));
    expect(attendedWaitSince(uf)).toBe(T0 + 2 * MIN);
  });

  test("a new turn ends the wait", () => {
    expect(attendedWaitSince(refining(runFacts([hook("turn_end", T0), hook("turn_start", T0 + MIN)])))).toBeNull();
  });

  test("permission prompts and questions count as waiting", () => {
    expect(attendedWaitSince(refining(runFacts([hook("tool_use", T0), hook("permission_prompt", T0 + MIN, "Notification")])))).toBe(T0 + MIN);
    expect(attendedWaitSince(refining(runFacts([hook("waiting_input", T0, "Notification")])))).toBe(T0);
  });

  test("a dead or ended session never waits", () => {
    expect(attendedWaitSince(refining(runFacts([hook("turn_end", T0)], { process_alive: false })))).toBeNull();
    expect(attendedWaitSince(refining(runFacts([hook("turn_end", T0), hook("session_end", T0 + MIN)])))).toBeNull();
  });

  test("with no hook since the last activity, a pane that went idle afterwards starts it", () => {
    const pane: PaneState = { alive: true, state: "idle", since: T0 + 5 * MIN };
    expect(attendedWaitSince(refining(runFacts([hook("tool_use", T0)], { pane })))).toBe(T0 + 5 * MIN);
    expect(attendedWaitSince(refining(runFacts([hook("tool_use", T0 + 6 * MIN)], { pane })))).toBeNull();
  });

  test("unattended steps and other runs are not attended waits", () => {
    const slice = sliceUnit("gh-1", "01", "a");
    const st = stateFor(slice, SLICE_WF, { status: "running", run: { run_id: RUN, step: "implement", attempt: 1, started_at: at(T0), how: "auto" } });
    expect(attendedWaitSince(unitFacts(slice, SLICE_WF, st, { run: runFacts([hook("turn_end", T0)]) }))).toBeNull();
    expect(attendedWaitSince(refining(runFacts([hook("turn_end", T0)], { run_id: "01JEEEEEEEEEEEEEEEEEEEEEEE" })))).toBeNull();
  });
});

describe("attended wait in the inbox (HC2, HC3)", () => {
  const waiting = refining(runFacts([hook("turn_start", T0), hook("turn_end", T0 + MIN)]));

  test("stays under Running until limits.attended_wait has passed", () => {
    const early = inboxAt(T0 + 2 * MIN, waiting);
    expect(early.groups.your_turn).toEqual([]);
    expect(early.groups.running[0]?.title).toBe("refine #1 (manual)");
  });

  test("then is Your turn, reached in place — never a second agent", () => {
    const inbox = inboxAt(T0 + 4 * MIN, waiting);
    expect(inbox.groups.running).toEqual([]);
    expect(inbox.groups.your_turn[0]).toMatchObject({
      id: `attended:gh-1:${RUN}:${at(T0 + MIN)}`,
      title: "refine: the agent is waiting for you",
      command: `cd ${WT}`,
      since: at(T0 + MIN),
      age: "3m",
      reach: { worktree: WT, agent_session_id: "sess-1", pane_id: null },
    });
  });

  test("a runner session is reached with the runner's command", () => {
    const session = { runner: "herdr", session_id: "w1:p2", pane_id: "w1:p2", reach: "herdr agent attach w1:p2" };
    const uf = refining(runFacts([hook("turn_end", T0)]), {
      run: { run_id: RUN, step: "refine", attempt: 1, started_at: at(T0), how: "manual", agent: "claude", session },
    });
    const item = inboxAt(T0 + 10 * MIN, uf).groups.your_turn[0];
    expect(item).toMatchObject({ command: "herdr agent attach w1:p2", reach: { pane_id: "w1:p2", agent_session_id: null } });
  });

  test("0s shows it at once; each new wait is a new item (one notification per wait)", () => {
    const now0 = { ...CONFIG, limits: { ...CONFIG.limits, attended_wait: "0s" } };
    const first = inboxAt(T0 + MIN, waiting, now0).groups.your_turn[0];
    const again = refining(runFacts([hook("turn_start", T0), hook("turn_end", T0 + MIN), hook("turn_start", T0 + 2 * MIN), hook("turn_end", T0 + 3 * MIN)]));
    const second = inboxAt(T0 + 3 * MIN, again, now0).groups.your_turn[0];
    expect(first?.id).toBeDefined();
    expect(second?.id).toBeDefined();
    expect(second?.id).not.toBe(first?.id);
  });
});
