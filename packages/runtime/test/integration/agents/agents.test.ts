/**
 * The agent loop end to end over real processes: the runtime launches a scripted agent through its
 * own HarnessLauncher in the headless runner, the agent's hooks go through the `norn` stand-in into
 * ingestHook and the event log, its report goes through the reporting API, sessions are read from
 * the event log, and checks run detached. Nothing here waits inside a tick.
 */
import { describe, expect, test } from "bun:test";
import { join } from "node:path";
import { decodeCheckHandle, decodeLaunchHandle, readEvents, readStepRun, reportRun } from "../../../src/index.ts";
import { git, rulesOf, team } from "../world.ts";
import { agentMachine, drive, newStory, noteOf, personAnswers, ticks, unitOf } from "./world.ts";

const UNIT = "lt-1";
const MINUTE = 60_000;

/** Poll real time until `ok` holds; a process ending is not a tick's to wait on. */
async function waitUntil(ok: () => Promise<boolean>, maxMs = 15_000): Promise<void> {
  for (const until = performance.now() + maxMs; performance.now() < until; await Bun.sleep(100)) if (await ok()) return;
  throw new Error("timed out waiting");
}

/** The rules of every tick so far, flat. */
const rules = (m: { reports: { report: Parameters<typeof rulesOf>[0] }[] }) => m.reports.flatMap((r) => rulesOf(r.report));

describe("an agent step and a check, both detached", () => {
  test("a story goes from intake through a real agent process and a detached check to its gate, no tick waiting on either", async () => {
    const t = await team();
    const m = await agentMachine(t, { workflow: "e2e-slow", plans: [{ behavior: "work", commit: { "feature.txt": "the feature\n" }, pauseMs: 4000 }] });
    await newStory(m, "Add the feature");

    await drive(m, async () => (await unitOf(m, UNIT)).state?.parked !== undefined, { stepMs: 2_000 });
    const record = await unitOf(m, UNIT);
    expect([record.state?.step, record.state?.parked?.reason]).toEqual(["ready", "gate.park"]);
    expect(rules(m).filter((r) => r.includes("!"))).toEqual([]);
    expect(m.reports.flatMap((r) => r.report.problems)).toEqual([]);

    // one agent process ran the step, launched through the harness in the headless runner
    expect(m.launched).toHaveLength(1);
    const runId = m.launched[0] as string;
    const started = record.receipts.find((r) => r.data.kind === "run.started" && r.data.run_id === runId && r.data.session !== undefined);
    const handle = started?.data.kind === "run.started" ? decodeLaunchHandle(started.data.session as string) : null;
    expect([handle?.executor, handle?.run_id, handle?.unit]).toEqual(["claude", runId, UNIT]);

    // its hooks: the brief arrived as norn's prompt, a write in the worktree was allowed and one into run state denied,
    // and a stop before the report was blocked with how to report
    expect(noteOf(m, runId, "prompt")).toEqual({ kind: "allow" });
    expect(noteOf(m, runId, "brief")).toContain("norn done");
    expect(noteOf(m, runId, "write.inside")).toEqual({ kind: "allow" });
    expect(noteOf(m, runId, "write.run-state")).toMatchObject({ kind: "deny", reason: expect.stringContaining("run state") });
    expect(noteOf(m, runId, "stop.before-report")).toMatchObject({ kind: "block", reason: expect.stringContaining("norn done") });
    expect(noteOf(m, runId, "done")).toMatchObject({ code: 0 });
    // the tick applying the report stopped the agent: a headless run the unit has left works no more
    expect(await m.env.launcher.alive?.(started?.data.kind === "run.started" ? (started.data.session as string) : "")).toBe(false);
    // a retried `norn done` is the same report, wherever the unit has moved since
    const again = await reportRun(m.env, UNIT, runId, { verb: "done", outcome: "done" }, `${runId}-done`);
    expect(again.ok && again.value.replayed).toBe(true);
    const events = await readEvents(m.ctx, UNIT, runId);
    expect(events.problems).toEqual([]);
    const brief = events.events.find((e) => e.type === "turn.started");
    expect(brief?.type === "turn.started" && [brief.source, brief.prompt_id]).toEqual(["brief", runId]);
    expect(events.events.map((e) => e.type)).toContain("report.made");

    // the agent's commit is the story's work, reported once
    const worktree = join(t.dir, "a-machine", "worktrees", UNIT);
    expect(await git(worktree, "log", "-1", "--format=%s")).toBe("agent: feature.txt");
    expect(record.receipts.filter((r) => r.data.kind === "run.reported")).toHaveLength(1);

    // the check ran detached: the tick that started it returned at once, and later ticks saw it running and then routed it
    const checkRun = m.reports.flatMap((r) => r.report.outcomes).find((o) => o.decision.rule === "check.run");
    expect(checkRun?.ok && (checkRun.detail as { running?: boolean }).running).toBe(true);
    expect(record.receipts.flatMap((r) => (r.data.kind === "check.finished" ? [r.data.outcome] : []))).toEqual(["pass"]);
    const stepRun = await readStepRun(m.ctx, UNIT);
    expect([stepRun?.exit, stepRun?.running, stepRun?.output?.trim()]).toEqual([0, undefined, "ok"]);
    // no tick took as long as the agent's pause or the check's sleep
    expect(Math.max(...m.reports.map((r) => r.ms))).toBeLessThan(2500);
    expect(rules(m)).toContain(`${UNIT} agent.running`);
  }, 90_000);
});

