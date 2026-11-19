import { describe, expect, test } from "bun:test";
import type { HarnessEvent } from "@norn/plugin-api";
import { classifySession, reduceSession, type SessionActivity } from "../../src/index.ts";
import { BRIEF, type Body, START, iso, stream } from "./support.ts";

const SILENT_AFTER = 60_000;
const opts = { silentAfterMs: SILENT_AFTER };

/** Classify the stream `secs` seconds after its first event. */
function at(events: HarnessEvent[], secs: number) {
  return classifySession(reduceSession(events), iso(secs), opts);
}

const shell = (id: string) => ({ type: "tool.requested", id, kind: "shell", tool: "Bash" }) as const;
const ask: Body = { type: "input.requested", id: "q1", question: "Which one?", options: ["a", "b"] };
const perm = { type: "tool.permission", id: "t1", prompt: "Allow?" } as const;
const bg = { type: "subagent.started", id: "a1", background: true } as const;

describe("classifySession: each activity", () => {
  const cases: Array<[SessionActivity, HarnessEvent[]]> = [
    ["starting", stream(START)],
    ["working", stream(START, BRIEF)],
    ["awaiting_tools", stream(START, BRIEF, shell("t1"))],
    ["awaiting_subagents", stream(START, BRIEF, bg)],
    ["asking", stream(START, BRIEF, ask)],
    ["permission", stream(START, BRIEF, shell("t1"), perm)],
    ["limited", stream(START, BRIEF, { type: "limit.hit", kind: "usage" })],
    ["turn_ended", stream(START, BRIEF, { type: "turn.ended" })],
    ["reported", stream(START, BRIEF, { type: "report.made", verb: "done" })],
    ["ended", stream(START, BRIEF, { type: "session.ended", reason: "exit" })],
  ];
  test.each(cases)("%s", (activity, events) => {
    expect(at(events, 5).activity).toBe(activity);
  });

  test("no events at all is starting and never silent", () => {
    const f = classifySession(reduceSession([]), iso(10_000), opts);
    expect(f).toEqual({ activity: "starting", silent: false, pending_tools: 0, subagents: 0, pane_answers: 0, errors: [] });
  });
});

describe("classifySession: priority", () => {
  // each step adds the reason that outranks everything before it
  const ladder: Array<[SessionActivity, Body]> = [
    ["working", BRIEF],
    ["turn_ended", { type: "turn.ended" }],
    ["awaiting_tools", shell("t1")],
    ["awaiting_subagents", bg],
    ["asking", ask],
    ["permission", perm],
    ["limited", { type: "limit.hit", kind: "usage", resets_at: iso(3600) }],
    ["reported", { type: "report.made", verb: "ask" }],
    ["ended", { type: "session.ended", reason: "exit" }],
  ];

  test("ended > reported > limited > permission > asking > awaiting_subagents > awaiting_tools > turn_ended > working > starting", () => {
    const bodies: Body[] = [START];
    expect(at(stream(...bodies), 1).activity).toBe("starting");
    for (const [activity, body] of ladder) {
      bodies.push(body);
      expect({ activity: at(stream(...bodies), 30).activity, after: body }).toEqual({ activity, after: body });
    }
  });

  test("a turn end hides nothing held by a background subagent", () => {
    expect(at(stream(START, BRIEF, bg, { type: "turn.ended" }), 5).activity).toBe("awaiting_subagents");
  });
});

describe("classifySession: silence", () => {
  test("a working agent quiet past the threshold is silent", () => {
    const events = stream(START, BRIEF);
    expect(at(events, 1 + 60).silent).toBe(false);
    expect(at(events, 1 + 61).silent).toBe(true);
  });

  test("the newest event's time goes with the facts, so a workflow's own window can judge silence", () => {
    const events = stream(START, BRIEF, shell("t1"), { type: "tool.finished", id: "t1", ok: true });
    expect(at(events, 10).last_event_at).toBe(iso(3));
    expect(at([], 10).last_event_at).toBeUndefined();
  });

  test("silence counts from the newest event", () => {
    const events = stream(START, BRIEF, shell("t1"), { type: "tool.finished", id: "t1", ok: true });
    expect(at(events, 3 + 59).silent).toBe(false);
    expect(at(events, 3 + 61)).toMatchObject({ activity: "working", silent: true });
  });

  test("a long tool call is never silent", () => {
    const f = at(stream(START, BRIEF, shell("t1")), 10_000);
    expect(f).toMatchObject({ activity: "awaiting_tools", silent: false, pending_tools: 1 });
  });

  test("background subagents are never silent, before or after the turn ends", () => {
    expect(at(stream(START, BRIEF, bg), 10_000)).toMatchObject({ activity: "awaiting_subagents", silent: false, subagents: 1 });
    expect(at(stream(START, BRIEF, bg, { type: "turn.ended" }), 10_000)).toMatchObject({ activity: "awaiting_subagents", silent: false });
  });

  test("once the background subagent reports back the agent can fall silent again", () => {
    const events = stream(START, BRIEF, bg, { type: "turn.ended" }, { type: "subagent.finished", id: "a1" }, { type: "turn.started", source: "brief" });
    expect(at(events, 5 + 61)).toMatchObject({ activity: "working", silent: true, subagents: 0 });
  });

  test.each([
    ["starting", stream(START)],
    ["asking", stream(START, BRIEF, ask)],
    ["permission", stream(START, BRIEF, shell("t1"), perm)],
    ["limited", stream(START, BRIEF, { type: "limit.hit", kind: "usage" })],
    ["turn_ended", stream(START, BRIEF, { type: "turn.ended" })],
    ["reported", stream(START, BRIEF, { type: "report.made", verb: "done" })],
    ["ended", stream(START, BRIEF, { type: "session.ended", reason: "exit" })],
  ] as const)("%s is never silent", (activity, events) => {
    expect(at([...events], 10_000)).toMatchObject({ activity, silent: false });
  });
});

