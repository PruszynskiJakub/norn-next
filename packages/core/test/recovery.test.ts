/**
 * Auto-mode recovery in decide and the inbox (SPEC-auto-mode-recovery R4, R5, R7):
 *   - R4.2: a nudge is typed (`send`), else resumed (`--resume` + nudge text), else a counted retry
 *   - R4.3: a failed act effect is an Unblock item while it applies
 *   - R5.1/R5.2: a run whose `started` receipt was never applied is adopted when found, `died` after
 *     2 watch intervals when not; R5.3: no new run beside an active one of the same step
 *   - R5.5: a heartbeat that is down is an Unblock item and auto steps get no manual hint
 *   - R7: runs record their machine; a foreign run is judged by hooks and the claim, never by pid
 */
import { describe, expect, test } from "bun:test";
import type { UnitState } from "@norn/schema";
import type { Action } from "../src/actions.ts";
import { NUDGE_TEXT } from "../src/commands.ts";
import { decide } from "../src/decide/index.ts";
import type { ActFailure, Facts, RunFacts, StoryFacts, UnitFacts } from "../src/facts.ts";
import { actFailureItem, buildInbox, heartbeatDown } from "../src/inbox/items.ts";
import { at, CONFIG, facts, HB, numbered, receipt, SOLO_WF, stateFor, storyFacts, storyUnit, T0, TICK, unitFacts, WORKFLOWS } from "./fixtures.ts";

const RUN = "01JDDDDDDDDDDDDDDDDDDDDDDD";
const OTHER_RUN = "01JEEEEEEEEEEEEEEEEEEEEEEE";
const WT = "/r-worktrees/gh-1-login";
const decisions = (f: Facts) => decide(f, WORKFLOWS, CONFIG).map((d) => `${d.unit} ${d.action.kind} ${d.rule}`);
const only = (f: Facts): Action => {
  const d = decide(f, WORKFLOWS, CONFIG).find((x) => x.unit === "gh-1");
  if (!d) throw new Error("no decision for gh-1");
  return d.action;
};

function solo(patch: Partial<UnitState> = {}, run: Partial<RunFacts> | null = null, unit: Partial<UnitFacts> = {}, story: Partial<StoryFacts> = {}): StoryFacts {
  const ref = storyUnit();
  const st = stateFor(ref, SOLO_WF, patch);
  const rf: RunFacts | null = run && { run_id: RUN, session: { runner: "herdr", session_id: "s1" }, process_alive: true, pane: null, hooks: [], last_hook_at: null, last_activity_at: T0, transcript: null, ...run };
  return storyFacts("gh-1", [unitFacts(ref, SOLO_WF, st, { run: rf, ...unit })], { ...story, frontmatter: { ...storyFacts("gh-1", []).frontmatter!, workflow: "solo" } });
}
const running = (p: Partial<UnitState> = {}, session: { runner: string; session_id: string } = { runner: "herdr", session_id: "s1" }): Partial<UnitState> => ({
  status: "running",
  run: { run_id: RUN, step: "implement", attempt: 1, started_at: at(T0 - 20 * 60_000), how: "auto", session, agent: "claude", agent_session_id: "cs-1" },
  updated_at: at(T0 - 20 * 60_000),
  ...p,
});
/** quiet for longer than the stalled window (15m) */
const stalled = { last_activity_at: T0 - 16 * 60_000 };
const withRunner = (f: Facts, runner: string, caps: { send: boolean; resume: boolean }): Facts => ({ ...f, machine: { ...f.machine, runner, runner_capabilities: caps } });

