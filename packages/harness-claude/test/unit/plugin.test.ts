import { describe, expect, test } from "bun:test";
import { claudeHarness, claudePlugin, RUN_ID_ENV } from "../../src/index.ts";

const REQ = { cwd: "/repo/.worktrees/gh-12", prompt: "Use the norn skill, then run `norn brief`.", run_id: "run-1", env: { PATH: "/usr/bin" } };

describe("claude launch", () => {
  test("claude -- <prompt>, with the run id in the env", () => {
    expect(claudeHarness.launch(REQ)).toEqual({ argv: ["claude", "--", REQ.prompt], env: { PATH: "/usr/bin", [RUN_ID_ENV]: "run-1" } });
  });
  test("model, resume and extra args come before --, so a variadic flag cannot take the prompt", () => {
    const spec = claudeHarness.launch({ ...REQ, model: "opus", resume: "abc123", args: ["--allowedTools", "Bash", "Edit"] });
    expect(spec.argv).toEqual(["claude", "--model", "opus", "--resume", "abc123", "--allowedTools", "Bash", "Edit", "--", REQ.prompt]);
  });
  test("a resume with no prompt passes none", () => {
    expect(claudeHarness.launch({ ...REQ, prompt: "", resume: "abc123" }).argv).toEqual(["claude", "--resume", "abc123"]);
  });
  test("the caller's env cannot override the run id", () => {
    expect(claudeHarness.launch({ ...REQ, env: { [RUN_ID_ENV]: "other" } }).env[RUN_ID_ENV]).toBe("run-1");
  });
});

describe("claude plugin", () => {
  test("provides the claude harness under its name, frozen", () => {
    expect(claudePlugin.name).toBe("norn-harness-claude");
    expect(claudePlugin.api).toBe("^1");
    expect(claudePlugin.provides.harness?.claude).toBe(claudeHarness);
    expect(Object.isFrozen(claudePlugin)).toBe(true);
  });
  test("declares what Claude Code's hooks can do", () => {
    expect(claudeHarness.name).toBe("claude");
    expect(claudeHarness.capabilities).toEqual({ blockStop: true, denyTool: true, injectContext: true, subagents: true, limits: true, paneInput: true });
  });
});
