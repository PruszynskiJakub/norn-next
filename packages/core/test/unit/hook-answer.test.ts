import { describe, expect, test } from "bun:test";
import type { HookFact, UnitState, UnitStateRecord } from "@norn/schema";
import type { AgentUnit } from "../../src/agent-unit.ts";
import { HARD_RULES, ruleWithReason } from "../../src/hard-rules.ts";
import type { NumberedReceipt } from "../../src/facts.ts";
import { type HookAnswerInput, hookAnswer } from "../../src/hook.ts";
import { at, numbered, receipt, SLICE_WF, sliceUnit, STORY_WF, stateFor, storyUnit } from "../fixtures.ts";

const unit = sliceUnit("gh-1", "01", "a");
const RUN = { run_id: "01JRRRRRRRRRRRRRRRRRRRRRRR", step: "implement", attempt: 1, agent: "claude", started_at: at(), agent_session_id: "sess-A" } as NonNullable<UnitState["run"]>;
const CLAUDE = { name: "claude", tier: "blocking" as const, hookEvents: { Stop: "turn_end", Notification: "waiting_input", PreToolUse: "tool_use" } as const };
const STOP: HookFact = { event: "turn_end", at: at(), agent: "claude", native: "Stop", cwd: "/repo/.worktrees/gh-1", agent_session_id: "sess-A" };

function session(patch: Partial<UnitStateRecord> = { status: "running", run: RUN }, receipts: NumberedReceipt[] = []): AgentUnit {
  return { unit, state: stateFor(unit, SLICE_WF, patch), workflow: SLICE_WF, receipts, unapplied: [] };
}

const ask = (input: Partial<HookAnswerInput>) => hookAnswer({ session: session(), fact: STOP, toolCall: null, adapter: CLAUDE, ...input });

describe("hookAnswer: the turn-end block", () => {
  test("an unreported turn end of an unattended agent step is blocked, naming the outcomes it can report", () => {
    expect(ask({})).toEqual({
      kind: "block",
      reason:
        "norn: step implement of gh-1/01 has no report for this run. Before ending your turn, report exactly once: " +
        '`norn done <done> --handoff "…"`, `norn ask "<question>"` or `norn stuck "<reason>"`. Run `norn brief` to see what each outcome means.',
    });
    const review = { ...RUN, step: "review" };
    const answer = ask({ session: session({ step: "review", status: "running", run: review }) });
    expect(answer.kind === "block" && answer.reason).toContain('`norn done <approve|changes_requested> --handoff "…"`');
  });

  test("a ready unit whose run has started but is not yet applied is held too", () => {
    const st = stateFor(unit, SLICE_WF);
    const started = numbered(1, receipt({ ...st, run: RUN }, "started", { agent_session_id: "sess-A" }));
    const s: AgentUnit = { unit, state: st, workflow: SLICE_WF, receipts: [started], unapplied: [started] };
    expect(ask({ session: s }).kind).toBe("block");
  });

  test("attended steps never block", () => {
    const story = storyUnit("gh-2");
    const s: AgentUnit = { unit: story, state: stateFor(story, STORY_WF, { step: "refine", status: "running", run: { ...RUN, step: "refine" } }), workflow: STORY_WF, receipts: [], unapplied: [] };
    expect(ask({ session: s })).toEqual({ kind: "allow" });
  });

  test("outside a loadable unit, at a non-agent step or a unit not running, it allows", () => {
    expect(ask({ session: null })).toEqual({ kind: "allow" });
    expect(ask({ session: session({ step: "test", status: "running", run: RUN }) })).toEqual({ kind: "allow" });
    expect(ask({ session: session({ status: "stuck", run: RUN }) })).toEqual({ kind: "allow" });
    expect(ask({ session: session({ status: "running" }) })).toEqual({ kind: "allow" }); // no live run
  });

  test("a fact of another run or another agent session is not held to the run", () => {
    expect(ask({ fact: { ...STOP, run_id: "01JXXXXXXXXXXXXXXXXXXXXXXX" } })).toEqual({ kind: "allow" });
    expect(ask({ fact: { ...STOP, agent_session_id: "sess-B" } })).toEqual({ kind: "allow" });
  });

  test("a run that already reported is not blocked", () => {
    const st = stateFor(unit, SLICE_WF, { status: "running", run: RUN });
    const done = numbered(1, receipt(st, "done", { outcome: "done" }));
    expect(ask({ session: session({ status: "running", run: RUN }, [done]) })).toEqual({ kind: "allow" });
  });

  test("only a turn end the adapter's own turn-end hook raised can be blocked", () => {
    expect(ask({ fact: { ...STOP, native: "Notification" } })).toEqual({ kind: "allow" }); // idle_prompt turn end
    expect(ask({ fact: { ...STOP, event: "tool_use", native: "PreToolUse" } })).toEqual({ kind: "allow" });
    expect(ask({ fact: { ...STOP, agent: "codex" } })).toEqual({ kind: "allow" });
    expect(ask({ adapter: { ...CLAUDE, tier: "hooks" } })).toEqual({ kind: "allow" });
  });
});

