import { describe, expect, test } from "bun:test";
import { memoryFiles, memoryHost } from "@norn/conformance";
import type { HostProcesses, KillSignal, RunnerStartRequest, SpawnOptions } from "@norn/plugin-api";
import { createHeadlessRunner, keyRecordPath } from "../../src/index.ts";

/** A process table in memory: spawn hands out pids, kill TERM ends a process unless it ignores TERM. */
function fakeProcs(opts: { ignoreTerm?: boolean; spawnThrows?: boolean } = {}) {
  const live = new Map<number, string>();
  const spawns: Array<{ argv: string[]; opts: SpawnOptions }> = [];
  const kills: Array<{ pid: number; signal: KillSignal | undefined }> = [];
  let next = 100;
  const procs: HostProcesses = {
    spawn: async (argv, o) => {
      if (opts.spawnThrows) throw new Error("ENOENT: no such file");
      spawns.push({ argv, opts: o });
      const pid = next++;
      const started = `start-${pid}`;
      live.set(pid, started);
      return { pid, started };
    },
    alive: async (pid, started) => live.has(pid) && (started === undefined || live.get(pid) === started),
    kill: async (pid, signal) => {
      kills.push({ pid, signal });
      if (signal === "KILL" || !opts.ignoreTerm) live.delete(pid);
    },
  };
  return { procs, live, spawns, kills };
}

const req = (over: Partial<RunnerStartRequest> = {}): RunnerStartRequest => ({
  key: "01JRUN",
  argv: ["claude", "-p", "go"],
  env: { NORN_RUN_ID: "01JRUN" },
  cwd: "/wt/gh-1",
  title: "gh-1 implement",
  workspace: "gh-1",
  logPath: "/machine/repo/logs/01JRUN.log",
  ...over,
});

const noSleep = async () => {};

describe("headless start", () => {
  test("spawns detached with the request's cwd, env and log, records the key and returns pid@started", async () => {
    const files = memoryFiles();
    const ctx = memoryHost({ files });
    const f = fakeProcs();
    const r = await createHeadlessRunner(ctx, f.procs, {}).start(req());
    expect(r).toEqual({ ok: true, value: { handle: "100@start-100" } });
    expect(f.spawns).toEqual([{ argv: ["claude", "-p", "go"], opts: { cwd: "/wt/gh-1", env: { NORN_RUN_ID: "01JRUN" }, logPath: "/machine/repo/logs/01JRUN.log" } }]);
    expect(keyRecordPath(ctx, "01JRUN")).toBe("/machine/repo/runners/headless/01JRUN.json");
    expect(JSON.parse(files.snapshot()["/machine/repo/runners/headless/01JRUN.json"] as string)).toEqual({ key: "01JRUN", handle: "100@start-100" });
  });

  test("a replay under the same key hands back the first handle and starts nothing, even once that process died", async () => {
    const ctx = memoryHost();
    const f = fakeProcs();
    const runner = createHeadlessRunner(ctx, f.procs, {});
    const first = await runner.start(req());
    f.live.clear();
    expect(await runner.start(req({ argv: ["other"] }))).toEqual(first);
    expect(f.spawns.length).toBe(1);
  });

  test("another key starts another process", async () => {
    const f = fakeProcs();
    const runner = createHeadlessRunner(memoryHost(), f.procs, {});
    await runner.start(req());
    expect(await runner.start(req({ key: "01JOTHER" }))).toEqual({ ok: true, value: { handle: "101@start-101" } });
  });

  test("losing the race for the key record ends our process and hands back the winner's", async () => {
    const files = memoryFiles();
    const f = fakeProcs();
    // the winner's record lands between our read and our create
    const racing = { ...files, create: async (p: string, d: string) => (await files.write(p, JSON.stringify({ key: "01JRUN", handle: "7@winner" })), false) };
    const r = await createHeadlessRunner(memoryHost({ files: racing }), f.procs, {}, { sleep: noSleep }).start(req());
    expect(r).toEqual({ ok: true, value: { handle: "7@winner" } });
    expect(f.kills).toEqual([
      { pid: 100, signal: "TERM" },
      { pid: 100, signal: "KILL" },
    ]);
  });

  test("a key record it cannot read is refused, never overwritten", async () => {
    const files = memoryFiles({ "/machine/repo/runners/headless/01JRUN.json": "{not json" });
    const f = fakeProcs();
    const r = await createHeadlessRunner(memoryHost({ files }), f.procs, {}).start(req());
    expect(r.ok).toBe(false);
    expect(!r.ok && r.failure.code).toBe("invalid");
    expect(f.spawns).toEqual([]);
  });

  test("a key that is not a safe file name or an empty argv is refused before anything starts", async () => {
    const f = fakeProcs();
    const runner = createHeadlessRunner(memoryHost(), f.procs, {});
    for (const key of ["../x", ".hidden", "a/b", ""]) expect({ key, code: ((await runner.start(req({ key }))) as { failure?: { code: string } }).failure?.code }).toEqual({ key, code: "invalid" });
    expect(((await runner.start(req({ argv: [] }))) as { failure?: { code: string } }).failure?.code).toBe("invalid");
    expect(f.spawns).toEqual([]);
  });

  test("a binary the host cannot start is an unavailable failure and leaves no record", async () => {
    const files = memoryFiles();
    const r = await createHeadlessRunner(memoryHost({ files }), fakeProcs({ spawnThrows: true }).procs, {}).start(req());
    expect(r).toEqual({ ok: false, failure: { code: "unavailable", message: "headless runner: cannot start claude: ENOENT: no such file", retryable: true } });
    expect(files.snapshot()).toEqual({});
  });

  test("a record that cannot be written ends the process it started", async () => {
    const files = memoryFiles();
    files.failWrites(true);
    const f = fakeProcs();
    const r = await createHeadlessRunner(memoryHost({ files }), f.procs, {}, { sleep: noSleep }).start(req());
    expect(!r.ok && r.failure.code).toBe("unavailable");
    expect(f.live.size).toBe(0);
  });
});

