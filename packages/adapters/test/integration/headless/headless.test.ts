import { describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHeadlessRunner, logPath } from "../../../src/headless/index.ts";

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
    expect(await runner.paneState(session)).toEqual({ alive: true, state: "unknown", since: null });

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
});