describe("an agent that dies without reporting", () => {
  test("is read as died from its process and retried in a fresh session, and the retry carries the story on", async () => {
    const t = await team();
    const m = await agentMachine(t, { workflow: "e2e", plans: [{ behavior: "die" }, { behavior: "work", commit: { "feature.txt": "take 2\n" } }] });
    await newStory(m, "Add the feature");
    await drive(m, async () => (await unitOf(m, UNIT)).state?.parked !== undefined);
    const record = await unitOf(m, UNIT);
    expect([record.state?.step, record.state?.parked?.reason, record.state?.retries_used]).toEqual(["ready", "gate.park", 0]);
    expect(rules(m)).toContain(`${UNIT} agent.died.retry`);
    expect(rules(m).filter((r) => r.includes("!"))).toEqual([]);
    const [first, second] = m.launched as [string, string];
    expect(m.launched).toHaveLength(2);
    // the first agent said nothing of its end: the runner's word that its process is gone made it died
    expect((await readEvents(m.ctx, UNIT, first)).events.map((e) => e.type)).not.toContain("session.ended");
    const retry = record.receipts.find((r) => r.data.kind === "run.started" && r.data.run_id === second);
    expect(retry?.data.kind === "run.started" && retry.data.retry_of).toBe(first);
    expect(record.receipts.filter((r) => r.data.kind === "run.reported").map((r) => (r.data.kind === "run.reported" ? r.data.run_id : ""))).toEqual([second]);
  }, 90_000);

  test("a second death spends the step's one retry and ends the story stuck", async () => {
    const t = await team();
    const m = await agentMachine(t, { workflow: "e2e", plans: [{ behavior: "die" }, { behavior: "die" }] });
    await newStory(m, "Add the feature");
    await drive(m, async () => (await unitOf(m, UNIT)).state?.ended !== undefined);
    const state = (await unitOf(m, UNIT)).state;
    expect([state?.ended, state?.step, state?.ended_reason]).toEqual(["stuck", "build", "died: retries 1/1 used at build"]);
    expect(m.launched).toHaveLength(2);
    expect(rules(m)).toContain(`${UNIT} agent.died.exhausted`);
  }, 90_000);
});

