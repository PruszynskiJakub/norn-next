/**
 * Prompts the agent is blocked on, and launch prompts that never arrive (SPEC-auto-mode-recovery):
 *   - R6.1: an implicit ask ends when the pane leaves `waiting_input` or a newer hook arrives —
 *     an `answer` receipt `by: "agent"`, nothing typed; explicit asks wait for the person
 *   - R6.2: answers to pane prompts become keystrokes (option number / arrows + enter)
 *   - R6.3, L1: the Answer item reads as the question block, first command line and options; the
 *     screen only as `full`; a failed delivery points at the pane
 *   - R9.1: SessionStart without a turn → one re-send after 60 s, `silent` 60 s later
 */
import { describe, expect, test } from "bun:test";
import type { HookFact, UnitState } from "@norn/schema";
import type { Action } from "../src/actions.ts";
import { applyReceipts } from "../src/apply.ts";
import { AUTO_PROMPT, NUDGE_TEXT } from "../src/commands.ts";
import { decide } from "../src/decide.ts";
import type { Facts, RunFacts, StoryFacts, UnitFacts } from "../src/facts.ts";
import { buildInbox } from "../src/inbox.ts";
import type { PanePrompt } from "../src/ports.ts";
import { optionIndex, promptKeys } from "../src/prompt.ts";
import { at, CONFIG, facts, numbered, receipt, SOLO_WF, stateFor, storyFacts, storyUnit, T0, unitFacts, WORKFLOWS } from "./fixtures.ts";

const RUN = "01JDDDDDDDDDDDDDDDDDDDDDDD";
const SCREEN = " │ rm -rf build\n╌╌╌╌╌╌╌╌╌╌\n Do you want to proceed?\n ❯ 1. Yes\n   2. No\n\n Esc to cancel";
const PROMPT: PanePrompt = { question: "Do you want to proceed?", command: "rm -rf build", options: ["Yes", "No"], choice: { numbered: true, cursor: 0 } };

const only = (f: Facts): Action => {
  const d = decide(f, WORKFLOWS, CONFIG).find((x) => x.unit === "gh-1");
  if (!d) throw new Error("no decision for gh-1");
  return d.action;
};
function solo(patch: Partial<UnitState>, run: Partial<RunFacts> | null, unit: Partial<UnitFacts> = {}): StoryFacts {
  const ref = storyUnit();
  const st = stateFor(ref, SOLO_WF, patch);
  const rf: RunFacts | null = run && { run_id: RUN, session: { runner: "herdr", session_id: "w1:p1", pane_id: "w1:p1" }, process_alive: true, pane: null, hooks: [], last_hook_at: null, last_activity_at: T0, transcript: null, ...run };
  return storyFacts("gh-1", [unitFacts(ref, SOLO_WF, st, { run: rf, ...unit })], { frontmatter: { ...storyFacts("gh-1", []).frontmatter!, workflow: "solo" } });
}
const runInfo = { run_id: RUN, step: "implement", attempt: 1, started_at: at(T0 - 5 * 60_000), how: "auto" as const, session: { runner: "herdr", session_id: "w1:p1", pane_id: "w1:p1", reach: "herdr agent attach w1:p1" }, agent: "claude" };
const running = (p: Partial<UnitState> = {}): Partial<UnitState> => ({ status: "running", run: runInfo, updated_at: at(T0 - 5 * 60_000), ...p });
const hook = (event: HookFact["event"], ms: number): HookFact => ({ event, at: at(ms), agent: "claude", native: event, cwd: "/r-worktrees/gh-1-login", run_id: RUN });
const withCaps = (f: Facts, send: boolean): Facts => ({ ...f, machine: { ...f.machine, runner: send ? "herdr" : "headless", runner_capabilities: { send, resume: true } } });

/** The state an implicit ask parks the unit in (decide → apply of its ask receipt). */
function parkedOnPrompt(): UnitState {
  const a = only(facts([solo(running(), { pane: { alive: true, state: "waiting_input", since: null, detail: SCREEN, prompt: PROMPT } })]));
  if (a.kind !== "park" || !a.state) throw new Error(`expected park, got ${a.kind}`);
  return a.state;
}

