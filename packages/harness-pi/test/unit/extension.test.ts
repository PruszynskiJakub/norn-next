/**
 * The generated extension, loaded as pi loads it and wired to a stand-in pi and a stand-in hook
 * command, so no child process starts: `wire` takes the function the real extension spawns with.
 */
import { afterAll, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { RUN_ENV } from "@norn/plugin-api";
import { extensionPath, FAILED_WRITE_REASON, PI_HOOKS, piHarness } from "../../src/index.ts";

type Handler = (event: Record<string, unknown>, ctx: unknown) => Promise<unknown>;
type Reply = { ok: true; reply: Record<string, unknown> } | { ok: false };
type Send = (name: string, payload: Record<string, unknown>) => Promise<Reply>;
interface Extension {
  default: (pi: unknown) => void;
  wire: (pi: unknown, send: Send) => void;
}

const dirs: string[] = [];
afterAll(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});

async function load(): Promise<Extension> {
  const wt = mkdtempSync(join(tmpdir(), "norn-pi-ext-"));
  dirs.push(wt);
  await piHarness.install({ worktree: wt, hookCommand: "norn hook pi" });
  return (await import(extensionPath(wt))) as Extension;
}

const extension = await load();

/** The handlers the extension registers, against a hook command answering `replies[event]` (allow when absent). */
function wired(replies: Record<string, Reply | (() => Promise<Reply>)> = {}, sendMessage?: (message: unknown, options: unknown) => void) {
  const calls: Array<{ name: string; payload: Record<string, unknown> }> = [];
  const sent: Array<{ message: unknown; options: unknown }> = [];
  const on: Record<string, Handler> = {};
  const pi = {
    on: (name: string, h: Handler) => (on[name] = h),
    sendMessage: sendMessage ?? ((message: unknown, options: unknown) => sent.push({ message, options })),
  };
  extension.wire(pi, async (name, payload) => {
    calls.push({ name, payload });
    const r = replies[name];
    return typeof r === "function" ? r() : (r ?? { ok: true, reply: {} });
  });
  return { on, calls, sent, handler: (name: string) => on[name] as Handler };
}

const assistant = (text: string, extra: Record<string, unknown> = {}) => ({ type: "message", message: { role: "assistant", content: [{ type: "text", text }], ...extra } });

function ctx(entries: unknown[] = [], idle = true) {
  return {
    cwd: "/w",
    isIdle: () => idle,
    sessionManager: { getSessionId: () => "0199-pi", getSessionFile: () => "/s/0199-pi.jsonl", getEntries: () => entries, getBranch: () => entries },
  };
}

const SESSION = { session_id: "0199-pi", transcript_path: "/s/0199-pi.jsonl", cwd: "/w" };

describe("pi extension: forwarding", () => {
  test("registers a handler for exactly the events the harness normalizes", () => {
    expect(Object.keys(wired().on).sort()).toEqual([...PI_HOOKS].sort());
  });
  test("forwards each event with the session and the fields normalize reads", async () => {
    const w = wired();
    await w.handler("session_start")({ reason: "startup" }, ctx());
    await w.handler("before_agent_start")({ messageType: "user", prompt: "Run norn brief" }, ctx());
    await w.handler("tool_call")({ toolCallId: "call_01", toolName: "bash", input: { command: "bun test" } }, ctx());
    await w.handler("tool_execution_end")({ toolCallId: "call_01", toolName: "bash", isError: false }, ctx());
    await w.handler("ui_prompt_start")({ kind: "confirm", title: "Allow rm -rf?" }, ctx());
    await w.handler("ui_prompt_end")({}, ctx());
    await w.handler("session_compact")({ reason: "threshold" }, ctx());
    await w.handler("agent_settled")({ aborted: true }, ctx());
    await w.handler("session_shutdown")({ reason: "quit" }, ctx());
    expect(w.calls).toEqual([
      { name: "session_start", payload: { ...SESSION, reason: "startup" } },
      { name: "before_agent_start", payload: { ...SESSION, message_type: "user", prompt: "Run norn brief" } },
      { name: "tool_call", payload: { ...SESSION, tool_call_id: "call_01", tool_name: "bash", tool_input: { command: "bun test" } } },
      { name: "tool_execution_end", payload: { ...SESSION, tool_call_id: "call_01", tool_name: "bash", is_error: false } },
      { name: "ui_prompt_start", payload: { ...SESSION, kind: "confirm", title: "Allow rm -rf?", prompt_seq: expect.stringMatching(/^[0-9a-z]+-\d+$/) } },
      { name: "ui_prompt_end", payload: SESSION },
      { name: "session_compact", payload: { ...SESSION, reason: "threshold" } },
      { name: "agent_settled", payload: { ...SESSION, aborted: true } },
      { name: "session_shutdown", payload: { ...SESSION, reason: "quit" } },
    ]);
  });
  test("what it forwards normalizes into events, not hook errors", async () => {
    const w = wired();
    await w.handler("tool_call")({ toolCallId: "call_02", toolName: "write", input: { path: "src/a.ts", content: "x" } }, ctx());
    await w.handler("agent_before_settle")({ entries: [] }, ctx([assistant("Done.", { stopReason: "stop" })]));
    const events = w.calls.flatMap((c, i) => piHarness.normalize({ hook: c.name, payload: { hook_event_name: c.name, ...c.payload }, env: {}, at: "2026-11-17T10:00:00.000Z", run_id: "r", seq: i }));
    expect(events.map((e) => e.type)).toEqual(["tool.requested", "turn.ended"]);
  });
  test("agent_before_settle sends the newest assistant words and how the run stopped", async () => {
    const w = wired();
    const branch = [assistant("Slice implemented."), { type: "message", message: { role: "assistant", content: [], stopReason: "error", errorMessage: "overloaded" } }];
    await w.handler("agent_before_settle")({ entries: [] }, ctx(branch));
    expect(w.calls[0]?.payload).toEqual({ ...SESSION, outcome: "completed", stop_reason: "error", error_message: "overloaded", last_assistant_message: "Slice implemented." });
  });
});

