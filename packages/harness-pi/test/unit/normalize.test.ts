import { describe, expect, test } from "bun:test";
import { type HarnessEvent, isHarnessEvent, markPrompt } from "@norn/plugin-api";
import { PI_HOOKS, piHarness } from "../../src/index.ts";
import fixtures from "./fixtures/hook-payloads.json" with { type: "json" };

const payloads = fixtures.payloads;
const AT = "2026-11-17T10:00:00.000Z";
const RUN = "run-1";

const norm = (hook: string, payload: unknown, seq = 0, env: Record<string, string> = {}) => piHarness.normalize({ hook, payload, env, at: AT, run_id: RUN, seq });
/** The events without their envelope, which every case shares. */
const bodies = (events: HarnessEvent[]) => events.map(({ run_id: _r, seq: _s, at: _a, ...rest }) => rest);
const body = (hook: string, payload: unknown) => bodies(norm(hook, payload));

describe("pi normalize: envelope", () => {
  test("stamps run_id and at, and numbers events from the given seq", () => {
    const events = norm("before_agent_start", payloads.before_agent_start, 41);
    expect(events.map((e) => [e.run_id, e.seq, e.at])).toEqual([
      [RUN, 41, AT],
      [RUN, 42, AT],
    ]);
  });
  test("every event it returns satisfies the contract, and every forwarded event has a fixture", () => {
    const seen = new Set<string>();
    for (const [name, p] of Object.entries(payloads)) {
      seen.add(p.hook_event_name);
      for (const e of norm(p.hook_event_name, p)) expect({ name, ok: isHarnessEvent(e), type: e.type === "hook.error" }).toEqual({ name, ok: true, type: false });
    }
    expect([...seen].sort()).toEqual([...PI_HOOKS].sort());
  });
});

describe("pi normalize: session events", () => {
  test("session_start → session.started with the session id and transcript, on a fresh start and a resume alike", () => {
    const started = { type: "session.started", harness_session: "0199-pi", transcript: "/s/0199-pi.jsonl" } as const;
    expect(body("session_start", payloads.session_start)).toEqual([started]);
    expect(body("session_start", payloads.session_start_resume)).toEqual([started]);
  });
  test("an ephemeral session with no file → session.started without a transcript", () => {
    const { transcript_path: _, ...ephemeral } = payloads.session_start;
    expect(body("session_start", ephemeral)).toEqual([{ type: "session.started", harness_session: "0199-pi" }]);
  });
  test("session_compact → context.compacted", () => {
    expect(body("session_compact", payloads.session_compact)).toEqual([{ type: "context.compacted" }]);
  });
  test("a quit → session.ended exit; a session replaced inside the process ends nothing", () => {
    expect(body("session_shutdown", payloads.session_shutdown)).toEqual([{ type: "session.ended", reason: "exit" }]);
    expect(body("session_shutdown", payloads.session_shutdown_new)).toEqual([]);
  });
});

