/**
 * Honest QA and notes (QV1–QV8, NT1–NT4; SPEC-base-sync-and-qa §7 cases 8, 9, 10): the pure checks
 * `norn done` runs on a criteria report, and — replayed through decide (X4) — the human-qa gate's
 * inbox item listing what a person checks, note items and their acknowledgement by `approve`.
 */
import { describe, expect, test } from "bun:test";
import { type AgentStep, type Criterion, type CriterionVerdict, deriveUlid, type Receipt, type UnitState, type Workflow } from "@norn/schema";
import type { Action } from "../src/actions.ts";
import { renderBrief } from "../src/brief.ts";
import { checkReport, openNotes, unverifiedNeeds, verdictCounts, worstVerdict } from "../src/criteria.ts";
import { decide } from "../src/decide.ts";
import type { NumberedReceipt } from "../src/facts.ts";
import { buildInbox } from "../src/inbox.ts";
import { validateWorkflowDefinition } from "../src/workflow.ts";
import { at, CONFIG, facts, loaded, numbered, stateFor, storyFacts, storyUnit, T0, unitFacts } from "./fixtures.ts";

/** QV6 in small: qa → (pass) ready, (partial | unverified) human-qa, (fail) back to qa's fixer. */
const QA_WF: Workflow = {
  name: "qa-flow",
  start: "qa",
  steps: {
    qa: {
      type: "agent",
      skill: "qa",
      criteria: "required",
      outcomes: {
        pass: { to: "ready", verdict: "pass", means: "every criterion observed with evidence" },
        fail: { to: "$stuck", verdict: "fail", means: "a criterion fails; repro in findings" },
        partial: { to: "human-qa", verdict: "person", means: "criteria only a person can judge, evidence prepared" },
        unverified: { to: "human-qa", verdict: "unverified", means: "criteria this session could not check; how to check each one is in the report" },
      },
    },
    "human-qa": { type: "gate", outcomes: { approve: "ready", reject: { to: "qa", counter: "qa_loop" } } },
    ready: { type: "gate", outcomes: { approve: "$done", reject: { to: "qa", counter: "qa_loop" } } },
  },
  counters: { qa_loop: { max: 3 } },
};
const QA = QA_WF.steps.qa as AgentStep;

const CRITERIA: Criterion[] = [
  { id: "AC1", verifier: "test" },
  { id: "AC2", verifier: "agent", needs: ["browser"] },
  { id: "AC3", verifier: "person" },
];
const PASS = (id: string): CriterionVerdict => ({ id, verdict: "pass", evidence: `evidence/${id}.txt` });
const UNVERIFIED: CriterionVerdict = { id: "AC2", verdict: "unverified", reason: "no browser in this session", how: "open /today, add 'buy milk p1', expect red flag" };
const PERSON: CriterionVerdict = { id: "AC3", verdict: "person", how: "compare against Figma frame 12" };

const check = (outcome: string, report: CriterionVerdict[] | null, criteria: Criterion[] | null = CRITERIA, notes: Array<{ text: string; criterion?: string }> = [], step: AgentStep = QA, capabilities: string[] = ["browser"]) =>
  checkReport({ step, step_name: "qa", outcome, report, criteria, notes, capabilities });

