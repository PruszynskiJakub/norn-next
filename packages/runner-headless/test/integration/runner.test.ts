import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createNodeHost } from "@norn/host-node";
import { createRunner, type Runner, type RunnerStartRequest } from "@norn/plugin-api";
import { decodeHandle, headlessRunnerFactory } from "../../src/index.ts";

let root: string;
let runner: Runner;
const handles: string[] = [];

async function until(cond: () => Promise<boolean> | boolean, ms = 5_000): Promise<boolean> {
  const end = performance.now() + ms;
  while (performance.now() < end) {
    if (await cond()) return true;
    await Bun.sleep(25);
  }
  return cond();
}

function pidRuns(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

const req = (over: Partial<RunnerStartRequest>): RunnerStartRequest => ({
  key: "01JRUNHEADLESS",
  argv: ["sh", "-c", "sleep 30"],
  env: {},
  cwd: root,
  title: "test run",
  logPath: join(root, "logs", "run.log"),
  ...over,
});

async function start(r: RunnerStartRequest): Promise<string> {
  const got = await runner.start(r);
  if (!got.ok) throw new Error(got.failure.message);
  handles.push(got.value.handle);
  return got.value.handle;
}

beforeEach(() => {
  root = realpathSync(mkdtempSync(join(tmpdir(), "norn-runner-headless-")));
  const made = createRunner(headlessRunnerFactory, createNodeHost({ root, dataDir: join(root, "machine") }), { kill_grace_ms: 1_000 });
  if (!made.ok) throw new Error(made.failure.message);
  runner = made.value;
});
afterEach(async () => {
  for (const h of handles.splice(0)) await runner.stop(h);
  rmSync(root, { recursive: true, force: true });
});

describe("headless runner on the node host", () => {
  test("runs a short process detached with the env in cwd, writes its log, and reads it dead once it exits", async () => {
    const logPath = join(root, "logs", "short.log");
    const handle = await start(req({ argv: ["sh", "-c", 'pwd; echo "$NORN_RUN_ID"; sleep 0.3'], env: { NORN_RUN_ID: "01JRUNHEADLESS" }, logPath }));
    expect(await runner.alive(handle)).toEqual({ ok: true, value: true });
    const dead = async () => {
      const a = await runner.alive(handle);
      return a.ok && !a.value;
    };
    expect(await until(dead)).toBe(true);
    expect(readFileSync(logPath, "utf8")).toBe(`${root}\n01JRUNHEADLESS\n`);
    expect(existsSync(join(root, "machine", "runners", "headless", "01JRUNHEADLESS.json"))).toBe(true);
  });

  test("a start replayed under the same key finds the live process instead of starting another", async () => {
    const handle = await start(req({}));
    expect(await runner.start(req({}))).toEqual({ ok: true, value: { handle } });
  });

  test("stop ends the whole process group, grandchildren too", async () => {
    const pidFile = join(root, "grandchild.pid");
    const handle = await start(req({ argv: ["sh", "-c", `sleep 30 & echo $! > ${pidFile}; wait`] }));
    expect(await until(() => existsSync(pidFile) && readFileSync(pidFile, "utf8").trim() !== "")).toBe(true);
    const grandchild = Number(readFileSync(pidFile, "utf8").trim());
    expect(pidRuns(grandchild)).toBe(true);
    expect(await runner.stop(handle)).toEqual({ ok: true, value: undefined });
    expect(await runner.alive(handle)).toEqual({ ok: true, value: false });
    expect(await until(() => !pidRuns(grandchild))).toBe(true);
    expect(await runner.stop(handle)).toEqual({ ok: true, value: undefined });
  });

  test("stop ends a child that ignores TERM even once the leader has exited", async () => {
    const pidFile = join(root, "stubborn.pid");
    const handle = await start(req({ argv: ["sh", "-c", `(trap "" TERM; exec sleep 30) & echo $! > ${pidFile}; wait`] }));
    expect(await until(() => existsSync(pidFile) && readFileSync(pidFile, "utf8").trim() !== "")).toBe(true);
    const stubborn = Number(readFileSync(pidFile, "utf8").trim());
    expect(await runner.stop(handle)).toEqual({ ok: true, value: undefined });
    expect(await until(() => !pidRuns(stubborn))).toBe(true);
  });

  test("stop after the leader has exited still ends the child it left, before that child writes", async () => {
    const late = join(root, "late.txt");
    const pidFile = join(root, "left.pid");
    const handle = await start(req({ argv: ["sh", "-c", `(sleep 1; echo x > ${late}) & echo $! > ${pidFile}`] }));
    const dead = async () => {
      const a = await runner.alive(handle);
      return a.ok && !a.value;
    };
    expect(await until(dead)).toBe(true);
    expect(await until(() => existsSync(pidFile) && readFileSync(pidFile, "utf8").trim() !== "")).toBe(true);
    const left = Number(readFileSync(pidFile, "utf8").trim());
    expect(pidRuns(left)).toBe(true);
    expect(await runner.stop(handle)).toEqual({ ok: true, value: undefined });
    expect(await until(() => !pidRuns(left))).toBe(true);
    await Bun.sleep(1_200);
    expect(existsSync(late)).toBe(false);
  });

  test("a handle whose pid now belongs to another start reads as dead", async () => {
    const handle = await start(req({}));
    const h = decodeHandle(handle);
    if (!h) throw new Error("not a handle");
    expect(await runner.alive(`${h.pid}@not-the-start`)).toEqual({ ok: true, value: false });
  });
});
