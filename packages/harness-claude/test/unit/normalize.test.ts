import { describe, expect, test } from "bun:test";
import { type HarnessEvent, isHarnessEvent, markPrompt } from "@norn/plugin-api";
import { claudeHarness, PROMPT_SOURCE_ENV } from "../../src/index.ts";
import payloads from "./fixtures/hook-payloads.json" with { type: "json" };

const AT = "2026-11-17T10:00:00.000Z";
const RUN = "run-1";
type Env = Record<string, string | undefined>;

const norm = (hook: string, payload: unknown, env: Env = {}, seq = 0) => claudeHarness.normalize({ hook, payload, env, at: AT, run_id: RUN, seq });
/** The events without their envelope, which every case shares. */
const bodies = (events: HarnessEvent[]) => events.map(({ run_id: _r, seq: _s, at: _a, ...rest }) => rest);
const body = (hook: string, payload: unknown, env: Env = {}) => bodies(norm(hook, payload, env));

describe("claude normalize: envelope", () => {
  test("stamps run_id and at, and numbers events from the given seq", () => {
    const events = norm("PreToolUse", payloads.PreToolUseAsk, {}, 41);
    expect(events.map((e) => [e.run_id, e.seq, e.at])).toEqual([
      [RUN, 41, AT],
      [RUN, 42, AT],
    ]);
  });
  test("every event it returns satisfies the contract", () => {
    for (const [name, p] of Object.entries(payloads)) {
      const hook = (p as { hook_event_name: string }).hook_event_name;
      for (const e of norm(hook, p)) expect({ name, ok: isHarnessEvent(e) }).toEqual({ name, ok: true });
    }
  });
});

describe("claude normalize: session and turn hooks", () => {
  test("SessionStart → session.started with the session id and transcript", () => {
    expect(body("SessionStart", payloads.SessionStart)).toEqual([
      { type: "session.started", harness_session: "abc123", transcript: "/home/u/.claude/projects/-repo/abc123.jsonl" },
    ]);
  });
  test("a prompt typed by a person → turn.started person plus an answer from the pane", () => {
    expect(body("UserPromptSubmit", payloads.UserPromptSubmit)).toEqual([
      { type: "turn.started", source: "person" },
      { type: "input.received", by: "pane" },
    ]);
  });
  test.each(["brief", "nudge"] as const)("a prompt norn sent as %s → turn.started with that source only", (source) => {
    expect(body("UserPromptSubmit", payloads.UserPromptSubmit, { [PROMPT_SOURCE_ENV]: source })).toEqual([{ type: "turn.started", source }]);
  });
  test("an answer norn typed → turn.started answer plus an answer from norn", () => {
    expect(body("UserPromptSubmit", payloads.UserPromptSubmit, { [PROMPT_SOURCE_ENV]: "answer" })).toEqual([
      { type: "turn.started", source: "answer" },
      { type: "input.received", by: "norn" },
    ]);
  });
  test.each(["brief", "nudge"] as const)("a prompt carrying a %s mark → turn.started with that source and the prompt id", (source) => {
    const prompt = markPrompt("carry on", { source, id: "p-1" });
    expect(body("UserPromptSubmit", { ...payloads.UserPromptSubmit, prompt })).toEqual([{ type: "turn.started", source, prompt_id: "p-1" }]);
  });
  test("an answer mark → turn.started answer with its id plus an answer from norn", () => {
    const prompt = markPrompt("yes, go on", { source: "answer", id: "a-1" });
    expect(body("UserPromptSubmit", { ...payloads.UserPromptSubmit, prompt })).toEqual([
      { type: "turn.started", source: "answer", prompt_id: "a-1" },
      { type: "input.received", by: "norn" },
    ]);
  });
  test("a prompt mark wins over the per-launch env", () => {
    const marked = markPrompt("x", { source: "nudge", id: "n-1" });
    expect(body("UserPromptSubmit", { ...payloads.UserPromptSubmit, prompt: marked }, { [PROMPT_SOURCE_ENV]: "brief" })[0]).toEqual({ type: "turn.started", source: "nudge", prompt_id: "n-1" });
  });
  test("an unknown prompt source counts as a person", () => {
    expect(body("UserPromptSubmit", payloads.UserPromptSubmit, { [PROMPT_SOURCE_ENV]: "elsewhere" })[0]).toEqual({ type: "turn.started", source: "person" });
  });
  test("Stop → turn.ended with the last assistant message; an older Claude Code sends none", () => {
    expect(body("Stop", payloads.Stop)).toEqual([{ type: "turn.ended", last_message: "All tests pass." }]);
    const { last_assistant_message: _, ...older } = payloads.Stop;
    expect(body("Stop", older)).toEqual([{ type: "turn.ended" }]);
  });
  test("PreCompact → context.compacted", () => {
    expect(body("PreCompact", payloads.PreCompact)).toEqual([{ type: "context.compacted" }]);
  });
  test("SessionEnd → session.ended exit", () => {
    expect(body("SessionEnd", payloads.SessionEnd)).toEqual([{ type: "session.ended", reason: "exit" }]);
  });
});