describe("R6.2: answers become the keys a prompt expects", () => {
  test("numbered menu: option number + enter, by number or by label", () => {
    expect(promptKeys(PROMPT, "2")).toEqual({ keys: [{ text: "2" }, { key: "enter" }], option: 1 });
    expect(promptKeys(PROMPT, "yes")).toEqual({ keys: [{ text: "1" }, { key: "enter" }], option: 0 });
  });
  test("unnumbered menu: arrows from the cursor + enter", () => {
    const trust = { options: ["No, exit", "Yes, I trust this folder"], choice: { numbered: false, cursor: 0 } };
    expect(promptKeys(trust, "2").keys).toEqual([{ key: "down" }, { key: "enter" }]);
    expect(promptKeys({ ...trust, choice: { numbered: false, cursor: 1 } }, "No, exit").keys).toEqual([{ key: "up" }, { key: "enter" }]);
  });
  test("no option named (or no options): the text + enter", () => {
    expect(promptKeys(PROMPT, "use bun instead").keys).toEqual([{ text: "use bun instead" }, { key: "enter" }]);
    expect(promptKeys({}, "y").keys).toEqual([{ text: "y" }, { key: "enter" }]);
    expect(optionIndex(["Yes", "Yes, always", "No"], "yes, al")).toBe(1);
    expect(optionIndex(["Yes", "Yes, always"], "ye")).toBeNull(); // ambiguous prefix
    expect(optionIndex(["Yes"], "3")).toBeNull();
  });
});

describe("§10 implicit ask from a pane prompt (L1, R6.2)", () => {
  test("parks with the question block, first command line, options, choice and the screen", () => {
    const st = parkedOnPrompt();
    expect(st.park).toMatchObject({ kind: "ask", reason: "Do you want to proceed?", command: "rm -rf build", implicit: "pane", options: ["Yes", "No"], choice: { numbered: true, cursor: 0 }, screen: SCREEN });
  });

  test("the Answer item is readable; the screen only as `full`", () => {
    const st = parkedOnPrompt();
    const item = buildInbox(facts([solo(st, {})]), CONFIG).groups.answer[0];
    expect(item).toMatchObject({ title: "Do you want to proceed?", detail: "pending command: rm -rf build · options: 1. Yes · 2. No — answer with the number", command: 'norn answer gh-1 "…"', full: SCREEN });
  });

  test("R6.3: an answer that did not reach the pane: the item says so and names how to reach it", () => {
    const st = parkedOnPrompt();
    const failure = { effect: "answer", rule: "answer.keys", reason: "answer to gh-1 not delivered: pane gone", at: at(T0 + 1000), tick_id: RUN, step: "implement", attempt: 1, session: { runner: "herdr", session_id: "w1:p1", pane_id: "w1:p1" } };
    const inbox = buildInbox(facts([solo(st, {}, { act_failure: failure })], {}, T0 + 2000), CONFIG);
    expect(inbox.groups.answer[0]).toMatchObject({ command: "herdr agent attach w1:p1", detail: expect.stringContaining("not delivered: answer to gh-1 not delivered: pane gone") });
    expect(inbox.groups.unblock).toEqual([]);
  });

  test("a person's answer is typed as the prompt's keys (SessionInput.keys)", () => {
    const st = parkedOnPrompt();
    const answer = numbered(st.applied_through + 1, receipt(st, "answer", { answer: "2" }, "human"));
    const a = only(withCaps(facts([solo(st, {}, { unapplied: [answer] })]), true));
    expect(a).toMatchObject({ kind: "apply_receipts", input: { session: { pane_id: "w1:p1" }, text: "2", keys: [{ text: "2" }, { key: "enter" }] }, state: { status: "running", park: null } });
  });
});

