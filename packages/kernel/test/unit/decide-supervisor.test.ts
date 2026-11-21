import { describe, expect, test } from "bun:test";
import { ASKED_PARK, DEFAULT_SUPERVISOR_ASKS, type KernelReceipt, type RunState } from "../../src/index.ts";
import { agentSpec, caps, decideCase, graph, kindOf, loaded, minutesAgo, receipt, run, stateAt } from "./decide-unit-fixtures.ts";

const supervised = loaded(graph({ build: { agent: agentSpec({ attended: "agent", asks: 2 }) } }));
const grant = { standIn: { attended: ["story.build"], gates: [] } };
const asked = (over: Partial<RunState> = {}): RunState => stateAt("build", { run: run(), parked: { reason: ASKED_PARK, since: minutesAgo(1), text: "Which database?", input_id: "q-1" }, ...over }, supervised);
const supervisor = (over: Partial<NonNullable<RunState["supervisor"]>> = {}): NonNullable<RunState["supervisor"]> => ({
  id: "sup-1",
  subject: "ask",
  input_id: "q-1",
  executor: "claude",
  started_at: minutesAgo(2),
  session: "h-sup-1",
  ...over,
});

describe("a question from a supervised step", () => {
  test("starts the supervisor the person's policy grants for the step, recording supervisor.started first", () => {
    const d = kindOf(decideCase({ state: asked(), workflows: [supervised], config: grant }), "start_supervisor");
    expect(d).toMatchObject({ rule: "supervisor.ask", subject: "ask", input_id: "q-1", executor: "claude" });
    expect(d.intent.data).toEqual({ kind: "supervisor.started", run_id: d.run_id, executor: "claude", subject: "ask", input_id: "q-1", step: "build", attempt: 1 });
  });

  test("the supervisor runs where an attended: agent step's runner puts it, bound as the supervisor role", () => {
    const config = { ...grant, bind: { supervisor: ["other"] } };
    const executors = { claude: caps(), "other@agent": caps({ attended: false }) };
    expect(kindOf(decideCase({ state: asked(), workflows: [supervised], config, executors }), "start_supervisor").executor).toBe("other@agent");
  });

  test("waits for the person when the policy grants no stand-in, or the step is not attended: agent", () => {
    expect(decideCase({ state: asked(), workflows: [supervised] })?.rule).toBe("unit.parked");
    const unattended = loaded(graph({ build: { agent: agentSpec({ attended: "none" }) } }));
    expect(decideCase({ state: stateAt("build", { run: run(), parked: { reason: ASKED_PARK, since: minutesAgo(1), input_id: "q-1" } }, unattended), workflows: [unattended], config: grant })?.rule).toBe("unit.parked");
  });

  test("a question naming a capability only the person grants goes to the person, never to the supervisor", () => {
    const d = kindOf(decideCase({ state: asked(), workflows: [supervised], config: grant, question_reserved: ["merge", "push"] }), "noop");
    expect(d.rule).toBe("supervisor.reserved");
    expect(d.reason).toContain("merge, push");
  });

  test("once the step's limits.asks are spent, the question waits in the mailbox rather than ending the unit", () => {
    const d = kindOf(decideCase({ state: asked({ supervised: { answered: 2 } }), workflows: [supervised], config: grant }), "noop");
    expect(d.rule).toBe("supervisor.asks_spent");
    const defaulted = loaded(graph({ build: { agent: agentSpec({ attended: "agent" }) } }));
    const spent = kindOf(decideCase({ state: asked({ workflow: defaulted.pinned, supervised: { answered: DEFAULT_SUPERVISOR_ASKS } }), workflows: [defaulted], config: grant }), "noop");
    expect(spent.rule).toBe("supervisor.asks_spent");
  });

  test("a question the supervisor handed to the person stays with them", () => {
    const escalated = asked({ supervised: { answered: 0, escalated: [{ input: "q-1", reason: "needs the person's taste" }] } });
    expect(decideCase({ state: escalated, workflows: [supervised], config: grant })?.rule).toBe("unit.parked");
  });

  test("with no executor that can run a supervisor headless and guarded, the question waits for the person, saying why", () => {
    const d = kindOf(decideCase({ state: asked(), workflows: [supervised], config: grant, executors: { claude: caps({ denyTool: false }) } }), "noop");
    expect(d.rule).toBe("supervisor.no_executor");
    expect(d.reason).toContain("cannot deny a tool");
  });

  test("a supervisor at work is waited on; one gone quiet past the window or dead is handed to the person", () => {
    expect(decideCase({ state: asked({ supervisor: supervisor() }), workflows: [supervised], config: grant })?.rule).toBe("supervisor.working");
    const quiet = kindOf(decideCase({ state: asked({ supervisor: supervisor({ started_at: minutesAgo(16) }) }), workflows: [supervised], config: grant }), "apply_receipts");
    expect(quiet.rule).toBe("supervisor.silent");
    expect(quiet.receipts[0]?.data).toMatchObject({ kind: "supervisor.escalated", run_id: "sup-1" });
    expect(quiet.state.supervisor).toBeUndefined();
    expect(quiet.state.parked?.reason).toBe(ASKED_PARK);
    expect(quiet.state.supervised?.escalated?.[0]?.input).toBe("q-1");
    const dead = kindOf(decideCase({ state: asked({ supervisor: supervisor() }), workflows: [supervised], config: grant, supervisor_alive: false }), "apply_receipts");
    expect(dead.rule).toBe("supervisor.died");
  });
});