describe("claude normalize: tool hooks", () => {
  test.each([
    ["PreToolUse", "shell", "Bash", "bun test", "toolu_01"],
    ["PreToolUseWrite", "write", "Write", "/repo/.worktrees/gh-12/src/a.ts", "toolu_03"],
    ["PreToolUseEdit", "write", "Edit", "/repo/.worktrees/gh-12/src/b.ts", "toolu_04"],
    ["PreToolUseMultiEdit", "write", "MultiEdit", "/repo/.worktrees/gh-12/src/c.ts", "toolu_05"],
    ["PreToolUseNotebookEdit", "write", "NotebookEdit", "/repo/.worktrees/gh-12/n.ipynb", "toolu_06"],
    ["PreToolUseRead", "other", "Read", "/repo/.worktrees/gh-12/src/a.ts", "toolu_08"],
  ] as const)("%s → tool.requested kind %s", (fixture, kind, tool, detail, id) => {
    expect(body("PreToolUse", payloads[fixture])).toEqual([{ type: "tool.requested", id, kind, tool, detail }]);
  });
  test("PostToolUse → tool.finished ok; PostToolUseFailure → tool.finished not ok", () => {
    expect(body("PostToolUse", payloads.PostToolUse)).toEqual([{ type: "tool.finished", id: "toolu_02", ok: true }]);
    expect(body("PostToolUseFailure", payloads.PostToolUseFailure)).toEqual([{ type: "tool.finished", id: "toolu_01", ok: false }]);
  });
});

describe("claude normalize: AskUserQuestion", () => {
  const ask = payloads.PreToolUseAsk;
  test("opens an input keyed by the tool call's id, with the question and option labels", () => {
    expect(body("PreToolUse", ask)).toEqual([
      { type: "tool.requested", id: "toolu_09", kind: "ask", tool: "AskUserQuestion" },
      { type: "input.requested", id: "toolu_09", question: "Which database should the cache use?", options: ["Redis", "SQLite"] },
    ]);
  });
  test("the input id is stable: the same call seen at another time, seq or beside other tools keeps it", () => {
    const first = norm("PreToolUse", ask, {}, 0).find((e) => e.type === "input.requested");
    const parallel = norm("PreToolUse", payloads.PreToolUse, {}, 5);
    const again = claudeHarness.normalize({ hook: "PreToolUse", payload: ask, env: {}, at: "2026-11-17T11:00:00.000Z", run_id: RUN, seq: 9 }).find((e) => e.type === "input.requested");
    expect(parallel.some((e) => e.type === "input.requested")).toBe(false);
    expect(first && "id" in first && first.id).toBe("toolu_09");
    expect(again && "id" in again && again.id).toBe("toolu_09");
  });
  test("several questions are asked as one input, without options", () => {
    const two = { ...ask, tool_input: { questions: [{ question: "Name?", options: [{ label: "a" }] }, { question: "Colour?", options: [{ label: "b" }] }] } };
    expect(body("PreToolUse", two)[1]).toEqual({ type: "input.requested", id: "toolu_09", question: "Name?\nColour?" });
  });
  test("its PostToolUse records the answer from the pane, or from norn when norn typed it, and closes the call", () => {
    expect(body("PostToolUse", payloads.PostToolUseAsk)).toEqual([
      { type: "input.received", id: "toolu_09", by: "pane" },
      { type: "tool.finished", id: "toolu_09", ok: true },
    ]);
    expect(body("PostToolUse", payloads.PostToolUseAsk, { [PROMPT_SOURCE_ENV]: "answer" })[0]).toEqual({ type: "input.received", id: "toolu_09", by: "norn" });
  });
  test("a declined question records no answer, only the failed call", () => {
    const failed = { ...payloads.PostToolUseAsk, hook_event_name: "PostToolUseFailure" };
    expect(body("PostToolUseFailure", failed)).toEqual([{ type: "tool.finished", id: "toolu_09", ok: false }]);
  });
});

