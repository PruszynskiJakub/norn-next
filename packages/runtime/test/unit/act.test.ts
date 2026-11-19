import { describe, expect, test } from "bun:test";
import { type Decision, type DecisionOf, renderBrief } from "@norn/kernel";
import { deriveUlid } from "@norn/schema";
import { layout } from "@norn/store-local";
import { act, type AgentRunRequest, appendEvents, briefRenderInput, nudgePromptId, readStepRun } from "../../src/index.ts";
import { decided, decisionOf, type Harnessed, has, harness, MINUTE, record, rulesOf, session, tickUntil, trackerItem } from "./support.ts";

const kinds = async (h: ReturnType<typeof harness>, unit: string) => (await record(h, unit)).receipts.map((r) => r.data.kind);

describe("agent runs", () => {
  test("a crash between the intent and the launch replays without writing the intent twice, and a done launch is never repeated", async () => {
    const h = harness({ workflow: "agented" });
    h.items.push(trackerItem(1));
    await tickUntil(h, has("round.start"));
    const { t, d, index } = await decisionOf(h, "agent.start");
    h.launcher.failStart.set("lt-1", "throw");
    const crashed = await act(t, d, index);
    expect(crashed.ok).toBe(false);
    expect(await kinds(h, "lt-1")).toEqual(["round.started", "run.started"]);

    h.launcher.failStart.delete("lt-1");
    const replayed = await act(t, d, index);
    expect(replayed).toMatchObject({ ok: true, detail: { performed: true } });
    const receipts = (await record(h, "lt-1")).receipts;
    expect(receipts.map((r) => r.data.kind)).toEqual(["round.started", "run.started", "run.started"]);
    expect(receipts[2]?.data).toMatchObject({ run_id: (d as DecisionOf<"start_run">).run_id, session: `h-${(d as DecisionOf<"start_run">).run_id}` });

    const again = await act(t, d, index);
    expect(again).toMatchObject({ ok: true, detail: { performed: false } });
    expect(h.launcher.of("start")).toHaveLength(2);
    expect(await kinds(h, "lt-1")).toHaveLength(3);
  });

  test("a quiet agent is nudged through its session handle", async () => {
    const h = harness({ workflow: "agented" });
    h.items.push(trackerItem(1));
    await tickUntil(h, has("agent.start"));
    await tickUntil(h, has("receipts.apply"));
    h.sessions.byUnit.set("lt-1", session("working", { silent: true }));
    await tickUntil(h, has("agent.silent.nudge"));
    const handle = (await record(h, "lt-1")).state?.run?.session;
    const sent = (await record(h, "lt-1")).receipts.find((r) => r.data.kind === "nudge.sent");
    // the prompt id comes from the decision's intent, so a replayed nudge is the same prompt
    expect(h.launcher.of("nudge")).toEqual([[handle, expect.stringContaining("norn done"), nudgePromptId(sent?.id ?? "")]]);
    expect(await kinds(h, "lt-1")).toContain("nudge.sent");
  });

  test("a nudge to a run with no session handle fails before its intent, so it is not counted", async () => {
    const h = harness({ workflow: "agented" });
    h.items.push(trackerItem(1));
    await tickUntil(h, has("agent.start"));
    await tickUntil(h, has("receipts.apply"));
    h.sessions.byUnit.set("lt-1", session("working", { silent: true }));
    const { t, d, index } = await decisionOf(h, "agent.silent.nudge");
    const facts = structuredClone(t.facts);
    const unit = facts.stories[0]?.units[0];
    if (unit?.state?.run) delete unit.state.run.session;
    const r = await act({ ...t, facts }, d, index);
    expect(r).toMatchObject({ ok: false, error: expect.stringContaining("has no session to nudge") });
    expect(await kinds(h, "lt-1")).not.toContain("nudge.sent");
  });

  test("a dead session is retried in a fresh one, the old one stopped first", async () => {
    const h = harness({ workflow: "agented" });
    h.items.push(trackerItem(1));
    await tickUntil(h, has("agent.start"));
    await tickUntil(h, has("receipts.apply"));
    const old = (await record(h, "lt-1")).state?.run?.session;
    h.sessions.byUnit.set("lt-1", session("ended"));
    await tickUntil(h, has("agent.died.retry"));
    expect(h.launcher.calls.slice(-2).map((c) => c.op)).toEqual(["stop", "start"]);
    expect(h.launcher.of("stop").at(-1)).toEqual([old]);
  });

  test("a run past its deadline is stopped once, the order on the record", async () => {
    const h = harness({ workflow: "agented" });
    h.items.push(trackerItem(1));
    await tickUntil(h, has("agent.start"));
    await tickUntil(h, has("receipts.apply"));
    h.sessions.byUnit.set("lt-1", session("working"));
    h.clock.advance(61 * MINUTE);
    await tickUntil(h, has("agent.timeout"));
    const handle = (await record(h, "lt-1")).state?.run?.session;
    expect(h.launcher.of("stop")).toEqual([[handle]]);
    expect(await kinds(h, "lt-1")).toContain("stop.sent");
  });

  test("an answer a person sent goes to the live session when it is applied", async () => {
    const h = harness({ workflow: "agented" });
    h.items.push(trackerItem(1));
    await tickUntil(h, has("agent.start"));
    await tickUntil(h, has("receipts.apply"));
    const st = (await record(h, "lt-1")).state;
    h.sessions.byUnit.set("lt-1", session("asking", { ask: { id: "q1", question: "Which way?" } }));
    await tickUntil(h, has("agent.asking.park"));
    await h.env.journal.record("lt-1", { id: "01JD5G0000ANSWER000000000Q", data: { kind: "answer.sent", input_id: "q1", text: "left", by: "person", step: st?.step, attempt: st?.attempt } });
    h.sessions.byUnit.set("lt-1", session("working"));
    await tickUntil(h, has("receipts.apply"));
    expect(h.launcher.of("answer")).toEqual([[st?.run?.session, "q1", "left"]]);
  });

  test("an answer to a dialog in the agent's pane goes to the session as a dialog answer, never as a typed prompt", async () => {
    const h = harness({ workflow: "agented" });
    h.items.push(trackerItem(1));
    await tickUntil(h, has("agent.start"));
    await tickUntil(h, has("receipts.apply"));
    const st = (await record(h, "lt-1")).state;
    h.sessions.byUnit.set("lt-1", session("permission", { permission: { id: "perm-1", prompt: "Claude needs your permission to use Bash" } }));
    await tickUntil(h, has("agent.permission.park"));
    await h.env.journal.record("lt-1", { id: "01JD5G0000ANSWER000000000Q", data: { kind: "answer.sent", input_id: "perm-1", text: "1", by: "person", to: "dialog", step: st?.step, attempt: st?.attempt } });
    h.sessions.byUnit.set("lt-1", session("working"));
    await tickUntil(h, has("receipts.apply"));
    expect(h.launcher.of("answer")).toEqual([[st?.run?.session, "perm-1", "1", { dialog: true }]]);
  });

  test("an answer that fails to reach the session is not applied, and goes again next tick", async () => {
    const h = harness({ workflow: "agented" });
    h.items.push(trackerItem(1));
    await tickUntil(h, has("agent.start"));
    await tickUntil(h, has("receipts.apply"));
    const st = (await record(h, "lt-1")).state;
    h.sessions.byUnit.set("lt-1", session("asking", { ask: { id: "q1", question: "Which way?" } }));
    await tickUntil(h, has("agent.asking.park"));
    await h.env.journal.record("lt-1", { id: "01JD5G0000ANSWER000000000Q", data: { kind: "answer.sent", input_id: "q1", text: "left", by: "person", step: st?.step, attempt: st?.attempt } });
    h.sessions.byUnit.set("lt-1", session("working"));
    h.launcher.failAnswers = true;
    const failed = await h.runtime.tick();
    expect(failed.outcomes.find((o) => o.decision.rule === "receipts.apply")).toMatchObject({ ok: false, error: expect.stringContaining("is gone") });
    const held = await record(h, "lt-1");
    expect(held.state?.parked).toBeDefined();
    expect(held.unapplied.map((r) => r.data.kind)).toContain("answer.sent");
    h.launcher.failAnswers = false;
    await tickUntil(h, has("receipts.apply"));
    expect(h.launcher.of("answer")).toEqual([
      [st?.run?.session, "q1", "left"],
      [st?.run?.session, "q1", "left"],
    ]);
    expect((await record(h, "lt-1")).state?.parked).toBeUndefined();
  });

  test("an answer to a session that ended and cannot be resumed is applied undelivered, and the retry's brief carries it", async () => {
    const h = harness({ workflow: "agented" });
    h.items.push(trackerItem(1));
    await tickUntil(h, has("agent.start"));
    await tickUntil(h, has("receipts.apply"));
    const st = (await record(h, "lt-1")).state;
    const first = st?.run?.id as string;
    await appendEvents(h.ctx, "lt-1", first, [{ type: "input.requested", run_id: first, seq: 0, at: h.ctx.now(), id: "q1", question: "Which way?" }]);
    h.sessions.byUnit.set("lt-1", session("asking", { ask: { id: "q1", question: "Which way?" } }));
    await tickUntil(h, has("agent.asking.park"));
    // a headless agent exits once its turn ends; the fake harness cannot resume a session
    h.sessions.byUnit.set("lt-1", session("ended"));
    h.launcher.failAnswers = true;
    await h.env.journal.record("lt-1", { id: "01JD5G0000ANSWER000000000Q", data: { kind: "answer.sent", input_id: "q1", text: "left", by: "person", step: st?.step, attempt: st?.attempt } });
    const applied = await h.runtime.tick();
    expect(applied.outcomes.find((o) => o.decision.rule === "receipts.apply.undelivered")).toMatchObject({ ok: true });
    expect(h.launcher.of("answer")).toEqual([]);
    expect((await record(h, "lt-1")).state?.parked).toBeUndefined();
    await tickUntil(h, has("agent.died.retry"));
    const retry = h.launcher.of("start").at(-1)?.[0] as AgentRunRequest;
    expect(retry.run_id).not.toBe(first);
    const input = await briefRenderInput(h.env, "lt-1", retry.brief, retry.run_id);
    if (!input.ok) throw new Error(input.failure.message);
    expect(input.value.answered).toEqual([{ question: "Which way?", answer: "left" }]);
    expect(renderBrief(input.value)).toContain("- Asked: Which way?\n  Answered: left");
  });

  test("a step a gate's reject sent back to is briefed with the person's reason under Rework", async () => {
    const h = harness({ workflow: "gated" });
    h.items.push(trackerItem(1));
    await tickUntil(h, has("round.start"));
    const st = (await record(h, "lt-1")).state;
    await h.env.journal.record("lt-1", { id: "01JD5G0000REJECT0000000000", data: { kind: "gate.decided", outcome: "reject", by: "person", reason: "Make the button blue", step: st?.step, attempt: st?.attempt } });
    await tickUntil(h, has("agent.start"));
    const run = h.launcher.of("start").at(-1)?.[0] as AgentRunRequest;
    const input = await briefRenderInput(h.env, "lt-1", run.brief, run.run_id);
    if (!input.ok) throw new Error(input.failure.message);
    expect(renderBrief(input.value)).toContain("## Rework");
    expect(input.value.rework).toBe("`ready` was decided `reject` by person: Make the button blue");
  });

  test("a brief carries what the unit's steps did this round, and the ruling it reworks under Rework only", async () => {
    const h = harness({ workflow: "gated" });
    h.items.push(trackerItem(1));
    await tickUntil(h, has("round.start"));
    const st = (await record(h, "lt-1")).state;
    await h.env.journal.record("lt-1", { id: "01JD5G0000REJECT0000000000", data: { kind: "gate.decided", outcome: "reject", by: "person", reason: "Make the button blue", step: st?.step, attempt: st?.attempt } });
    await tickUntil(h, has("agent.start"));
    const run = h.launcher.of("start").at(-1)?.[0] as AgentRunRequest;
    const input = await briefRenderInput(h.env, "lt-1", run.brief, run.run_id);
    if (!input.ok) throw new Error(input.failure.message);
    expect(input.value.rework).toContain("Make the button blue");
    expect(input.value.rulings).toBeUndefined();
    expect(input.value.history).toEqual(["`ready #1` decided `reject` by person"]);
    expect(input.value.retry).toBeUndefined();
  });

  test("a retry's brief says how the session it replaces ended", async () => {
    const h = harness({ workflow: "agented" });
    h.items.push(trackerItem(1));
    await tickUntil(h, has("agent.start"));
    await tickUntil(h, has("receipts.apply"));
    const first = (await record(h, "lt-1")).state?.run?.id as string;
    const before = await briefRenderInput(h.env, "lt-1", (h.launcher.of("start").at(-1)?.[0] as AgentRunRequest).brief, first);
    expect(before.ok ? before.value.retry : "unread").toBeUndefined();
    h.sessions.byUnit.set("lt-1", session("ended"));
    await tickUntil(h, has("agent.died.retry"));
    const retry = h.launcher.of("start").at(-1)?.[0] as AgentRunRequest;
    const input = await briefRenderInput(h.env, "lt-1", retry.brief, retry.run_id);
    if (!input.ok) throw new Error(input.failure.message);
    expect(input.value.retry).toBe(`run \`${first}\``);
    expect(renderBrief(input.value)).toContain("## Retry");
  });
});

