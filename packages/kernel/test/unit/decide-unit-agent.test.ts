import { describe, expect, test } from "bun:test";
import { caps, decideCase, graph, agentSpec, kindOf, loaded, minutesAgo, minutesAhead, receipt, run, session, stateAt, NOW } from "./decide-unit-fixtures.ts";

describe("a ready agent step", () => {
  test("auto mode starts a run on the config's executor, recording run.started for the step and attempt", () => {
    const d = kindOf(decideCase({ state: stateAt("build") }), "start_run");
    expect(d.rule).toBe("agent.start");
    expect(d.executor).toBe("claude");
    expect(d.attended).toBe(false);
    expect(d.brief).toMatchObject({ workflow: "story", step: "build", attempt: 1, skills: ["norn-implement"], inputs: ["spec"] });
    expect(d.intent.data).toEqual({ kind: "run.started", run_id: d.run_id, run_kind: "agent", executor: "claude", attended: false, step: "build", attempt: 1 });
  });

  test("a step entered by work sent back briefs its run, and a retry of it, with the receipt that sent it back", () => {
    const d = kindOf(decideCase({ state: stateAt("build", { rework_from: 5 }) }), "start_run");
    expect(d.brief.rework_from).toBe(5);
    expect(kindOf(decideCase({ state: stateAt("build") }), "start_run").brief.rework_from).toBeUndefined();
    const retry = kindOf(decideCase({ state: stateAt("build", { rework_from: 5, run: run() }), session: session("ended") }), "retry_run");
    expect(retry.brief.rework_from).toBe(5);
  });

  test("the step's by: picks the executor over the config's", () => {
    const wf = loaded(graph({ build: { agent: agentSpec({ executor: "codex" }) } }));
    const d = kindOf(decideCase({ state: stateAt("build", {}, wf), workflows: [wf], executors: { claude: caps(), codex: caps() } }), "start_run");
    expect(d.executor).toBe("codex");
  });

  test("an executor nobody configured parks the unit naming it", () => {
    const wf = loaded(graph({ build: { agent: agentSpec({ executor: "codex" }) } }));
    const d = kindOf(decideCase({ state: stateAt("build", {}, wf), workflows: [wf] }), "park");
    expect(d.rule).toBe("agent.no_executor");
    expect(d.inbox?.text).toContain("codex");
  });

  test("a park is a unit.parked receipt and the state that applies it, so state and facts agree on the next tick", () => {
    const d = kindOf(decideCase({ state: stateAt("build", { applied_through: 6 }), config: { mode: "manual" } }), "park");
    expect(d.intent.data).toEqual({ kind: "unit.parked", reason: "agent.ready.manual", step: "build", attempt: 1 });
    expect(d.state).toMatchObject({ step: "build", parked: { reason: "agent.ready.manual", since: NOW }, applied_through: 7 });
    expect(d.expect_version).toBe(4);
    expect(decideCase({ state: d.state, config: { mode: "manual" } })?.rule).toBe("unit.parked");
  });

  test("manual mode waits for a person with an inbox item, from the config, the workflow or the story", () => {
    const fromConfig = kindOf(decideCase({ state: stateAt("build"), config: { mode: "manual" } }), "park");
    expect(fromConfig).toMatchObject({ rule: "agent.ready.manual", reason: "agent.ready.manual", inbox: { kind: "manual", unit: "gh-1", step: "build", since: NOW } });
    const wf = loaded({ ...graph(), mode: "manual" });
    expect(decideCase({ state: stateAt("build", {}, wf), workflows: [wf] })?.rule).toBe("agent.ready.manual");
    // the story's own mode outranks the workflow's
    expect(decideCase({ state: stateAt("build", { mode: "auto" }, wf), workflows: [wf] })?.rule).toBe("agent.start");
  });

  test("an attended step waits for a person even in auto mode", () => {
    const wf = loaded(graph({ build: { agent: agentSpec({ attended: true }) } }));
    const d = kindOf(decideCase({ state: stateAt("build", {}, wf), workflows: [wf] }), "park");
    expect(d).toMatchObject({ rule: "agent.ready.attended", inbox: { kind: "attended" } });
  });

  test("a person's start lifts an attended step's park: in a pane the run is attended, headless it runs as an auto run", () => {
    const wf = loaded(graph({ build: { agent: agentSpec({ attended: true }) } }));
    const requested = { by: "ann", at: NOW };
    const pane = kindOf(decideCase({ state: stateAt("build", { requested }, wf), workflows: [wf], executors: { claude: caps({ headless: true, attended: true }) } }), "start_run");
    expect([pane.rule, pane.attended, pane.intent.data]).toMatchObject(["agent.start", true, { kind: "run.started", attended: true }]);
    const headless = kindOf(decideCase({ state: stateAt("build", { requested }, wf), workflows: [wf], executors: { claude: caps({ headless: true, attended: false }) } }), "start_run");
    expect([headless.rule, headless.attended]).toEqual(["agent.start", false]);
  });

  test("auto mode on an executor that cannot run headless waits for a person", () => {
    expect(decideCase({ state: stateAt("build"), executors: { claude: caps({ headless: false }) } })?.rule).toBe("agent.ready.no_headless");
  });

  test("a run a person started opens on an executor that runs only where a person watches", () => {
    const requested = { by: "ann", at: NOW };
    const paneOnly = { claude: caps({ headless: false, attended: true }) };
    expect(decideCase({ state: stateAt("build", { requested }), config: { mode: "manual" }, executors: paneOnly })?.rule).toBe("agent.start");
    // with neither headless nor a pane there is nowhere to run it
    expect(decideCase({ state: stateAt("build", { requested }), config: { mode: "manual" }, executors: { claude: caps({ headless: false, attended: false }) } })?.rule).toBe("agent.ready.no_headless");
  });

  test("a park the facts still call for is not sent again; one they no longer call for is lifted", () => {
    const parked = { reason: "agent.ready.manual", since: minutesAgo(30) };
    expect(decideCase({ state: stateAt("build", { parked }), config: { mode: "manual" } })?.rule).toBe("unit.parked");
    // the story switched to auto: the park comes off first, the start follows next tick
    const lifted = kindOf(decideCase({ state: stateAt("build", { parked, mode: "auto" }), config: { mode: "manual" } }), "apply_receipts");
    expect(lifted.rule).toBe("unit.unpark");
    expect(lifted.state.parked).toBeUndefined();
    expect(lifted.receipts).toEqual([]);
    expect(lifted.expect_version).toBe(4);
  });

  test("a park a receipt put there holds", () => {
    const parked = { reason: "build: the agent asks a question", since: minutesAgo(3) };
    expect(decideCase({ state: stateAt("build", { parked }) })).toMatchObject({ kind: "noop", rule: "unit.parked" });
  });
});