describe("criteria report checks (QV3–QV5, NT1)", () => {
  test("QV5a (C2): pass for a criterion whose needs the agent lacks is refused — report unverified with how", () => {
    const all = [PASS("AC1"), PASS("AC2"), PASS("AC3")];
    const r = check("pass", all, CRITERIA, [], QA, []);
    expect(r).toMatchObject({ ok: false, refusal: { code: "pass_without_capability", details: { criteria: [{ id: "AC2", missing: ["browser"] }], capabilities: [] } } });
    if (r.ok) throw new Error("unreachable");
    expect(r.refusal.error).toContain("AC2 (needs browser)");
    expect(r.refusal.error).toContain("earlier ruling does not verify");
    expect(r.refusal.do_instead).toContain('report AC2 as {"verdict": "unverified"');
    expect(r.refusal.do_instead).toContain('norn done unverified --criteria <file> --handoff "…"');
    // another capability does not cover it; the declared one does; unverified needs nothing
    expect(check("pass", all, CRITERIA, [], QA, ["shell"])).toMatchObject({ ok: false, refusal: { code: "pass_without_capability" } });
    expect(check("pass", all, CRITERIA, [], QA, ["browser"])).toEqual({ ok: true, worst: "pass", coverage: "checked" });
    expect(check("unverified", [PASS("AC1"), UNVERIFIED, PASS("AC3")], CRITERIA, [], QA, [])).toEqual({ ok: true, worst: "unverified", coverage: "checked" });
    // checked before the outcome gate: a pass on AC2 inside an unverified report is still refused
    expect(check("partial", [PASS("AC1"), PASS("AC2"), PERSON], CRITERIA, [], QA, [])).toMatchObject({ ok: false, refusal: { code: "pass_without_capability" } });
  });

  test("8: pass with an unverified criterion is refused; do_instead names unverified", () => {
    const r = check("pass", [PASS("AC1"), UNVERIFIED, PASS("AC3")]);
    expect(r).toMatchObject({ ok: false, refusal: { code: "outcome_contradicts_verdicts", details: { worst: "unverified", matching: ["unverified"], criteria: ["AC2"] } } });
    if (r.ok) throw new Error("unreachable");
    expect(r.refusal.do_instead).toBe('norn done unverified --criteria <file> --handoff "…"');
    expect(r.refusal.error).toContain("'unverified'");
    // the matching outcome is accepted
    expect(check("unverified", [PASS("AC1"), UNVERIFIED, PASS("AC3")])).toEqual({ ok: true, worst: "unverified", coverage: "checked" });
  });

  test("QV5: the worst verdict decides — fail > unverified > person > pass", () => {
    expect(worstVerdict([PASS("AC1"), PERSON])).toBe("person");
    expect(worstVerdict([PERSON, UNVERIFIED])).toBe("unverified");
    expect(worstVerdict([UNVERIFIED, { id: "AC1", verdict: "fail", repro: "x" }])).toBe("fail");
    expect(check("partial", [PASS("AC1"), PASS("AC2"), PERSON])).toMatchObject({ ok: true, worst: "person" });
    expect(check("partial", [PASS("AC1"), UNVERIFIED, PERSON])).toMatchObject({ ok: false, refusal: { code: "outcome_contradicts_verdicts", details: { matching: ["unverified"] } } });
    expect(check("pass", [PASS("AC1"), PASS("AC2"), PASS("AC3")])).toMatchObject({ ok: true, worst: "pass" });
    expect(check("unverified", [PASS("AC1"), PASS("AC2"), PASS("AC3")])).toMatchObject({ ok: false, refusal: { details: { matching: ["pass"] } } });
  });

  test("9: a report missing a frontmatter criterion id, or naming an unknown one, is invalid_criteria", () => {
    const missing = check("pass", [PASS("AC1"), PASS("AC2")]);
    expect(missing).toMatchObject({ ok: false, refusal: { code: "invalid_criteria", details: { expected: ["AC1", "AC2", "AC3"], missing: ["AC3"], unknown: [] } } });
    if (missing.ok) throw new Error("unreachable");
    expect(missing.refusal.do_instead).toContain("AC1, AC2, AC3");
    expect(check("pass", [PASS("AC1"), PASS("AC2"), PASS("AC3"), PASS("AC9")])).toMatchObject({ ok: false, refusal: { code: "invalid_criteria", details: { unknown: ["AC9"] } } });
    expect(check("pass", [PASS("AC1"), PASS("AC1"), PASS("AC2"), PASS("AC3")])).toMatchObject({ ok: false, refusal: { code: "invalid_criteria", details: { duplicate: ["AC1"] } } });
  });

  test("QV4: without frontmatter criteria coverage is not checked (unchecked)", () => {
    expect(check("pass", [PASS("X1")], null)).toEqual({ ok: true, worst: "pass", coverage: "unchecked" });
  });

  test("QV3: criteria: required, or an outcome gated by a verdict, needs a report", () => {
    expect(check("pass", null)).toMatchObject({ ok: false, refusal: { code: "criteria_required", do_instead: expect.stringContaining("--criteria <file>") } });
    const optional: AgentStep = { ...QA, criteria: undefined };
    expect(check("pass", null, CRITERIA, [], optional)).toMatchObject({ ok: false, refusal: { code: "criteria_required", error: expect.stringContaining("gated by verdict 'pass'") } });
    const ungated: AgentStep = { type: "agent", skill: "implement", outcomes: { done: { to: "$done", means: "built" } } };
    expect(check("done", null, null, [], ungated)).toEqual({ ok: true, worst: null, coverage: null });
    // an ungated outcome takes any report
    expect(check("done", [UNVERIFIED], null, [], ungated)).toMatchObject({ ok: true, worst: "unverified" });
  });

  test("NT1: a note's criterion must be one of the unit's criteria; notes never change the outcome check", () => {
    expect(check("pass", [PASS("AC1"), PASS("AC2"), PASS("AC3")], CRITERIA, [{ text: "kept whitespace inside backticks", criterion: "AC3" }])).toMatchObject({ ok: true });
    expect(check("pass", [PASS("AC1"), PASS("AC2"), PASS("AC3")], CRITERIA, [{ text: "x", criterion: "AC7" }])).toMatchObject({ ok: false, refusal: { code: "invalid_criteria", details: { unknown: ["AC7"] } } });
  });

  test("QV8: unverified counted per capability in needs", () => {
    const report = [PASS("AC1"), UNVERIFIED, { id: "AC3", verdict: "unverified", reason: "no device", how: "on a phone" } as CriterionVerdict];
    expect(unverifiedNeeds(report, CRITERIA)).toEqual({ browser: 1, none: 1 });
    expect(verdictCounts(report)).toEqual({ pass: 1, fail: 0, person: 0, unverified: 2 });
  });

  test("W5/QV5: verdict only on outcomes an agent reports", () => {
    expect(validateWorkflowDefinition(QA_WF).issues).toEqual([]);
    const bad = validateWorkflowDefinition({ ...QA_WF, steps: { ...QA_WF.steps, ready: { type: "gate", outcomes: { approve: { to: "$done", verdict: "pass" }, reject: { to: "qa", counter: "qa_loop" } } } } });
    expect(bad.issues.map((i) => [i.code, i.path])).toEqual([["verdict", "/steps/ready/outcomes/approve"]]);
  });
});

