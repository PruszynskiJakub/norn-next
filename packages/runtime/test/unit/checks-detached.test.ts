import { describe, expect, test } from "bun:test";
import type { DecisionOf } from "@norn/kernel";
import { act, checkExitPath, checkWrapperArgv, readStepRun, type StepRunRecord } from "../../src/index.ts";
import { decisionOf, FakeProcesses, type Harnessed, has, harness, MINUTE, record, rulesOf, tickUntil, trackerItem } from "./support.ts";

const kinds = async (h: Harnessed, unit: string) => (await record(h, unit)).receipts.map((r) => r.data.kind);

/** A story at its check step on a host that runs checks detached. */
async function atCheck() {
  const procs = new FakeProcesses();
  const h = harness({ processes: procs });
  h.items.push(trackerItem(1));
  await tickUntil(h, has("check.run"));
  // the run's start is applied before decide reads the step run
  await tickUntil(h, has("receipts.apply"));
  return { h, procs };
}

async function exits(h: Harnessed, code: number, output = "") {
  const sr = (await readStepRun(h.ctx, "lt-1")) as StepRunRecord;
  if (output && sr.log) await h.files.write(sr.log, output);
  await h.files.write(checkExitPath(h.ctx, "lt-1", sr.run_id, sr.attempt), `${JSON.stringify({ exit: code, finished_at: h.ctx.now() })}\n`);
}

describe("detached checks", () => {
  test("run_check starts the wrapper and returns at once; the step run is recorded running with its handle", async () => {
    const { h, procs } = await atCheck();
    expect(h.exec.calls).toEqual([]);
    expect(procs.spawned).toHaveLength(1);
    const sr = (await readStepRun(h.ctx, "lt-1")) as StepRunRecord;
    expect(sr).toMatchObject({ kind: "check", running: true, handle: "100@start-100", timeout_ms: 300_000, detail: { exits: { 3: "flaky" } } });
    expect(procs.spawned[0]).toMatchObject({ argv: checkWrapperArgv("bun test", checkExitPath(h.ctx, "lt-1", sr.run_id, sr.attempt)), cwd: "/machine/repo/worktrees/lt-1", logPath: sr.log });
    // while it runs, decide waits
    expect(rulesOf(await h.runtime.tick())).toContain("lt-1 check.running");
  });

  test("a replayed run_check starts nothing new", async () => {
    const procs = new FakeProcesses();
    const h = harness({ processes: procs });
    h.items.push(trackerItem(1));
    await tickUntil(h, has("round.start"));
    const { t, d, index } = await decisionOf(h, "check.run");
    expect(await act(t, d, index)).toMatchObject({ ok: true, detail: { performed: true, running: true } });
    expect(await act(t, d, index)).toMatchObject({ ok: true, detail: { performed: false, running: true } });
    expect(procs.spawned).toHaveLength(1);
    expect(await kinds(h, "lt-1")).toEqual(["round.started", "run.started"]);
  });

  test("a finished check's exit routes its outcome, and its output tail is kept for the rework brief", async () => {
    const { h } = await atCheck();
    await exits(h, 3, "1 test flaked\n");
    await tickUntil(h, has("check.finished"));
    expect((await record(h, "lt-1")).receipts.at(-1)?.data).toMatchObject({ kind: "check.finished", exit: 3, outcome: "flaky" });
    expect(await readStepRun(h.ctx, "lt-1")).toMatchObject({ outcome: "flaky", exit: 3, output: "1 test flaked\n" });
    expect((await readStepRun(h.ctx, "lt-1"))?.running).toBeUndefined();
  });

  test("a check whose process died without an exit is a failed outcome with the reason", async () => {
    const { h, procs } = await atCheck();
    procs.dead.add(100);
    await tickUntil(h, has("check.finished"));
    expect((await record(h, "lt-1")).receipts.at(-1)?.data).toMatchObject({ kind: "check.finished", outcome: "fail" });
    expect(await readStepRun(h.ctx, "lt-1")).toMatchObject({ outcome: "fail", error: expect.stringContaining("ended without recording its exit") });
  });

  test("a check past its deadline is stopped and fails as timed out", async () => {
    const { h, procs } = await atCheck();
    h.clock.advance(6 * MINUTE);
    await tickUntil(h, has("check.finished"));
    expect(procs.killed).toEqual([100]);
    expect((await record(h, "lt-1")).receipts.at(-1)?.data).toMatchObject({ kind: "check.finished", outcome: "fail" });
    expect(await readStepRun(h.ctx, "lt-1")).toMatchObject({ outcome: "fail", output: expect.stringContaining("timed out after 300000 ms") });
  });

  test("an exit file that fails validation fails the check and says why, never guessing an exit", async () => {
    const { h } = await atCheck();
    const sr = (await readStepRun(h.ctx, "lt-1")) as StepRunRecord;
    await h.files.write(checkExitPath(h.ctx, "lt-1", sr.run_id, sr.attempt), "{");
    await tickUntil(h, has("check.finished"));
    expect(await readStepRun(h.ctx, "lt-1")).toMatchObject({ outcome: "fail", output: expect.stringContaining("exit file is unreadable") });
  });

  test("a spawn that cannot start records the error, and decide reruns the check under its run", async () => {
    const procs = new FakeProcesses();
    procs.failSpawn = true;
    const h = harness({ processes: procs });
    h.items.push(trackerItem(1));
    await tickUntil(h, has("check.run"));
    expect(await readStepRun(h.ctx, "lt-1")).toMatchObject({ error: expect.stringContaining("could not start") });
    procs.failSpawn = false;
    const reports = await tickUntil(h, has("check.rerun"));
    expect(reports.flatMap(rulesOf)).toContain("lt-1 check.rerun");
    expect(procs.spawned).toHaveLength(1);
  });

  test("a stopped run reaches its running check", async () => {
    const { h, procs } = await atCheck();
    const { t, index } = await decisionOf(h, "check.running");
    const run_id = (await readStepRun(h.ctx, "lt-1"))?.run_id as string;
    const stop: DecisionOf<"stop_run"> = { kind: "stop_run", unit: "lt-1", rule: "story.ended.stop", run_id, reason: "the story ended" } as DecisionOf<"stop_run">;
    expect(await act(t, stop, index)).toMatchObject({ ok: true, detail: { stopped: true } });
    expect(procs.killed).toEqual([100]);
  });
});
