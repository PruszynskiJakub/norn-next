/**
 * Unit guard self-test (B4, seam S2). The guard is not in the root bunfig yet (slice 07), so this file
 * installs it by hand around each test and takes it off again.
 */
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { spawn as nodeSpawn } from "node:child_process";
import { installUnitGuard, type UnitGuard } from "../support/unit-guard.ts";

const FILE = "test/repo/unit-guard.test.ts";
const MESSAGE = `unit test in ${FILE} started \`git rev-parse HEAD\`; a test that spawns belongs in test/integration/`;

let guard: UnitGuard;
beforeEach(() => {
  guard = installUnitGuard();
});
afterEach(() => {
  guard.uninstall();
});

/** Calls `start`, expects the guard's error, and clears the violation so this test passes. */
function expectBlocked(start: () => unknown): string {
  let thrown: unknown;
  try {
    start();
  } catch (e) {
    thrown = e;
  }
  expect(thrown).toBeInstanceOf(Error);
  const message = (thrown as Error).message;
  expect(() => guard.check()).toThrow(message);
  return message;
}

describe("unit guard (B4)", () => {
  test("Bun.spawn throws at once, naming the argv, the test file and test/integration/ (AC1)", () => {
    expect(expectBlocked(() => Bun.spawn(["git", "rev-parse", "HEAD"]))).toBe(MESSAGE);
  });

  test("Bun.spawn with an options object is blocked the same way (AC1)", () => {
    expect(expectBlocked(() => Bun.spawn({ cmd: ["git", "rev-parse", "HEAD"] }))).toBe(MESSAGE);
  });

  test("Bun.spawnSync throws at once (AC1)", () => {
    expect(expectBlocked(() => Bun.spawnSync(["git", "rev-parse", "HEAD"]))).toBe(MESSAGE);
  });

  test("node's child_process.spawn throws at once (AC1)", () => {
    expect(expectBlocked(() => nodeSpawn("git", ["rev-parse", "HEAD"]))).toBe(MESSAGE);
  });

  test("a swallowed error still fails the test at the guard's check (AC2)", () => {
    try {
      Bun.spawn(["git", "rev-parse", "HEAD"]);
    } catch {
      // code under test that catches everything
    }
    expect(() => guard.check()).toThrow(MESSAGE);
    // the check reports a violation once
    expect(() => guard.check()).not.toThrow();
  });

  test("the message never carries the spawn's environment or options (AC3)", () => {
    const secret = "sk-live-0123456789abcdef";
    const message = expectBlocked(() =>
      Bun.spawn(["git", "rev-parse", "HEAD"], { env: { NORN_API_TOKEN: secret }, cwd: "/tmp/secret-dir" }),
    );
    expect(message).toBe(MESSAGE);
    expect(message).not.toContain(secret);
    expect(message).not.toContain("NORN_API_TOKEN");
    expect(message).not.toContain("secret-dir");
  });

  test("a test that spawns nothing passes the check", () => {
    expect(() => guard.check()).not.toThrow();
  });

  test("uninstall puts the real spawn functions back", () => {
    const wrapped = Bun.spawn;
    guard.uninstall();
    expect(Bun.spawn).not.toBe(wrapped);
    guard = installUnitGuard();
  });
});