describe("pi normalize: runs", () => {
  test("a prompt typed by a person → turn.started person plus an answer from the pane", () => {
    expect(body("before_agent_start", payloads.before_agent_start)).toEqual([
      { type: "turn.started", source: "person" },
      { type: "input.received", by: "pane" },
    ]);
  });
  test.each(["brief", "nudge"] as const)("a prompt carrying a %s mark → turn.started with that source and the prompt id", (source) => {
    const prompt = markPrompt("Run norn brief", { source, id: "p-1" });
    expect(body("before_agent_start", { ...payloads.before_agent_start, prompt })).toEqual([{ type: "turn.started", source, prompt_id: "p-1" }]);
  });
  test("an answer mark → turn.started answer with its id plus an answer from norn", () => {
    const prompt = markPrompt("yes, go on", { source: "answer", id: "a-1" });
    expect(body("before_agent_start", { ...payloads.before_agent_start, prompt })).toEqual([
      { type: "turn.started", source: "answer", prompt_id: "a-1" },
      { type: "input.received", by: "norn" },
    ]);
  });
  test("a run another extension's message started → turn.started person, answering nothing", () => {
    expect(body("before_agent_start", payloads.before_agent_start_custom)).toEqual([{ type: "turn.started", source: "person" }]);
  });
  test("agent_before_settle → turn.ended with the last assistant words", () => {
    expect(body("agent_before_settle", payloads.agent_before_settle)).toEqual([{ type: "turn.ended", last_message: "Done." }]);
    const { last_assistant_message: _, ...silent } = payloads.agent_before_settle;
    expect(body("agent_before_settle", silent)).toEqual([{ type: "turn.ended" }]);
  });
  test("a run pi will not continue (an error settle) ends its turn at agent_settled, with the error as its words", () => {
    const named = "pi stopped on an error: 429 rate_limit_error";
    expect(body("agent_settled", payloads.agent_settled_error)).toEqual([{ type: "turn.ended", last_message: named, error: named }]);
    const { error_message: _, ...unnamed } = payloads.agent_settled_error;
    const generic = "pi stopped on an error: pi stopped on a provider error";
    expect(body("agent_settled", unnamed)).toEqual([{ type: "turn.ended", last_message: generic, error: generic }]);
  });
  test("an aborted settle ends at agent_settled with the last words it had", () => {
    const aborted = { ...payloads.agent_settled_error, outcome: "aborted", stop_reason: "aborted", error_message: undefined };
    expect(body("agent_settled", aborted)).toEqual([{ type: "turn.ended", last_message: "Slice implemented;" }]);
  });
  test("agent_settled ends the turn only for a run that skipped agent_before_settle", () => {
    expect(body("agent_settled", payloads.agent_settled)).toEqual([]);
    expect(body("agent_settled", { ...payloads.agent_settled, outcome: "completed" })).toEqual([]);
    expect(body("agent_settled", payloads.agent_settled_aborted)).toEqual([{ type: "turn.ended" }]);
  });
});

describe("pi normalize: tool calls", () => {
  test.each([
    ["tool_call", "shell", "bash", "bun test", "call_01"],
    ["tool_call_write", "write", "write", "/w/src/a.ts", "call_02"],
    ["tool_call_edit", "write", "edit", "/w/src/b.ts", "call_03"],
    ["tool_call_read", "other", "read", "src/a.ts", "call_04"],
  ] as const)("%s → tool.requested kind %s", (fixture, kind, tool, detail, id) => {
    expect(body("tool_call", payloads[fixture])).toEqual([{ type: "tool.requested", id, kind, tool, detail }]);
  });
  test("a call with no input → tool.requested without a detail", () => {
    const { tool_input: _, ...bare } = payloads.tool_call_read;
    expect(body("tool_call", bare)).toEqual([{ type: "tool.requested", id: "call_04", kind: "other", tool: "read" }]);
  });
  describe("a write's detail is the file pi will write, so the guard sees through pi's path prefixes", () => {
    const HOME = { HOME: "/home/u" };
    const write = (path: string, extra: Record<string, unknown> = {}) => {
      const { resolved_path: _, ...raw } = payloads.tool_call_write;
      return { ...raw, tool_input: { path, content: "x" }, ...extra };
    };
    const detail = (payload: unknown, env: Record<string, string> = HOME) => {
      const e = norm("tool_call", payload, 0, env)[0];
      return e?.type === "tool.requested" ? e.detail : e?.type;
    };
    test("the extension's resolved path wins over the raw one", () => {
      expect(detail(write("~/Projects/norn/x", { resolved_path: "/home/u/Projects/norn/x" }))).toBe("/home/u/Projects/norn/x");
    });
    test("a resolved path that is not absolute is ignored", () => {
      expect(detail(write("@/abs/other/f", { resolved_path: "relative/f" }))).toBe("/abs/other/f");
    });
    test.each([
      ["a leading @ before an absolute path", "@/abs/other-worktree/f", "/abs/other-worktree/f"],
      ["a leading @ before a relative path", "@src/a.ts", "src/a.ts"],
      ["~ alone", "~", "/home/u"],
      ["~/ under the home", "~/Projects/norn/x", "/home/u/Projects/norn/x"],
      ["a file:// URL", "file:///abs/data/state.json", "/abs/data/state.json"],
      ["a file://localhost URL with escapes", "file://localhost/abs/my%20dir/f", "/abs/my dir/f"],
      ["@ before ~/", "@~/x", "/home/u/x"],
      ["a unicode space", "src/a\u00A0b.ts", "src/a b.ts"],
      ["a plain relative path", "src/a.ts", "src/a.ts"],
    ])("%s", (_name, raw, expected) => {
      expect(detail(write(raw))).toBe(expected);
    });
    test("with no home in the env, ~ reads as outside any worktree, never relative to it", () => {
      expect(detail(write("~/Projects/norn/x"), {})).toBe("/~/Projects/norn/x");
      expect(detail(write("~"), {})).toBe("/~");
    });
    test("a read keeps the raw path: nothing guards it", () => {
      expect(detail({ ...payloads.tool_call_read, tool_input: { path: "~/x" } })).toBe("~/x");
    });
  });
  test("tool_execution_end → tool.finished, not ok when pi reports an error", () => {
    expect(body("tool_execution_end", payloads.tool_execution_end)).toEqual([{ type: "tool.finished", id: "call_01", ok: true }]);
    expect(body("tool_execution_end", payloads.tool_execution_end_error)).toEqual([{ type: "tool.finished", id: "call_02", ok: false }]);
  });
});