describe("R6.1: an implicit ask resolved by a later fact", () => {
  test("the pane no longer waits for input → answer by agent, the run goes on, nothing typed", () => {
    const st = parkedOnPrompt();
    const a = only(facts([solo(st, { pane: { alive: true, state: "working", since: null } })], {}, T0 + 60_000));
    expect(a).toMatchObject({ kind: "apply_receipts", rule: "agent.ask.implicit.resolved", input: null, launch: null, state: { status: "running", park: null } });
    if (a.kind !== "apply_receipts") return;
    expect(a.receipts[0]?.receipt).toMatchObject({ kind: "answer", by: "agent", ask_receipt_id: st.park?.receipt_id, answer: expect.stringContaining("no longer waits for input") });
  });

  test("a newer hook for the run (not another wait) resolves it; a newer wait does not", () => {
    const st = parkedOnPrompt();
    const waiting = { pane: { alive: true, state: "waiting_input" as const, since: null, prompt: PROMPT } };
    expect(only(facts([solo(st, { ...waiting, hooks: [hook("permission_prompt", T0 + 10_000)] })], {}, T0 + 60_000))).toMatchObject({ kind: "noop", rule: "unit.parked.ask" });
    expect(only(facts([solo(st, { ...waiting, hooks: [hook("tool_use", T0 + 10_000)] })], {}, T0 + 60_000))).toMatchObject({ kind: "apply_receipts", rule: "agent.ask.implicit.resolved" });
  });

  test("an explicit `norn ask` is never resolved by facts", () => {
    const st0 = stateFor(storyUnit(), SOLO_WF, running());
    const ask = numbered(1, receipt(st0, "ask", { question: "which db?" }));
    const st = applyReceipts(st0, [ask], { workflow: SOLO_WF, now: at(), limits: CONFIG.limits }).state;
    expect(st.park?.implicit).toBeUndefined();
    const a = only(facts([solo(st, { pane: { alive: true, state: "working", since: null }, hooks: [hook("tool_use", T0 + 10_000)] })], {}, T0 + 60_000));
    expect(a).toMatchObject({ kind: "noop", rule: "unit.parked.ask" });
  });

  test("apply: an agent's answer and an answer `norn answer` already typed are never delivered again", () => {
    const st = parkedOnPrompt();
    const ctx = { workflow: SOLO_WF, now: at(T0 + 1000), limits: CONFIG.limits };
    const byAgent = applyReceipts(st, [numbered(st.applied_through + 1, receipt(st, "answer", { answer: "moved on" }, "agent"))], ctx);
    expect(byAgent).toMatchObject({ deliver: null, state: { status: "running", park: null } });
    const typed = applyReceipts(st, [numbered(st.applied_through + 1, receipt(st, "answer", { answer: "1", delivered: true }, "human"))], ctx);
    expect(typed).toMatchObject({ deliver: null, state: { status: "running" } });
  });
});

describe("R9.1: launch prompt not received", () => {
  const started = (ms: number) => ({ hooks: [hook("session_start", ms)], last_hook_at: ms });

  test("SessionStart and no turn for 60 s → the launch prompt is typed again, once (not counted)", () => {
    expect(only(withCaps(facts([solo(running(), started(T0 - 30_000))]), true))).toMatchObject({ kind: "noop", rule: "agent.running" });
    const a = only(withCaps(facts([solo(running(), started(T0 - 61_000))]), true));
    expect(a).toMatchObject({ kind: "nudge", rule: "agent.launch_prompt.resend", input: { text: AUTO_PROMPT, session: { pane_id: "w1:p1" } }, receipts: [], state: { nudges_used: 0, run: { prompt_resent_at: at(T0) } } });
  });

  test("still nothing 60 s after the re-send → silent with the launch rule, then the inbox names the pane", () => {
    const resent = running({ run: { ...runInfo, prompt_resent_at: at(T0 - 61_000) } });
    const a = only(withCaps(facts([solo(resent, started(T0 - 122_000))]), true));
    expect(a).toMatchObject({ kind: "nudge", rule: "agent.silent.launch_prompt.nudge", input: { text: NUDGE_TEXT } });
    if (a.kind !== "nudge" || !a.state) return;
    expect(a.receipts[0]?.receipt).toMatchObject({ kind: "classify", outcome: "silent", rule: "agent.silent.launch_prompt", detail: "launch prompt not received" });
    const inbox = buildInbox(withCaps(facts([solo(a.state, started(T0 - 122_000))]), true), CONFIG);
    expect(inbox.groups.unblock[0]).toMatchObject({ title: "launch prompt not received by gh-1 implement — look at pane w1:p1", command: "herdr agent attach w1:p1" });
    // a turn arrives: the item goes away and the run is just running
    const turned = { hooks: [hook("session_start", T0 - 122_000), hook("turn_start", T0 - 1000)], last_hook_at: T0 - 1000 };
    expect(buildInbox(withCaps(facts([solo(a.state, turned)]), true), CONFIG).groups.unblock).toEqual([]);
    expect(only(withCaps(facts([solo(resent, turned)]), true))).toMatchObject({ kind: "noop", rule: "agent.running" });
  });

  test("a runner that cannot type (headless takes its prompt as an argument) is left to the usual rules", () => {
    const f = withCaps(facts([solo(running({ run: { ...runInfo, session: { runner: "headless", session_id: RUN } } }), { ...started(T0 - 61_000), session: { runner: "headless", session_id: RUN } })]), false);
    expect(only(f)).toMatchObject({ kind: "noop", rule: "agent.running" });
  });
});