describe("an agent run, judged from its session", () => {
  const running = (over = {}) => stateAt("build", { run: run(over) });

  test("a report is written as run.reported and applied, routing the outcome", () => {
    const d = kindOf(decideCase({ state: running(), session: session("reported", { report: { verb: "done", outcome: "done" } }) }), "apply_receipts");
    expect(d.rule).toBe("agent.reported");
    expect(d.receipts.map((r) => r.data)).toEqual([{ kind: "run.reported", run_id: "run-1", verb: "done", outcome: "done", step: "build", attempt: 1 }]);
    expect(d.state).toMatchObject({ step: "test", attempt: 1, run: null, applied_through: 1 });
  });

  test("a report outranks the session ending after it", () => {
    expect(decideCase({ state: running(), session: session("ended", { report: { verb: "done", outcome: "done" } }) })?.rule).toBe("agent.reported");
  });

  test("receipts on the record are applied before anything the session shows", () => {
    const receipts = [receipt(1, { kind: "run.reported", run_id: "run-1", verb: "done", outcome: "done", step: "build", attempt: 1 })];
    const d = kindOf(decideCase({ state: running(), receipts, session: session("working", { silent: true }) }), "apply_receipts");
    expect(d.rule).toBe("receipts.apply");
    expect(d.receipts).toEqual([]);
    expect(d.state.step).toBe("test");
  });

  test("receipts the state refuses are applied as rejected", () => {
    const receipts = [receipt(1, { kind: "run.reported", run_id: "run-old", verb: "done", outcome: "done" })];
    const d = kindOf(decideCase({ state: running(), receipts }), "apply_receipts");
    expect(d.rule).toBe("receipts.reject");
    expect(d.rejected.map((r) => r.seq)).toEqual([1]);
    // each refusal is written in the same act and applied with it, so the next tick has nothing left to apply
    expect(d.receipts.map((r) => r.data)).toEqual([{ kind: "receipt.rejected", seq: 1, reason: "stale run run-old; the current run is run-1" }]);
    expect(d.state.applied_through).toBe(2);
  });

  test("a refusal beside an intent is written after it, and both are applied", () => {
    const reported = [receipt(1, { kind: "run.reported", run_id: "run-old", verb: "done", outcome: "done" })];
    const d = kindOf(decideCase({ state: running(), receipts: reported, session: session("working", { silent: true }) }), "apply_receipts");
    expect(d.receipts.map((r) => r.data.kind)).toEqual(["receipt.rejected"]);
    const fresh = kindOf(decideCase({ state: running(), session: session("reported", { report: { verb: "done", outcome: "done" } }) }), "apply_receipts");
    expect(fresh.receipts.map((r) => r.data.kind)).toEqual(["run.reported"]);
    expect(fresh.state.applied_through).toBe(1);
  });

  test("a silent agent is nudged while nudges last, then the unit ends stuck", () => {
    const quiet = session("working", { silent: true });
    const n = kindOf(decideCase({ state: running(), session: quiet }), "nudge");
    expect(n).toMatchObject({ rule: "agent.silent.nudge", run_id: "run-1", reason: "silent" });
    expect(n.intent.data).toEqual({ kind: "nudge.sent", run_id: "run-1", reason: "silent", step: "build", attempt: 1 });
    const out = kindOf(decideCase({ state: running({ nudges: 2 }), session: quiet }), "apply_receipts");
    expect(out.rule).toBe("agent.silent.exhausted");
    expect(out.receipts[0]?.data).toMatchObject({ kind: "run.classified", outcome: "silent", rule: "agent.silent.exhausted" });
    expect(out.state.ended).toBe("stuck");
  });

  test("a nudge still on its way is not sent again", () => {
    const d = decideCase({ state: running({ nudges: 1, last_nudge_at: minutesAgo(2) }), session: session("turn_ended") });
    expect(d).toMatchObject({ kind: "noop", rule: "agent.turn_ended.nudged" });
    expect(decideCase({ state: running({ nudges: 1, last_nudge_at: minutesAgo(20) }), session: session("turn_ended") })?.kind).toBe("nudge");
  });

  test("an executor that can take no nudge gets a fresh session instead, counted as a retry", () => {
    const executors = { claude: caps({ paneInput: false, injectContext: false }) };
    const d = kindOf(decideCase({ state: running(), session: session("working", { silent: true }), executors }), "retry_run");
    expect(d).toMatchObject({ rule: "agent.silent.retry", previous_run_id: "run-1", executor: "claude" });
    expect(d.intent.data).toMatchObject({ kind: "run.started", retry_of: "run-1", run_id: d.run_id });
    const spent = decideCase({ state: stateAt("build", { run: run(), retries_used: 1 }), session: session("working", { silent: true }), executors });
    expect(spent?.rule).toBe("agent.silent.exhausted");
  });

  test("a step that routes stalled takes it for an agent with no activity, ahead of silent; a turn ended without a report stays silent", () => {
    const wf = loaded(graph({ build: { routes: { done: { to: "test" }, stalled: { to: "$stuck" }, silent: { to: "test" } } } }));
    const d = kindOf(decideCase({ state: stateAt("build", { run: run() }, wf), workflows: [wf], session: session("working", { silent: true }) }), "apply_receipts");
    expect(d.rule).toBe("agent.stalled.route");
    expect(d.receipts[0]?.data).toMatchObject({ kind: "run.classified", outcome: "stalled", rule: "agent.stalled.route" });
    expect(d.state).toMatchObject({ ended: "stuck" });
    expect(decideCase({ state: stateAt("build", { run: run() }, wf), workflows: [wf], session: session("turn_ended") })?.rule).toBe("agent.turn_ended.route");
    // a step that routes only stalled leaves a turn ended without a report to the silent rules
    const only = loaded(graph({ build: { routes: { done: { to: "test" }, stalled: { to: "$stuck" } } } }));
    expect(decideCase({ state: stateAt("build", { run: run() }, only), workflows: [only], session: session("turn_ended") })?.rule).toBe("agent.turn_ended.nudge");
  });

  test("a workflow's defaults.stalled is how long a working agent goes without an event before it reads as silent, in place of the config's window", () => {
    const within = (stalled_ms: number) => loaded({ ...graph(), stalled_ms });
    const short = within(2 * 60_000);
    const quietFor3 = session("working", { silent: false, last_event_at: minutesAgo(3) });
    expect(decideCase({ state: stateAt("build", { run: run() }, short), workflows: [short], session: quietFor3 })).toMatchObject({ kind: "nudge", rule: "agent.silent.nudge" });
    expect(decideCase({ state: stateAt("build", { run: run() }, short), workflows: [short], session: session("working", { last_event_at: minutesAgo(1) }) })?.rule).toBe("agent.running");
    const long = within(60 * 60_000);
    const quietFor20 = session("working", { silent: true, last_event_at: minutesAgo(20) });
    expect(decideCase({ state: stateAt("build", { run: run() }, long), workflows: [long], session: quietFor20 })?.rule).toBe("agent.running");
    // an agent with a call or a subagent outstanding has a reason to be quiet, however long
    expect(decideCase({ state: stateAt("build", { run: run() }, short), workflows: [short], session: session("working", { pending_tools: 1, last_event_at: minutesAgo(30) }) })?.rule).toBe("agent.running");
    // without the setting the config's window holds
    expect(decideCase({ state: running(), session: quietFor3 })?.rule).toBe("agent.running");
  });

  test("a run with no session seen yet waits the workflow's stalled window, not the config's", () => {
    const short = loaded({ ...graph(), stalled_ms: 2 * 60_000 });
    const pane = { claude: caps({ paneInput: true, dialogKeys: true }) };
    const started = (minutes: number) => stateAt("build", { run: run({ started_at: minutesAgo(minutes) }) }, short);
    expect(decideCase({ state: started(1), workflows: [short], session: null, run_alive: true, executors: pane })?.rule).toBe("agent.unobserved");
    expect(decideCase({ state: started(3), workflows: [short], session: null, run_alive: true, executors: pane })?.rule).toBe("agent.no_events.park");
    const long = loaded({ ...graph(), stalled_ms: 60 * 60_000 });
    const startedLong = stateAt("build", { run: run({ started_at: minutesAgo(20) }) }, long);
    expect(decideCase({ state: startedLong, workflows: [long], session: null, run_alive: true, executors: pane })?.rule).toBe("agent.unobserved");
  });

  test("a nudge is waited on for the workflow's stalled window, not the config's", () => {
    const short = loaded({ ...graph(), stalled_ms: 2 * 60_000 });
    const nudged = { run: run({ nudges: 1, last_nudge_at: minutesAgo(3) }) };
    expect(decideCase({ state: stateAt("build", nudged, short), workflows: [short], session: session("turn_ended") })?.kind).toBe("nudge");
    expect(decideCase({ state: stateAt("build", nudged), session: session("turn_ended") })?.rule).toBe("agent.turn_ended.nudged");
  });

  test("a step that routes silent takes its route instead of the nudges", () => {
    const wf = loaded(graph({ build: { routes: { done: { to: "test" }, silent: { to: "$stuck" } } } }));
    const d = decideCase({ state: stateAt("build", { run: run() }, wf), workflows: [wf], session: session("working", { silent: true }) });
    expect(d?.rule).toBe("agent.silent.route");
  });

  test("manual mode never types into a quiet session: it waits for a person", () => {
    const d = kindOf(decideCase({ state: running(), session: session("working", { silent: true }), config: { mode: "manual" } }), "park");
    expect(d).toMatchObject({ rule: "agent.silent.manual", inbox: { kind: "stuck" } });
  });

  test("a turn that ended without a report is nudged, bounded like silence", () => {
    expect(decideCase({ state: running(), session: session("turn_ended") })).toMatchObject({ kind: "nudge", rule: "agent.turn_ended.nudge", reason: "turn_ended" });
    expect(decideCase({ state: running({ nudges: 2 }), session: session("turn_ended") })?.rule).toBe("agent.turn_ended.exhausted");
  });

  test("a dead session is retried in a fresh one while retries last, then the unit ends stuck", () => {
    const d = kindOf(decideCase({ state: running(), session: session("ended") }), "retry_run");
    expect(d.rule).toBe("agent.died.retry");
    const out = kindOf(decideCase({ state: stateAt("build", { run: run(), retries_used: 1 }), session: session("ended") }), "apply_receipts");
    expect(out.rule).toBe("agent.died.exhausted");
    expect(out.state.ended).toBe("stuck");
  });

  test("a dead session that stopped on a harness error keeps the error in the receipt and the stuck reason", () => {
    const error = "pi stopped on an error: Codex error: The 'gpt-6.1-sol' model is not supported";
    const out = kindOf(decideCase({ state: stateAt("build", { run: run(), retries_used: 1 }), session: session("ended", { error }) }), "apply_receipts");
    expect(out.receipts[0]?.data).toMatchObject({ kind: "run.classified", outcome: "died", error });
    expect(out.state.ended_reason).toBe(`died: ${error}; retries 1/1 used at build`);
    const manual = kindOf(decideCase({ state: running(), session: session("ended", { error }), config: { mode: "manual" } }), "park");
    expect(manual.inbox?.text).toBe(`run run-1 ended without a report: ${error}`);
  });

  test("a dead session in manual mode waits for a person to start again", () => {
    expect(decideCase({ state: running(), session: session("ended"), config: { mode: "manual" } })?.rule).toBe("agent.died.manual");
  });

  test("a question parks the unit with an inbox item that carries it, and nothing is sent to the agent", () => {
    const ask = { id: "q-1", question: "Which base?", options: ["main", "next"] };
    const d = kindOf(decideCase({ state: running(), session: session("asking", { ask }) }), "park");
    expect(d).toMatchObject({ rule: "agent.asking.park", inbox: { kind: "ask", text: "Which base?", options: ["main", "next"], input_id: "q-1" } });
  });

  test("a permission prompt parks the unit; once it clears the park is lifted", () => {
    const permission = { id: "p-1", prompt: "Run rm -rf build?" };
    const d = kindOf(decideCase({ state: running(), session: session("permission", { permission }) }), "park");
    expect(d).toMatchObject({ rule: "agent.permission.park", inbox: { kind: "permission", input_id: "p-1" } });
    const parked = { reason: "agent.permission.park", since: minutesAgo(1) };
    expect(decideCase({ state: stateAt("build", { run: run(), parked }), session: session("permission", { permission }) })?.rule).toBe("unit.parked");
    expect(decideCase({ state: stateAt("build", { run: run(), parked }), session: session("working") })?.rule).toBe("unit.unpark");
  });

  test("a limited agent records its reset once, waits for it without a nudge, and is nudged once the reset passes", () => {
    const limited = (resets_at: string) => session("limited", { limit: { kind: "usage", resets_at } });
    const first = kindOf(decideCase({ state: running(), session: limited(minutesAhead(30)) }), "apply_receipts");
    expect(first.rule).toBe("agent.limited.record");
    expect(first.receipts[0]?.data).toEqual({ kind: "run.limited", run_id: "run-1", resets_at: minutesAhead(30), step: "build", attempt: 1 });
    expect(first.state.run?.limited_until).toBe(minutesAhead(30));
    const recorded = stateAt("build", { run: run({ limited_until: minutesAhead(30) }) });
    expect(decideCase({ state: recorded, session: limited(minutesAhead(30)) })).toMatchObject({ kind: "noop", rule: "agent.limited.wait" });
    expect(decideCase({ state: running(), session: limited(minutesAgo(1)) })).toMatchObject({ kind: "nudge", rule: "agent.limited.nudge" });
  });

  test("a limit with no reset time parks for a person rather than waiting unseen", () => {
    const d = kindOf(decideCase({ state: running(), session: session("limited", { limit: { kind: "rate" } }) }), "park");
    expect(d).toMatchObject({ rule: "agent.limited.unknown", inbox: { kind: "limited" } });
  });

  test("a usage limit outranks the deadline: a limited run past it waits for the reset, never stopped", () => {
    const late = (over = {}) => stateAt("build", { run: run({ started_at: minutesAgo(120), ...over }) });
    const limited = session("limited", { limit: { kind: "usage", resets_at: minutesAhead(60) } });
    expect(decideCase({ state: late(), session: limited })?.rule).toBe("agent.limited.record");
    expect(decideCase({ state: late({ limited_until: minutesAhead(60) }), session: limited })?.rule).toBe("agent.limited.wait");
    // the deadline counts from the reset it waited out, so the agent back at work is not stopped at once
    expect(decideCase({ state: late({ limited_until: minutesAgo(10) }), session: session("working") })?.rule).toBe("agent.running");
    expect(decideCase({ state: late({ limited_until: minutesAgo(70) }), session: session("working") })?.rule).toBe("agent.timeout");
  });

  test("a run past its deadline is stopped once, the order recorded, or routed when the step routes timeout", () => {
    const late = stateAt("build", { run: run({ started_at: minutesAgo(61) }) });
    const d = kindOf(decideCase({ state: late, session: session("working") }), "stop_run");
    expect(d).toMatchObject({ rule: "agent.timeout", run_id: "run-1", reason: "timeout" });
    expect(d.intent?.data).toEqual({ kind: "stop.sent", run_id: "run-1", reason: "timeout", step: "build", attempt: 1 });
    const wf = loaded(graph({ build: { routes: { done: { to: "test" }, timeout: { to: "$stuck" } } } }));
    const routed = decideCase({ state: stateAt("build", { run: run({ started_at: minutesAgo(61) }) }, wf), workflows: [wf], session: session("working") });
    expect(routed?.rule).toBe("agent.timeout.route");
  });

  test("a stop ordered is not sent again; a session that outlives it by the silent window is judged dead", () => {
    const stopped = (minutes: number) => stateAt("build", { run: run({ started_at: minutesAgo(80), stopped_at: minutesAgo(minutes) }) });
    expect(decideCase({ state: stopped(2), session: session("working") })).toMatchObject({ kind: "noop", rule: "agent.timeout.stopping" });
    expect(decideCase({ state: stopped(16), session: session("working") })).toMatchObject({ kind: "retry_run", rule: "agent.died.retry", previous_run_id: "run-1" });
  });

  test("a run with no session seen yet waits for the silent window, then is judged dead and retried within its retries", () => {
    expect(decideCase({ state: running(), session: null })).toMatchObject({ kind: "noop", rule: "agent.unobserved" });
    const launchLost = (over = {}) => stateAt("build", { run: run({ started_at: minutesAgo(16) }), ...over });
    expect(decideCase({ state: launchLost(), session: null })).toMatchObject({ kind: "retry_run", rule: "agent.died.retry" });
    const spent = kindOf(decideCase({ state: launchLost({ retries_used: 1 }), session: null }), "apply_receipts");
    expect(spent).toMatchObject({ rule: "agent.died.exhausted", state: { ended: "stuck" } });
    // a run past its deadline with no session is not stopped every tick: it is dead
    expect(decideCase({ state: stateAt("build", { run: run({ started_at: minutesAgo(120) }) }), session: null })?.rule).toBe("agent.died.retry");
  });

  test("an agent alive in its pane that has sent no event past the silent window parks for a person, never retried; its first event lifts the park", () => {
    const pane = { claude: caps({ paneInput: true, dialogKeys: true }) };
    const quiet = (over = {}) => stateAt("build", { run: run({ started_at: minutesAgo(16) }), ...over });
    const d = kindOf(decideCase({ state: quiet(), session: null, run_alive: true, executors: pane }), "park");
    expect(d).toMatchObject({ rule: "agent.no_events.park", inbox: { kind: "permission" } });
    expect(d.inbox?.text).toContain("Trust the folder there");
    expect(d.inbox?.text).toContain("norn story answer gh-1 1");
    // parked, each later tick holds it: no retry loop while the dialog waits
    const parked = quiet({ parked: { reason: "agent.no_events.park", since: minutesAgo(1) } });
    expect(decideCase({ state: parked, session: null, run_alive: true, executors: pane })).toMatchObject({ kind: "noop", rule: "unit.parked" });
    expect(decideCase({ state: parked, session: session("working"), executors: pane })).toMatchObject({ kind: "apply_receipts", rule: "unit.unpark" });
    // its process gone, the run is dead as before
    expect(decideCase({ state: quiet(), session: null, run_alive: false, executors: pane })).toMatchObject({ kind: "retry_run", rule: "agent.died.retry" });
  });

  test("a silent run in a pane whose executor cannot press a dialog's keys is sent to the pane, never to story answer", () => {
    const quiet = stateAt("build", { run: run({ started_at: minutesAgo(16) }) });
    const d = kindOf(decideCase({ state: quiet, session: null, run_alive: true, executors: { claude: caps({ paneInput: true }) } }), "park");
    expect(d.rule).toBe("agent.no_events.park");
    expect(d.inbox?.text).toContain("Trust the folder there");
    expect(d.inbox?.text).not.toContain("norn story answer");
  });

  test("a live process with no pane that has sent no event is still judged dead: nobody could answer a dialog in it", () => {
    const quiet = stateAt("build", { run: run({ started_at: minutesAgo(16) }) });
    expect(decideCase({ state: quiet, session: null, run_alive: true })).toMatchObject({ kind: "retry_run", rule: "agent.died.retry" });
  });

  test("a permission park names the call it asks about", () => {
    const permission = { id: "p-1", prompt: "Claude needs your permission to use Bash", call: { id: "t-1", tool: "Bash(rm -rf build)" } };
    const d = kindOf(decideCase({ state: running(), session: session("permission", { permission }) }), "park");
    expect(d.inbox).toMatchObject({ kind: "permission", input_id: "p-1", text: "Bash(rm -rf build): Claude needs your permission to use Bash" });
  });

  test("a report with an outcome the step does not declare parks the unit with the refusal and writes nothing, so the next tick does not write it again", () => {
    const bogus = session("reported", { report: { verb: "done", outcome: "bogus" } });
    const d = kindOf(decideCase({ state: running(), session: bogus }), "park");
    expect(d).toMatchObject({ rule: "agent.reported.rejected", inbox: { kind: "stuck", text: "not applied: outcome bogus is not declared at build" } });
    const parked = stateAt("build", { run: run(), parked: { reason: "agent.reported.rejected", since: minutesAgo(1) } });
    expect(decideCase({ state: parked, session: bogus })).toMatchObject({ kind: "noop", rule: "unit.parked" });
    // a fresh report from the agent is applied, lifting the park
    const good = kindOf(decideCase({ state: parked, session: session("reported", { report: { verb: "done", outcome: "done" } }) }), "apply_receipts");
    expect(good).toMatchObject({ rule: "agent.reported", state: { step: "test" } });
    expect(good.state.parked).toBeUndefined();
  });

  test("a working agent is left alone", () => {
    expect(decideCase({ state: running(), session: session("awaiting_subagents", { subagents: 2 }) })).toMatchObject({ kind: "noop", rule: "agent.running" });
  });

  test("an attended run decides only its report and its end", () => {
    const attended = stateAt("build", { run: run({ attended: true }) });
    expect(decideCase({ state: attended, session: session("working", { silent: true }) })?.rule).toBe("agent.running");
    expect(decideCase({ state: attended, session: session("ended") })?.rule).toBe("agent.died.manual");
  });

  test("decisions follow capabilities, never an executor's name", () => {
    const wfA = loaded(graph({ build: { agent: agentSpec({ executor: "alpha" }) } }));
    const wfB = loaded({ ...graph({ build: { agent: agentSpec({ executor: "beta" }) } }), hash: "c".repeat(64) });
    const quiet = session("working", { silent: true });
    const a = decideCase({ state: stateAt("build", { run: run({ executor: "alpha" }) }, wfA), workflows: [wfA], session: quiet, executors: { alpha: caps({ paneInput: true, injectContext: false }) } });
    const b = decideCase({ state: stateAt("build", { run: run({ executor: "beta" }) }, wfB), workflows: [wfB], session: quiet, executors: { beta: caps({ paneInput: true, injectContext: false }) } });
    expect(a?.rule).toBe("agent.silent.nudge");
    expect(b?.rule).toBe(a?.rule as string);
  });

  test("the same facts decide the same, ids included", () => {
    const c = { state: running(), session: session("ended") };
    expect(decideCase(c)).toEqual(decideCase(c));
  });
});

