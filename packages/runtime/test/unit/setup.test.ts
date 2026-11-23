/**
 * The worktree setup: the command that readies a unit's worktree runs before its first agent or check,
 * again once its inputs change, and a failure parks the unit for a person, the launch never made.
 */
import { describe, expect, test } from "bun:test";
import { fail, type RoleDefinition } from "@norn/plugin-api";
import { checkWrapperArgv, readSetupRecord, SETUP_FAILED_PARK, type SetupRecord, setupDigest, setupExitPath, setupParkText, setupRecordPath, wakePath } from "../../src/index.ts";
import { FakeProcesses, type Harnessed, type HarnessOptions, harness, has, MINUTE, record, type Report, rulesOf, tickUntil, trackerItem } from "./support.ts";

const UNIT = "lt-1";
const WT = "/machine/repo/worktrees/lt-1";
const SETUP = { command: "bun install --frozen-lockfile", inputs: ["bun.lock"], timeoutMs: 15 * MINUTE };

function setupHarness(opts: HarnessOptions = {}) {
  const procs = new FakeProcesses();
  const h = harness({ workflow: "agented", setup: SETUP, processes: procs, ...opts });
  return { h, procs };
}

/** The repo's lockfile in the unit's worktree, and the story taken in. */
async function begin(h: Harnessed): Promise<void> {
  await h.files.write(`${WT}/bun.lock`, "lock-1\n");
  h.items.push(trackerItem(1));
}

async function setupRecord(h: Harnessed): Promise<SetupRecord> {
  const r = await readSetupRecord(h.ctx, UNIT);
  if (!r) throw new Error("no setup record");
  return r;
}

/** What the setup's wrapper leaves once its command exits. */
async function setupExits(h: Harnessed, code: number, output = ""): Promise<void> {
  const r = await setupRecord(h);
  if (output) await h.files.write(r.log, output);
  await h.files.write(setupExitPath(h.ctx, UNIT, r.id), `${JSON.stringify({ exit: code, finished_at: h.ctx.now() })}\n`);
}

const kinds = async (h: Harnessed) => (await record(h, UNIT)).receipts.map((r) => r.data.kind);
const detailOf = (r: Report, rule: string) => {
  const o = r.outcomes.find((x) => x.decision.rule === rule);
  return o?.ok ? o.detail : undefined;
};
const launches = (h: Harnessed) => h.launcher.of("start").length;

/** Record what `norn done` records for the unit's current run. */
async function reportDone(h: Harnessed): Promise<void> {
  const state = (await record(h, UNIT)).state;
  const run = state?.run;
  if (!state || !run) throw new Error("no run on the record");
  const wrote = await h.env.journal.record(UNIT, { id: `report-${run.id}`, data: { kind: "run.reported", run_id: run.id, verb: "done", outcome: "done", step: state.step, attempt: state.attempt } });
  if (!wrote.ok) throw new Error(wrote.failure.message);
}

/** A person's rerun of the step the unit is at. */
async function rerun(h: Harnessed): Promise<void> {
  const state = (await record(h, UNIT)).state;
  if (!state) throw new Error("no run state");
  const wrote = await h.env.journal.record(UNIT, { id: `move-${state.step}-${state.attempt}`, data: { kind: "step.moved", to: state.step, by: "a-person", step: state.step, attempt: state.attempt } });
  if (!wrote.ok) throw new Error(wrote.failure.message);
}

/** Up to the first launch: the setup started, exited 0, and the agent launched. */
async function launched(h: Harnessed): Promise<void> {
  await begin(h);
  await tickUntil(h, has("agent.start"));
  await setupExits(h, 0);
  await tickUntil(h, () => launches(h) > 0);
}