const SESSION_START: HookFact = { event: "session_start", at: at(), agent: "claude", native: "SessionStart", cwd: "/repo/.worktrees/gh-1", message: "compact" };
const PROMPT: HookFact = { event: "turn_start", at: at(), agent: "claude", native: "UserPromptSubmit", cwd: "/repo/.worktrees/gh-1", message: "go on" };
const attendedSession = (): AgentUnit => {
  const story = storyUnit("gh-2");
  return { unit: story, state: stateFor(story, STORY_WF, { step: "refine", status: "running", run: { ...RUN, step: "refine" } }), workflow: STORY_WF, receipts: [], unapplied: [] };
};
const contextOf = (a: ReturnType<typeof hookAnswer>): string => (a.kind === "context" ? a.text : "");

describe("hookAnswer: the session-start note", () => {
  test.each(["compact", "resume", "clear"])("a session started from %s is re-oriented: unit, step, outcomes, every hard rule with its reason", (source) => {
    const text = contextOf(ask({ fact: { ...SESSION_START, message: source } }));
    expect(text).toContain("gh-1/01");
    expect(text).toContain("step implement");
    expect(text).toContain('`norn done <done> --handoff "…"`');
    expect(text).toContain('`norn ask "<question>"`');
    expect(text).toContain('`norn stuck "<reason>"`');
    for (const r of HARD_RULES) expect(text).toContain(ruleWithReason(r.id));
    expect(text).toContain("Run `norn brief` for the rest.");
  });

  test("Codex's and Gemini's session starts from resume or clear are re-oriented the same way", () => {
    for (const agent of ["codex", "gemini"]) expect(contextOf(ask({ fact: { ...SESSION_START, agent, message: "resume" } }))).toContain("step implement of gh-1/01");
    expect(contextOf(ask({ fact: { ...SESSION_START, agent: "gemini", message: "clear" } }))).toContain("Run `norn brief` for the rest.");
  });

  test("a review step's note names the outcomes it can report", () => {
    const text = contextOf(ask({ session: session({ step: "review", status: "running", run: { ...RUN, step: "review" } }), fact: SESSION_START }));
    expect(text).toContain('`norn done <approve|changes_requested> --handoff "…"`');
  });

  test("an attended step is re-oriented too", () => {
    const text = contextOf(ask({ session: attendedSession(), fact: SESSION_START }));
    expect(text).toContain("step refine of gh-2");
    expect(text).not.toContain("`norn ask \"<question>\"`");
    expect(text).toContain("ask in this session rather than with `norn ask`");
  });

  test("start-up, an unknown source, no loadable unit or a cursor not at an agent step add nothing", () => {
    expect(ask({ fact: { ...SESSION_START, message: "startup" } })).toEqual({ kind: "allow" });
    expect(ask({ fact: { ...SESSION_START, message: undefined } })).toEqual({ kind: "allow" });
    expect(ask({ session: null, fact: SESSION_START })).toEqual({ kind: "allow" });
    expect(ask({ session: session({ step: "test", status: "running" }), fact: SESSION_START })).toEqual({ kind: "allow" });
    expect(ask({ session: session({ step: "$done", status: "done" }), fact: SESSION_START })).toEqual({ kind: "allow" });
  });
});

describe("hookAnswer: the attended reminder", () => {
  test("each prompt in an attended agent step carries one line: done once the person agrees, ask here", () => {
    const text = contextOf(ask({ session: attendedSession(), fact: PROMPT }));
    expect(text.split("\n")).toHaveLength(1);
    expect(text).toContain("`norn done`");
    expect(text).toContain("the person agrees the work is finished");
    expect(text).toContain("ask in this session rather than with `norn ask`");
  });

  test("an unattended step, no loadable unit or a non-agent step add no line", () => {
    expect(ask({ fact: PROMPT })).toEqual({ kind: "allow" });
    expect(ask({ session: null, fact: PROMPT })).toEqual({ kind: "allow" });
    expect(ask({ session: session({ step: "test", status: "running" }), fact: PROMPT })).toEqual({ kind: "allow" });
  });
});
