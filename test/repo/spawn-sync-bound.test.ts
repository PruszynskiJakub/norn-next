/**
 * gh-215: the spawning tiers' `Bun.spawnSync` bound, against a recording stand-in for the real call (no child
 * starts). The fixture tests in packages/cli/test/integration/harness-git-timeout.test.ts prove it under bun test.
 */
import { expect, test } from "bun:test";
import { boundSpawnSync } from "../support/spawn-sync-bound.ts";

const recorder = () => {
  const calls: unknown[][] = [];
  return { calls, real: (...args: unknown[]) => (calls.push(args), "result") };
};

test("a call that sets no timeout gets the bound and a SIGKILL, in both call shapes", () => {
  const { calls, real } = recorder();
  const bound = boundSpawnSync(real, () => 1234);
  expect(bound(["git", "status"])).toBe("result");
  bound(["git", "status"], { cwd: "/r" });
  bound({ cmd: ["git", "status"], cwd: "/r" });
  expect(calls).toEqual([
    [["git", "status"], { timeout: 1234, killSignal: "SIGKILL" }],
    [["git", "status"], { cwd: "/r", timeout: 1234, killSignal: "SIGKILL" }],
    [{ cmd: ["git", "status"], cwd: "/r", timeout: 1234, killSignal: "SIGKILL" }],
  ]);
});

test("a call that sets its own timeout keeps it", () => {
  const { calls, real } = recorder();
  const bound = boundSpawnSync(real, () => 1234);
  bound(["git", "fetch"], { timeout: 120_000 });
  bound({ cmd: ["git", "fetch"], timeout: 5 });
  expect(calls).toEqual([[["git", "fetch"], { timeout: 120_000 }], [{ cmd: ["git", "fetch"], timeout: 5 }]]);
});