const normalized = (calls: Array<{ name: string; payload: Record<string, unknown> }>, env: Record<string, string> = {}) =>
  calls.flatMap((c, i) => piHarness.normalize({ hook: c.name, payload: { hook_event_name: c.name, ...c.payload }, env, at: "2026-11-17T10:00:00.000Z", run_id: "r", seq: i }));

describe("pi extension: a write names the file pi will write", () => {
  const HOME = homedir();
  test.each([
    ["a relative path, against the session's cwd", "src/a.ts", "/w/src/a.ts"],
    ["a leading @", "@/abs/other-worktree/f", "/abs/other-worktree/f"],
    ["~/", "~/Projects/norn/x", `${HOME}/Projects/norn/x`],
    ["~ alone", "~", HOME],
    ["a file:// URL", "file:///abs/data/state.json", "/abs/data/state.json"],
    ["dot segments", "./src/../../x", "/x"],
  ])("%s", async (_name, path, resolved) => {
    for (const toolName of ["write", "edit"]) {
      const w = wired();
      await w.handler("tool_call")({ toolCallId: "c", toolName, input: { path } }, ctx());
      expect(w.calls[0]?.payload.resolved_path).toBe(resolved);
      expect(normalized(w.calls)).toMatchObject([{ type: "tool.requested", kind: "write", detail: resolved }]);
    }
  });
  test("a call that writes nothing, or names no path, sends no resolved path", async () => {
    const w = wired();
    await w.handler("tool_call")({ toolCallId: "c", toolName: "bash", input: { command: "ls ~" } }, ctx());
    await w.handler("tool_call")({ toolCallId: "d", toolName: "write", input: { content: "x" } }, ctx());
    expect(w.calls.map((c) => "resolved_path" in c.payload)).toEqual([false, false]);
  });
});

describe("pi extension: dialogs", () => {
  test("each opening is numbered, so the same dialog asked twice is two inputs", async () => {
    const w = wired();
    const open = { kind: "confirm", title: "Clear session?" };
    await w.handler("ui_prompt_start")(open, ctx());
    await w.handler("ui_prompt_end")({}, ctx());
    await w.handler("ui_prompt_start")(open, ctx());
    const seqs = w.calls.filter((c) => c.name === "ui_prompt_start").map((c) => c.payload.prompt_seq);
    expect(new Set(seqs).size).toBe(2);
    const ids = normalized(w.calls).flatMap((e) => (e.type === "input.requested" ? [e.id] : []));
    expect(ids).toHaveLength(2);
    expect(ids[0]).not.toBe(ids[1]);
  });
});