describe("claude normalize: subagents", () => {
  test("a foreground subagent starts with its tool call and finishes with it", () => {
    expect(body("PreToolUse", payloads.PreToolUseSubagent)).toEqual([
      { type: "tool.requested", id: "toolu_10", kind: "subagent", tool: "Task", detail: "Spec axis review" },
      { type: "subagent.started", id: "toolu_10", background: false },
    ]);
    expect(body("PostToolUse", payloads.PostToolUseSubagent)).toEqual([
      { type: "subagent.finished", id: "toolu_10" },
      { type: "tool.finished", id: "toolu_10", ok: true },
    ]);
  });
  test("a background subagent is handed from its tool call's id to its agent id, which SubagentStop finishes", () => {
    expect(body("PreToolUse", payloads.PreToolUseBackgroundAgent)[1]).toEqual({ type: "subagent.started", id: "toolu_11", background: true });
    expect(body("PostToolUse", payloads.PostToolUseBackgroundAgent)).toEqual([
      { type: "subagent.finished", id: "toolu_11" },
      { type: "subagent.started", id: "a1", background: true },
      { type: "tool.finished", id: "toolu_11", ok: true },
    ]);
    expect(body("SubagentStop", payloads.SubagentStop)).toEqual([{ type: "subagent.finished", id: "a1" }]);
  });
  test("the agent id is read from a text tool response too", () => {
    const text = { ...payloads.PostToolUseBackgroundAgent, tool_response: "Async agent launched successfully.\nagentId: a7 (use this to check on it)" };
    expect(body("PostToolUse", text)[1]).toEqual({ type: "subagent.started", id: "a7", background: true });
  });
  test("a Stop with a subagent still running reports it before the turn ends, so the session awaits it", () => {
    expect(body("Stop", payloads.StopBackground)).toEqual([
      { type: "subagent.started", id: "a1", background: true },
      { type: "turn.ended", last_message: "All tests pass." },
    ]);
    const finished = { ...payloads.StopBackground, background_tasks: [{ id: "a2", type: "subagent", status: "completed" }, { id: "s1", type: "shell", status: "running" }] };
    expect(body("Stop", finished)).toEqual([{ type: "turn.ended", last_message: "All tests pass." }]);
  });
  test("SubagentStop from an older Claude Code, naming no agent, yields nothing", () => {
    const { agent_id: _, ...older } = payloads.SubagentStop;
    expect(body("SubagentStop", older)).toEqual([]);
  });
});