/** The story unit at qa (running), its report unapplied → one tick → parked at the target gate. */
function afterReport(report: Receipt, notes: NumberedReceipt[] = []) {
  const run = { run_id: deriveUlid("01JRRRRRRRRRRRRRRRRRRRRRRR", 0), step: "qa", attempt: 1, started_at: at(), how: "auto" as const };
  const st: UnitState = stateFor(storyUnit(), QA_WF, { status: "running", run });
  const done = numbered(1, { ...report, run_id: run.run_id } as Receipt);
  const sf = storyFacts("gh-1", [unitFacts(storyUnit(), QA_WF, st, { unapplied: [done] })], { frontmatter: { ...storyFacts("gh-1", []).frontmatter!, workflow: "qa-flow" } });
  const d = decide(facts([sf]), { "qa-flow": loaded(QA_WF) }, CONFIG).find((x) => x.unit === "gh-1" && x.rule !== "claim.renew");
  const a = d?.action as Extract<Action, { kind: "apply_receipts" }>;
  expect(a.kind).toBe("apply_receipts");
  const after = a.state as UnitState;
  const receipts = [done, ...notes];
  const parked = unitFacts(storyUnit(), QA_WF, after, { last_outcome_receipt: done });
  const story = storyFacts("gh-1", [parked], { notes: openNotes([{ unit: "gh-1", receipts }]) });
  return { state: after, story, inbox: buildInbox(facts([story], {}, T0 + 60_000), CONFIG) };
}

