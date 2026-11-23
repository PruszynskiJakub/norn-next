import { describe, expect, test } from "bun:test";
import { isHarnessEvent } from "@norn/plugin-api";
import { LAB_HOOKS, labHarness } from "../../src/index.ts";

const at = "2026-11-17T10:00:00.000Z";
const norm = (hook: string, payload: unknown, seq = 0) => labHarness.normalize({ hook, payload, env: {}, at, run_id: "run-1", seq });

describe("the lab harness's hooks", () => {
  test("the start hook reports the session the agent names, which a resume continues", () => {
    expect(norm("start", { session_id: "lab-run-1" }, 4)).toEqual([{ type: "session.started", run_id: "run-1", seq: 4, at, harness_session: "lab-run-1" }]);
  });

  test("every hook of the protocol reads as contract events, numbered from the seq it is given", () => {
    const payloads: Record<string, unknown> = {
      start: { session_id: "s" },
      prompt: { prompt: "go\n\n<!-- norn-prompt source=answer id=answer-q1 -->" },
      tool: { id: "t1", kind: "write", tool: "Write", detail: "a.txt" },
      "tool-done": { id: "t1" },
      permission: { id: "t1", prompt: "Allow?" },
      ask: { id: "q1", question: "Which?", options: ["a", "b"] },
      answer: { id: "q1", by: "pane" },
      compact: {},
      stop: { last_message: "Reported done." },
      end: { reason: "exit" },
    };
    for (const hook of LAB_HOOKS) {
      const events = norm(hook, payloads[hook], 7);
      expect({ hook, valid: events.every(isHarnessEvent), errors: events.filter((e) => e.type === "hook.error"), seqs: events.map((e) => e.seq) }).toEqual({
        hook,
        valid: true,
        errors: [],
        seqs: events.map((_, i) => 7 + i),
      });
    }
    expect(norm("prompt", payloads.prompt).map((e) => e.type)).toEqual(["turn.started", "input.received"]);
  });

  test("an unknown hook or a payload missing a field is one hook.error, never a throw", () => {
    expect(norm("nope", {})).toEqual([{ type: "hook.error", run_id: "run-1", seq: 0, at, hook: "nope", message: 'unknown hook "nope"' }]);
    expect(norm("start", "not an object")).toMatchObject([{ type: "hook.error", message: "start: no session_id" }]);
    expect(norm("tool", { id: "t1", kind: "teleport" })).toMatchObject([{ type: "hook.error" }]);
  });

  test("allow answers nothing; any other answer goes back as its JSON", () => {
    expect(labHarness.respond({ hook: "tool", answer: { kind: "allow" } })).toEqual({ stdout: "", exit_code: 0 });
    expect(labHarness.respond({ hook: "prompt", answer: { kind: "context", text: "the answer" } })).toEqual({ stdout: '{"kind":"context","text":"the answer"}\n', exit_code: 0 });
  });
});
