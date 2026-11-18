import { describe, expect, test } from "bun:test";
import { reportOnRecord } from "@norn/runtime";
import { ExitCode, runCli } from "../../src/index.ts";
import { AGENT_STEP, configured, envOf, GATE_STEP, RUN, receiptsOf, runEnv, seedUnit, UNIT, withEnv } from "./units.ts";

const json = (stdout: string): unknown => Bun.JSONL.parse(stdout)[0];
const refusal = (r: { exit: number; stdout: string }) => ({ exit: r.exit, code: (json(r.stdout) as { code?: string }).code });

describe("story approve and reject", () => {
  test("a story not at a gate refuses, saying where it is", async () => {
    const m = configured();
    await seedUnit(m, { step: AGENT_STEP });
    const r = await runCli(["story", "approve", UNIT, "--json"], m.io);
    expect(r.exit).toBe(ExitCode.refused);
    expect(json(r.stdout)).toEqual({ error: `${UNIT} is not at a gate: ${UNIT} at ${AGENT_STEP}`, do_instead: `norn story view ${UNIT}`, code: "not_at_gate" });
    expect(await receiptsOf(m)).toEqual([]);
  });

  test("an unknown story refuses, sending to the story list", async () => {
    const r = await runCli(["story", "approve", "lt-9", "--json"], configured().io);
    expect(refusal(r)).toEqual({ exit: ExitCode.refused, code: "unknown_story" });
  });

  test("approve records gate.decided for the gate's step and attempt, once however often it is sent", async () => {
    const m = configured();
    await seedUnit(m, { step: GATE_STEP, run: null });
    const first = json((await runCli(["story", "approve", UNIT, "--reason", "looks right", "--json"], m.io)).stdout);
    const again = json((await runCli(["story", "approve", UNIT, "--gate", GATE_STEP, "--json"], m.io)).stdout);
    expect(first).toMatchObject({ unit: UNIT, step: GATE_STEP, attempt: 1, outcome: "approve", replayed: false });
    expect(again).toMatchObject({ replayed: true });
    expect((await receiptsOf(m)).map((r) => r.data)).toEqual([{ kind: "gate.decided", outcome: "approve", by: "me@box", step: GATE_STEP, attempt: 1, reason: "looks right" }]);
    const wrongGate = await runCli(["story", "approve", UNIT, "--gate", "merge", "--json"], m.io);
    expect(refusal(wrongGate)).toEqual({ exit: ExitCode.refused, code: "not_at_gate" });
  });

  test("a later round's approval at the same gate and attempt records again, never read as the earlier round's", async () => {
    const m = configured();
    const state = await seedUnit(m, { step: GATE_STEP, run: null });
    const first = json((await runCli(["story", "approve", UNIT, "--json"], m.io)).stdout);
    const env = await envOf(m);
    const round = await env.journal.record(UNIT, { id: "01JBBBBBBBBBBBBBBBBBBBBBBB", data: { kind: "round.started", workflow: state.workflow } });
    if (!round.ok) throw new Error(round.failure.message);
    const second = json((await runCli(["story", "approve", UNIT, "--json"], m.io)).stdout);
    expect(first).toMatchObject({ attempt: 1, replayed: false });
    expect(second).toMatchObject({ attempt: 1, replayed: false });
    expect((first as { receipt_id: string }).receipt_id).not.toBe((second as { receipt_id: string }).receipt_id);
    expect((await receiptsOf(m)).map((r) => r.data.kind)).toEqual(["gate.decided", "round.started", "gate.decided"]);
  });

  test("a step agent may not decide a gate, and a reject needs its reason", async () => {
    const m = configured();
    await seedUnit(m, { step: GATE_STEP, run: null });
    expect(refusal(await runCli(["story", "approve", UNIT, "--json"], withEnv(m, runEnv()).io))).toEqual({ exit: ExitCode.refused, code: "agent_gate" });
    expect(refusal(await runCli(["story", "reject", UNIT, "--json"], m.io))).toEqual({ exit: ExitCode.refused, code: "reason" });
    expect((await runCli(["story", "reject", UNIT, "--reason", "split slice 2", "--json"], m.io)).exit).toBe(ExitCode.ok);
    expect((await receiptsOf(m)).map((r) => r.data)).toEqual([{ kind: "gate.decided", outcome: "reject", by: "me@box", step: GATE_STEP, attempt: 1, reason: "split slice 2" }]);
  });
});

