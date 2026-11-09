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

describe("hookAnswer: file-tool writes under run state", () => {
  const RUNS = "/home/me/.norn/repos/abc/runs";
  const PRE: HookFact = { ...STOP, event: "tool_use", native: "PreToolUse" };
  const write = (...paths: string[]): Partial<HookAnswerInput> => ({ fact: PRE, toolCall: { kind: "file_write", paths }, fileWrite: { paths, runStateDir: RUNS } });
  const REASON = "a hand-edited file fails validation and makes the unit `corrupt`";

  test("a write resolving under the checkout's runs/ folder, this unit's or another's, is denied with the corrupt reason", () => {
    for (const p of [`${RUNS}/gh-1/01-a/state.json`, `${RUNS}/gh-7/_story/receipts/0001.json`, `${RUNS}/new.json`]) {
      const answer = ask(write("/repo/.worktrees/gh-1/src/a.ts", p));
      expect(answer.kind).toBe("deny");
      expect(answer.kind === "deny" && answer.reason).toContain(REASON);
      expect(answer.kind === "deny" && answer.reason).toContain(p);
    }
  });

  test("it is denied in attended steps too, and every time it is retried", () => {
    const story = storyUnit("gh-2");
    const s: AgentUnit = { unit: story, state: stateFor(story, STORY_WF, { step: "refine", status: "running", run: { ...RUN, step: "refine" } }), workflow: STORY_WF, receipts: [], unapplied: [] };
    const input = { session: s, ...write(`${RUNS}/gh-2/_story/state.json`) };
    expect(ask(input).kind).toBe("deny");
    expect(ask(input).kind).toBe("deny");
  });

  test("a write elsewhere, or beside the folder under a name that only starts like it, is allowed", () => {
    expect(ask(write("/repo/.worktrees/gh-1/src/a.ts"))).toEqual({ kind: "allow" });
    expect(ask(write(`${RUNS}-old/state.json`, "/home/me/.norn/repos/abc/heartbeat.json"))).toEqual({ kind: "allow" });
  });

  test("a read or a shell command under run state is not inspected", () => {
    expect(ask({ fact: PRE, toolCall: null })).toEqual({ kind: "allow" });
    expect(ask({ fact: PRE, toolCall: { kind: "shell", command: `echo x > ${RUNS}/gh-1/01-a/state.json` } })).toEqual({ kind: "allow" });
  });

  test("outside a loadable unit it allows", () => {
    expect(ask({ session: null, ...write(`${RUNS}/gh-1/01-a/state.json`) })).toEqual({ kind: "allow" });
  });
});
