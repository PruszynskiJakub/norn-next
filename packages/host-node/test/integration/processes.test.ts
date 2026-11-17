import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { hostProcesses } from "@norn/plugin-api";
import { createNodeHost, readStartProbe } from "../../src/index.ts";

let root: string;
const spawned: number[] = [];

function procs() {
  const got = hostProcesses(createNodeHost({ root, dataDir: join(root, "machine") }));
  if (!got.ok) throw new Error(`node host lacks ${got.missing.join(", ")}`);
  return got.value;
}

async function until(cond: () => Promise<boolean> | boolean, ms = 5_000): Promise<boolean> {
  const end = performance.now() + ms;
  while (performance.now() < end) {
    if (await cond()) return true;
    await Bun.sleep(25);
  }
  return cond();
}

beforeEach(() => {
  root = realpathSync(mkdtempSync(join(tmpdir(), "norn-host-procs-")));
});
afterEach(async () => {
  for (const pid of spawned.splice(0)) await procs().kill(pid, "KILL").catch(() => {});
  rmSync(root, { recursive: true, force: true });
});

describe("spawn", () => {
  test("starts detached in cwd with the env merged, appends output to the log, and returns at once", async () => {
    const log = join(root, "logs", "run.log");
    const t0 = performance.now();
    const p = await procs().spawn(["sh", "-c", 'pwd; echo "$NORN_SPAWN_TEST"; echo err >&2; sleep 0.2; echo late'], {
      cwd: root,
      env: { NORN_SPAWN_TEST: "v" },
      logPath: log,
    });
    spawned.push(p.pid);
    expect(performance.now() - t0).toBeLessThan(2_000);
    expect(p.pid).toBeGreaterThan(0);
    expect(p.started).not.toBe("");
    expect(await until(() => existsSync(log) && readFileSync(log, "utf8").includes("late"))).toBe(true);
    expect(readFileSync(log, "utf8")).toBe(`${root}\nv\nerr\nlate\n`);
  });

  test("a second spawn to the same log appends rather than truncating", async () => {
    const log = join(root, "run.log");
    const a = await procs().spawn(["sh", "-c", "echo one"], { cwd: root, logPath: log });
    await until(async () => !(await procs().alive(a.pid, a.started)));
    const b = await procs().spawn(["sh", "-c", "echo two"], { cwd: root, logPath: log });
    expect(await until(() => readFileSync(log, "utf8") === "one\ntwo\n")).toBe(true);
    expect(await until(async () => !(await procs().alive(b.pid, b.started)))).toBe(true);
  });

  test("a missing executable rejects", async () => {
    await expect(procs().spawn(["norn-no-such-binary-xyz"], { cwd: root, logPath: join(root, "x.log") })).rejects.toThrow();
  });
});

describe("alive and kill", () => {
  test("alive while it runs; dead once it exits", async () => {
    const p = await procs().spawn(["sh", "-c", "sleep 0.3"], { cwd: root, logPath: join(root, "a.log") });
    spawned.push(p.pid);
    expect(await procs().alive(p.pid, p.started)).toBe(true);
    expect(await procs().alive(p.pid)).toBe(true);
    expect(await until(async () => !(await procs().alive(p.pid, p.started)))).toBe(true);
  });

  test("a live pid with another start marker is not ours", async () => {
    const p = await procs().spawn(["sleep", "30"], { cwd: root, logPath: join(root, "b.log") });
    spawned.push(p.pid);
    expect(await procs().alive(p.pid, "Thu Jan  1 00:00:00 1970")).toBe(false);
  });

  test("kill ends the whole process group, grandchildren included", async () => {
    const pidFile = join(root, "grandchild.pid");
    const p = await procs().spawn(["sh", "-c", `sleep 30 & echo $! > ${pidFile}; wait`], { cwd: root, logPath: join(root, "c.log") });
    spawned.push(p.pid);
    expect(await until(() => existsSync(pidFile) && readFileSync(pidFile, "utf8").trim() !== "")).toBe(true);
    const grandchild = Number(readFileSync(pidFile, "utf8").trim());
    expect(await procs().alive(grandchild)).toBe(true);
    await procs().kill(p.pid);
    expect(await until(async () => !(await procs().alive(p.pid, p.started)))).toBe(true);
    expect(await until(async () => !(await procs().alive(grandchild)))).toBe(true);
  });

  test("KILL reaches a group member that ignored TERM after its leader has exited", async () => {
    const pidFile = join(root, "stubborn.pid");
    // the subshell ignores TERM and exec keeps that for sleep; the leader sh dies of the TERM
    const p = await procs().spawn(["sh", "-c", `(trap "" TERM; exec sleep 30) & echo $! > ${pidFile}; wait`], { cwd: root, logPath: join(root, "e.log") });
    spawned.push(p.pid);
    expect(await until(() => existsSync(pidFile) && readFileSync(pidFile, "utf8").trim() !== "")).toBe(true);
    const stubborn = Number(readFileSync(pidFile, "utf8").trim());
    await procs().kill(p.pid, "TERM");
    expect(await until(async () => !(await procs().alive(p.pid, p.started)))).toBe(true);
    expect(await procs().alive(stubborn)).toBe(true);
    await procs().kill(p.pid, "KILL");
    expect(await until(async () => !(await procs().alive(stubborn)))).toBe(true);
  });

  test("killing a process already gone, or a pid that is no pid, is not an error", async () => {
    const p = await procs().spawn(["true"], { cwd: root, logPath: join(root, "d.log") });
    await until(async () => !(await procs().alive(p.pid, p.started)));
    await procs().kill(p.pid);
    await procs().kill(p.pid, "KILL");
    await procs().kill(0);
    expect(await procs().alive(0)).toBe(false);
  });
});

describe("readStartProbe", () => {
  test("reads a start time, a zombie as gone, no such pid as gone, and anything else as unknown", () => {
    expect(readStartProbe("Ss   Tue Nov 17 10:00:00 2026\n", 0)).toEqual({ kind: "alive", start: "Tue Nov 17 10:00:00 2026" });
    expect(readStartProbe("Z+   Tue Nov 17 10:00:00 2026\n", 0)).toEqual({ kind: "gone" });
    expect(readStartProbe("", 1)).toEqual({ kind: "gone" });
    expect(readStartProbe("", 127)).toEqual({ kind: "unknown" });
  });
});