describe("story answer", () => {
  test("delivers through answer.sent, naming the ask the agent reported; the ask then no longer counts as the run's report", async () => {
    const m = configured();
    await seedUnit(m, { step: AGENT_STEP });
    expect((await runCli(["ask", "which", "db?"], withEnv(m, runEnv()).io)).exit).toBe(ExitCode.ok);
    const ask = (await receiptsOf(m))[0];
    const r = await runCli(["story", "answer", UNIT, "use", "postgres", "--json"], m.io);
    expect(r.exit).toBe(ExitCode.ok);
    expect(json(r.stdout)).toMatchObject({ unit: UNIT, input_id: ask?.id, question: "which db?", replayed: false });
    const receipts = await receiptsOf(m);
    expect(receipts.at(-1)?.data).toEqual({ kind: "answer.sent", input_id: ask?.id as string, text: "use postgres", by: "me@box", step: AGENT_STEP, attempt: 1 });
    const read = await (await envOf(m)).journal.readUnit(UNIT);
    expect(read.ok && reportOnRecord(read.value, RUN)).toBeNull();
    // answered, nothing waits any more
    expect(refusal(await runCli(["story", "answer", UNIT, "again", "--json"], m.io))).toEqual({ exit: ExitCode.refused, code: "no_question" });
  });

  test("a story whose agent asked nothing refuses", async () => {
    const m = configured();
    await seedUnit(m, { step: AGENT_STEP });
    expect(refusal(await runCli(["story", "answer", UNIT, "yes", "--json"], m.io))).toEqual({ exit: ExitCode.refused, code: "no_question" });
  });
});

describe("run stop", () => {
  test("parks the unit, then records stop.sent and stops the session; an answer sets it going again", async () => {
    const m = configured();
    await seedUnit(m, { step: AGENT_STEP });
    const r = await runCli(["run", "stop", UNIT, "--json"], m.io);
    expect(r.exit).toBe(ExitCode.ok);
    expect(json(r.stdout)).toMatchObject({ unit: UNIT, run_id: RUN, stopped: true });
    const kinds = (await receiptsOf(m)).map((x) => x.data.kind);
    expect(kinds).toEqual(["unit.parked", "stop.sent"]);
    const answered = json((await runCli(["story", "answer", UNIT, "carry", "on", "--json"], m.io)).stdout);
    expect(answered).toMatchObject({ unit: UNIT, input_id: (await receiptsOf(m))[0]?.id });
  });

  test("a unit with no run in progress refuses", async () => {
    const m = configured();
    await seedUnit(m, { step: GATE_STEP, run: null });
    expect(refusal(await runCli(["run", "stop", UNIT, "--json"], m.io))).toEqual({ exit: ExitCode.refused, code: "no_run" });
  });
});

describe("run start", () => {
  const parked = { parked: { reason: "agent.ready.manual", since: "2026-11-17T10:00:00.000Z" } };

  test("records run.requested for the parked step and attempt, once however often it is sent", async () => {
    const m = configured();
    await seedUnit(m, { step: AGENT_STEP, run: null, extra: parked });
    const r = await runCli(["run", "start", UNIT, "--json"], m.io);
    expect(r.exit).toBe(ExitCode.ok);
    expect(json(r.stdout)).toMatchObject({ unit: UNIT, step: AGENT_STEP, attempt: 1, replayed: false });
    const again = await runCli(["run", "start", "lt-1", "--json"], m.io);
    expect(json(again.stdout)).toMatchObject({ replayed: true });
    const receipts = await receiptsOf(m);
    expect(receipts.map((x) => x.data)).toEqual([{ kind: "run.requested", by: "me@box", step: AGENT_STEP, attempt: 1 }]);
  });

  test("a unit not parked by manual mode refuses, saying where it is; a step agent may not start a run", async () => {
    const m = configured();
    await seedUnit(m, { step: AGENT_STEP });
    const r = await runCli(["run", "start", UNIT, "--json"], m.io);
    expect(refusal(r)).toEqual({ exit: ExitCode.refused, code: "not_manual_parked" });
    expect((json(r.stdout) as { error: string }).error).toContain(`runs ${RUN} at ${AGENT_STEP}`);
    const agent = withEnv(m, runEnv());
    expect(refusal(await runCli(["run", "start", UNIT, "--json"], agent.io))).toEqual({ exit: ExitCode.refused, code: "agent_start" });
    expect(await receiptsOf(m)).toEqual([]);
  });

  test("help lists the verb under run", async () => {
    const m = configured();
    const r = await runCli(["help", "run", "start"], m.io);
    expect(r.stdout).toContain("norn run start <unit>");
  });
});

describe("story create and close on the local tracker", () => {
  test("create makes an item intake takes in; close closes it", async () => {
    const m = configured();
    const made = await runCli(["story", "create", "Add", "a", "login", "page", "--workflow", "quick", "--json"], m.io);
    expect(made.exit).toBe(ExitCode.ok);
    const value = json(made.stdout) as { key: string; labels: string[] };
    expect(value).toMatchObject({ key: "lt-1", title: "Add a login page", labels: ["norn", "norn:wf:quick"] });
    const env = await envOf(m);
    const intake = await env.slots.tracker.intake({ label: "norn", assignee: null });
    expect(intake.ok && intake.value.map((i) => i.key)).toEqual(["lt-1"]);
    expect(refusal(await runCli(["story", "create", "x", "--workflow", "nope", "--json"], m.io))).toEqual({ exit: ExitCode.refused, code: "unknown_workflow" });

    const closed = await runCli(["story", "close", "lt-1", "--json"], m.io);
    expect(json(closed.stdout)).toEqual({ key: "lt-1", closed: true, was_open: true, stopping: [] });
    const item = await env.slots.tracker.get(1);
    expect(item.ok && item.value?.open).toBe(false);
    expect(refusal(await runCli(["story", "close", "lt-7", "--json"], m.io))).toEqual({ exit: ExitCode.refused, code: "unknown_story" });
  });
});