describe("what a supervisor stood in for belongs to one visit", () => {
  const visited = loaded(graph({ build: { agent: agentSpec({ attended: "agent", asks: 2 }), routes: { done: { to: "approve" } } } }));

  test("leaving the step drops the answers counted and the subjects handed back, and a question on the next visit starts a fresh supervisor", () => {
    const spent = { answered: 2, escalated: [{ input: "q-1", reason: "needs the person's taste" }] };
    const atBuild = stateAt("build", { run: run(), supervised: spent, visits: { build: 1 } }, visited);
    const left = kindOf(decideCase({ state: atBuild, workflows: [visited], config: grant, receipts: [receipt(1, { kind: "run.reported", run_id: "run-1", verb: "done", outcome: "done" })] }), "apply_receipts");
    expect(left.state.step).toBe("approve");
    expect(left.state.supervised).toBeUndefined();

    const back = kindOf(decideCase({ state: left.state, workflows: [visited], config: grant, receipts: [receipt(2, { kind: "gate.decided", outcome: "reject", by: "a-person", step: "approve", attempt: 1 })] }), "apply_receipts");
    expect(back.state).toMatchObject({ step: "build", attempt: 2 });
    expect(back.state.supervised).toBeUndefined();

    const askedAgain: RunState = { ...back.state, run: run({ id: "run-2", attempt: 2 }), parked: { reason: ASKED_PARK, since: minutesAgo(1), text: "Which database?", input_id: "q-1" } };
    expect(decideCase({ state: askedAgain, workflows: [visited], config: grant })?.rule).toBe("supervisor.ask");
  });
});