describe("the worktree setup", () => {
  test("(a) the first launch starts the setup detached in the worktree and waits, writing no intent; once it exits 0 the agent launches, the digest taken after it", async () => {
    const { h, procs } = setupHarness();
    await begin(h);
    const first = await tickUntil(h, has("agent.start"));
    expect(detailOf(first.at(-1) as Report, "agent.start")).toEqual({ performed: false, waiting: "setup" });
    const r = await setupRecord(h);
    expect(r).toMatchObject({ unit: UNIT, state: "running", command: SETUP.command, inputs: ["bun.lock"], worktree: WT, handle: "100@start-100", timeout_ms: 15 * MINUTE });
    expect(procs.spawned).toEqual([{ pid: 100, argv: checkWrapperArgv(SETUP.command, setupExitPath(h.ctx, UNIT, r.id), wakePath(h.ctx)), cwd: WT, logPath: r.log }]);
    expect(await kinds(h)).not.toContain("run.started");
    expect(launches(h)).toBe(0);

    // while it runs, every launch waits on it and nothing starts twice
    const waiting = await h.runtime.tick();
    h.clock.advance(MINUTE);
    expect(detailOf(waiting, "agent.start")).toEqual({ performed: false, waiting: "setup" });
    expect(procs.spawned).toHaveLength(1);

    // the install rewrote its own lockfile: the digest it records is the one after it, so it is not run again
    await h.files.write(`${WT}/bun.lock`, "lock-2\n");
    await setupExits(h, 0);
    await tickUntil(h, () => launches(h) > 0);
    expect(await setupRecord(h)).toMatchObject({ state: "done", exit: 0, digest: await setupDigest(h.ctx, SETUP, WT) });
    expect(await kinds(h)).toContain("run.started");
    expect(procs.spawned).toHaveLength(1);
  });

  test("(b) a later launch with its inputs unchanged runs no setup", async () => {
    const { h, procs } = setupHarness({ workflow: "handed" });
    await launched(h);
    await tickUntil(h, has("receipts.apply"));
    await reportDone(h);
    await tickUntil(h, () => launches(h) > 1);
    expect(procs.spawned).toHaveLength(1);
    expect((await record(h, UNIT)).state?.step).toBe("review");
  });

  test("(c) a changed input runs the setup again before the next check, which starts once it is done", async () => {
    const { h, procs } = setupHarness({ workflow: "built" });
    await launched(h);
    await tickUntil(h, has("receipts.apply"));
    await h.files.write(`${WT}/bun.lock`, "lock-2\n");
    await reportDone(h);
    const waited = await tickUntil(h, has("check.run"));
    expect(detailOf(waited.at(-1) as Report, "check.run")).toEqual({ performed: false, waiting: "setup" });
    expect(procs.spawned.map((p) => p.argv[4])).toEqual([SETUP.command, SETUP.command]);
    await setupExits(h, 0);
    await tickUntil(h, () => procs.spawned.length > 2);
    expect(procs.spawned.map((p) => p.argv[4])).toEqual([SETUP.command, SETUP.command, "bun test"]);
  });

  test("(d) a setup that exits non-zero parks the unit with what it said, and the agent is never launched", async () => {
    const { h, procs } = setupHarness();
    await begin(h);
    await tickUntil(h, has("agent.start"));
    await setupExits(h, 1, "resolving\nerror: lockfile had changes, but lockfile is frozen\n");
    await tickUntil(h, async () => (await record(h, UNIT)).state?.parked !== undefined);
    const r = await setupRecord(h);
    expect(r).toMatchObject({ state: "failed", exit: 1, reason: "exited 1" });
    const parked = (await record(h, UNIT)).state?.parked;
    expect(parked).toMatchObject({ reason: SETUP_FAILED_PARK, text: setupParkText(r) });
    expect(parked?.text).toBe(`the worktree setup \`${SETUP.command}\` exited 1 in ${WT} (log: ${r.log}): error: lockfile had changes, but lockfile is frozen; fix setup.command or the files it reads, then rerun the step`);
    // parked, the unit waits for a person: no launch, no second setup
    for (let i = 0; i < 3; i++) {
      await h.runtime.tick();
      h.clock.advance(MINUTE);
    }
    expect(launches(h)).toBe(0);
    expect(procs.spawned).toHaveLength(1);
    expect((await kinds(h)).filter((k) => k === "unit.parked")).toHaveLength(1);
  });

  test("(e) after a person's rerun the setup runs again, its inputs unchanged", async () => {
    const { h, procs } = setupHarness();
    await begin(h);
    await tickUntil(h, has("agent.start"));
    await setupExits(h, 1, "boom\n");
    await tickUntil(h, async () => (await record(h, UNIT)).state?.parked !== undefined);
    await rerun(h);
    await tickUntil(h, () => procs.spawned.length > 1);
    expect(await setupRecord(h)).toMatchObject({ state: "running" });
    await setupExits(h, 0);
    await tickUntil(h, () => launches(h) > 0);
    expect((await record(h, UNIT)).state?.parked).toBeUndefined();
  });

  test("(f) a setup past its timeout is stopped and parks the unit saying it timed out", async () => {
    const { h, procs } = setupHarness();
    await begin(h);
    await tickUntil(h, has("agent.start"));
    h.clock.advance(16 * MINUTE);
    await tickUntil(h, async () => (await record(h, UNIT)).state?.parked !== undefined);
    expect(procs.killed).toEqual([100]);
    expect((await record(h, UNIT)).state?.parked?.text).toContain(`\`${SETUP.command}\` timed out after 15m in ${WT}`);
    expect(launches(h)).toBe(0);
  });

  test("(g) a worktree made again is set up again, though nothing the digest covers changed", async () => {
    const { h, procs } = setupHarness({ workflow: "handed", setup: { ...SETUP, inputs: [] } });
    await launched(h);
    await tickUntil(h, has("receipts.apply"));
    // the person removed the worktree: the next ensure makes it new
    for (const path of Object.keys(h.files.snapshot()).filter((p) => p.startsWith(`${WT}/`))) await h.files.remove(path);
    await reportDone(h);
    await tickUntil(h, () => procs.spawned.length > 1);
    expect(await setupRecord(h)).toMatchObject({ state: "running" });
    expect(launches(h)).toBe(1);
  });

  test("(h) a host that cannot detach runs the setup inside the tick, and launches in the same tick once it passes", async () => {
    const h = harness({ workflow: "agented", setup: SETUP });
    await begin(h);
    await tickUntil(h, () => launches(h) > 0);
    expect(h.exec.calls.filter((c) => c.argv[0] === "sh")).toEqual([{ argv: ["sh", "-c", SETUP.command], opts: { cwd: WT, timeoutMs: SETUP.timeoutMs } }]);
    expect(await setupRecord(h)).toMatchObject({ state: "done", exit: 0, output: "ok" });
  });

  test("(h) inside the tick, a setup that fails parks the unit in the same act", async () => {
    const h = harness({ workflow: "agented", setup: SETUP, exec: (argv) => (argv[0] === "sh" ? { code: 2, stderr: "no lockfile" } : undefined) });
    await begin(h);
    const reports = await tickUntil(h, has("agent.start"));
    expect(detailOf(reports.at(-1) as Report, "agent.start")).toEqual({ performed: false, waiting: "parked" });
    await tickUntil(h, has("receipts.apply"));
    expect((await record(h, UNIT)).state?.parked).toMatchObject({ reason: SETUP_FAILED_PARK, text: expect.stringContaining("exited 2") });
    expect(launches(h)).toBe(0);
  });

  test("(h) inside the tick, a setup that rewrites one of its inputs and then fails never counts as ready: it runs again for the new digest and parks", async () => {
    let h: Harnessed | undefined;
    h = harness({
      workflow: "agented",
      setup: SETUP,
      exec: (argv) => {
        if (argv[0] !== "sh") return undefined;
        void h?.files.write(`${WT}/bun.lock`, "lock-rewritten\n");
        return { code: 1, stderr: "postinstall failed" };
      },
    });
    await begin(h);
    const first = await tickUntil(h, has("agent.start"));
    expect(detailOf(first.at(-1) as Report, "agent.start")).toEqual({ performed: false, waiting: "setup" });
    expect(launches(h)).toBe(0);
    const second = await tickUntil(h, has("agent.start"));
    expect(detailOf(second.at(-1) as Report, "agent.start")).toEqual({ performed: false, waiting: "parked" });
    await tickUntil(h, has("receipts.apply"));
    expect((await record(h, UNIT)).state?.parked).toMatchObject({ reason: SETUP_FAILED_PARK, text: expect.stringContaining("exited 1") });
    expect(h.exec.calls.filter((c) => c.argv[0] === "sh")).toHaveLength(2);
    expect(launches(h)).toBe(0);
  });

  test("(i) with no setup configured a launch runs nothing first and keeps no record", async () => {
    const procs = new FakeProcesses();
    const h = harness({ workflow: "agented", processes: procs });
    await begin(h);
    await tickUntil(h, () => launches(h) > 0);
    expect(procs.spawned).toEqual([]);
    expect(h.exec.calls).toEqual([]);
    expect(await h.files.read(setupRecordPath(h.ctx, UNIT))).toBeNull();
  });

  test("(j) a park that could not be written is written once, on the next act", async () => {
    const { h } = setupHarness();
    await begin(h);
    await tickUntil(h, has("agent.start"));
    await setupExits(h, 1, "boom\n");
    const journal = h.env.journal;
    const real = journal.record.bind(journal);
    let failed = false;
    journal.record = async (unit, intent) => {
      if (!failed && intent.data.kind === "unit.parked") {
        failed = true;
        return fail("unavailable", "the store is down");
      }
      return real(unit, intent);
    };
    const down = await h.runtime.tick();
    h.clock.advance(MINUTE);
    expect(rulesOf(down)).toContain(`${UNIT} agent.start !unavailable: the store is down`);
    expect(await setupRecord(h)).toMatchObject({ state: "failed" });
    await tickUntil(h, async () => (await record(h, UNIT)).state?.parked !== undefined);
    for (let i = 0; i < 2; i++) {
      await h.runtime.tick();
      h.clock.advance(MINUTE);
    }
    expect((await kinds(h)).filter((k) => k === "unit.parked")).toHaveLength(1);
  });

  test("(k) on a launch that may not keep code, the setup runs before the snapshot is taken", async () => {
    const roles: Record<string, RoleDefinition> = { reviewer: { purpose: "Reviews.", allow: ["code:read", "docs:write", "out:findings"] } };
    const { h } = setupHarness({ workflow: "granted", roles });
    await begin(h);
    await tickUntil(h, has("agent.start"));
    expect(h.vcsCalls.filter((c) => c.op === "snapshot")).toEqual([]);
    expect(await kinds(h)).not.toContain("run.snapshot");
    await setupExits(h, 0);
    await tickUntil(h, () => launches(h) > 0);
    expect((await kinds(h)).slice(-3)).toEqual(["run.started", "run.snapshot", "run.started"]);
  });

  test("(l) a setup record that fails validation is removed and the setup runs again; the unit is never corrupt", async () => {
    const { h, procs } = setupHarness();
    await h.files.write(setupRecordPath(h.ctx, UNIT), '{"unit": "lt-1", "state": "done"}\n');
    await begin(h);
    await tickUntil(h, has("agent.start"));
    expect(procs.spawned).toHaveLength(1);
    expect(await setupRecord(h)).toMatchObject({ state: "running" });
    expect((await record(h, UNIT)).corrupt).toBeUndefined();
  });
});