describe("R4.2: nudge delivery by runner capability", () => {
  test("a runner that types gets the nudge typed into the live session", () => {
    const a = only(withRunner(facts([solo(running(), stalled)]), "herdr", { send: true, resume: true }));
    expect(a).toMatchObject({ kind: "nudge", rule: "agent.stalled.nudge", input: { session: { session_id: "s1" }, text: NUDGE_TEXT }, launch: null, kill: null });
  });

  test("headless stalled: the old process is killed and the agent session resumed with the nudge text", () => {
    const f = withRunner(facts([solo(running({}, { runner: "headless", session_id: RUN }), { ...stalled, session: { runner: "headless", session_id: RUN } })]), "headless", { send: false, resume: true });
    const a = only(f);
    expect(a).toMatchObject({
      kind: "nudge",
      rule: "agent.stalled.nudge.resume",
      input: null,
      kill: { runner: "headless", session_id: RUN },
      launch: { run_id: RUN, agent: "claude", cwd: WT, prompt: NUDGE_TEXT, resume: "cs-1" },
      state: { status: "running", nudges_used: 1, applied_through: 2, run: { run_id: RUN, agent_session_id: "cs-1" } },
    });
    if (a.kind !== "nudge") return;
    expect(a.receipts.map((r) => [r.n, r.receipt.kind])).toEqual([
      [1, "classify"],
      [2, "started"],
    ]);
    expect(a.receipts[0]?.receipt).toMatchObject({ outcome: "stalled", route: "nudge", counter: { name: "nudges", value: 1, max: 2 } });
    expect(a.receipts[1]?.receipt).toMatchObject({ run_id: RUN, how: "auto", agent_session_id: "cs-1" });
  });

  test("a runner that can neither type nor resume: a fresh session, counted as a retry", () => {
    const f = withRunner(facts([solo(running({}, { runner: "plain", session_id: "x1" }), { ...stalled, session: { runner: "plain", session_id: "x1" } })]), "plain", { send: false, resume: false });
    const a = only(f);
    expect(a).toMatchObject({ kind: "retry_fresh", rule: "agent.stalled.retry.no_nudge", kill: { runner: "plain", session_id: "x1" }, state: { nudges_used: 0, retries_used: 1, status: "running" } });
    if (a.kind !== "retry_fresh") return;
    expect(a.receipts[0]?.receipt).toMatchObject({ kind: "classify", outcome: "stalled", route: "retry", counter: { name: "retries", value: 1, max: 1 } });
    expect(a.launch?.run_id).not.toBe(RUN);
    // retries spent: the fallback exhausts like a died run would
    const spent = only(withRunner(facts([solo(running({ retries_used: 1 }, { runner: "plain", session_id: "x1" }), { ...stalled, session: { runner: "plain", session_id: "x1" } })]), "plain", { send: false, resume: false }));
    expect(spent).toMatchObject({ kind: "classify", state: { status: "stuck", park: { kind: "exhausted", reason: "stalled: retries 1/1 at implement" } } });
  });

  test("resume without an agent session id to resume falls through to the retry too", () => {
    const st = running({}, { runner: "headless", session_id: RUN });
    delete st.run?.agent_session_id;
    const a = only(withRunner(facts([solo(st, { ...stalled, session: { runner: "headless", session_id: RUN } })]), "headless", { send: false, resume: true }));
    expect(a).toMatchObject({ kind: "retry_fresh", rule: "agent.stalled.retry.no_nudge" });
  });
});

