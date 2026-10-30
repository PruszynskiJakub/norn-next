import { describe, expect, test } from "bun:test";
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AdapterContext } from "@norn/core";
import { runnerLogDir, traceDir } from "@norn/store";
import { createHeadlessRunner, headlessFactory, logPath } from "../../src/headless/index.ts";

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

  test("send is a typed unsupported error (caller resumes or starts fresh, B2)", async () => {
    const runner = createHeadlessRunner({ logDir: tmpdir() });
    const err = await runner.send({ runner: "headless", session_id: "x" }, "hi").catch((e) => e);
    expect(err).toMatchObject({ code: "unsupported", retryable: false });
  });

  test("capabilities: no send, resume (R4.1); findSessions by the run's NORN_RUN env (R5.1)", async () => {
    const proc = {
      identify: async () => null,
      isAlive: async () => true,
      self: () => ({ pid: 1, pid_start: "x" }),
      findByEnv: async (name: string, value: string) => (name === "NORN_RUN" && value === "01JRUN" ? [{ pid: 77, pid_start: "Fri Oct 23 10:00:00 2026" }] : []),
    };
    const runner = createHeadlessRunner({ logDir: tmpdir(), process: proc });
    expect(runner.capabilities).toEqual({ send: false, resume: true });
    expect(await runner.findSessions?.({ run_id: "01JRUN", cwd: "/w" })).toEqual([{ session: { runner: "headless", session_id: "01JRUN", process: { pid: 77, pid_start: "Fri Oct 23 10:00:00 2026" } } }]);
    expect(await runner.findSessions?.({ run_id: "01JOTHER", cwd: "/w" })).toEqual([]);
  });

  test("output: the head of the run's log; null without one (B3)", async () => {
    // recorded: `claude -p --allowedTools Read "<prompt>"` — the variadic flag took the prompt
    const dir = mkdtempSync(join(tmpdir(), "norn-headless-"));
    const logDir = join(dir, "trace");
    mkdirSync(logDir, { recursive: true });
    copyFileSync(join(import.meta.dir, "fixtures", "claude-prompt-swallowed.log"), logPath(logDir, "01JRUN"));
    const runner = createHeadlessRunner({ logDir });
    expect(await runner.output?.({ runner: "headless", session_id: "01JRUN" })).toBe(
      "Error: Input must be provided either through stdin or as a prompt argument when using --print",
    );
    expect(await runner.output?.({ runner: "headless", session_id: "01JNONE" })).toBeNull();
  });

  test("without log_dir, logs go to store's runner log dir for the checkout: the trace dir's runs/, as before", async () => {
    const root = mkdtempSync(join(tmpdir(), "norn-headless-"));
    expect(runnerLogDir(root)).toBe(join(traceDir(root), "runs"));
    mkdirSync(runnerLogDir(root), { recursive: true });
    copyFileSync(join(import.meta.dir, "fixtures", "claude-prompt-swallowed.log"), logPath(runnerLogDir(root), "01JRUN"));
    const runner = headlessFactory({ repoRoot: root } as AdapterContext, { adapter: "headless" });
    expect(await runner.output?.({ runner: "headless", session_id: "01JRUN" })).toContain("Input must be provided");
  });

  test("launch of a missing binary fails with launch_failed", async () => {
    const runner = createHeadlessRunner({ logDir: mkdtempSync(join(tmpdir(), "norn-headless-")) });
    const err = await runner
      .launch({ cwd: tmpdir(), argv: ["/nonexistent/agent-bin"], env: {}, title: "t", run_id: "01JX" })
      .catch((e) => e);
    expect(err).toMatchObject({ code: "launch_failed" });
  });
});