describe("pi normalize: dialogs", () => {
  const idOf = (payload: unknown) => {
    const e = body("ui_prompt_start", payload)[0];
    return e && "id" in e ? e.id : undefined;
  };
  test("ui_prompt_start → input.requested keyed by its opening, the same id for a retried delivery of it", () => {
    const first = body("ui_prompt_start", payloads.ui_prompt_start);
    expect(first).toEqual([{ type: "input.requested", id: expect.stringMatching(/^input-[0-9a-f]{8}$/), question: "Allow rm -rf?" }]);
    expect(body("ui_prompt_start", payloads.ui_prompt_start)).toEqual(first);
  });
  test("the same dialog opened again (same kind and title) is a new input", () => {
    expect(idOf({ ...payloads.ui_prompt_start, prompt_seq: "mi3k2x0a-2" })).not.toBe(idOf(payloads.ui_prompt_start));
  });
  test("a dialog the extension did not number is a hook error, never an id another dialog shares", () => {
    const { prompt_seq: _, ...unnumbered } = payloads.ui_prompt_start;
    expect(body("ui_prompt_start", unnumbered)).toMatchObject([{ type: "hook.error", hook: "ui_prompt_start" }]);
  });
  test("a dialog with no title is asked by its kind", () => {
    const { title: _, ...untitled } = payloads.ui_prompt_start;
    expect(body("ui_prompt_start", untitled)[0]).toMatchObject({ type: "input.requested", question: "an extension waits on a confirm" });
  });
  test("ui_prompt_end → an answer from the pane that names no input", () => {
    expect(body("ui_prompt_end", payloads.ui_prompt_end)).toEqual([{ type: "input.received", by: "pane" }]);
  });
});

describe("pi normalize: malformed input yields one hook.error, never a throw", () => {
  test.each([
    ["an unknown event", "agent_end", payloads.agent_settled, /unknown pi event "agent_end"/],
    ["a payload that is not an object", "tool_call", "not json", /not a JSON object/],
    ["a null payload", "session_start", null, /not a JSON object/],
    ["a payload for another event", "tool_call", payloads.session_start, /payload is for session_start, not tool_call/],
    ["a tool call without its id", "tool_call", { ...payloads.tool_call, tool_call_id: undefined }, /tool_call_id/],
    ["a tool call without its tool", "tool_call", { ...payloads.tool_call, tool_name: 7 }, /tool_name/],
    ["a session start without its id", "session_start", { ...payloads.session_start, session_id: "" }, /session_id/],
    ["a finished call without its id", "tool_execution_end", { hook_event_name: "tool_execution_end" }, /tool_call_id/],
  ] as const)("%s", (_name, hook, payload, message) => {
    const events = norm(hook, payload, 3);
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ type: "hook.error", hook, run_id: RUN, seq: 3, at: AT });
    expect(events[0] && "message" in events[0] ? events[0].message : "").toMatch(message);
  });
  test("a payload that would yield an invalid event becomes a hook.error naming why", () => {
    const events = piHarness.normalize({ hook: "session_start", payload: payloads.session_start, env: {}, at: "not a time", run_id: RUN, seq: 0 });
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ type: "hook.error", hook: "session_start" });
    expect(events[0] && "message" in events[0] ? events[0].message : "").toMatch(/invalid event/);
  });
});