describe("R5: launch unknown, adoption and no second run", () => {
  const started = (st: UnitState, body: Record<string, unknown> = {}) => receipt({ ...st, run: { run_id: RUN, step: "implement", attempt: 1, started_at: at(), how: "auto" } }, "started", { how: "auto", agent: "claude", worktree: WT, machine: "jakub@mac", heartbeat_id: HB, ...body }, "norn");
  function unknown(run: Partial<RunFacts>, startedAt = T0 - 10_000): StoryFacts {
    const s = solo({}, null);
    const u = s.units[0] as UnitFacts;
    const r = { ...started(u.state as UnitState), at: at(startedAt) };
    u.unapplied = [numbered(1, r)];
    u.run = { run_id: RUN, session: null, process_alive: null, pane: null, hooks: [], last_hook_at: null, last_activity_at: null, transcript: null, launch_unknown: { n: 1, at: startedAt, agent_session_id: null }, ...run };
    return s;
  }

  test("found by the runner → adopted: the session is recorded and the step runs on", () => {
    const a = only(facts([unknown({ session: { runner: "herdr", session_id: "w1:p2", pane_id: "w1:p2", process: { pid: 7, pid_start: "x" } }, process_alive: true })]));
    expect(a).toMatchObject({ kind: "apply_receipts", rule: "run.adopt", applied: [1, 2], launch: null, state: { status: "running", applied_through: 2, run: { run_id: RUN, session: { session_id: "w1:p2" }, process: { pid: 7 } } } });
    expect(a.kind === "apply_receipts" && a.receipts[0]?.receipt).toMatchObject({ kind: "started", run_id: RUN, session: { runner: "herdr", session_id: "w1:p2" } });
  });

  test("found by its hooks only → adopted with the agent session id", () => {
    const hook = { event: "tool_use" as const, at: at(T0 - 5000), agent: "claude", native: "PreToolUse", cwd: WT, run_id: RUN, agent_session_id: "cs-9" };
    const s = unknown({ hooks: [hook], last_hook_at: T0 - 5000 });
    (s.units[0] as UnitFacts).run!.launch_unknown!.agent_session_id = "cs-9";
    expect(only(facts([s]))).toMatchObject({ kind: "apply_receipts", rule: "run.adopt", state: { status: "running", run: { run_id: RUN, agent_session_id: "cs-9" } } });
  });

  test("not found: wait 2 watch intervals, then `died` (counted) and a fresh run", () => {
    expect(decisions(facts([unknown({}, T0 - 50_000)]))).toEqual(["gh-1 noop run.launch_unknown.wait"]);
    const a = only(facts([unknown({}, T0 - 61_000)]));
    expect(a).toMatchObject({ kind: "retry_fresh", rule: "agent.died.launch_unknown.retry", kill: null, state: { status: "running", retries_used: 1, applied_through: 3 } });
    if (a.kind !== "retry_fresh") return;
    expect(a.receipts.map((r) => [r.n, r.receipt.kind])).toEqual([
      [2, "classify"],
      [3, "started"],
    ]);
    expect(a.receipts[0]?.receipt).toMatchObject({ outcome: "died", rule: "agent.died.launch_unknown", run_id: RUN, counter: { name: "retries", value: 1, max: 1 } });
    expect(a.launch?.run_id).not.toBe(RUN);
  });

  test("R5.3: no new run while a run of the step shows hook activity; an ended one does not block", () => {
    const active = solo({}, null, { step_runs: [{ run_id: OTHER_RUN, last_hook_at: T0 - 60_000, ended: false }] });
    expect(decisions(facts([active]))).toEqual(["gh-1 noop agent.start.wait_active"]);
    const ended = solo({}, null, { step_runs: [{ run_id: OTHER_RUN, last_hook_at: T0 - 60_000, ended: true }] });
    expect(decisions(facts([ended]))).toEqual(["gh-1 start_run agent.start"]);
    const quiet = solo({}, null, { step_runs: [{ run_id: OTHER_RUN, last_hook_at: T0 - 16 * 60_000, ended: false }] });
    expect(decisions(facts([quiet]))).toEqual(["gh-1 start_run agent.start"]);
  });

  test("R5.3: an answer that would resume waits too while another run of the step is active", () => {
    const s = solo(running({ status: "parked", park: { kind: "ask", reason: "Q?", since: at() } }, { runner: "headless", session_id: RUN }), { process_alive: false, session: { runner: "headless", session_id: RUN } }, { step_runs: [{ run_id: OTHER_RUN, last_hook_at: T0 - 1000, ended: false }] });
    const u = s.units[0] as UnitFacts;
    u.unapplied = [numbered(1, receipt(u.state as UnitState, "answer", { answer: "yes" }, "human"))];
    expect(decisions(withRunner(facts([s]), "headless", { send: false, resume: true }))).toEqual(["gh-1 noop answer.resume.wait_active"]);
  });
});