describe("checks and plugin steps", () => {
  test("a check run once under its intent is not run again on a replay", async () => {
    const h = harness();
    h.items.push(trackerItem(1));
    await tickUntil(h, has("round.start"));
    const { t, d, index } = await decisionOf(h, "check.run");
    expect(await act(t, d, index)).toMatchObject({ ok: true, detail: { performed: true, outcome: "pass", exit: 0 } });
    expect(await act(t, d, index)).toMatchObject({ ok: true, detail: { performed: false, outcome: "pass" } });
    expect(h.exec.calls).toHaveLength(1);
    expect(await kinds(h, "lt-1")).toEqual(["round.started", "run.started"]);
  });

  test("a check run inside the tick has what it left untracked in the worktree removed, never what was there before it", async () => {
    const wt = "/machine/repo/worktrees/lt-1";
    let h: Harnessed;
    h = harness({
      exec: (argv) => {
        if (argv[0] !== "sh") return undefined;
        h.untracked[wt] = ["notes.md", "coverage/out.json"];
        void h.files.write(`${wt}/coverage/out.json`, "{}");
        return { code: 0, stdout: "ok" };
      },
    });
    h.untracked[wt] = ["notes.md"];
    await h.files.write(`${wt}/notes.md`, "mine\n");
    h.items.push(trackerItem(1));
    await tickUntil(h, has("round.start"));
    const { t, d, index } = await decisionOf(h, "check.run");
    expect(await act(t, d, index)).toMatchObject({ ok: true, detail: { outcome: "pass" } });
    expect(await h.files.read(`${wt}/coverage/out.json`)).toBeNull();
    expect(await h.files.read(`${wt}/notes.md`)).toBe("mine\n");
    expect((await readStepRun(h.ctx, "lt-1"))?.output).toContain("norn removed what the check left untracked in the worktree: coverage/out.json");
  });

  test("a check's outcome comes from its exit: `exits` names one, a timeout fails", async () => {
    const answers = [{ code: 3 }, { code: 0, timedOut: true }];
    const h = harness({ exec: () => answers.shift() });
    h.items.push(trackerItem(1));
    await tickUntil(h, has("round.start"));
    const first = await decisionOf(h, "check.run");
    await act(first.t, first.d, first.index);
    expect((await readStepRun(h.ctx, "lt-1"))?.outcome).toBe("flaky");
    const again = { ...first.d, intent: { ...(first.d as DecisionOf<"run_check">).intent, id: deriveUlid(first.t.tickId, 77) } } as Decision;
    expect((await act(first.t, again, first.index)).ok).toBe(true);
    expect(await readStepRun(h.ctx, "lt-1")).toMatchObject({ outcome: "fail", output: expect.stringContaining("timed out") });
  });

  test("a check naming {checks.<name>} runs the config's command there; the default test command is bun test", async () => {
    for (const [checks, ran] of [[{ test: "npm ci && npm test" }, "npm ci && npm test --bail"], [undefined, "bun test --bail"]] as const) {
      const h = harness({ workflow: "configured", ...(checks ? { checks } : {}) });
      h.items.push(trackerItem(1));
      await tickUntil(h, has("round.start"));
      const { t, d, index } = await decisionOf(h, "check.run");
      expect(await act(t, d, index)).toMatchObject({ ok: true, detail: { outcome: "pass" } });
      expect(h.exec.calls.map((c) => c.argv)).toEqual([["sh", "-c", ran]]);
    }
  });

  test("a check naming a {checks.<name>} no config sets runs nothing and fails, naming the key to set", async () => {
    const h = harness({ workflow: "unconfigured" });
    h.items.push(trackerItem(1));
    await tickUntil(h, has("round.start"));
    const { t, d, index } = await decisionOf(h, "check.run");
    await act(t, d, index);
    expect(h.exec.calls).toHaveLength(0);
    expect((await readStepRun(h.ctx, "lt-1"))?.error).toContain("norn config set checks.lint <command>");
  });

  test("a step kind's detail reaches its step.finished receipt, where a resolver's brief reads the conflict from", async () => {
    const h = harness({ workflow: "stepped" });
    h.items.push(trackerItem(1));
    const detail = { base: { ref: "origin/main", sha: "b".repeat(40) }, conflicts: ["a.txt"] };
    h.stepAnswers.probe = [{ outcome: "conflict", detail }];
    await tickUntil(h, has("step.finished"));
    const finished = (await record(h, "lt-1")).receipts.findLast((r) => r.data.kind === "step.finished");
    expect(finished?.data).toMatchObject({ kind: "step.finished", step_kind: "probe", outcome: "conflict", detail });
  });

  test("a step kind that fails leaves its error, and decide runs it again under its run", async () => {
    const h = harness({ workflow: "stepped" });
    h.items.push(trackerItem(1));
    h.stepAnswers.probe = ["!fail", "done"];
    await tickUntil(h, has("step.run"));
    expect(await readStepRun(h.ctx, "lt-1")).toMatchObject({ kind: "probe", error: "probe: probe failed" });
    const reports = await tickUntil(h, has("step.finished"));
    expect(reports.flatMap(rulesOf)).toContain("lt-1 step.resume");
  });
});

