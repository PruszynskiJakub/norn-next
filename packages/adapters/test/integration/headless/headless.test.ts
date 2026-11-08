import { describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AdapterContext } from "@norn/core";
import { machineDir } from "@norn/store";
import { createHeadlessRunner, headlessFactory, logPath } from "../../../src/headless/index.ts";

describe("headless runner (real processes)", () => {
  test("spawns detached with env + log, tracks liveness by pid + start time, kills", async () => {
    const dir = mkdtempSync(join(tmpdir(), "norn-headless-"));
    const runner = createHeadlessRunner({ logDir: join(dir, "trace"), killGraceMs: 2000 });
    const session = await runner.launch({
      cwd: dir,
      argv: ["sh", "-c", 'echo "run=$NORN_RUN story=$NORN_STORY"; exec sleep 30'],
      env: { NORN_HOME: dir, NORN_STORY: "gh-1", NORN_SLICE: "01-x", NORN_RUN: "01JRUN" },
      title: "gh-1/01 implement",
      run_id: "01JRUN",
    });
    expect(session.runner).toBe("headless");
    expect(session.process?.pid).toBeGreaterThan(0);
    expect(session.process?.pid_start).toBeTruthy();
    expect(await runner.isAlive(session)).toBe(true);
    expect(await runner.paneState(session)).toEqual({ alive: true, state: "unknown" });

    // same pid, different start time → not ours
    expect(await runner.isAlive({ ...session, process: { pid: session.process!.pid, pid_start: "Thu Jan 1 00:00:00 1970" } })).toBe(false);

    await Bun.sleep(200);
    expect(readFileSync(logPath(join(dir, "trace"), "01JRUN"), "utf8")).toContain("run=01JRUN story=gh-1");

    await runner.kill(session);
    expect(await runner.isAlive(session)).toBe(false);
    await runner.kill(session); // idempotent
  });

  test("launch of a missing binary fails with launch_failed", async () => {
    const runner = createHeadlessRunner({ logDir: mkdtempSync(join(tmpdir(), "norn-headless-")) });
    const err = await runner
      .launch({ cwd: tmpdir(), argv: ["/nonexistent/agent-bin"], env: {}, title: "t", run_id: "01JX" })
      .catch((e) => e);
    expect(err).toMatchObject({ code: "launch_failed" });
  });

  test("without log_dir, a session's log is written at <machine dir>/sessions/<run_id>.log and nothing under runs/ (D1)", async () => {
    const root = mkdtempSync(join(tmpdir(), "norn-headless-"));
    const runner = headlessFactory({ repoRoot: root } as AdapterContext, { adapter: "headless" });
    const session = await runner.launch({ cwd: root, argv: ["sh", "-c", 'echo "run=$NORN_RUN"; exec sleep 30'], env: { NORN_RUN: "01JSESS" }, title: "t", run_id: "01JSESS" });
    try {
      await Bun.sleep(200);
      expect(readFileSync(join(machineDir(root), "sessions", "01JSESS.log"), "utf8")).toContain("run=01JSESS");
      expect(existsSync(join(machineDir(root), "runs"))).toBe(false);
      expect(await runner.output?.(session)).toContain("run=01JSESS");
    } finally {
      await runner.kill(session);
    }
  });
});