describe("the supervisor's answer", () => {
  const answer = (over: Record<string, unknown> = {}): KernelReceipt =>
    receipt(1, { kind: "answer.sent", input_id: "q-1", text: "Postgres.", by: "supervisor", supervisor_run: "sup-1", step: "build", attempt: 1, ...over } as KernelReceipt["data"]);

  test("from the supervisor norn launched for the question lifts the park and counts against limits.asks", () => {
    const d = kindOf(decideCase({ state: asked({ supervisor: supervisor() }), workflows: [supervised], config: grant, receipts: [answer()] }), "apply_receipts");
    expect(d.rejected).toEqual([]);
    expect(d.state.parked).toBeUndefined();
    expect(d.state.supervisor).toBeUndefined();
    expect(d.state.supervised).toEqual({ answered: 1 });
  });

  test("from any other run, or for another question, is refused", () => {
    expect(kindOf(decideCase({ state: asked({ supervisor: supervisor() }), workflows: [supervised], receipts: [answer({ supervisor_run: "sup-9" })] }), "apply_receipts").rejected[0]?.reason).toContain("supervisor");
    expect(kindOf(decideCase({ state: asked({ supervisor: supervisor() }), workflows: [supervised], receipts: [answer({ input_id: "q-2" })] }), "apply_receipts").rejected).toHaveLength(1);
    expect(kindOf(decideCase({ state: asked(), workflows: [supervised], receipts: [answer()] }), "apply_receipts").rejected).toHaveLength(1);
  });

  test("a person's answer while the supervisor works settles the question, and the supervisor's late one is refused", () => {
    const person = receipt(1, { kind: "answer.sent", input_id: "q-1", text: "MySQL.", by: "a-person", step: "build", attempt: 1 });
    const d = kindOf(decideCase({ state: asked({ supervisor: supervisor() }), workflows: [supervised], receipts: [person, { ...answer(), seq: 2, id: "r-2" }] }), "apply_receipts");
    expect(d.state.parked).toBeUndefined();
    expect(d.state.supervisor).toBeUndefined();
    expect(d.rejected.map((r) => r.seq)).toEqual([2]);
  });

  test("a supervisor.started for a question that is not the open one is refused", () => {
    const started = receipt(1, { kind: "supervisor.started", run_id: "sup-1", executor: "claude", subject: "ask", input_id: "q-2", step: "build", attempt: 1 });
    expect(kindOf(decideCase({ state: asked(), workflows: [supervised], receipts: [started] }), "apply_receipts").rejected).toHaveLength(1);
  });
});

describe("a gate the policy grants", () => {
  const sandboxed = { claude: caps({ sandbox: true }) };
  const gates = { standIn: { attended: [], gates: ["story.approve"] } };

  test("stays the person's even with every executor sandboxed, since nothing yet bounds the steps after it or checks the item's author", () => {
    const d = kindOf(decideCase({ state: stateAt("approve"), config: gates, executors: sandboxed }), "park");
    expect(d.rule).toBe("gate.park");
    expect(d.inbox?.text).toContain("the bound on the steps after a delegated gate");
  });

  test("one agent step bound to an executor outside a sandbox keeps the gate the person's", () => {
    const d = kindOf(decideCase({ state: stateAt("approve"), config: { ...gates, bind: { "story.build": ["loose"] } }, executors: { ...sandboxed, loose: caps() } }), "park");
    expect(d.inbox?.text).toContain("step build's executor 'loose' runs in no OS sandbox");
  });

  test("while the supervisor decides, the gate shows in the person's inbox, and either may decide it", () => {
    const d = kindOf(decideCase({ state: stateAt("approve", { supervisor: supervisor({ subject: "gate", input_id: undefined }) }), config: gates, executors: sandboxed }), "park");
    expect(d.rule).toBe("gate.park");
    expect(d.inbox?.text).toContain("A supervisor is deciding");
  });

  test("a delegated decision stands only from the visit's supervisor and with the visit named", () => {
    const at = stateAt("approve", { supervisor: supervisor({ subject: "gate", input_id: undefined }) });
    const decided = (over: Record<string, unknown>) => receipt(1, { kind: "gate.decided", outcome: "approve", by: "supervisor", delegated: true, supervisor_run: "sup-1", reason: "criteria 1-3 pass", step: "approve", attempt: 1, ...over } as KernelReceipt["data"]);
    expect(kindOf(decideCase({ state: at, config: gates, executors: sandboxed, receipts: [decided({})] }), "apply_receipts").state.ended).toBe("done");
    expect(kindOf(decideCase({ state: at, receipts: [decided({ attempt: undefined })] }), "apply_receipts").rejected).toHaveLength(1);
    expect(kindOf(decideCase({ state: at, receipts: [decided({ supervisor_run: "sup-2" })] }), "apply_receipts").rejected).toHaveLength(1);
    expect(kindOf(decideCase({ state: stateAt("approve", { supervisor: supervisor() }), receipts: [decided({})] }), "apply_receipts").rejected).toHaveLength(1);
  });

  test("a gate the supervisor handed back waits for the person with its reason", () => {
    const at = stateAt("approve", { supervised: { answered: 0, escalated: [{ input: "gate", reason: "criterion 2 is unverified" }] } });
    const d = kindOf(decideCase({ state: at, config: gates, executors: sandboxed }), "park");
    expect(d.inbox?.text).toContain("criterion 2 is unverified");
  });
});