describe("an answer to a session that cannot take it", () => {
  const parked = { reason: "build: the agent asks a question", since: minutesAgo(10) };
  const answered = [receipt(7, { kind: "answer.sent", input_id: "q1", text: "main", by: "ann" })];
  const at = (over = {}) => stateAt("build", { parked, applied_through: 6, run: run({ session: "h-1", ...over }) });

  test("an ended session on an executor that cannot resume gets the answer applied undelivered, and the unit unparks", () => {
    const d = kindOf(decideCase({ state: at(), receipts: answered, session: session("ended") }), "apply_receipts");
    expect(d.rule).toBe("receipts.apply.undelivered");
    expect(d.undelivered).toEqual(["r-7"]);
    expect(d.state.parked).toBeUndefined();
    // the next tick judges the ended session dead and retries it, in a fresh session whose brief carries the answer
    expect(decideCase({ state: d.state, session: session("ended") })?.rule).toBe("agent.died.retry");
  });

  test("a run with no session seen on this machine gets the answer applied undelivered, even on an executor that can resume", () => {
    // a story taken from another machine: the run's hook events stayed there, so nothing here can hand the answer over
    const d = kindOf(decideCase({ state: at(), receipts: answered, session: null, executors: { claude: caps({ resume: true }) } }), "apply_receipts");
    expect(d.rule).toBe("receipts.apply.undelivered");
    expect(d.undelivered).toEqual(["r-7"]);
    expect(d.state.parked).toBeUndefined();
  });

  test("a live session, a session that can be resumed, or an attended run takes the answer as usual", () => {
    for (const c of [
      { state: at(), session: session("working") },
      { state: at(), session: session("ended"), executors: { claude: caps({ resume: true }) } },
      { state: at({ attended: true }), session: session("ended") },
      // no event yet, its process alive here: the dialog its pane shows takes the answer as keys
      { state: at(), session: null, run_alive: true },
    ]) {
      const d = kindOf(decideCase({ ...c, receipts: answered }), "apply_receipts");
      expect([d.rule, d.undelivered]).toEqual(["receipts.apply", undefined]);
    }
  });
});
