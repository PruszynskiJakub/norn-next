import { describe, expect, test } from "bun:test";
import type { HarnessAnswer } from "@norn/plugin-api";
import { PI_HOOKS, piHarness } from "../../src/index.ts";

const reply = (hook: string, answer: HarnessAnswer) => piHarness.respond({ hook, answer });
const SILENT = { stdout: "", exit_code: 0 };

describe("pi respond", () => {
  test("a deny on tool_call blocks the call with the reason", () => {
    expect(reply("tool_call", { kind: "deny", reason: "outside the worktree" })).toEqual({ stdout: JSON.stringify({ block: true, reason: "outside the worktree" }), exit_code: 0 });
  });
  test("a block on agent_before_settle continues the run with the reason as a message", () => {
    expect(reply("agent_before_settle", { kind: "block", reason: "report with norn done first" })).toEqual({ stdout: JSON.stringify({ continue: "report with norn done first" }), exit_code: 0 });
  });
  test.each(["session_start", "session_compact", "before_agent_start"])("context on %s is handed over for the next prompt", (hook) => {
    expect(reply(hook, { kind: "context", text: "an answer came in" })).toEqual({ stdout: JSON.stringify({ context: "an answer came in" }), exit_code: 0 });
  });
  test("an allow prints nothing on every event", () => {
    for (const hook of PI_HOOKS) expect({ hook, r: reply(hook, { kind: "allow" }) }).toEqual({ hook, r: SILENT });
  });
  test("an answer the event cannot carry is acknowledged silently", () => {
    expect(reply("agent_before_settle", { kind: "deny", reason: "x" })).toEqual(SILENT);
    expect(reply("tool_call", { kind: "block", reason: "x" })).toEqual(SILENT);
    expect(reply("agent_settled", { kind: "block", reason: "x" })).toEqual(SILENT);
    expect(reply("tool_call", { kind: "context", text: "x" })).toEqual(SILENT);
    expect(reply("tool_execution_end", { kind: "deny", reason: "x" })).toEqual(SILENT);
  });
});