const doneReceipt = (outcome: string, extra: Record<string, unknown>): Receipt =>
  ({ kind: "done", receipt_id: deriveUlid("01JDDDDDDDDDDDDDDDDDDDDDDD", 1), run_id: null, step: "qa", attempt: 1, at: at(), by: "agent", who: "claude", outcome, handoff: "checked what I could", ...extra }) as Receipt;

describe("the gate a person checks (QV6, QV7)", () => {
  test("8: done unverified → human-qa; the gate item lists the unverified and person criteria with reason and how", () => {
    const { state, inbox } = afterReport(doneReceipt("unverified", { criteria: [PASS("AC1"), UNVERIFIED, PERSON] }));
    expect(state).toMatchObject({ step: "human-qa", status: "parked", park: { kind: "gate" } });
    const item = inbox.groups.approve.find((i) => i.story === "gh-1");
    expect(item?.detail).toContain("check: AC2 unverified (no browser in this session) — how: open /today, add 'buy milk p1', expect red flag; AC3 person — how: compare against Figma frame 12");
    expect(item?.detail).not.toContain("AC1");
    expect(item?.full).toBe(["Criteria for a person to check:", "- AC2 unverified (no browser in this session) — how: open /today, add 'buy milk p1', expect red flag", "- AC3 person — how: compare against Figma frame 12"].join("\n"));
  });

  test("a report without person or unverified criteria adds nothing to a gate", () => {
    const { inbox } = afterReport(doneReceipt("pass", { criteria: [PASS("AC1"), PASS("AC2"), PASS("AC3")] }));
    const item = inbox.groups.approve.find((i) => i.story === "gh-1");
    expect(item?.step).toBe("ready");
    expect(item?.detail).not.toContain("check:");
    expect(item?.full).toBeUndefined();
  });

  test("QV7: a rework brief after a rejection repeats the judged report's criteria not passed", () => {
    const st = stateFor(storyUnit(), QA_WF, { step: "qa", attempt: 2, status: "ready", counters: { qa_loop: 1 }, last_outcome: { step: "human-qa", outcome: "reject", source: "human", receipt_id: deriveUlid("01JJJJJJJJJJJJJJJJJJJJJJJJ", 0), at: at() } });
    const judged = numbered(1, doneReceipt("unverified", { criteria: [PASS("AC1"), UNVERIFIED, PERSON] }));
    const reject = numbered(2, { kind: "reject", receipt_id: deriveUlid("01JJJJJJJJJJJJJJJJJJJJJJJJ", 0), run_id: null, step: "human-qa", attempt: 1, at: at(), by: "human", who: "jakub@mac", comment: "AC2: no red flag in the browser" });
    const brief = renderBrief({
      unit: storyUnit(),
      state: st,
      workflow: QA_WF,
      mode: "auto",
      runner: "herdr",
      paths: { worktree: "/w", spec_dir: "/w/spec", story_file: "/w/spec/story.md", slice_file: null, unit_dir: "/w/spec/runs/_story" },
      diff_range: null,
      handoff: null,
      receipts: [judged, reject],
      limits: { deadline: "60m", nudges: 2, retries: 1, slot: null, port_base: null },
    });
    expect(brief.json.rework?.decision?.judged?.criteria?.map((c) => c.id)).toEqual(["AC2", "AC3"]);
    expect(brief.markdown).toContain("- **AC2** unverified — reason: no browser in this session; how: open /today");
    // QV3/QV5: the finish commands take the report and say which verdict each outcome needs
    expect(brief.json.finish.slice(0, 4)).toEqual([
      { command: 'norn done pass --criteria <file> --handoff "…"', means: "every criterion observed with evidence", verdict: "pass" },
      { command: 'norn done fail --criteria <file> --handoff "…"', means: "a criterion fails; repro in findings", verdict: "fail" },
      { command: 'norn done partial --criteria <file> --handoff "…"', means: "criteria only a person can judge, evidence prepared", verdict: "person" },
      { command: 'norn done unverified --criteria <file> --handoff "…"', means: "criteria this session could not check; how to check each one is in the report", verdict: "unverified" },
    ]);
    expect(brief.markdown).toContain("(only when the worst verdict is `unverified`)");
    expect(brief.markdown).toContain("--note");
  });
});

