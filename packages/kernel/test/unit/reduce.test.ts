import { describe, expect, test } from "bun:test";
import { reduceSession } from "../../src/index.ts";
import { BRIEF, type Body, START, iso, stream } from "./support.ts";

describe("reduceSession", () => {
  test("no events is an empty, inactive view", () => {
    expect(reduceSession([])).toEqual({
      active: false,
      pending_tools: [],
      subagents: [],
      turn_ended: false,
      compactions: 0,
      pane_answers: 0,
      errors: [],
    });
  });

  test("tracks the harness session and the newest event time", () => {
    const v = reduceSession(stream(START, BRIEF));
    expect(v.harness_session).toBe("s-1");
    expect(v.active).toBe(true);
    expect(v.last_event_at).toBe(iso(1));
  });

  test("pending tools open on request and close on finish, by id", () => {
    const v = reduceSession(
      stream(
        START,
        BRIEF,
        { type: "tool.requested", id: "t1", kind: "shell", tool: "Bash" },
        { type: "tool.requested", id: "t2", kind: "write", tool: "Edit" },
        { type: "tool.finished", id: "t1", ok: false },
      ),
    );
    expect(v.pending_tools).toEqual([{ id: "t2", kind: "write" }]);
  });

  test("a finish for an unknown id is ignored", () => {
    const v = reduceSession(
      stream(
        BRIEF,
        { type: "tool.requested", id: "t1", kind: "shell", tool: "Bash" },
        { type: "tool.finished", id: "nope", ok: true },
        { type: "subagent.started", id: "a1", background: true },
        { type: "subagent.finished", id: "nope" },
      ),
    );
    expect(v.pending_tools).toEqual([{ id: "t1", kind: "shell" }]);
    expect(v.subagents).toEqual([{ id: "a1", background: true }]);
  });

  test("a finished tool never reopens when its request is replayed under a new seq", () => {
    const v = reduceSession(
      stream(
        BRIEF,
        { type: "tool.requested", id: "t1", kind: "shell", tool: "Bash" },
        { type: "tool.finished", id: "t1", ok: true },
        { type: "tool.requested", id: "t1", kind: "shell", tool: "Bash" },
      ),
    );
    expect(v.pending_tools).toEqual([]);
  });

  test("events are applied in seq order, whatever order they arrive in", () => {
    const events = stream(
      BRIEF,
      { type: "tool.requested", id: "t1", kind: "shell", tool: "Bash" },
      { type: "tool.finished", id: "t1", ok: true },
      { type: "turn.ended", last_message: "all done" },
    );
    const shuffled = [events[3], events[1], events[0], events[2]].filter((e) => e !== undefined);
    expect(reduceSession(shuffled)).toEqual(reduceSession(events));
    expect(reduceSession(shuffled).last_event_at).toBe(iso(3));
  });

  test("a repeated seq keeps only its first event", () => {
    const events = stream(BRIEF, { type: "context.compacted" }, { type: "hook.error", hook: "Stop", message: "boom" });
    const dup = [...events, ...events];
    const v = reduceSession(dup);
    expect(v.compactions).toBe(1);
    expect(v.errors).toEqual([{ hook: "Stop", message: "boom" }]);
  });

  test("subagents are tracked with their background flag", () => {
    const v = reduceSession(
      stream(
        BRIEF,
        { type: "subagent.started", id: "a1", background: true },
        { type: "subagent.started", id: "a2", background: false },
        { type: "subagent.finished", id: "a2" },
      ),
    );
    expect(v.subagents).toEqual([{ id: "a1", background: true }]);
  });

  test("a turn end drops calls and foreground subagents whose finish never came, keeps background ones", () => {
    const v = reduceSession(
      stream(
        BRIEF,
        { type: "tool.requested", id: "t1", kind: "shell", tool: "Bash" },
        { type: "subagent.started", id: "fg", background: false },
        { type: "subagent.started", id: "bg", background: true },
        { type: "turn.ended" },
      ),
    );
    expect(v.pending_tools).toEqual([]);
    expect(v.subagents).toEqual([{ id: "bg", background: true }]);
    expect(v.turn_ended).toBe(true);
  });

  test("turn_ended clears on a new turn or later tool activity, not on a late finish", () => {
    const ended = stream(BRIEF, { type: "tool.requested", id: "t1", kind: "shell", tool: "Bash" }, { type: "turn.ended" });
    expect(reduceSession(ended).turn_ended).toBe(true);
    expect(reduceSession(stream(BRIEF, { type: "turn.ended" }, { type: "turn.started", source: "nudge" })).turn_ended).toBe(false);
    expect(reduceSession(stream(BRIEF, { type: "turn.ended" }, { type: "tool.requested", id: "t2", kind: "other", tool: "Glob" })).turn_ended).toBe(false);
    expect(reduceSession(stream(BRIEF, { type: "turn.ended" }, { type: "subagent.started", id: "a", background: true })).turn_ended).toBe(false);
    expect(reduceSession(stream(BRIEF, { type: "turn.ended" }, { type: "tool.finished", id: "t1", ok: true })).turn_ended).toBe(true);
  });

  test("last_message keeps the newest one a turn end carried", () => {
    const v = reduceSession(stream(BRIEF, { type: "turn.ended", last_message: "first" }, BRIEF, { type: "turn.ended" }));
    expect(v.last_message).toBe("first");
    expect(reduceSession(stream(BRIEF, { type: "turn.ended", last_message: "a" }, BRIEF, { type: "turn.ended", last_message: "b" })).last_message).toBe("b");
  });

  test("the error a turn stopped on stays until a later turn ends without one", () => {
    const failed = { type: "turn.ended", last_message: "pi stopped on an error: overloaded", error: "pi stopped on an error: overloaded" } as const;
    expect(reduceSession(stream(BRIEF, failed)).error).toBe("pi stopped on an error: overloaded");
    expect(reduceSession(stream(BRIEF, failed, BRIEF, { type: "turn.ended", last_message: "fixed" })).error).toBeUndefined();
  });

  describe("input requests", () => {
    const ask = { type: "tool.requested", id: "q1", kind: "ask", tool: "AskUserQuestion" } as const;
    const input: Body = { type: "input.requested", id: "q1", question: "Which one?", options: ["a", "b"] };

    test("an ask tool alone opens no input; input.requested does", () => {
      expect(reduceSession(stream(BRIEF, ask)).input).toBeUndefined();
      expect(reduceSession(stream(BRIEF, ask, input)).input).toEqual({ id: "q1", question: "Which one?", options: ["a", "b"] });
    });

    test("an input received with its id closes it; another id does not", () => {
      expect(reduceSession(stream(BRIEF, ask, input, { type: "input.received", id: "q1", by: "norn" })).input).toBeUndefined();
      expect(reduceSession(stream(BRIEF, ask, input, { type: "input.received", id: "zz", by: "norn" })).input?.id).toBe("q1");
    });

    test("the ask tool finishing closes it", () => {
      expect(reduceSession(stream(BRIEF, ask, input, { type: "tool.finished", id: "q1", ok: true })).input).toBeUndefined();
    });

    test("an answer typed in the pane closes the open input and is counted", () => {
      const v = reduceSession(stream(BRIEF, ask, input, { type: "turn.started", source: "person" }, { type: "input.received", by: "pane" }));
      expect(v.input).toBeUndefined();
      expect(v.pane_answers).toBe(1);
    });

    test("pane answers are counted even with nothing open; norn's are not", () => {
      const v = reduceSession(stream(BRIEF, { type: "input.received", by: "pane" }, { type: "input.received", by: "norn" }, { type: "input.received", by: "pane" }));
      expect(v.pane_answers).toBe(2);
    });

    test("an answered input never reopens when its request is replayed", () => {
      const v = reduceSession(stream(BRIEF, ask, input, { type: "input.received", id: "q1", by: "norn" }, input));
      expect(v.input).toBeUndefined();
    });

    test("a repeated request keeps the same id", () => {
      const v = reduceSession(stream(BRIEF, ask, input, input, { type: "tool.requested", id: "t9", kind: "shell", tool: "Bash" }, input));
      expect(v.input?.id).toBe("q1");
    });

    test("an ask a tool call holds stays open while other calls run beside it", () => {
      const v = reduceSession(stream(BRIEF, ask, input, { type: "tool.requested", id: "t9", kind: "shell", tool: "Bash" }, { type: "tool.finished", id: "t9", ok: true }));
      expect(v.input?.id).toBe("q1");
    });
  });

  describe("an input no tool call holds (a dialog, a logged-out agent)", () => {
    const dialog: Body = { type: "input.requested", id: "input-1", question: "MCP server github requests input" };
    const mcp = { type: "tool.requested", id: "m1", kind: "other", tool: "mcp__github__create_issue" } as const;

    test("opens, and the call it was raised during finishing does not close it", () => {
      expect(reduceSession(stream(BRIEF, mcp, dialog)).input?.id).toBe("input-1");
    });

    test("closes when the agent requests another tool", () => {
      const v = reduceSession(stream(BRIEF, mcp, dialog, { type: "tool.finished", id: "m1", ok: true }, { type: "tool.requested", id: "t2", kind: "shell", tool: "Bash" }));
      expect(v.input).toBeUndefined();
      expect(v.pending_tools).toEqual([{ id: "t2", kind: "shell" }]);
    });

    test("closes when the turn ends", () => {
      expect(reduceSession(stream(BRIEF, mcp, dialog, { type: "tool.finished", id: "m1", ok: true }, { type: "turn.ended" })).input).toBeUndefined();
    });

    test.each(["brief", "nudge", "answer", "person"] as const)("closes when a turn starts from %s", (source) => {
      const login: Body = { type: "input.requested", id: "login-1", question: "agent logged out: run /login in the pane" };
      expect(reduceSession(stream(BRIEF, login, { type: "turn.started", source })).input).toBeUndefined();
    });

    test("closes on an answer with no id, counted when it came from the pane", () => {
      const v = reduceSession(stream(BRIEF, mcp, dialog, { type: "input.received", by: "pane" }));
      expect(v.input).toBeUndefined();
      expect(v.pane_answers).toBe(1);
    });
  });

  describe("permissions", () => {
    const tool = { type: "tool.requested", id: "t1", kind: "shell", tool: "Bash" } as const;
    const perm = { type: "tool.permission", id: "t1", prompt: "Allow rm?" } as const;

    test("opens on tool.permission, naming the call it is about", () => {
      expect(reduceSession(stream(BRIEF, tool, perm)).permission).toEqual({ id: "t1", prompt: "Allow rm?", call: { id: "t1", tool: "Bash" } });
    });

    test("a call's detail is part of what it names, and a prompt with no call pending names none", () => {
      const rm = { type: "tool.requested", id: "t1", kind: "shell", tool: "Bash", detail: "rm -rf build" } as const;
      const unnamed = { type: "tool.permission", id: "perm-1a2b", prompt: "Allow Bash?" } as const;
      expect(reduceSession(stream(BRIEF, rm, unnamed)).permission).toEqual({ id: "perm-1a2b", prompt: "Allow Bash?", call: { id: "t1", tool: "Bash(rm -rf build)" } });
      expect(reduceSession(stream(BRIEF, unnamed)).permission).toEqual({ id: "perm-1a2b", prompt: "Allow Bash?" });
    });

    test("closes when its tool finishes", () => {
      expect(reduceSession(stream(BRIEF, tool, perm, { type: "tool.finished", id: "t1", ok: true })).permission).toBeUndefined();
    });

    test("another tool finishing leaves it open", () => {
      const v = reduceSession(stream(BRIEF, { type: "tool.requested", id: "t0", kind: "other", tool: "Read" }, tool, perm, { type: "tool.finished", id: "t0", ok: true }));
      expect(v.permission?.id).toBe("t1");
    });

    test("closes on a later request of another tool, not on a replay of its own", () => {
      expect(reduceSession(stream(BRIEF, tool, perm, { type: "tool.requested", id: "t2", kind: "other", tool: "Read" })).permission).toBeUndefined();
      expect(reduceSession(stream(BRIEF, tool, perm, tool)).permission?.id).toBe("t1");
    });

    describe("a prompt that names no pending call", () => {
      const read = { type: "tool.requested", id: "t0", kind: "other", tool: "Read" } as const;
      const unnamed = { type: "tool.permission", id: "perm-1a2b", prompt: "Allow Bash?" } as const;

      test("closes when the latest pending call runs", () => {
        expect(reduceSession(stream(BRIEF, read, tool, unnamed, { type: "tool.finished", id: "t1", ok: true })).permission).toBeUndefined();
      });

      test("an earlier parallel call finishing leaves it open", () => {
        expect(reduceSession(stream(BRIEF, read, tool, unnamed, { type: "tool.finished", id: "t0", ok: true })).permission?.id).toBe("perm-1a2b");
      });

      test("the binding ends with the prompt: the old call finishing does not close a newer prompt", () => {
        const second = { type: "tool.permission", id: "perm-3c4d", prompt: "Allow Write?" } as const;
        const write = { type: "tool.requested", id: "t2", kind: "write", tool: "Write" } as const;
        const v = reduceSession(stream(BRIEF, tool, unnamed, write, second, { type: "tool.finished", id: "t1", ok: true }));
        expect(v.permission?.id).toBe("perm-3c4d");
      });
    });

    test("closes on turn activity", () => {
      expect(reduceSession(stream(BRIEF, tool, perm, { type: "turn.ended" })).permission).toBeUndefined();
      expect(reduceSession(stream(BRIEF, tool, perm, { type: "turn.started", source: "person" })).permission).toBeUndefined();
    });
  });

  describe("limits", () => {
    test("records the kind and reset time", () => {
      const v = reduceSession(stream(BRIEF, { type: "limit.hit", kind: "usage", resets_at: iso(3600) }, { type: "turn.ended" }));
      expect(v.limit).toEqual({ kind: "usage", resets_at: iso(3600) });
    });

    test("is dropped once the agent acts again", () => {
      for (const after of [
        { type: "turn.started", source: "nudge" },
        { type: "tool.requested", id: "t1", kind: "shell", tool: "Bash" },
        { type: "subagent.started", id: "a1", background: false },
      ] as const)
        expect(reduceSession(stream(BRIEF, { type: "limit.hit", kind: "rate" }, after)).limit).toBeUndefined();
    });

    test("survives passive events after it", () => {
      const v = reduceSession(stream(BRIEF, { type: "limit.hit", kind: "rate" }, { type: "turn.ended" }, { type: "hook.error", hook: "Stop", message: "x" }));
      expect(v.limit).toEqual({ kind: "rate" });
    });
  });

  test("report, compactions, errors and end are recorded", () => {
    const v = reduceSession(
      stream(
        START,
        BRIEF,
        { type: "context.compacted" },
        { type: "context.compacted" },
        { type: "hook.error", hook: "PreToolUse", message: "bad payload" },
        { type: "report.made", verb: "done", outcome: "approve" },
        { type: "session.ended", reason: "exit" },
      ),
    );
    expect(v.compactions).toBe(2);
    expect(v.errors).toEqual([{ hook: "PreToolUse", message: "bad payload" }]);
    expect(v.report).toEqual({ verb: "done", outcome: "approve" });
    expect(v.ended).toBe("exit");
  });

  test("an answer received settles an ask report; any other report stands", () => {
    const answered = (verb: "ask" | "stuck") => reduceSession(stream(BRIEF, { type: "report.made", verb }, { type: "input.received", id: "a1", by: "norn" })).report;
    expect(answered("ask")).toBeUndefined();
    expect(answered("stuck")).toEqual({ verb: "stuck" });
  });

  test("a new turn clears a report; a resumed session clears its end", () => {
    expect(reduceSession(stream(BRIEF, { type: "report.made", verb: "stuck" }, { type: "turn.started", source: "nudge" })).report).toBeUndefined();
    expect(reduceSession(stream(START, { type: "session.ended", reason: "crash" }, START)).ended).toBeUndefined();
  });

  test("a session resumed after its turn ended and its process exited is not read as a turn ended before its prompt arrives", () => {
    const resumed = reduceSession(stream(START, BRIEF, { type: "report.made", verb: "ask" }, { type: "turn.ended" }, { type: "session.ended", reason: "exit" }, START));
    expect({ ended: resumed.ended, turn_ended: resumed.turn_ended }).toEqual({ ended: undefined, turn_ended: false });
  });

  test("an end drops every outstanding call and subagent", () => {
    const v = reduceSession(
      stream(BRIEF, { type: "tool.requested", id: "t1", kind: "shell", tool: "Bash" }, { type: "subagent.started", id: "a1", background: true }, { type: "session.ended", reason: "killed" }),
    );
    expect(v.pending_tools).toEqual([]);
    expect(v.subagents).toEqual([]);
  });
});