describe("pi extension: a settle pi will not continue", () => {
  const errored = [assistant("Running the linter next."), { type: "message", message: { role: "assistant", content: [], stopReason: "error", errorMessage: "429 rate_limit_error" } }];
  test("an error settle is not forwarded where a continue could answer it, and agent_settled ends the turn on the error", async () => {
    const w = wired({ agent_before_settle: { ok: true, reply: { continue: "report with norn done first" } } });
    expect(await w.handler("agent_before_settle")({ outcome: "error", entries: [] }, ctx(errored))).toBeUndefined();
    await w.handler("agent_settled")({ aborted: false }, ctx(errored));
    expect(w.calls).toEqual([
      { name: "agent_settled", payload: { ...SESSION, aborted: false, outcome: "error", stop_reason: "error", error_message: "429 rate_limit_error", last_assistant_message: "Running the linter next." } },
    ]);
    expect(normalized(w.calls)).toMatchObject([{ type: "turn.ended", last_message: "pi stopped on an error: 429 rate_limit_error" }]);
  });
  test("an aborted settle ends at agent_settled the same way", async () => {
    const w = wired();
    await w.handler("agent_before_settle")({ outcome: "aborted", entries: [] }, ctx([assistant("Half way.", { stopReason: "aborted" })]));
    await w.handler("agent_settled")({ aborted: true }, ctx([assistant("Half way.", { stopReason: "aborted" })]));
    expect(w.calls.map((c) => c.name)).toEqual(["agent_settled"]);
    expect(normalized(w.calls)).toMatchObject([{ type: "turn.ended", last_message: "Half way." }]);
  });
  test("a completed settle is forwarded, and the agent_settled after it ends nothing again", async () => {
    const w = wired();
    await w.handler("agent_before_settle")({ outcome: "completed", entries: [] }, ctx([assistant("Done.", { stopReason: "stop" })]));
    await w.handler("agent_settled")({ aborted: false }, ctx([assistant("Done.", { stopReason: "stop" })]));
    expect(w.calls.map((c) => [c.name, c.payload.outcome])).toEqual([
      ["agent_before_settle", "completed"],
      ["agent_settled", undefined],
    ]);
    expect(normalized(w.calls).map((e) => e.type)).toEqual(["turn.ended"]);
  });
  test("an error settle's stop is carried once: the next run's agent_settled does not repeat it", async () => {
    const w = wired();
    await w.handler("agent_before_settle")({ outcome: "error", entries: [] }, ctx(errored));
    await w.handler("agent_settled")({ aborted: false }, ctx(errored));
    await w.handler("agent_before_settle")({ outcome: "completed", entries: [] }, ctx([assistant("Done.")]));
    await w.handler("agent_settled")({ aborted: false }, ctx([assistant("Done.")]));
    expect(w.calls.at(-1)).toEqual({ name: "agent_settled", payload: { ...SESSION, aborted: false } });
  });
});

describe("pi extension: applying norn's reply", () => {
  test("an empty reply allows: no block, no continuation, no message", async () => {
    const w = wired();
    expect(await w.handler("tool_call")({ toolCallId: "c", toolName: "write", input: {} }, ctx())).toBeUndefined();
    expect(await w.handler("agent_before_settle")({ entries: [] }, ctx())).toBeUndefined();
    expect(await w.handler("before_agent_start")({ messageType: "user", prompt: "x" }, ctx())).toBeUndefined();
  });
  test("a block on tool_call refuses the call with norn's reason", async () => {
    const w = wired({ tool_call: { ok: true, reply: { block: true, reason: "outside the worktree" } } });
    expect(await w.handler("tool_call")({ toolCallId: "c", toolName: "bash", input: {} }, ctx())).toEqual({ block: true, reason: "outside the worktree" });
  });
  test("a continue on agent_before_settle appends norn's message and asks for one more run", async () => {
    const prior = { type: "custom", customType: "other" };
    const w = wired({ agent_before_settle: { ok: true, reply: { continue: "report with norn done first" } } });
    expect(await w.handler("agent_before_settle")({ entries: [prior] }, ctx())).toEqual({
      entries: [prior, { type: "custom_message", customType: "norn", content: "report with norn done first", display: true }],
      continue: true,
    });
  });
  test("context answered while a run is under way is steered into that run at once, never held", async () => {
    const w = wired({ session_compact: { ok: true, reply: { context: "the brief, restated" } } });
    await w.handler("session_compact")({ reason: "threshold" }, ctx([], false));
    expect(w.sent).toEqual([{ message: { customType: "norn", content: "the brief, restated", display: false }, options: { deliverAs: "steer" } }]);
    expect(await w.handler("before_agent_start")({ messageType: "user", prompt: "next" }, ctx())).toBeUndefined();
  });
  test("context that cannot be steered (sendMessage throws) is held for the next prompt", async () => {
    const w = wired({ session_compact: { ok: true, reply: { context: "held" } } }, () => {
      throw new Error("not streaming");
    });
    await w.handler("session_compact")({ reason: "threshold" }, ctx([], false));
    expect(await w.handler("before_agent_start")({ messageType: "user", prompt: "next" }, ctx())).toEqual({ message: { customType: "norn", content: "held", display: false } });
  });
  test("held context rides on a continuation, ahead of norn's reason", async () => {
    const w = wired({ session_compact: { ok: true, reply: { context: "held" } }, agent_before_settle: { ok: true, reply: { continue: "report first" } } });
    await w.handler("session_compact")({ reason: "manual" }, ctx());
    expect(w.sent).toEqual([]);
    expect(await w.handler("agent_before_settle")({ outcome: "completed", entries: [] }, ctx())).toEqual({
      entries: [
        { type: "custom_message", customType: "norn", content: "held", display: false },
        { type: "custom_message", customType: "norn", content: "report first", display: true },
      ],
      continue: true,
    });
    expect(await w.handler("before_agent_start")({ messageType: "user", prompt: "again" }, ctx())).toBeUndefined();
  });
  test("context from a session start or compaction while idle waits for the next prompt, then goes with it once", async () => {
    const w = wired({ session_start: { ok: true, reply: { context: "first" } }, session_compact: { ok: true, reply: { context: "second" } } });
    await w.handler("session_start")({ reason: "startup" }, ctx());
    await w.handler("session_compact")({ reason: "manual" }, ctx());
    expect(await w.handler("before_agent_start")({ messageType: "user", prompt: "go" }, ctx())).toEqual({ message: { customType: "norn", content: "first\n\nsecond", display: false } });
    expect(await w.handler("before_agent_start")({ messageType: "user", prompt: "again" }, ctx())).toBeUndefined();
  });
  test("context on before_agent_start goes with that very prompt", async () => {
    const w = wired({ before_agent_start: { ok: true, reply: { context: "an answer came in" } } });
    expect(await w.handler("before_agent_start")({ messageType: "user", prompt: "go" }, ctx())).toEqual({ message: { customType: "norn", content: "an answer came in", display: false } });
  });
});

