import { describe, expect, test } from "bun:test";
import { HARNESS_EVENT_TYPES, type HarnessEvent, isHarnessEvent, validateHarnessEvent } from "../../src/index.ts";

const env = { run_id: "run-1", seq: 0, at: "2026-11-17T10:00:00.000Z" };

/** One valid event of every type, with every optional field set where the type has one. */
const SAMPLES: HarnessEvent[] = [
  { ...env, type: "session.started", harness_session: "s-1", transcript: "/t.jsonl" },
  { ...env, type: "turn.started", source: "brief" },
  { ...env, type: "tool.requested", id: "t1", kind: "shell", tool: "Bash", detail: "ls" },
  { ...env, type: "tool.permission", id: "t1", prompt: "Allow Bash?" },
  { ...env, type: "tool.finished", id: "t1", ok: true },
  { ...env, type: "subagent.started", id: "a1", background: true },
  { ...env, type: "subagent.finished", id: "a1" },
  { ...env, type: "input.requested", id: "q1", question: "Which?", options: ["a", "b"] },
  { ...env, type: "input.received", id: "q1", by: "pane" },
  { ...env, type: "limit.hit", kind: "usage", resets_at: "2026-11-17T15:00:00.000Z" },
  { ...env, type: "context.compacted" },
  { ...env, type: "turn.ended", last_message: "done for now" },
  { ...env, type: "report.made", verb: "done", outcome: "approve" },
  { ...env, type: "session.ended", reason: "exit" },
  { ...env, type: "hook.error", hook: "PreToolUse", message: "bad payload" },
];

describe("HarnessEvent", () => {
  test("lists exactly the contract's fifteen types", () => {
    expect(HARNESS_EVENT_TYPES).toEqual(SAMPLES.map((e) => e.type));
    expect(new Set(HARNESS_EVENT_TYPES).size).toBe(15);
  });

  test.each(SAMPLES.map((e) => [e.type, e] as const))("a well-formed %s validates", (_type, event) => {
    expect(validateHarnessEvent(event)).toEqual({ ok: true, value: event });
  });

  test("optional fields may be left out", () => {
    for (const e of [
      { ...env, type: "session.started", harness_session: "s-1" },
      { ...env, type: "tool.requested", id: "t1", kind: "other", tool: "Glob" },
      { ...env, type: "input.requested", id: "q1", question: "Which?" },
      { ...env, type: "input.received", by: "norn" },
      { ...env, type: "limit.hit", kind: "rate" },
      { ...env, type: "turn.ended" },
      { ...env, type: "report.made", verb: "stuck" },
    ])
      expect({ type: e.type, ok: isHarnessEvent(e) }).toEqual({ type: e.type, ok: true });
  });

  test("an unknown type is refused", () => {
    expect(isHarnessEvent({ ...env, type: "tool.cancelled", id: "t1" })).toBe(false);
  });

  test("the envelope is required and checked", () => {
    const base = { type: "context.compacted" };
    expect(isHarnessEvent({ ...base, seq: 0, at: env.at })).toBe(false);
    expect(isHarnessEvent({ ...base, run_id: "r", at: env.at })).toBe(false);
    expect(isHarnessEvent({ ...base, run_id: "r", seq: -1, at: env.at })).toBe(false);
    expect(isHarnessEvent({ ...base, run_id: "r", seq: 1.5, at: env.at })).toBe(false);
    expect(isHarnessEvent({ ...base, run_id: "r", seq: 0, at: "yesterday" })).toBe(false);
    expect(isHarnessEvent({ ...base, run_id: "", seq: 0, at: env.at })).toBe(false);
  });

  test("a field outside the variant, or a value outside an enum, is refused with a pointer", () => {
    const extra = validateHarnessEvent({ ...env, type: "tool.finished", id: "t1", ok: true, kind: "shell" });
    expect(extra).toEqual({ ok: false, errors: [{ path: "", message: "unknown property 'kind'" }] });
    const kind = validateHarnessEvent({ ...env, type: "tool.requested", id: "t1", kind: "network", tool: "Fetch" });
    expect(kind.ok).toBe(false);
    if (!kind.ok) expect(kind.errors.map((e) => e.path)).toContain("/kind");
    expect(isHarnessEvent({ ...env, type: "turn.started", source: "robot" })).toBe(false);
    expect(isHarnessEvent({ ...env, type: "limit.hit", kind: "usage", resets_at: "soon" })).toBe(false);
    expect(isHarnessEvent({ ...env, type: "input.requested", id: "q1", question: "?", options: [1] })).toBe(false);
  });

  test("non-objects are refused", () => {
    for (const v of [null, undefined, "tool.finished", 3, []]) expect(isHarnessEvent(v)).toBe(false);
  });
});