describe("claude normalize: waits and limits", () => {
  test("a permission prompt → tool.permission with an id derived from the payload", () => {
    const first = body("Notification", payloads.NotificationPermission);
    const perm = first[0];
    expect(perm).toMatchObject({ type: "tool.permission", prompt: "Claude needs your permission to use Bash" });
    expect(body("Notification", payloads.NotificationPermission)).toEqual(first);
    const other = body("Notification", { ...payloads.NotificationPermission, message: "Claude needs your permission to use Write" })[0];
    expect(other && "id" in other && other.id).not.toBe(perm && "id" in perm && perm.id);
  });
  test("a permission prompt that names its tool call takes that call's id", () => {
    expect(body("Notification", { ...payloads.NotificationPermission, tool_use_id: "toolu_01" })[0]).toMatchObject({ type: "tool.permission", id: "toolu_01" });
  });
  test("an untyped permission notification from an older Claude Code is read from its text", () => {
    const { notification_type: _, ...older } = payloads.NotificationPermission;
    expect(body("Notification", older)[0]).toMatchObject({ type: "tool.permission" });
  });
  test("the idle notification ends nothing: Stop already ended the turn, or it is paused on background work", () => {
    expect(body("Notification", payloads.NotificationIdle)).toEqual([]);
    const { notification_type: _, ...older } = payloads.NotificationIdle;
    expect(body("Notification", older)).toEqual([]);
  });
  test("an elicitation dialog asks the person, with a stable id", () => {
    const first = body("Notification", payloads.NotificationElicitation);
    expect(first).toEqual([{ type: "input.requested", id: expect.stringMatching(/^input-/), question: "MCP server github requests input" }]);
    expect(body("Notification", payloads.NotificationElicitation)).toEqual(first);
  });
  test.each(["elicitation_response", "elicitation_complete"])("a %s notification is an answer typed in the pane", (type) => {
    expect(body("Notification", { ...payloads.NotificationElicitation, notification_type: type, message: "MCP server github received a response" })).toEqual([
      { type: "input.received", by: "pane" },
    ]);
  });
  test("informational notifications yield nothing", () => {
    expect(body("Notification", { ...payloads.NotificationIdle, notification_type: "auth_success" })).toEqual([]);
  });
  test("a usage limit → limit.hit usage with its reset, never a turn end that would be read as stuck", () => {
    expect(body("StopFailure", payloads.StopFailureRateLimit)).toEqual([{ type: "limit.hit", kind: "usage", resets_at: "2026-11-17T13:00:00.000Z" }]);
    expect(body("StopFailure", { ...payloads.StopFailureRateLimit, error_details: "429", last_assistant_message: "API Error" })).toEqual([{ type: "limit.hit", kind: "usage" }]);
  });
  test("a Stop whose last message is the usage-limit notice ends the turn, then records the limit", () => {
    expect(body("Stop", { ...payloads.Stop, last_assistant_message: "Claude AI usage limit reached|1794920400" })).toEqual([
      { type: "turn.ended", last_message: "Claude AI usage limit reached|1794920400" },
      { type: "limit.hit", kind: "usage", resets_at: "2026-11-17T13:00:00.000Z" },
    ]);
  });
  test.each([
    "Done. Fixed the 'usage limit reached' detection.",
    "You've hit your limit for today.",
    "Claude AI usage limit reached",
    "Claude AI usage limit reached|1794920400 and then some",
  ])("a Stop whose last message only mentions a limit (%p) ends the turn and records no limit", (last) => {
    expect(body("Stop", { ...payloads.Stop, last_assistant_message: last })).toEqual([{ type: "turn.ended", last_message: last }]);
  });
  test("a failed login asks the person to run /login; another API error ends the turn", () => {
    expect(body("StopFailure", payloads.StopFailureAuth)).toEqual([{ type: "input.requested", id: expect.stringMatching(/^login-/), question: "agent logged out: run /login in the pane" }]);
    expect(body("StopFailure", { ...payloads.StopFailureAuth, error: "server_error" })).toEqual([{ type: "turn.ended", last_message: "API Error: 401" }]);
  });
});

describe("claude normalize: never throws", () => {
  const oneError = (events: HarnessEvent[], hook: string, message: RegExp) => {
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ type: "hook.error", hook, run_id: RUN, seq: 0, at: AT });
    expect((events[0] as { message: string }).message).toMatch(message);
  };
  test("an unknown hook", () => oneError(norm("PermissionRequest", {}), "PermissionRequest", /unknown Claude Code hook/));
  test.each([null, "text", 3, [1, 2]])("a payload that is not an object (%p)", (p) => oneError(norm("PreToolUse", p), "PreToolUse", /not a JSON object/));
  test("a tool call with no id", () => {
    const { tool_use_id: _, ...noId } = payloads.PreToolUse;
    oneError(norm("PreToolUse", noId), "PreToolUse", /tool_use_id/);
  });
  test("a SessionStart with no session id", () => oneError(norm("SessionStart", { hook_event_name: "SessionStart" }), "SessionStart", /session_id/));
  test("a payload meant for another hook", () => oneError(norm("Stop", payloads.PreToolUse), "Stop", /PreToolUse/));
  test("a payload that would yield an invalid event", () => oneError(norm("PreToolUse", { ...payloads.PreToolUse, tool_name: 7 }), "PreToolUse", /tool_name/));
  test("an envelope the contract refuses still yields one hook.error", () => {
    const events = claudeHarness.normalize({ hook: "Stop", payload: payloads.Stop, env: {}, at: "yesterday", run_id: RUN, seq: 0 });
    expect(events).toHaveLength(1);
    expect(events[0]?.type).toBe("hook.error");
  });
});