describe("pi extension: a failed hook command never crashes pi", () => {
  const failures: Array<[string, Reply | (() => Promise<Reply>)]> = [
    ["a failed run", { ok: false }],
    ["a throwing send", () => Promise.reject(new Error("spawn sh ENOENT"))],
  ];
  test.each(failures)("%s refuses a guarded write with norn's reason", async (_name, failure) => {
    for (const toolName of ["write", "edit"]) {
      const w = wired({ tool_call: failure });
      expect(await w.handler("tool_call")({ toolCallId: "c", toolName, input: { path: "a" } }, ctx())).toEqual({ block: true, reason: FAILED_WRITE_REASON });
    }
  });
  test.each(failures)("%s lets anything else through", async (_name, failure) => {
    const all = Object.fromEntries(PI_HOOKS.map((h) => [h, failure]));
    const w = wired(all);
    expect(await w.handler("tool_call")({ toolCallId: "c", toolName: "bash", input: { command: "ls" } }, ctx())).toBeUndefined();
    expect(await w.handler("agent_before_settle")({ entries: [] }, ctx())).toBeUndefined();
    expect(await w.handler("session_start")({ reason: "startup" }, ctx())).toBeUndefined();
    expect(await w.handler("before_agent_start")({ messageType: "user", prompt: "x" }, ctx())).toBeUndefined();
    expect(await w.handler("session_shutdown")({ reason: "quit" }, ctx())).toBeUndefined();
  });
  test("a context without a session manager is a failed hook, not a throw", async () => {
    const w = wired();
    expect(await w.handler("tool_call")({ toolCallId: "c", toolName: "edit", input: {} }, {})).toEqual({ block: true, reason: FAILED_WRITE_REASON });
    expect(await w.handler("session_start")({ reason: "startup" }, {})).toBeUndefined();
    expect(w.calls).toEqual([]);
  });
});

describe("pi extension: only in a session norn launched", () => {
  function registered(env: Record<string, string | undefined>): string[] {
    const saved = { unit: process.env[RUN_ENV.unit], run: process.env[RUN_ENV.run] };
    const set = (k: string, v: string | undefined) => (v === undefined ? delete process.env[k] : (process.env[k] = v));
    set(RUN_ENV.unit, env.unit);
    set(RUN_ENV.run, env.run);
    try {
      const names: string[] = [];
      extension.default({ on: (name: string) => names.push(name) });
      return names;
    } finally {
      set(RUN_ENV.unit, saved.unit);
      set(RUN_ENV.run, saved.run);
    }
  }
  test("a pi started by a person (no unit and run in its env) gets no handlers", () => {
    expect(registered({})).toEqual([]);
    expect(registered({ unit: "gh-12" })).toEqual([]);
  });
  test("a pi norn launched gets every handler", () => {
    expect(registered({ unit: "gh-12", run: "run-1" }).sort()).toEqual([...PI_HOOKS].sort());
  });
});
