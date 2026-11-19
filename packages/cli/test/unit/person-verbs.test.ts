import { describe, expect, test } from "bun:test";
import { reportOnRecord } from "@norn/runtime";
import { decisionRoute } from "../../src/commands/decision-route.ts";
import { CliFailure, configPaths, ExitCode, runCli } from "../../src/index.ts";
import { fakeGh, GITHUB_CONFIG, HOME, machine, ROOT } from "./support.ts";
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

describe("a decision on a story another machine holds", () => {
  const OTHER = "someone@else";
  const mailboxOf = async (m: ReturnType<typeof configured>) => {
    const got = await (await envOf(m)).slots.store.mailbox?.receive(UNIT);
    if (!got?.ok) throw new Error("no mailbox");
    return got.value;
  };

  test("held here, approve records on this machine's record as before", async () => {
    const m = configured();
    await seedUnit(m, { step: GATE_STEP, run: null });
    await (await envOf(m)).slots.store.claims.acquire(UNIT, "me@box", 60_000);
    const r = json((await runCli(["story", "approve", UNIT, "--json"], m.io)).stdout);
    expect(r).toMatchObject({ via: "local", replayed: false });
    expect((await receiptsOf(m)).map((x) => x.data.kind)).toEqual(["gate.decided"]);
    expect(await mailboxOf(m)).toEqual([]);
  });

  test("held by another holder, approve is sent to it as a letter under the receipt's id, once however often it is sent", async () => {
    const m = configured();
    await seedUnit(m, { step: GATE_STEP, run: null });
    await (await envOf(m)).slots.store.claims.acquire(UNIT, OTHER, 60_000);
    const first = await runCli(["story", "approve", UNIT, "--reason", "looks right", "--json"], m.io);
    const again = json((await runCli(["story", "approve", UNIT, "--json"], m.io)).stdout);
    expect(first.exit).toBe(ExitCode.ok);
    const sent = json(first.stdout) as { receipt_id: string };
    expect(sent).toMatchObject({ unit: UNIT, step: GATE_STEP, outcome: "approve", via: "mailbox", holder: OTHER, replayed: false });
    expect(again).toMatchObject({ via: "mailbox", receipt_id: sent.receipt_id, replayed: true });
    expect(await receiptsOf(m)).toEqual([]);
    const letters = await mailboxOf(m);
    expect(letters.map(({ id, from, data }) => ({ id, from, data }))).toEqual([
      {
        id: sent.receipt_id,
        from: "me@box",
        data: { unit: UNIT, receipt: { kind: "gate.decided", outcome: "approve", by: "me@box", step: GATE_STEP, attempt: 1, reason: "looks right" } },
      },
    ]);
    const md = (await runCli(["story", "reject", UNIT, "--reason", "split it"], m.io)).stdout;
    expect(md).toContain(`to ${OTHER}; its next tick applies it`);
  });

  test("an answer to a question goes the same way while another holder has the claim, expired or not", async () => {
    const m = configured();
    await seedUnit(m, { step: AGENT_STEP });
    expect((await runCli(["ask", "which", "db?"], withEnv(m, runEnv()).io)).exit).toBe(ExitCode.ok);
    const ask = (await receiptsOf(m))[0];
    await (await envOf(m)).slots.store.claims.acquire(UNIT, OTHER, 1);
    await Bun.sleep(5);
    const r = json((await runCli(["story", "answer", UNIT, "use", "postgres", "--json"], m.io)).stdout);
    expect(r).toMatchObject({ unit: UNIT, input_id: ask?.id, via: "mailbox", holder: OTHER });
    expect((await receiptsOf(m)).map((x) => x.data.kind)).toEqual(["run.reported"]);
    expect((await mailboxOf(m)).map((l) => l.data)).toEqual([
      { unit: UNIT, receipt: { kind: "answer.sent", input_id: ask?.id as string, text: "use postgres", by: "me@box", step: AGENT_STEP, attempt: 1 } },
    ]);
  });

  test("a store with no mailbox refuses on a shared store, naming the holder, and writes locally on a store every holder reads", () => {
    const claim = { story: UNIT, holder: OTHER, acquired_at: "2026-11-18T10:00:00.000Z", expires_at: "2026-11-18T11:00:00.000Z", version: 1 };
    const now = "2026-11-18T10:30:00.000Z";
    const caps = { claims: "distributed" as const, mailbox: false, artifacts: true };
    const shared = { name: "remote", capabilities: { ...caps, shared: true } };
    let refused: unknown;
    try {
      decisionRoute(UNIT, claim, "me@box", shared, now, `norn story approve ${UNIT}`);
    } catch (e) {
      refused = e;
    }
    expect(refused).toBeInstanceOf(CliFailure);
    const body = (refused as CliFailure).body;
    expect(body).toMatchObject({ code: "claim_held", details: { holder: OTHER, expired: false } });
    expect(body.do_instead).toContain(`norn story take ${UNIT} --force`);
    expect(decisionRoute(UNIT, claim, "me@box", { name: "one", capabilities: { ...caps, shared: false } }, now, "x")).toEqual({ via: "local" });
    expect(decisionRoute(UNIT, null, "me@box", shared, now, "x")).toEqual({ via: "local" });
    expect(decisionRoute(UNIT, { ...claim, holder: "me@box" }, "me@box", shared, now, "x")).toEqual({ via: "local" });
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

  test("an attended step's park is started the same way", async () => {
    const m = configured();
    await seedUnit(m, { step: AGENT_STEP, run: null, extra: { parked: { reason: "agent.ready.attended", since: "2026-11-17T10:00:00.000Z" } } });
    const r = await runCli(["run", "start", UNIT, "--json"], m.io);
    expect(r.exit).toBe(ExitCode.ok);
    expect((await receiptsOf(m)).map((x) => x.data)).toEqual([{ kind: "run.requested", by: "me@box", step: AGENT_STEP, attempt: 1 }]);
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

describe("story create on GitHub", () => {
  test("defines the labels the item takes before the issue is made, so a fresh repository takes them; one there already is left as it is", async () => {
    const gh = fakeGh(["norn"]);
    const m = machine({ seed: { [configPaths(HOME, ROOT).local]: GITHUB_CONFIG }, script: gh.script });
    const r = await runCli(["story", "create", "A", "title", "--workflow", "quick", "--json"], m.io);
    expect(r.exit).toBe(ExitCode.ok);
    expect(gh.calls.filter((c) => !c.startsWith("issue list"))).toEqual(["label list", "label create norn:wf:quick", "issue create"]);
  });

  test("a label the tracker cannot define refuses before any issue is made", async () => {
    const gh = fakeGh();
    gh.refuseLabels = true;
    const m = machine({ seed: { [configPaths(HOME, ROOT).local]: GITHUB_CONFIG }, script: gh.script });
    const r = await runCli(["story", "create", "A", "title", "--json"], m.io);
    expect(r.exit).not.toBe(ExitCode.ok);
    expect((json(r.stdout) as { error: string }).error).toContain("cannot define the labels norn");
    expect(gh.calls).not.toContain("issue create");
  });
});

describe("story round", () => {
  const ended = { extra: { ended: "done" as const }, run: null };

  test("records round.started on a story whose round ended, pinning the workflow and the step, once however often it is sent", async () => {
    const m = configured();
    await seedUnit(m, { step: AGENT_STEP, ...ended });
    const r = await runCli(["story", "round", UNIT, "--workflow", "triage", "--reason", "look again", "--json"], m.io);
    expect(r.exit).toBe(ExitCode.ok);
    const env = await envOf(m);
    const triage = env.workflows.triage;
    if (!triage?.ok) throw new Error("the pack's triage workflow does not load");
    expect(json(r.stdout)).toMatchObject({ story: UNIT, workflow: "triage", hash: triage.workflow.pinned.hash, at: "explore", ended_round: false, replayed: false });
    const again = await runCli(["story", "round", UNIT, "--workflow", "triage", "--reason", "look again", "--json"], m.io);
    expect(json(again.stdout)).toMatchObject({ replayed: true });
    expect((await receiptsOf(m)).map((x) => x.data)).toEqual([
      { kind: "round.started", workflow: triage.workflow.pinned, by: "me@box", reason: "look again", step: AGENT_STEP, attempt: 1 },
    ]);
  });

  test("--at names the step the round starts at; a step the workflow lacks, or a workflow that does not load, is refused", async () => {
    const m = configured();
    await seedUnit(m, { step: AGENT_STEP, ...ended });
    const bad = await runCli(["story", "round", UNIT, "--workflow", "refinement", "--at", "nowhere", "--json"], m.io);
    expect(refusal(bad)).toEqual({ exit: ExitCode.refused, code: "unknown_step" });
    expect(refusal(await runCli(["story", "round", UNIT, "--workflow", "nope", "--json"], m.io))).toEqual({ exit: ExitCode.refused, code: "unknown_workflow" });
    expect(await receiptsOf(m)).toEqual([]);
    const r = await runCli(["story", "round", UNIT, "--workflow", "refinement", "--at", "plan", "--json"], m.io);
    expect(json(r.stdout)).toMatchObject({ workflow: "refinement", at: "plan" });
    expect((await receiptsOf(m))[0]?.data).toMatchObject({ kind: "round.started", at: "plan", workflow: { name: "refinement" } });
  });

  test("a round under way is refused without --force; with it, the round is ended by the person first", async () => {
    const m = configured();
    await seedUnit(m, { step: GATE_STEP, run: null });
    expect(refusal(await runCli(["story", "round", UNIT, "--workflow", "triage", "--json"], m.io))).toEqual({ exit: ExitCode.refused, code: "round_unfinished" });
    const r = await runCli(["story", "round", UNIT, "--workflow", "triage", "--force", "--json"], m.io);
    expect(json(r.stdout)).toMatchObject({ ended_round: true, replayed: false });
    const data = (await receiptsOf(m)).map((x) => x.data);
    expect(data.map((d) => d.kind)).toEqual(["unit.marked", "round.started"]);
    expect(data[0]).toEqual({ kind: "unit.marked", ended: "stuck", reason: "ended by me@box for a new triage round", step: GATE_STEP, attempt: 1 });
    // a retry after a try cut short records nothing twice
    const again = await runCli(["story", "round", UNIT, "--workflow", "triage", "--force", "--json"], m.io);
    expect(json(again.stdout)).toMatchObject({ replayed: true });
    expect(await receiptsOf(m)).toHaveLength(2);
  });

  test("--force never ends a round while a run nobody stopped is on its record, of any kind, or a slice is unfinished", async () => {
    const m = configured();
    await seedUnit(m, { step: AGENT_STEP });
    const running = await runCli(["story", "round", UNIT, "--workflow", "triage", "--force", "--json"], m.io);
    expect(json(running.stdout)).toMatchObject({ code: "run_going", do_instead: `norn run stop ${UNIT}` });
    const check = configured();
    await seedUnit(check, { step: "test" });
    expect(refusal(await runCli(["story", "round", UNIT, "--workflow", "triage", "--force", "--json"], check.io))).toEqual({ exit: ExitCode.refused, code: "run_going" });
    const s = configured();
    await seedUnit(s, { step: GATE_STEP, run: null });
    await seedUnit(s, { unit: `${UNIT}/01`, step: GATE_STEP, run: null });
    expect(refusal(await runCli(["story", "round", UNIT, "--workflow", "triage", "--force", "--json"], s.io))).toEqual({ exit: ExitCode.refused, code: "slices_unfinished" });
    expect(await receiptsOf(m)).toEqual([]);
  });

  test("a round that can come to a slices step is refused while slices of an earlier round are on the record", async () => {
    const m = configured();
    await seedUnit(m, { step: "qa", ...ended });
    await seedUnit(m, { unit: `${UNIT}/01`, step: AGENT_STEP, ...ended });
    const r = await runCli(["story", "round", UNIT, "--workflow", "story", "--json"], m.io);
    expect(refusal(r)).toEqual({ exit: ExitCode.refused, code: "slices_from_earlier_round" });
    expect(json(r.stdout)).toMatchObject({ details: { units: [`${UNIT}/01`], steps: ["slices"] } });
    expect(await receiptsOf(m)).toEqual([]);
    // from qa no route comes back to the slices step, so that round counts no old slice
    const past = await runCli(["story", "round", UNIT, "--workflow", "story", "--at", "qa", "--json"], m.io);
    expect(json(past.stdout)).toMatchObject({ workflow: "story", at: "qa" });
  });

  test("a story whose change merged is refused: new work is a new story", async () => {
    const m = configured();
    await seedUnit(m, { step: AGENT_STEP, ...ended });
    const env = await envOf(m);
    const sha = "a".repeat(40);
    const merged = { id: 1, head_branch: `norn/${UNIT}`, base_branch: "main", title: "Look", body: "", draft: false, opened_at: "2026-11-17T10:00:00.000Z", receipts: ["r1"], base_sha_at_open: sha, head_sha: sha, merged_at: "2026-11-17T11:00:00.000Z", merge_sha: sha };
    await env.ctx.files.write(`${env.ctx.repo.dataDir}/changes/1.json`, JSON.stringify(merged));
    const r = await runCli(["story", "round", UNIT, "--workflow", "triage", "--json"], m.io);
    expect(refusal(r)).toEqual({ exit: ExitCode.refused, code: "change_merged" });
    expect((json(r.stdout) as { do_instead: string }).do_instead).toBe('norn story create "<title>" for the new work');
    expect(await receiptsOf(m)).toEqual([]);
  });

  test("story view and status name the commit a merged change landed as", async () => {
    const m = configured();
    await seedUnit(m, { step: AGENT_STEP, ...ended });
    const env = await envOf(m);
    const sha = "a".repeat(40);
    const landed = "b".repeat(40);
    const merged = { id: 1, head_branch: `norn/${UNIT}`, base_branch: "main", title: "Look", body: "", draft: false, opened_at: "2026-11-17T10:00:00.000Z", receipts: ["r1"], base_sha_at_open: sha, head_sha: sha, merged_at: "2026-11-17T11:00:00.000Z", merge_sha: landed };
    await env.ctx.files.write(`${env.ctx.repo.dataDir}/changes/1.json`, JSON.stringify(merged));
    const view = await runCli(["story", "view", UNIT, "--json"], m.io);
    expect((json(view.stdout) as { change: unknown }).change).toMatchObject({ id: 1, state: "merged", merge_sha: landed });
    const status = await runCli(["status", "--json"], m.io);
    expect((json(status.stdout) as { stories: { change: unknown }[] }).stories[0]?.change).toMatchObject({ merge_sha: landed });
  });

  test("a closed item, a slice, a step agent, another holder's claim and receipts waiting to be applied are refused", async () => {
    const m = configured();
    expect((await runCli(["story", "create", "Look", "--json"], m.io)).exit).toBe(ExitCode.ok);
    await seedUnit(m, { step: AGENT_STEP, ...ended });
    const env = await envOf(m);
    const round = (args: string[] = [], t = m) => runCli(["story", "round", ...args, "--workflow", "triage", "--json"], t.io);
    expect(refusal(await round([`${UNIT}/01`]))).toEqual({ exit: ExitCode.refused, code: "not_a_story" });
    expect(refusal(await round([UNIT], withEnv(m, runEnv())))).toEqual({ exit: ExitCode.refused, code: "agent_round" });
    const pending = await env.journal.record(UNIT, { id: "01JCCCCCCCCCCCCCCCCCCCCCCC", data: { kind: "mode.changed", mode: "auto", by: "me@box" } });
    if (!pending.ok) throw new Error(pending.failure.message);
    expect(refusal(await round([UNIT]))).toEqual({ exit: ExitCode.refused, code: "pending" });
    const held = await env.slots.store.claims.acquire(UNIT, "someone@else", 60_000);
    if (!held.ok) throw new Error(held.failure.message);
    expect(refusal(await round([UNIT]))).toEqual({ exit: ExitCode.refused, code: "claim_held" });
    await env.slots.store.claims.release(UNIT, "someone@else");
    expect((await runCli(["story", "close", UNIT, "--json"], m.io)).exit).toBe(ExitCode.ok);
    const closed = await round([UNIT]);
    expect(json(closed.stdout)).toMatchObject({ code: "item_closed", do_instead: 'norn story create "<title>" for the new work' });
  });
});

describe("run rerun", () => {
  const stuck = { extra: { ended: "stuck" as const, ended_reason: "the agent reported stuck" }, run: null };
  const countersOf = async (m: ReturnType<typeof configured>): Promise<string[]> => {
    const story = (await envOf(m)).workflows.story;
    if (!story?.ok) throw new Error("the pack's story workflow does not load");
    return Object.keys(story.workflow.graph.counters);
  };

  test("records step.moved for a stuck unit, at another step with counters reset, once however often it is sent", async () => {
    const m = configured();
    await seedUnit(m, { step: GATE_STEP, ...stuck });
    const counter = (await countersOf(m))[0] as string;
    const args = ["run", "rerun", UNIT, "--step", AGENT_STEP, "--reset", counter, "--reason", "the spec changed", "--json"];
    const r = await runCli(args, m.io);
    expect(r.exit).toBe(ExitCode.ok);
    expect(json(r.stdout)).toMatchObject({ unit: UNIT, from: GATE_STEP, attempt: 1, step: AGENT_STEP, reset: [counter], stops_run: null, replayed: false });
    expect(json((await runCli(args, m.io)).stdout)).toMatchObject({ replayed: true });
    expect((await receiptsOf(m)).map((x) => x.data)).toEqual([
      { kind: "step.moved", to: AGENT_STEP, reset: [counter], by: "me@box", reason: "the spec changed", step: GATE_STEP, attempt: 1 },
    ]);
  });

  test("without --step it runs the unit's own step again; a live run is left for the tick to stop first", async () => {
    const m = configured();
    await seedUnit(m, { step: AGENT_STEP });
    const r = await runCli(["run", "rerun", UNIT, "--json"], m.io);
    expect(json(r.stdout)).toMatchObject({ step: AGENT_STEP, from: AGENT_STEP, stops_run: RUN });
    expect((await receiptsOf(m)).map((x) => x.data)).toEqual([{ kind: "step.moved", to: AGENT_STEP, by: "me@box", step: AGENT_STEP, attempt: 1 }]);
  });

  test("a step or counter the pinned workflow lacks is refused naming the ones it has", async () => {
    const m = configured();
    await seedUnit(m, { step: GATE_STEP, ...stuck });
    const step = await runCli(["run", "rerun", UNIT, "--step", "nowhere", "--json"], m.io);
    expect(refusal(step)).toEqual({ exit: ExitCode.refused, code: "unknown_step" });
    expect((json(step.stdout) as { do_instead: string }).do_instead).toContain(AGENT_STEP);
    const counter = await runCli(["run", "rerun", UNIT, "--reset", "nope", "--json"], m.io);
    expect(refusal(counter)).toEqual({ exit: ExitCode.refused, code: "unknown_counter" });
    expect((json(counter.stdout) as { do_instead: string }).do_instead).toBe(`name one of ${(await countersOf(m)).join(", ")}`);
    expect(await receiptsOf(m)).toEqual([]);
  });

  test("a unit that ended done, a corrupt one, and one with no run state are refused", async () => {
    const m = configured();
    await seedUnit(m, { step: AGENT_STEP, run: null, extra: { ended: "done" } });
    const done = await runCli(["run", "rerun", UNIT, "--json"], m.io);
    expect(json(done.stdout)).toMatchObject({ code: "unit_done", do_instead: `norn story round ${UNIT} --workflow <name>, for new work on the story` });
    const c = configured();
    await seedUnit(c, { step: AGENT_STEP, run: null, extra: { ended: "corrupt", ended_reason: "bad record" } });
    expect(refusal(await runCli(["run", "rerun", UNIT, "--json"], c.io))).toEqual({ exit: ExitCode.corrupt, code: "corrupt" });
    expect(refusal(await runCli(["run", "rerun", "lt-9", "--json"], c.io))).toEqual({ exit: ExitCode.refused, code: "unknown_unit" });
  });

  test("a slice is rerun at its own step", async () => {
    const m = configured();
    await seedUnit(m, { step: GATE_STEP, run: null });
    await seedUnit(m, { unit: `${UNIT}/01`, step: AGENT_STEP, ...stuck });
    const r = await runCli(["run", "rerun", `${UNIT}/01`, "--json"], m.io);
    expect(json(r.stdout)).toMatchObject({ unit: `${UNIT}/01`, step: AGENT_STEP, replayed: false });
    expect((await receiptsOf(m, `${UNIT}/01`)).map((x) => x.data.kind)).toEqual(["step.moved"]);
  });

  test("a step agent, another holder's claim and receipts waiting to be applied are refused", async () => {
    const m = configured();
    await seedUnit(m, { step: GATE_STEP, ...stuck });
    const env = await envOf(m);
    const rerun = (t = m) => runCli(["run", "rerun", UNIT, "--json"], t.io);
    expect(refusal(await rerun(withEnv(m, runEnv())))).toEqual({ exit: ExitCode.refused, code: "agent_rerun" });
    const held = await env.slots.store.claims.acquire(UNIT, "someone@else", 60_000);
    if (!held.ok) throw new Error(held.failure.message);
    expect(refusal(await rerun())).toEqual({ exit: ExitCode.refused, code: "claim_held" });
    await env.slots.store.claims.release(UNIT, "someone@else");
    const pending = await env.journal.record(UNIT, { id: "01JCCCCCCCCCCCCCCCCCCCCCCC", data: { kind: "mode.changed", mode: "auto", by: "me@box" } });
    if (!pending.ok) throw new Error(pending.failure.message);
    expect(refusal(await rerun())).toEqual({ exit: ExitCode.refused, code: "pending" });
    expect((await receiptsOf(m)).map((x) => x.data.kind)).toEqual(["mode.changed"]);
  });
});

describe("story take", () => {
  const take = (m: ReturnType<typeof configured>, ...args: string[]) => runCli(["story", "take", UNIT, ...args, "--json"], m.io);
  const holderOf = async (m: ReturnType<typeof configured>) => {
    const c = await (await envOf(m)).slots.store.claims.read(UNIT);
    if (!c.ok) throw new Error(c.failure.message);
    return c.value?.holder ?? null;
  };

  test("a story in progress that nobody holds is taken and the takeover recorded; taking it again changes nothing", async () => {
    const m = configured();
    await seedUnit(m, { step: AGENT_STEP });
    const first = await take(m, "--reason", "carry it on here");
    expect(first.exit).toBe(ExitCode.ok);
    expect(json(first.stdout)).toMatchObject({ story: UNIT, holder: "me@box", taken: true, from: null, expired: null, replayed: false });
    expect(await holderOf(m)).toBe("me@box");
    const again = await take(m);
    expect(json(again.stdout)).toMatchObject({ story: UNIT, holder: "me@box", taken: false });
    const receipts = await receiptsOf(m);
    expect(receipts.map((r) => r.data)).toEqual([{ kind: "claim.taken", to: "me@box", version: 1, by: "me@box", reason: "carry it on here" }]);
  });

  test("another holder's claim is refused naming it, and taken over with --force, live or expired", async () => {
    const m = configured();
    await seedUnit(m, { step: AGENT_STEP });
    const env = await envOf(m);
    const held = await env.slots.store.claims.acquire(UNIT, "someone@else", 60_000);
    if (!held.ok) throw new Error(held.failure.message);
    const refused = await take(m);
    expect(refused.exit).toBe(ExitCode.refused);
    expect(json(refused.stdout)).toEqual({
      error: `${UNIT} is held by someone@else until ${held.value.expires_at}`,
      do_instead: `norn story take ${UNIT} --force, once someone@else no longer acts on it`,
      code: "claim_held",
      details: { holder: "someone@else", expires_at: held.value.expires_at, expired: false },
    });
    expect(await holderOf(m)).toBe("someone@else");
    const forced = await take(m, "--force", "--reason", "the laptop died");
    expect(json(forced.stdout)).toMatchObject({ taken: true, from: "someone@else", expired: false, version: held.value.version + 1 });
    expect(await holderOf(m)).toBe("me@box");
    expect((await receiptsOf(m)).map((r) => r.data)).toEqual([
      { kind: "claim.taken", from: "someone@else", from_expires_at: held.value.expires_at, to: "me@box", version: held.value.version + 1, by: "me@box", reason: "the laptop died" },
    ]);

    const other = configured();
    await seedUnit(other, { step: AGENT_STEP });
    const brief = await (await envOf(other)).slots.store.claims.acquire(UNIT, "someone@else", 1);
    if (!brief.ok) throw new Error(brief.failure.message);
    // every command reads a clock started afresh, so the claim is moved into the past on disk
    const [path, text] = Object.entries(other.files.snapshot()).find(([p]) => p.endsWith(`/${UNIT}/claim.json`)) ?? [];
    if (!path || !text) throw new Error("no claim file");
    await other.files.write(path, text.replace(brief.value.expires_at, "2025-01-01T00:00:00.000Z"));
    expect(json((await take(other)).stdout)).toMatchObject({ code: "claim_held", details: { expired: true } });
    expect(json((await take(other, "--force")).stdout)).toMatchObject({ taken: true, from: "someone@else", expired: true });
  });

  test("story view lists the criteria QA left for the person at the gate, until a gate is decided", async () => {
    const m = configured();
    await seedUnit(m, { step: "human-qa", run: null });
    const env = await envOf(m);
    const criteria = [
      { id: "AC1", verdict: "pass" as const, evidence: "AC1.md" },
      { id: "AC2", verdict: "unverified" as const, reason: "no browser here", how: "open /today and look for the red flag" },
    ];
    const wrote = await env.journal.record(UNIT, { id: "report-qa-1", data: { kind: "run.reported", step: "qa", attempt: 1, run_id: RUN, verb: "done", outcome: "unverified", criteria } });
    if (!wrote.ok) throw new Error(wrote.failure.message);
    const view = json((await runCli(["story", "view", UNIT, "--json"], m.io)).stdout) as { criteria: unknown[] };
    expect(view.criteria).toEqual([{ unit: UNIT, step: "qa", attempt: 1, at: expect.any(String), verdicts: [criteria[1]] }]);
    const md = (await runCli(["story", "view", UNIT], m.io)).stdout;
    expect(md).toContain("## Criteria to check");
    expect(md).toContain("- `AC2` unverified: (no browser here); how to check: open /today and look for the red flag");
    expect(md).not.toContain("`AC1`");
    const ruled = await env.journal.record(UNIT, { id: "gate-ruled", data: { kind: "gate.decided", outcome: "approve", by: "me@box", step: "human-qa", attempt: 1 } });
    if (!ruled.ok) throw new Error(ruled.failure.message);
    expect((json((await runCli(["story", "view", UNIT, "--json"], m.io)).stdout) as { criteria: unknown[] }).criteria).toEqual([]);
  });

  test("story view and status list the open notes for a person at a gate, until the gate is approved", async () => {
    const m = configured();
    await seedUnit(m, { step: "human-qa", run: null });
    const env = await envOf(m);
    const record = async (id: string, data: Parameters<typeof env.journal.record>[1]["data"]) => {
      const wrote = await env.journal.record(UNIT, { id, data });
      if (!wrote.ok) throw new Error(wrote.failure.message);
    };
    const criteria = [{ id: "AC1", verdict: "pass" as const, evidence: "AC1.md", note: "the copy reads oddly on mobile" }];
    // a note an earlier approve acknowledged is no longer open
    await record("report-old", { kind: "run.reported", step: "qa", attempt: 1, run_id: RUN, verb: "done", outcome: "pass", notes: [{ text: "settled before" }] });
    await record("gate-old", { kind: "gate.decided", outcome: "approve", by: "me@box", step: "approve-slices", attempt: 1 });
    // a report the journal rejected never stood, and neither did its note
    await record("report-refused", { kind: "run.reported", step: "qa", attempt: 1, run_id: RUN, verb: "done", outcome: "pass", notes: [{ text: "from a report that never stood" }] });
    const refused = (await receiptsOf(m)).at(-1)?.seq ?? 0;
    await record("reject-refused", { kind: "receipt.rejected", seq: refused, reason: "the run had already reported" });
    await record("report-qa-1", { kind: "run.reported", step: "qa", attempt: 1, run_id: RUN, verb: "done", outcome: "partial", criteria, notes: [{ text: "the copy reads oddly on mobile", criterion: "AC1" }] });
    const note = { unit: UNIT, step: "qa", attempt: 1, at: expect.any(String), text: "the copy reads oddly on mobile", criterion: "AC1" };
    expect((json((await runCli(["story", "view", UNIT, "--json"], m.io)).stdout) as { notes: unknown[] }).notes).toEqual([note]);
    const md = (await runCli(["story", "view", UNIT], m.io)).stdout;
    expect(md).toContain("## Notes for you");
    expect(md).toContain("- lt-1, from qa #1: `AC1` the copy reads oddly on mobile");
    expect(md).not.toContain("settled before");
    expect(md).not.toContain("never stood");
    expect((json((await runCli(["status", "--json"], m.io)).stdout) as { notes: unknown[] }).notes).toEqual([note]);
    expect((await runCli(["status"], m.io)).stdout).toContain("(1 open note: norn story view lt-1)");
    await record("gate-ruled", { kind: "gate.decided", outcome: "approve", by: "me@box", step: "human-qa", attempt: 1 });
    expect((json((await runCli(["story", "view", UNIT, "--json"], m.io)).stdout) as { notes: unknown[] }).notes).toEqual([]);
  });

  test("story view lists every takeover on the story's record", async () => {
    const m = configured();
    await seedUnit(m, { step: AGENT_STEP });
    const held = await (await envOf(m)).slots.store.claims.acquire(UNIT, "someone@else", 60_000);
    if (!held.ok) throw new Error(held.failure.message);
    expect((await take(m, "--force", "--reason", "moving to the desktop")).exit).toBe(ExitCode.ok);
    const view = json((await runCli(["story", "view", UNIT, "--json"], m.io)).stdout) as { takeovers: unknown[]; claim: unknown };
    expect(view.claim).toMatchObject({ holder: "me@box" });
    expect(view.takeovers).toEqual([{ at: expect.any(String), from: "someone@else", to: "me@box", by: "me@box", reason: "moving to the desktop" }]);
    const md = await runCli(["story", "view", UNIT], m.io);
    expect(md.stdout).toContain("## Claim taken");
    expect(md.stdout).toContain("taken from someone@else to me@box — moving to the desktop");
  });

  test("a slice, a step agent and a story with no run state and no claim are refused", async () => {
    const m = configured();
    expect(refusal(await take(m))).toEqual({ exit: ExitCode.refused, code: "unknown_story" });
    await seedUnit(m, { step: AGENT_STEP });
    expect(refusal(await runCli(["story", "take", `${UNIT}/01`, "--json"], m.io))).toEqual({ exit: ExitCode.refused, code: "not_a_story" });
    expect(refusal(await take(withEnv(m, runEnv())))).toEqual({ exit: ExitCode.refused, code: "agent_take" });
    expect(await receiptsOf(m)).toEqual([]);
    expect(await holderOf(m)).toBeNull();
  });
});
