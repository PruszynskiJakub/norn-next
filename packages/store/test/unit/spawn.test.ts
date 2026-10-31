/** git's network timeout rule (H11); the bounded child processes themselves are in test/integration/spawn.test.ts. */
import { describe, expect, test } from "bun:test";
import { NETWORK_TIMEOUT_MS, gitTimeoutMs } from "../../src/index.ts";

describe("git network timeouts", () => {
  test("only subcommands that reach a remote get a timeout", () => {
    for (const sub of ["fetch", "push", "ls-remote", "pull", "clone"]) expect(gitTimeoutMs([sub, "origin"])).toBe(NETWORK_TIMEOUT_MS);
    expect(gitTimeoutMs(["-c", "core.quotePath=false", "fetch", "origin"])).toBe(NETWORK_TIMEOUT_MS);
    // local commands run hooks (commit) or can be slow on big repos: never killed
    for (const args of [["commit", "-m", "x"], ["rev-parse", "HEAD"], ["--version"], ["-c", "a=b", "log"]]) expect(gitTimeoutMs(args)).toBeUndefined();
  });
});
