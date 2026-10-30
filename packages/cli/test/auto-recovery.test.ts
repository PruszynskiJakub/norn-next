/**
 * Auto-mode recovery end to end (SPEC-auto-mode-recovery §4 acceptance 5–8, 10), one clone each:
 *   - R4.2/R4.3: a failed nudge send is `ok: false`, an Unblock item and shown in status; a runner
 *     without `send` resumes the agent session with the nudge text
 *   - R5.1–R5.3: a `started` receipt without state is adopted when the runner finds the run, `died`
 *     after 2 watch intervals when nothing does; no new run beside one with hook activity
 *   - R5.4: ticks bracket act with `tick.start` / `tick.end`; `why` explains a tick that crashed
 *   - R5.5: a stale `last_tick_at` with auto work is an inbox item and removes the manual hint
 *   - R7: a run started on another machine is never judged by this machine's pid or pane
 */
import { afterAll, beforeAll, describe, expect, setDefaultTimeout, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { type Inbox, NUDGE_TEXT } from "@norn/core";
import { type TickStartTrace, type UnitState, ulid } from "@norn/schema";
import { appendHookTrace, appendTrace, readTrace, writeState } from "@norn/store";
import type { ProjectView } from "@norn/view";
import type { TickReport } from "../src/index.ts";
import { createHarness, type Harness, issue } from "./harness.ts";

// whole flows over real git, several ticks each: 5 s is too tight on a loaded machine (full suite)
setDefaultTimeout(30_000);

const SOLO = `name: solo
start: implement
steps:
  implement:
    type: agent
    skill: norn-implement
    nudges: 2
    retries: 1
    outcomes: { done: $done }
`;

const CONFIG = `agents:
  claude: { adapter: claude }
runner: { adapter: headless }
remote: { provider: gh, label: norn }
default_workflow: solo
default_mode: auto
`;

const SPEC = ".agents/specs/gh-9-fix-the-bug";
const acted = (r: TickReport) => r.decisions.filter((d) => d.kind !== "noop" && d.rule !== "claim.renew").map((d) => `${d.unit} ${d.rule}${d.ok ? "" : ` FAILED ${d.error}`}`);
const rules = (r: TickReport) => r.decisions.filter((d) => d.rule !== "claim.renew").map((d) => `${d.unit} ${d.rule}`);

async function boot(h: Harness): Promise<void> {
  expect((await h.norn("init")).exit).toBe(0);
  h.write(join(h.root, ".agents/norn/config.yaml"), CONFIG);
  h.write(join(h.root, ".agents/norn/workflows/solo.yaml"), SOLO);
  h.git(["add", "-A"]);
  h.git(["commit", "-q", "-m", "norn"]);
  h.git(["push", "-q", "origin", "main"]);
  h.remote.issues = [issue(9, "Fix the bug")];
}

const wt = (h: Harness) => `${h.root}-worktrees/gh-9-fix-the-bug`;
const runs = (h: Harness) => join(wt(h), SPEC, "runs/_story");

/** Tick until the story unit's agent runs (intake → claim → start → launch). */
async function untilRunning(h: Harness): Promise<UnitState> {
  for (let i = 0; i < 6 && h.state(runs(h))?.status !== "running"; i++) {
    h.clock.advance(10_000);
    await h.tick();
  }
  const st = h.state(runs(h));
  expect(st?.status).toBe("running");
  return st as UnitState;
}

function hook(h: Harness, runId: string, event: "turn_end" | "tool_use" | "session_start", extra: Record<string, string> = {}) {
  appendHookTrace(h.root, { story: "gh-9" }, { type: "hook", id: ulid(h.clock.now()), fact: { event, at: h.clock.iso(), agent: "claude", native: event, cwd: wt(h), story: "gh-9", run_id: runId, ...extra } });
}

describe("R4: nudges that can be delivered (acceptance 5)", () => {
  let h: Harness;
  beforeAll(async () => {
    h = await createHarness();
    await boot(h);
  });
  afterAll(() => h.cleanup());

  test("R4.3: a send that fails is ok:false, an Unblock item and shown in status", async () => {
    const st = await untilRunning(h);
    h.runner.sendError = new Error("agent p-1 is blocked by a dialog");
    h.clock.advance(10_000);
    hook(h, st.run?.run_id as string, "turn_end");
    h.clock.advance(1000);
    const r = await h.tick();
    expect(acted(r)).toEqual(["gh-9 agent.silent.nudge FAILED nudge to gh-9 not delivered: agent p-1 is blocked by a dialog"]);
    expect(r.failed).toBe(1);

    const inbox = (await h.norn("inbox")).value as Inbox;
    expect(inbox.groups.unblock).toEqual([expect.objectContaining({ story: "gh-9", step: "implement", title: "nudge to gh-9 not delivered: agent p-1 is blocked by a dialog", command: `norn why gh-9 --tick ${r.tick_id}` })]);
    // notified once, from the tick that failed (O3)
    expect(h.notifier.items.filter((i) => i.id === `failed:gh-9:${r.tick_id}`)).toHaveLength(1);
    const status = (await h.norn("status", "gh-9")).value as ProjectView["stories"][number];
    expect(status.act_failure).toMatchObject({ effect: "nudge", tick_id: r.tick_id });
    expect((await h.norn("status")).stdout).toContain("  ! nudge to gh-9 not delivered: agent p-1 is blocked by a dialog");

    // the classify receipt is applied next tick: the nudge is counted, the item stays
    h.clock.advance(10_000);
    await h.tick();
    expect(h.state(runs(h))).toMatchObject({ nudges_used: 1 });
    expect(((await h.norn("inbox")).value as Inbox).groups.unblock).toHaveLength(1);
  });

  test("R4.2: a runner without `send` resumes the agent session with the nudge text; the failure clears", async () => {
    h.runner.sendError = null;
    h.runner.capabilities = { send: false, resume: true };
    const st = h.state(runs(h)) as UnitState;
    h.clock.advance(60_000);
    hook(h, st.run?.run_id as string, "turn_end", { agent_session_id: "cs-1" });
    h.clock.advance(1000);
    const launches = h.runner.launches.length;
    const r = await h.tick();
    expect(acted(r)).toEqual(["gh-9 agent.silent.nudge.resume"]);
    expect(h.runner.killed.map((s) => s.session_id)).toEqual(["s-1"]);
    expect(h.runner.launches).toHaveLength(launches + 1);
    expect(h.runner.launches.at(-1)).toMatchObject({ run_id: st.run?.run_id, env: { NORN_RUN: st.run?.run_id } });
    expect(h.runner.launches.at(-1)?.argv.join(" ")).toContain("cs-1");
    expect(h.runner.launches.at(-1)?.argv.join(" ")).toContain(NUDGE_TEXT);
    expect(h.state(runs(h))).toMatchObject({ status: "running", nudges_used: 2, run: { run_id: st.run?.run_id, session: { session_id: `s-${launches + 1}` }, agent_session_id: "cs-1" } });
    expect(((await h.norn("inbox")).value as Inbox).groups.unblock).toEqual([]);
  });

  test("R4.4: status shows the run's last classification, not only liveness", async () => {
    const text = (await h.norn("status")).stdout as string;
    expect(text).toMatch(/gh-9 +implement#1 auto claude .*— silent since /);
  });
});

describe("R5: a launch norn did not see finish (acceptance 6)", () => {
  let h: Harness;
  beforeAll(async () => {
    h = await createHarness();
    await boot(h);
  });
  afterAll(() => h.cleanup());

  const commitRuns = () => {
    h.git(["add", "-A"], wt(h));
    h.git(["commit", "-q", "-m", "test: rewrite runs/"], wt(h));
  };

  /** Undo the launch's state write and its session receipt: the crash between `started` and state. */
  function crashAfterStarted(before: UnitState): string {
    const dir = join(runs(h), "receipts");
    const names = readdirSync(dir).sort();
    const sessionReceipt = names.at(-1) as string;
    const decided = JSON.parse(readFileSync(join(dir, names.at(-2) as string), "utf8")) as { kind: string; run_id: string; session?: unknown };
    expect(decided.kind).toBe("started");
    expect(decided.session).toBeUndefined();
    Bun.spawnSync(["rm", join(dir, sessionReceipt)]);
    writeState(runs(h), before);
    commitRuns();
    return decided.run_id;
  }

  test("the runner finds the run → adopted, no second agent", async () => {
    // up to the launch tick, keeping the state before it
    for (let i = 0; i < 6 && !(h.state(runs(h))?.status === "ready"); i++) {
      h.clock.advance(10_000);
      await h.tick();
    }
    const before = h.state(runs(h)) as UnitState;
    h.clock.advance(10_000);
    expect(acted(await h.tick())).toEqual(["gh-9 agent.start"]);
    const runId = crashAfterStarted(before);

    h.runner.found = [{ session: { runner: "fake", session_id: "s-1", pane_id: "p-1" }, agent_session_id: "cs-7" }];
    h.clock.advance(10_000);
    const r = await h.tick();
    expect(acted(r)).toEqual(["gh-9 run.adopt"]);
    expect(h.runner.launches).toHaveLength(1);
    expect(h.state(runs(h))).toMatchObject({ status: "running", run: { run_id: runId, session: { session_id: "s-1" }, agent_session_id: "cs-7" } });
  });

  test("nothing finds it → waits 2 watch intervals, then died (counted) and a fresh run", async () => {
    h.runner.found = [];
    h.report(runs(h), "done", { outcome: "done", handoff: "x" }); // finish the adopted run…
    h.clock.advance(10_000);
    await h.tick();
    // …and start over on a fresh story state at implement, crashing its launch the same way
    const st = h.state(runs(h)) as UnitState;
    const ready: UnitState = { ...st, step: "implement", status: "ready", run: null, attempt: 2, visits: { implement: 2 }, retries_used: 0, nudges_used: 0 };
    writeState(runs(h), ready);
    commitRuns();
    h.clock.advance(10_000);
    expect(acted(await h.tick())).toEqual(["gh-9 agent.start"]);
    const runId = crashAfterStarted(ready);

    h.clock.advance(10_000);
    expect(rules(await h.tick())).toEqual(["gh-9 run.launch_unknown.wait"]);
    h.clock.advance(60_000);
    const r = await h.tick();
    expect(acted(r)).toEqual(["gh-9 agent.died.launch_unknown.retry"]);
    expect(h.runner.launches).toHaveLength(3);
    const now = h.state(runs(h)) as UnitState;
    expect(now).toMatchObject({ status: "running", retries_used: 1 });
    expect(now.run?.run_id).not.toBe(runId);
  });

  test("R5.3: no new run while another run of the step shows hook activity", async () => {
    const st = h.state(runs(h)) as UnitState;
    const active = st.run?.run_id as string;
    // the person's answer left the step ready without a session (B2 fresh path) — but the run lives on
    writeState(runs(h), { ...st, status: "ready", run: null });
    commitRuns();
    h.clock.advance(10_000);
    hook(h, active, "tool_use");
    h.clock.advance(1000);
    expect(rules(await h.tick())).toEqual(["gh-9 agent.start.wait_active"]);
    expect(h.runner.launches).toHaveLength(3);
    // once the run has been quiet for the stalled window (claim renewed meanwhile), the step starts again
    for (let i = 0; i < 3; i++) {
      h.clock.advance(4 * 60_000);
      expect(rules(await h.tick())).toEqual(["gh-9 agent.start.wait_active"]);
    }
    h.clock.advance(4 * 60_000);
    expect(acted(await h.tick())).toEqual(["gh-9 agent.start.retry"]);
  });
});

describe("R5.4 / R5.5: tick records and the heartbeat (acceptance 7, 8)", () => {
  let h: Harness;
  beforeAll(async () => {
    h = await createHarness();
    await boot(h);
  });
  afterAll(() => h.cleanup());

  test("every tick writes tick.start before act and tick.end after; heartbeat.json records last_tick_at", async () => {
    const r = await h.tick();
    const ev = readTrace(h.root, { types: ["tick.start", "tick", "tick.end"] }).events.filter((e) => "tick_id" in e && e.tick_id === r.tick_id);
    expect(ev.map((e) => e.type)).toEqual(["tick.start", "tick", "tick.end"]);
    const hb = JSON.parse(readFileSync(join(h.root, ".agents/norn/trace/heartbeat.json"), "utf8")) as { heartbeat_id: string; last_tick_at: string };
    expect(hb).toMatchObject({ heartbeat_id: expect.any(String), last_tick_at: h.clock.iso() });
  });

  test("a tick that died during act: why says so and resolves the receipt that cites it", async () => {
    for (let i = 0; i < 3; i++) {
      h.clock.advance(10_000);
      await h.tick();
    }
    // the receipts a crashed launch tick numbered cite a tick with no end
    const tick_id = ulid(h.clock.now());
    const start: TickStartTrace = {
      type: "tick.start",
      tick_id,
      at: h.clock.iso(),
      heartbeat_id: null,
      decisions: [{ unit: "gh-9", rule: "agent.start", action: { kind: "start_run", receipts: [{ n: 7, receipt: { kind: "started", receipt_id: tick_id, run_id: tick_id } }] } as TickStartTrace["decisions"][number]["action"] }],
    };
    appendTrace(h.root, start);
    const why = await h.norn("why", "gh-9", "--tick", tick_id);
    expect(why.exit).toBe(0);
    expect(why.value).toMatchObject({ tick_id, crashed: true, rule: "agent.start", action: "start_run", explanation: expect.stringContaining("tick crashed during act"), receipts: [{ n: 7, kind: "started", run_id: tick_id }] });
    // the newest tick for the unit is the crashed one
    expect((await h.norn("why", "gh-9")).value).toMatchObject({ tick_id, crashed: true });
  });

  test("no heartbeat for 3 watch intervals with auto work held: inbox item, no manual start hint", async () => {
    // the launch is queued forever (max_agents 0 would be config; simply stop ticking at `ready`)
    const st = h.state(runs(h)) as UnitState;
    writeState(runs(h), { ...st, status: "ready", run: null });
    const fresh = (await h.norn("status", "gh-9")).value as ProjectView["stories"][number];
    expect(fresh.next).not.toBe("norn watch");
    h.clock.advance(7 * 60_000);
    const inbox = (await h.norn("inbox")).value as Inbox;
    expect(inbox.groups.unblock.map((i) => [i.title, i.command])).toEqual([["no heartbeat on tester@box for 7m — run `norn watch`", "norn watch"]]);
    expect(inbox.groups.running.map((i) => i.title)).toEqual(["implement #1 (waiting for the heartbeat — norn watch)"]);
    const status = (await h.norn("status")).value as ProjectView;
    expect(status.heartbeat).toMatchObject({ holder: "tester@box", down: true, age: "7m" });
    expect(status.stories[0]?.next).toBe("norn watch");
    expect((await h.norn("status")).stdout).toContain("! no heartbeat on tester@box for 7m — run `norn watch`");
    // the next tick is the heartbeat: the item goes away
    await h.tick();
    expect(((await h.norn("inbox")).value as Inbox).groups.unblock).toEqual([]);
  });
});

describe("R7: a run from another machine (acceptance 10)", () => {
  let h: Harness;
  beforeAll(async () => {
    h = await createHarness();
    await boot(h);
  });
  afterAll(() => h.cleanup());

  test("no pid or pane check; after the take, no hooks for the stalled window → died with the foreign rule", async () => {
    const st = await untilRunning(h);
    expect(st.run).toMatchObject({ machine: "tester@box", heartbeat_id: expect.any(String) });
    // the run was launched by ann's heartbeat on her machine; this checkout holds the story now
    const foreign: UnitState = { ...st, run: { ...(st.run as NonNullable<UnitState["run"]>), machine: "ann@pc", heartbeat_id: "01JFFFFFFFFFFFFFFFFFFFFFFF", process: { pid: 999_999_99, pid_start: "gone" } } };
    writeState(runs(h), foreign);
    h.git(["add", "-A"], wt(h));
    h.git(["commit", "-q", "-m", "foreign run"], wt(h));
    h.runner.pane = { alive: false, state: "unknown", since: null };
    h.clock.advance(10_000);
    expect(rules(await h.tick())).toEqual(["gh-9 agent.running.foreign"]);
    // ticks keep renewing the claim; the run stays foreign and quiet
    for (let i = 0; i < 3; i++) {
      h.clock.advance(4 * 60_000);
      expect(rules(await h.tick())).toEqual(["gh-9 agent.running.foreign"]);
    }
    h.clock.advance(4 * 60_000);
    const r = await h.tick();
    expect(acted(r)).toEqual(["gh-9 agent.died.foreign.retry"]);
    expect(h.runner.killed).toEqual([]); // never closes a pane id of another machine
    const dir = join(runs(h), "receipts");
    const classify = readdirSync(dir).filter((f) => f.endsWith("-classify.json")).sort().at(-1) as string;
    expect(JSON.parse(readFileSync(join(dir, classify), "utf8"))).toMatchObject({ outcome: "died", rule: "agent.died.foreign", detail: "foreign run, holder changed" });
    expect(h.state(runs(h))).toMatchObject({ status: "running", retries_used: 1, run: { machine: "tester@box" } });
  });
});