describe("an agent that asks a person", () => {
  test("parks the story; the agent exits as `claude -p` does, the person's answer resumes the same session, and the run carries on", async () => {
    const t = await team();
    const m = await agentMachine(t, {
      workflow: "e2e",
      plans: [{ behavior: "ask", question: "Which colour should the button be?", commit: { "feature.txt": "a blue button\n" } }],
    });
    await newStory(m, "Add the button");
    await drive(m, async () => (await unitOf(m, UNIT)).state?.parked !== undefined);
    const parked = (await unitOf(m, UNIT)).state;
    expect([parked?.step, parked?.parked?.reason, parked?.parked?.text]).toEqual(["build", "agent.asked", "Which colour should the button be?"]);
    const runId = m.launched[0] as string;
    // the agent ended its turn on the ask and exited, as a headless agent does
    await waitUntil(async () => (await m.env.launcher.alive?.((parked?.run?.session as string) ?? "")) === false);
    expect(noteOf(m, runId, "stop.after-ask")).toEqual({ kind: "allow" });

    await personAnswers(m, UNIT, `report-${runId}-ask`, "Blue.");
    await drive(m, async () => (await unitOf(m, UNIT)).state?.step === "ready" && (await unitOf(m, UNIT)).state?.parked !== undefined);
    expect(rules(m).filter((r) => r.includes("!"))).toEqual([]);
    // one session the whole way: the answer resumed it, never a fresh launch or a retry
    expect(m.launched).toEqual([runId]);
    expect(rules(m).filter((r) => r.includes("died"))).toEqual([]);
    expect(noteOf(m, runId, "answered")).toMatchObject({ session: `s-${runId}`, prompt: expect.stringContaining("Blue.") });
    expect(noteOf(m, runId, "resume.prompt")).toEqual({ kind: "allow" });
    expect(noteOf(m, runId, "done")).toMatchObject({ code: 0 });
    const record = await unitOf(m, UNIT);
    expect(record.receipts.filter((r) => r.data.kind === "run.reported").map((r) => (r.data.kind === "run.reported" ? r.data.verb : ""))).toEqual(["ask", "done"]);
  }, 90_000);
});

describe("a check that hangs past its timeout", () => {
  test("is stopped by the tick that finds it overdue and routed as failed, the ticks never waiting on it", async () => {
    const t = await team();
    const m = await agentMachine(t, { workflow: "e2e-hang", plans: [{ behavior: "work", commit: { "feature.txt": "the feature\n" } }] });
    await newStory(m, "Add the feature");
    await drive(m, async () => (await readStepRun(m.ctx, UNIT))?.running === true, { stepMs: 1_000 });
    const running = await readStepRun(m.ctx, UNIT);
    const proc = decodeCheckHandle(running?.handle ?? "");
    if (!proc) throw new Error(`no check handle: ${running?.handle}`);
    expect(await m.ctx.alive?.(proc.pid, proc.started)).toBe(true);
    // still running a few ticks on, inside its minute
    await ticks(m, 3, 1_000);
    expect([(await unitOf(m, UNIT)).state?.step, (await readStepRun(m.ctx, UNIT))?.running]).toEqual(["test", true]);

    m.advance(2 * MINUTE);
    await drive(m, async () => (await unitOf(m, UNIT)).state?.parked !== undefined, { stepMs: 1_000 });
    const record = await unitOf(m, UNIT);
    expect([record.state?.step, record.state?.parked?.reason]).toEqual(["triage", "gate.park"]);
    expect(record.receipts.flatMap((r) => (r.data.kind === "check.finished" ? [r.data.outcome] : []))).toEqual(["fail"]);
    const settled = await readStepRun(m.ctx, UNIT);
    expect([settled?.running, settled?.outcome]).toEqual([undefined, "fail"]);
    expect(settled?.output).toContain("timed out after 60000 ms");
    // the process group is gone: the check does not hold the worktree past its deadline
    expect(await m.ctx.alive?.(proc.pid, proc.started)).toBe(false);
    expect(Math.max(...m.reports.map((r) => r.ms))).toBeLessThan(2500);
    expect(rules(m).filter((r) => r.includes("!"))).toEqual([]);
  }, 90_000);
});
