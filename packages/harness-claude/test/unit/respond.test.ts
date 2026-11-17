import { describe, expect, test } from "bun:test";
import type { HarnessAnswer } from "@norn/plugin-api";
import { claudeHarness } from "../../src/index.ts";

const SILENT = { stdout: "", exit_code: 0 };
const reply = (hook: string, answer: HarnessAnswer) => claudeHarness.respond({ hook, answer });
const parsed = (hook: string, answer: HarnessAnswer) => {
  const r = reply(hook, answer);
  expect(r.exit_code).toBe(0);
  return JSON.parse(r.stdout);
};

describe("claude respond", () => {
  test("a PreToolUse deny → permissionDecision deny with the reason", () => {
    expect(parsed("PreToolUse", { kind: "deny", reason: "outside the worktree" })).toEqual({
      hookSpecificOutput: { hookEventName: "PreToolUse", permissionDecision: "deny", permissionDecisionReason: "outside the worktree" },
    });
  });
  test("an allow prints nothing, leaving Claude Code's own permission check in place", () => {
    expect(reply("PreToolUse", { kind: "allow" })).toEqual(SILENT);
    expect(reply("Stop", { kind: "allow" })).toEqual(SILENT);
  });
  test.each(["Stop", "SubagentStop"])("a %s block → decision block with the reason", (hook) => {
    expect(parsed(hook, { kind: "block", reason: "report with norn done first" })).toEqual({ decision: "block", reason: "report with norn done first" });
  });
  test.each(["SessionStart", "UserPromptSubmit"])("context on %s → additionalContext", (hook) => {
    expect(parsed(hook, { kind: "context", text: "Run norn brief." })).toEqual({ hookSpecificOutput: { hookEventName: hook, additionalContext: "Run norn brief." } });
  });
  test("an answer the hook cannot carry is acknowledged silently", () => {
    expect(reply("Stop", { kind: "deny", reason: "x" })).toEqual(SILENT);
    expect(reply("PreToolUse", { kind: "block", reason: "x" })).toEqual(SILENT);
    expect(reply("Notification", { kind: "context", text: "x" })).toEqual(SILENT);
  });
});