describe("headless alive and stop", () => {
  test("alive compares the start marker, so a reused pid reads as dead", async () => {
    const f = fakeProcs();
    const runner = createHeadlessRunner(memoryHost(), f.procs, {});
    const started = await runner.start(req());
    if (!started.ok) throw new Error(started.failure.message);
    expect(await runner.alive(started.value.handle)).toEqual({ ok: true, value: true });
    f.live.set(100, "someone-else");
    expect(await runner.alive(started.value.handle)).toEqual({ ok: true, value: false });
    expect(((await runner.alive("garbage")) as { failure?: { code: string } }).failure?.code).toBe("invalid");
  });

  test("stop sends TERM to the group, and KILL to what is left of it as soon as the leader ends", async () => {
    const f = fakeProcs();
    const slept: number[] = [];
    const runner = createHeadlessRunner(memoryHost(), f.procs, { kill_grace_ms: 300 }, { sleep: async (ms) => void slept.push(ms) });
    const started = await runner.start(req());
    if (!started.ok) throw new Error(started.failure.message);
    expect(await runner.stop(started.value.handle)).toEqual({ ok: true, value: undefined });
    // a child that ignored TERM outlives its leader: the group still gets KILL, without waiting out the grace
    expect(f.kills).toEqual([
      { pid: 100, signal: "TERM" },
      { pid: 100, signal: "KILL" },
    ]);
    expect(slept).toEqual([100]);
  });

  test("a process that outlives TERM by the grace gets KILL", async () => {
    const f = fakeProcs({ ignoreTerm: true });
    const slept: number[] = [];
    const runner = createHeadlessRunner(memoryHost(), f.procs, { kill_grace_ms: 300 }, { sleep: async (ms) => void slept.push(ms) });
    const started = await runner.start(req());
    if (!started.ok) throw new Error(started.failure.message);
    expect(await runner.stop(started.value.handle)).toEqual({ ok: true, value: undefined });
    expect(f.kills).toEqual([
      { pid: 100, signal: "TERM" },
      { pid: 100, signal: "KILL" },
    ]);
    expect(slept).toEqual([100, 100, 100]);
  });

  test("a leader that already exited still has its group killed, so a child it left running cannot write after the stop", async () => {
    const f = fakeProcs();
    const runner = createHeadlessRunner(memoryHost(), f.procs, {}, { sleep: noSleep });
    const started = await runner.start(req());
    if (!started.ok) throw new Error(started.failure.message);
    f.live.delete(100);
    expect(await runner.stop(started.value.handle)).toEqual({ ok: true, value: undefined });
    expect(f.kills).toEqual([{ pid: 100, signal: "KILL" }]);
  });

  test("a pid now someone else's signals nothing", async () => {
    const f = fakeProcs();
    const runner = createHeadlessRunner(memoryHost(), f.procs, {}, { sleep: noSleep });
    f.live.set(556, "a-stranger");
    expect(await runner.stop("556@start-556")).toEqual({ ok: true, value: undefined });
    expect(f.kills).toEqual([]);
  });
});