describe("unit records", () => {
  test("a park is a receipt and a state, written once", async () => {
    const h = harness({ workflow: "agented", kernel: { mode: "manual" } });
    h.items.push(trackerItem(1));
    await tickUntil(h, has("agent.ready.manual"));
    const unit = await record(h, "lt-1");
    expect(unit.receipts.at(-1)?.data).toMatchObject({ kind: "unit.parked", reason: "agent.ready.manual" });
    expect(unit.state?.parked?.reason).toBe("agent.ready.manual");
    const next = await h.runtime.tick();
    expect(rulesOf(next)).toEqual(["lt-1 unit.parked"]);
    expect((await record(h, "lt-1")).receipts).toHaveLength(unit.receipts.length);
  });

  test("a merged change marks the story done through its receipt", async () => {
    const h = harness({ workflow: "stepped" });
    h.items.push(trackerItem(1));
    await tickUntil(h, has("gate.park"));
    h.changes["norn/lt-1"] = { id: 4, state: "merged", draft: false, head_branch: "norn/lt-1", base_branch: "main", head_sha: "a1", title: "Story 1" };
    await tickUntil(h, has("story.change_merged"));
    expect((await record(h, "lt-1")).receipts.at(-1)?.data).toMatchObject({ kind: "unit.marked", ended: "done" });
    await tickUntil(h, has("claim.release"));
    expect((await record(h, "lt-1")).state?.ended).toBe("done");
  });

  test("a corrupt record is marked once: the mark is a receipt the next tick reads back", async () => {
    const h = harness();
    h.items.push(trackerItem(1));
    await tickUntil(h, has("round.start"));
    await h.env.slots.store.appendReceipt("lt-1", { id: "01JD5G0000GARBAGE000000000", data: { kind: "nonsense" } });
    await tickUntil(h, has("unit.corrupt"));
    const raw = await h.env.slots.store.readUnit("lt-1");
    expect(raw.ok && raw.value.receipts.at(-1)?.data).toMatchObject({ kind: "unit.marked", ended: "corrupt" });
    const next = await h.runtime.tick();
    expect(rulesOf(next)).toContain("lt-1 unit.corrupt.held");
  });

  test("a run-state file the store cannot parse makes the unit corrupt, held without a mark, never a story left out", async () => {
    const h = harness();
    h.items.push(trackerItem(1));
    await tickUntil(h, has("round.start"));
    await h.ctx.files.write(layout(h.ctx.repo.dataDir).state("lt-1"), '{"format": 1, "unit": 7');
    const unit = await record(h, "lt-1");
    expect(unit.corrupt).toContain("not JSON");
    const ticks = [await h.runtime.tick(), await h.runtime.tick()];
    expect(ticks.map(rulesOf)).toEqual([["lt-1 unit.corrupt.held"], ["lt-1 unit.corrupt.held"]]);
  });

  test("a refused receipt is recorded as refused in the same act and costs no extra tick", async () => {
    const h = harness();
    h.items.push(trackerItem(1));
    await tickUntil(h, has("round.start"));
    await h.env.journal.record("lt-1", { id: "01JD5G0000STALEGATE0000000", data: { kind: "gate.decided", outcome: "approve", by: "person", step: "elsewhere", attempt: 1 } });
    await tickUntil(h, has("receipts.reject"));
    const unit = await record(h, "lt-1");
    expect(unit.receipts.map((r) => r.data.kind)).toEqual(["round.started", "gate.decided", "receipt.rejected"]);
    expect(unit.unapplied).toEqual([]);
    expect(rulesOf(await h.runtime.tick())).toEqual(["lt-1 check.run"]);
  });

  test("a record that moved since facts were read is not committed over", async () => {
    const h = harness();
    h.items.push(trackerItem(1));
    await tickUntil(h, has("round.start"));
    await h.env.journal.record("lt-1", { id: "01JD5G0000STALEGATE0000000", data: { kind: "gate.decided", outcome: "approve", by: "person", step: "elsewhere", attempt: 1 } });
    const { t, d, index } = await decisionOf(h, "receipts.reject");
    await h.env.journal.record("lt-1", { id: "01JD5G0000LATEWRITER000000", data: { kind: "mode.changed", mode: "manual", by: "person" } });
    const before = (await record(h, "lt-1")).version;
    expect(await act(t, d, index)).toMatchObject({ ok: false, error: expect.stringContaining("the record moved since facts were read") });
    expect((await record(h, "lt-1")).version).toBe(before);
  });

  test("slices get their worktrees off the story branch and their first states, once", async () => {
    const h = harness();
    h.items.push(trackerItem(1));
    await tickUntil(h, has("round.start"));
    const { t } = await decided(h);
    const load = t.workflows.byName.checked;
    if (!load?.ok) throw new Error("checked does not load");
    const d: Decision = { kind: "start_slices", unit: "lt-1", rule: "slices.start", slices: [{ unit: "lt-1/01", workflow: "checked", hash: load.workflow.pinned.hash }] };
    expect(await act(t, d, 0)).toMatchObject({ ok: true, detail: { started: ["lt-1/01"] } });
    expect(h.vcsCalls.filter((c) => c.op === "ensure").at(-1)?.args).toEqual(["lt-1/01", "norn/lt-1-01", "norn/lt-1"]);
    expect((await record(h, "lt-1/01")).state).toMatchObject({ unit: "lt-1/01", story: "lt-1", step: "test" });
    expect(await act(t, d, 0)).toMatchObject({ ok: true, detail: { started: [] } });
  });
});

