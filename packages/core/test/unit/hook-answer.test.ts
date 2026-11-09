import { describe, expect, test } from "bun:test";
import type { HookFact, UnitState, UnitStateRecord } from "@norn/schema";
import type { AgentUnit } from "../../src/agent-unit.ts";
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