describe("classifySession: limits", () => {
  const hit = (resets_at?: string): Body => (resets_at ? { type: "limit.hit", kind: "usage", resets_at } : { type: "limit.hit", kind: "rate" });

  test("with a reset time: limited until it, then the activity underneath", () => {
    const events = stream(START, BRIEF, hit(iso(600)), { type: "turn.ended" });
    expect(at(events, 599)).toMatchObject({ activity: "limited", limit: { kind: "usage", resets_at: iso(600) } });
    const after = at(events, 600);
    expect(after.activity).toBe("turn_ended");
    expect(after.limit).toBeUndefined();
  });

  test("without a reset time: limited while nothing follows but passive events", () => {
    expect(at(stream(START, BRIEF, hit()), 10_000)).toMatchObject({ activity: "limited", limit: { kind: "rate" }, silent: false });
    expect(at(stream(START, BRIEF, hit(), { type: "turn.ended" }), 10_000).activity).toBe("limited");
  });

  test("without a reset time: activity after the limit ends it", () => {
    expect(at(stream(START, BRIEF, hit(), { type: "turn.started", source: "nudge" }), 5).activity).toBe("working");
    expect(at(stream(START, BRIEF, hit(), shell("t2")), 5).activity).toBe("awaiting_tools");
  });

  test("a limit then activity is not limited even before its reset time", () => {
    expect(at(stream(START, BRIEF, hit(iso(3600)), shell("t2")), 5).activity).toBe("awaiting_tools");
  });

  test("a limit read out of order still holds", () => {
    const events = stream(START, BRIEF, shell("t1"), hit());
    expect(at([events[3], events[0], events[2], events[1]] as HarnessEvent[], 5).activity).toBe("limited");
  });
});

describe("classifySession: asks", () => {
  test("the ask carries the input request's id, question and options", () => {
    expect(at(stream(START, BRIEF, ask), 5).ask).toEqual({ id: "q1", question: "Which one?", options: ["a", "b"] });
  });

  test("the ask id is stable across ticks, repeats and parallel tool calls", () => {
    const base: Body[] = [START, BRIEF, { type: "tool.requested", id: "q1", kind: "ask", tool: "AskUserQuestion" }, ask];
    const ids = new Set<string | undefined>();
    for (const extra of [[], [ask], [shell("p1"), shell("p2")], [shell("p1"), ask, { type: "tool.finished", id: "p1", ok: true }]] as Body[][]) {
      const events = stream(...base, ...extra);
      for (const secs of [5, 50, 500]) ids.add(at(events, secs).ask?.id);
      ids.add(at([...events, ...events], 5).ask?.id);
    }
    expect([...ids]).toEqual(["q1"]);
  });

  test("an answer in the pane closes the ask and counts as a pane answer", () => {
    const f = at(stream(START, BRIEF, ask, { type: "turn.started", source: "person" }, { type: "input.received", by: "pane" }), 5);
    expect(f).toMatchObject({ activity: "working", pane_answers: 1 });
    expect(f.ask).toBeUndefined();
  });
});

describe("classifySession: the rest of the facts", () => {
  test("carries the report, last message, counts and hook error messages", () => {
    const f = at(
      stream(
        START,
        BRIEF,
        { type: "hook.error", hook: "PreToolUse", message: "bad payload" },
        { type: "hook.error", hook: "Stop", message: "timeout" },
        { type: "input.received", by: "pane" },
        { type: "turn.ended", last_message: "here it is" },
        { type: "report.made", verb: "done", outcome: "approve" },
      ),
      10,
    );
    expect(f).toEqual({
      activity: "reported",
      silent: false,
      report: { verb: "done", outcome: "approve" },
      last_message: "here it is",
      last_event_at: iso(6),
      pending_tools: 0,
      subagents: 0,
      pane_answers: 1,
      errors: ["bad payload", "timeout"],
    });
  });

  test("the permission carries its id, prompt and the call it asks about", () => {
    expect(at(stream(START, BRIEF, shell("t1"), perm), 5).permission).toEqual({ id: "t1", prompt: "Allow?", call: { id: "t1", tool: "Bash" } });
  });

  test("classifying never changes the view", () => {
    const view = reduceSession(stream(START, BRIEF, ask, { type: "limit.hit", kind: "usage", resets_at: iso(60) }));
    const copy = structuredClone(view);
    const f = classifySession(view, iso(5), opts);
    f.ask?.options?.push("c");
    expect(view).toEqual(copy);
  });
});