describe("notes for a person (NT1–NT3)", () => {
  const withNote = doneReceipt("pass", { criteria: [PASS("AC1"), PASS("AC2"), PASS("AC3")], notes: [{ text: "kept whitespace inside backticks", criterion: "AC3" }, { text: "copy says 'Today' not 'today'" }] });
  const id1 = `note:${withNote.receipt_id}:1`;
  const id2 = `note:${withNote.receipt_id}:2`;

  test("10: a note on a pass is a Check item; the story-level gate lists it", () => {
    const { inbox, state } = afterReport(withNote);
    expect(state).toMatchObject({ step: "ready", status: "parked" });
    const notes = inbox.groups.check.filter((i) => i.id.startsWith("note:"));
    expect(notes.map((i) => [i.id, i.title, i.command])).toEqual([
      [id1, "qa note on gh-1 (AC3): kept whitespace inside backticks", `norn why gh-1 --receipt ${withNote.receipt_id}`],
      [id2, "qa note on gh-1: copy says 'Today' not 'today'", `norn why gh-1 --receipt ${withNote.receipt_id}`],
    ]);
    const gate = inbox.groups.approve.find((i) => i.story === "gh-1");
    expect(gate?.detail).toContain("open notes (approve acknowledges them): gh-1 qa (AC3): kept whitespace inside backticks; gh-1 qa: copy says 'Today' not 'today'");
    expect(gate?.full).toContain(`- gh-1 qa (AC3): kept whitespace inside backticks [${id1}]`);
  });

  test("10: acknowledged by ready.approve; still open after ready.reject", () => {
    const done = numbered(1, withNote);
    const reject = numbered(2, { kind: "reject", receipt_id: deriveUlid("01JKKKKKKKKKKKKKKKKKKKKKKK", 0), run_id: null, step: "ready", attempt: 1, at: at(), by: "human", comment: "not yet" });
    expect(openNotes([{ unit: "gh-1", receipts: [done, reject] }]).map((n) => n.id)).toEqual([id1, id2]);
    const approve = numbered(3, { kind: "approve", receipt_id: deriveUlid("01JKKKKKKKKKKKKKKKKKKKKKKK", 1), run_id: null, step: "ready", attempt: 2, at: at(), by: "human", acknowledged_notes: [id1, id2] });
    expect(openNotes([{ unit: "gh-1", receipts: [done, reject, approve] }])).toEqual([]);
    // a slice's note counts once even when two worktrees hold its runs/
    expect(openNotes([{ unit: "gh-1/01", receipts: [done] }, { unit: "gh-1/01", receipts: [done] }]).map((n) => [n.id, n.unit])).toEqual([[id1, "gh-1/01"], [id2, "gh-1/01"]]);
  });

  test("a slice-level gate does not list the story's notes", () => {
    const { story } = afterReport(withNote);
    const slice = { story: "gh-1", slice: "gh-1/01", dir: "01-a", key: "gh-1/01" };
    const st = stateFor(slice, QA_WF, { step: "human-qa", status: "parked", park: { kind: "gate", reason: "check", since: at() } });
    const inbox = buildInbox(facts([{ ...story, units: [...story.units, unitFacts(slice, QA_WF, st)] }], {}, T0 + 60_000), CONFIG);
    expect(inbox.groups.approve.find((i) => i.slice === "gh-1/01")?.detail).not.toContain("open notes");
  });
});