describe("R7: liveness across machines", () => {
  test("started receipts record the machine and heartbeat", () => {
    const a = only(facts([solo()]));
    expect(a.kind === "start_run" && a.receipts[0]?.receipt).toMatchObject({ kind: "started", machine: "jakub@mac", heartbeat_id: HB });
    expect(a.kind === "start_run" && a.state?.run).toMatchObject({ machine: "jakub@mac", heartbeat_id: HB });
  });

  test("a foreign run after a take: no pid check; died with the foreign rule once quiet for the stalled window", () => {
    const foreign = (takenAgo: number) =>
      solo(
        running({ run: { ...running().run!, machine: "ann@pc", heartbeat_id: "01JFFFFFFFFFFFFFFFFFFFFFFF", started_at: at(T0 - 60 * 60_000 + 60_000) }, updated_at: at(T0 - 60 * 60_000) }),
        { process_alive: false, pane: { alive: false, state: "unknown", since: null }, last_activity_at: null },
        {},
        { claim: { state: "mine", sha: "c1", blob: { version: 1, story: "gh-1", holder: "jakub@mac", heartbeat_id: HB, acquired_at: at(T0 - takenAgo), renewed_at: at(), expires_at: at(T0 + 600_000), last_tick_id: null } } },
      );
    // a local pid / pane reading "dead" is ignored for a run of another machine
    expect(decisions(facts([foreign(60_000)]))).toEqual(["gh-1 noop agent.running.foreign"]);
    const a = only(facts([foreign(16 * 60_000)]));
    expect(a).toMatchObject({ kind: "retry_fresh", rule: "agent.died.foreign.retry", kill: null });
    expect(a.kind === "retry_fresh" && a.receipts[0]?.receipt).toMatchObject({ kind: "classify", outcome: "died", rule: "agent.died.foreign", detail: "foreign run, holder changed" });
  });
});

describe("R4.3 / R5.5: inbox items", () => {
  const failure = (p: Partial<ActFailure> = {}): ActFailure => ({ effect: "nudge", rule: "agent.stalled.nudge", reason: "nudge to gh-1 not delivered: herdr agent prompt: blocked", at: at(T0 - 60_000), tick_id: TICK, step: "implement", attempt: 1, ...p });

  test("a failed nudge is an Unblock item until the cursor moves or the agent shows activity", () => {
    const s = solo(running(), { last_activity_at: T0 - 120_000 }, { act_failure: failure() });
    const item = actFailureItem(s, s.units[0] as UnitFacts);
    expect(item).toMatchObject({ group: "unblock", title: "nudge to gh-1 not delivered: herdr agent prompt: blocked", command: `norn run view gh-1 --why --tick ${TICK}` });
    expect(buildInbox(facts([s]), CONFIG).groups.unblock.map((i) => i.id)).toEqual([`failed:gh-1:${TICK}`]);
    const moved = solo(running({ attempt: 2 }), { last_activity_at: T0 - 120_000 }, { act_failure: failure() });
    expect(actFailureItem(moved, moved.units[0] as UnitFacts)).toBeNull();
    const active = solo(running(), { last_activity_at: T0 }, { act_failure: failure() });
    expect(actFailureItem(active, active.units[0] as UnitFacts)).toBeNull();
    // a refused push stays until a push succeeds, whatever the agent does
    const push = solo(running(), { last_activity_at: T0 }, { act_failure: failure({ effect: "push", reason: "push of gh-1-login failed: rejected" }) });
    expect(actFailureItem(push, push.units[0] as UnitFacts)?.title).toBe("push of gh-1-login failed: rejected");
  });

  test("heartbeat down with auto work held here: Unblock item, and a ready auto step waits for `norn watch`", () => {
    const f = { ...facts([solo()]), heartbeat: { last_tick_at: T0 - 7 * 60_000 } };
    expect(heartbeatDown(f, CONFIG)).toMatchObject({ holder: "jakub@mac", for_ms: 7 * 60_000 });
    const inbox = buildInbox(f, CONFIG);
    expect(inbox.groups.unblock.map((i) => [i.title, i.command])).toEqual([["no heartbeat on jakub@mac for 7m — run `norn watch`", "norn watch"]]);
    expect(inbox.groups.running.map((i) => [i.title, i.command])).toEqual([["implement #1 (waiting for the heartbeat — norn watch)", "norn watch"]]);
    // a recent tick, a manual story or no observation → no item
    expect(heartbeatDown({ ...f, heartbeat: { last_tick_at: T0 - 60_000 } }, CONFIG)).toBeNull();
    expect(heartbeatDown({ ...facts([solo({}, null, {}, { mode: "manual" })]), heartbeat: { last_tick_at: null } }, CONFIG)).toBeNull();
    expect(heartbeatDown(facts([solo()]), CONFIG)).toBeNull();
  });
});