describe("the mailbox and the store", () => {
  test("a letter becomes a receipt of the unit it names and is acknowledged; one that fails is only acknowledged", async () => {
    const h = harness({ workflow: "stepped" });
    h.items.push(trackerItem(1));
    await tickUntil(h, has("gate.park"));
    const st = (await record(h, "lt-1")).state;
    const mailbox = h.env.slots.store.mailbox;
    if (!mailbox) throw new Error("store-local has a mailbox");
    await mailbox.send("lt-1", { id: "01JD5G0000LETTER0000000001", from: "machine-b", data: { unit: "lt-1", receipt: { kind: "gate.decided", outcome: "approve", by: "person", step: st?.step, attempt: st?.attempt } } });
    await mailbox.send("lt-1", { id: "01JD5G0000LETTER0000000002", from: "machine-b", data: { what: "nonsense" } });
    const [r] = await tickUntil(h, has("mailbox.import"));
    expect(rulesOf(r as never)).toEqual(expect.arrayContaining(["- mailbox.import", "- mailbox.reject"]));
    const got = await mailbox.receive("lt-1");
    expect(got.ok && got.value).toEqual([]);
    expect((await record(h, "lt-1")).receipts.find((x) => x.id === "01JD5G0000LETTER0000000001")?.data.kind).toBe("gate.decided");
    await tickUntil(h, has("claim.release"));
    expect((await record(h, "lt-1")).state?.ended).toBe("done");
  });

  test("a store without flush publishes nothing, and says so", async () => {
    const h = harness();
    const { t } = await decided(h);
    expect(await act(t, { kind: "flush", unit: null, rule: "store.flush", story: "lt-1" }, 0)).toEqual({ decision: expect.anything(), ok: true, detail: { pushed: false } });
  });
});
