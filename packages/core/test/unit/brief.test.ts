import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { Finding, Receipt, UnitState, Workflow } from "@norn/schema";
import { applyReceipts } from "../../src/apply.ts";
import { type BriefInput, renderBrief, storyRulings } from "../../src/brief.ts";
import { HARD_RULES } from "../../src/hard-rules.ts";
import type { NumberedReceipt, UnitRef } from "../../src/facts.ts";
import { at, numbered, receipt, SLICE_WF, sliceUnit, STORY_WF, stateFor, storyUnit } from "../fixtures.ts";

const SLICE = sliceUnit("gh-1", "02", "form");
const RUN = "01JDDDDDDDDDDDDDDDDDDDDDDD";

/** Feed receipts one by one through apply, returning the state and the numbered receipts. */
function history(st: UnitState, wf = SLICE_WF, ...make: Array<(s: UnitState) => Receipt>) {
  const rs: NumberedReceipt[] = [];
  for (const m of make) {
    const nr = numbered(rs.length + 1, m(st));
    rs.push(nr);
    st = applyReceipts(st, [nr], { workflow: wf, now: at() }).state;
  }
  return { st, rs };
}
const started = (s: UnitState) => ({ ...receipt(s, "started", { how: "manual", worktree: "/w" }), run_id: RUN });
const done = (outcome: string, extra: Record<string, unknown> = {}) => (s: UnitState) => receipt(s, "done", { outcome, handoff: "h", ...extra });

const input = (st: UnitState, receipts: NumberedReceipt[], over: Partial<BriefInput> = {}): BriefInput => ({
  unit: SLICE,
  state: st,
  workflow: SLICE_WF,
  mode: "auto",
  runner: "herdr",
  paths: {
    worktree: "/r-worktrees/gh-1-login--02-form",
    spec_dir: ".agents/specs/gh-1-login",
    story_file: ".agents/specs/gh-1-login/story.md",
    slice_file: ".agents/specs/gh-1-login/slices/02-form.md",
    unit_dir: ".agents/specs/gh-1-login/runs/02-form",
  },
  diff_range: "gh-1-login...HEAD",
  handoff: null,
  receipts,
  limits: { deadline: "60m", nudges: 2, retries: 1, slot: 3, port_base: 4030 },
  ...over,
});

describe("renderBrief", () => {
  test("first run of implement", () => {
    const b = renderBrief(input(stateFor(SLICE, SLICE_WF), []));
    expect(b.json.rework).toBeNull();
    expect(b.json.finish.map((f) => f.command)).toEqual(['norn done done --handoff "…"', 'norn ask "<question>"', 'norn stuck "<reason>"']);
    expect(b.markdown).toMatchSnapshot();
  });

  test("the step's description and instructions follow the skill under Your work, instructions trimmed", () => {
    const wf = structuredClone(SLICE_WF);
    Object.assign(wf.steps.implement as object, {
      description: "Build the slice test-first.",
      instructions: "Base mode: merge the base commit named in Rework; never rebase.\n",
    });
    const b = renderBrief(input(stateFor(SLICE, wf), [], { workflow: wf }));
    expect(b.json.work).toEqual({
      skill: "implement",
      description: "Build the slice test-first.",
      instructions: "Base mode: merge the base commit named in Rework; never rebase.\n",
    });
    expect(b.markdown).toContain(
      "## Your work\n\nUse the `implement` skill.\n\nBuild the slice test-first.\n\nBase mode: merge the base commit named in Rework; never rebase.\n\n## Finish with exactly one of",
    );
    expect(b.markdown).toMatchSnapshot();
  });

  test("rework after a failing check shows the output tail and log", () => {
    const { st, rs } = history(stateFor(SLICE, SLICE_WF), SLICE_WF, started, done("done"), (s) =>
      receipt(s, "check", { outcome: "fail", command: "bun test", exit_code: 1, duration_ms: 900, output_tail: "✓ a\n✗ login rejects empty password\n  expected 400, got 200", log: `logs/${RUN}.log` }, "norn"),
    );
    expect(st).toMatchObject({ step: "implement", attempt: 2 });
    const b = renderBrief(input(st, rs, { handoff: "## Goal\nLogin form\n\n## Progress\n- form renders" }));
    expect(b.json.rework).toMatchObject({ from: "test.fail", check: { exit_code: 1, log: `/r-worktrees/gh-1-login--02-form/.agents/specs/gh-1-login/runs/02-form/logs/${RUN}.log` }, findings: null });
    expect(b.markdown).toMatchSnapshot();
  });

  test("rework after review findings lists them", () => {
    const { st, rs } = history(stateFor(SLICE, SLICE_WF, { step: "review", visits: { implement: 1, review: 1 } }), SLICE_WF, started, done("changes_requested", {
      findings: [
        { severity: "blocking", title: "Password not validated", file: "src/login.ts", line: 12, criterion: "B3", repro: "POST /login with empty password" },
        { severity: "minor", title: "Naming", detail: "rename x to email" },
      ],
    }));
    const b = renderBrief(input(st, rs));
    expect(b.json.rework?.findings?.items).toHaveLength(2);
    expect(b.markdown).toMatchSnapshot();
  });

  test("attended step with answers in context, manual downgrade, no deadline", () => {
    const story = storyUnit();
    const { st, rs } = history(stateFor(story, STORY_WF), STORY_WF, started, (s) => receipt(s, "ask", { question: "Email or username?" }), (s) => receipt(s, "answer", { answer: "Email" }, "human"));
    const b = renderBrief(
      input(st, rs, {
        unit: story,
        workflow: STORY_WF,
        runner: null,
        paths: { worktree: "/r-worktrees/gh-1-login", spec_dir: ".agents/specs/gh-1-login", story_file: ".agents/specs/gh-1-login/story.md", slice_file: null, unit_dir: ".agents/specs/gh-1-login/runs/_story" },
        limits: { deadline: "60m", nudges: 2, retries: 1, slot: null, port_base: null },
      }),
    );
    expect(b.json.where).toMatchObject({ mode: "manual", mode_requested: "auto", attended: true, runner: null });
    expect(b.json.context.answers).toEqual([{ question: "Email or username?", answer: "Email" }]);
    expect(b.markdown).toMatchSnapshot();
  });

  test("declared inputs, entered from review: findings shown, a failing check settled by a later pass is not", () => {
    const wf = structuredClone(SLICE_WF);
    (wf.steps.implement as { inputs?: unknown }).inputs = ["slice", "last_check", "last_findings"];
    const { st, rs } = history(stateFor(SLICE, wf), wf, started, done("done"), (s) =>
      receipt(s, "check", { outcome: "fail", command: "bun test", exit_code: 2, duration_ms: 1, output_tail: "boom" }, "norn"), started, done("done"), (s) =>
      receipt(s, "check", { outcome: "pass", command: "bun test", exit_code: 0, duration_ms: 1, output_tail: "" }, "norn"), started, done("changes_requested", { findings: [{ severity: "major", title: "Edge case" }] }));
    const b = renderBrief(input(st, rs, { workflow: wf }));
    // the failing check was fixed by a later pass: it is not rework
    expect(b.json.rework?.check).toBeNull();
    expect(b.json.rework?.findings?.items[0]?.title).toBe("Edge case");
    expect(b.json.inputs.map((i) => i.kind)).toEqual(["slice", "last_check", "last_findings"]);
  });

  test("declared last_check shows only the failure after the previous attempt, not an older one", () => {
    const wf = structuredClone(SLICE_WF);
    (wf.steps.implement as { inputs?: unknown }).inputs = ["last_check"];
    const fail = (tailText: string) => (s: UnitState) => receipt(s, "check", { outcome: "fail", command: "bun test", exit_code: 1, duration_ms: 1, output_tail: tailText }, "norn");
    const { st, rs } = history(stateFor(SLICE, wf), wf, started, done("done"), fail("old"), started, done("done"), fail("new"));
    const b = renderBrief(input(st, rs, { workflow: wf }));
    expect(b.json.rework?.check?.output_tail).toBe("new");
  });

  test("declared inputs drop findings and checks that a later pass settled; a gate reject shows its comment", () => {
    const wf = structuredClone(SLICE_WF);
    (wf.steps.implement as { inputs?: unknown }).inputs = ["last_check", "last_findings"];
    const check = (outcome: "pass" | "fail") => (s: UnitState) => receipt(s, "check", { outcome, command: "bun test", exit_code: outcome === "pass" ? 0 : 1, duration_ms: 1, output_tail: outcome }, "norn");
    const { st, rs } = history(
      stateFor(SLICE, wf),
      wf,
      started,
      done("done"),
      check("fail"),
      started,
      done("done"),
      check("pass"),
      started,
      done("changes_requested", { findings: [{ severity: "major", title: "Old finding" }] }),
      started,
      done("done"),
      check("pass"),
      started,
      done("approve"),
      started,
      done("partial"),
      (s) => receipt(s, "reject", { comment: "button is off-screen" }, "human"),
    );
    expect(st).toMatchObject({ step: "implement" });
    const b = renderBrief(input(st, rs, { workflow: wf }));
    expect(b.json.rework).toMatchObject({ from: "human-qa.reject", check: null, findings: null, decision: { step: "human-qa", comment: "button is off-screen" } });
    expect(b.markdown).not.toContain("Old finding");
  });

  test("non-agent steps have no briefing", () => {
    expect(() => renderBrief(input(stateFor(SLICE, SLICE_WF, { step: "test" }), []))).toThrow("not an agent step");
  });
});

/** SLICE_WF with implement declaring the rework inputs, as the shipped workflows do. */
const DECLARED = (() => {
  const wf = structuredClone(SLICE_WF);
  (wf.steps.implement as { inputs?: unknown }).inputs = ["slice", "last_check", "last_findings"];
  return wf;
})();
const at_ = (step: string, visits: Record<string, number>) => stateFor(SLICE, DECLARED, { step, visits });
const EVIDENCE = `evidence/${RUN}`;
const ABS_UNIT = "/r-worktrees/gh-1-login--02-form/.agents/specs/gh-1-login/runs/02-form";
const QA_FAIL = "QA via curl: FAIL B12 'delete already-deleted -> 404': ids of deleted items are reused, so a retried DELETE removes a newer item. Repro in B12-repro.md.";
const refOf = (b: ReturnType<typeof renderBrief>, kind: string) => b.json.inputs.find((i) => i.kind === kind)?.ref;

describe("Rework only when sent back", () => {
  test("qa.fail without findings: the handoff verbatim and the absolute evidence dir with its files", () => {
    const { st, rs } = history(at_("qa", { implement: 1, review: 1, qa: 1 }), DECLARED, started, done("fail", { handoff: QA_FAIL, evidence: EVIDENCE }));
    expect(st).toMatchObject({ step: "implement", attempt: 2 });
    const b = renderBrief(input(st, rs, { workflow: DECLARED, evidence_files: { [EVIDENCE]: ["B12-repro.md", "report.md"] } }));
    expect(b.json.rework).toMatchObject({
      from: "qa.fail",
      counter: { name: "qa_loop", value: 1, max: 2 },
      check: null,
      findings: null,
      report: { step: "qa", outcome: "fail", handoff: QA_FAIL, evidence: { dir: `${ABS_UNIT}/${EVIDENCE}`, files: ["B12-repro.md", "report.md"] } },
    });
    expect(refOf(b, "last_check")).toBe("none");
    expect(refOf(b, "last_findings")).toBe("see Rework");
    expect(b.markdown).toMatchSnapshot();
  });

  test("qa.fail with findings: criterion and repro, then the evidence", () => {
    const findings = [{ severity: "blocking", title: "Deleted ids are reused", criterion: "B12", repro: "DELETE /api/items/3 twice after creating a new item → 204, newer item gone" }];
    const { st, rs } = history(at_("qa", { implement: 1, review: 1, qa: 1 }), DECLARED, started, done("fail", { handoff: QA_FAIL, evidence: EVIDENCE, findings }));
    const b = renderBrief(input(st, rs, { workflow: DECLARED, evidence_files: { [EVIDENCE]: ["B12-repro.md"] } }));
    expect(b.json.rework?.findings).toMatchObject({ step: "qa", outcome: "fail", items: [{ criterion: "B12" }] });
    expect(b.markdown).toContain("Repro: DELETE /api/items/3 twice");
    expect(b.markdown).toMatchSnapshot();
  });

  test("gate reject with a comment: the comment verbatim and who; the judged receipt's evidence; an earlier approve's findings are not rework", () => {
    const { st, rs } = history(
      at_("review", { implement: 1, review: 1 }),
      DECLARED,
      started,
      done("approve", { findings: [{ severity: "minor", title: "Raw HTML shown as row error", criterion: "AC7" }, { severity: "nit", title: "Substring test" }] }),
      started,
      done("partial", { handoff: "AC7 needs a browser; steps in AC7.md", evidence: EVIDENCE }),
      (s) => ({ ...receipt(s, "reject", { comment: "AC7: show 'Item not found' instead of the raw HTML page, with a test." }, "human"), who: "jakub@mac" }),
    );
    expect(st).toMatchObject({ step: "implement", attempt: 2 });
    const b = renderBrief(input(st, rs, { workflow: DECLARED, evidence_files: { [EVIDENCE]: ["AC7.md", "report.md"] } }));
    expect(b.json.rework).toMatchObject({
      from: "human-qa.reject",
      counter: { name: "qa_loop", value: 1, max: 2 },
      findings: null,
      decision: {
        step: "human-qa",
        by: "jakub@mac",
        comment: "AC7: show 'Item not found' instead of the raw HTML page, with a test.",
        judged: { step: "qa", outcome: "partial", evidence: { dir: `${ABS_UNIT}/${EVIDENCE}`, files: ["AC7.md", "report.md"] } },
      },
    });
    expect(b.markdown).not.toContain("Substring test");
    expect(b.markdown).toMatchSnapshot();
  });

  test("gate reject without a comment says so and points at the evidence", () => {
    const { st, rs } = history(at_("qa", { implement: 1, review: 1, qa: 1 }), DECLARED, started, done("partial", { evidence: EVIDENCE }), (s) => receipt(s, "reject", {}, "human"));
    const b = renderBrief(input(st, rs, { workflow: DECLARED, evidence_files: { [EVIDENCE]: ["report.md"] } }));
    expect(b.json.rework?.decision).toMatchObject({ comment: null });
    expect(b.markdown).toContain("(no comment given; ask the person or see the evidence)");
    expect(b.markdown).toMatchSnapshot();
  });

  test("review.approve → qa is forward: no Rework; non-blocking findings are neutral notes in Context", () => {
    const { st, rs } = history(at_("review", { implement: 1, review: 1 }), DECLARED, started, done("approve", { findings: [{ severity: "minor", title: "Raw HTML shown as row error", file: "src/views.ts", line: 191 }] }));
    expect(st).toMatchObject({ step: "qa" });
    const b = renderBrief(input(st, rs, { workflow: DECLARED }));
    expect(b.json.rework).toBeNull();
    expect(b.json.context.notes).toMatchObject({ step: "review", outcome: "approve", items: [{ title: "Raw HTML shown as row error" }] });
    expect(b.markdown).not.toContain("## Rework");
    expect(b.markdown).not.toContain("Address");
    expect(b.markdown).toContain("## Non-blocking findings from review");
    expect(b.markdown).toMatchSnapshot();
  });

  test("test.fail after the qa rework round: the check only; qa's failure was settled by the previous attempt", () => {
    const fail = (s: UnitState) => receipt(s, "check", { outcome: "fail", command: "bun test", exit_code: 1, duration_ms: 1, output_tail: "✗ ids not reused", log: `logs/${RUN}.log` }, "norn");
    const { st, rs } = history(at_("qa", { implement: 1, review: 1, qa: 1 }), DECLARED, started, done("fail", { handoff: QA_FAIL, findings: [{ severity: "blocking", title: "Deleted ids are reused" }] }), started, done("done"), fail);
    expect(st).toMatchObject({ step: "implement", attempt: 3 });
    const b = renderBrief(input(st, rs, { workflow: DECLARED }));
    expect(b.json.rework).toMatchObject({ from: "test.fail", counter: { name: "test_loop", value: 1 }, report: null, findings: null, decision: null, check: { log: `${ABS_UNIT}/logs/${RUN}.log` } });
    expect(refOf(b, "last_check")).toBe("see Rework");
    expect(refOf(b, "last_findings")).toBe("none");
    expect(b.markdown).not.toContain("Deleted ids are reused");
  });

  test("integrate conflict → merge: the conflicting files", () => {
    const { st, rs } = history(at_("integrate", { implement: 1, integrate: 1 }), DECLARED, (s) =>
      receipt(s, "classify", { outcome: "conflict", rule: "integrate", route: "merge", detail: "rebase onto gh-1-login conflicts in src/a.ts, src/b.ts" }, "norn"),
    );
    expect(st).toMatchObject({ step: "merge" });
    const b = renderBrief(input(st, rs, { workflow: DECLARED }));
    expect(b.json.rework).toMatchObject({ from: "integrate.conflict", counter: { name: "conflict_loop", value: 1 }, detail: "rebase onto gh-1-login conflicts in src/a.ts, src/b.ts" });
    expect(b.markdown).toMatchSnapshot();
  });

  test("no Rework means no dangling 'see Rework' in Inputs", () => {
    const b = renderBrief(input(stateFor(SLICE, DECLARED), [], { workflow: DECLARED }));
    expect(b.json.rework).toBeNull();
    expect(b.markdown).not.toContain("see Rework");
    expect(refOf(b, "last_check")).toBe("none");
  });
});

describe("Checks since the last report", () => {
  const UNIT = "/r-worktrees/gh-1-login--02-form/.agents/specs/gh-1-login/runs/02-form";
  const check = (outcome: "pass" | "fail", extra: Record<string, unknown> = {}) => (s: UnitState) =>
    receipt(s, "check", { outcome, command: "bun test", exit_code: outcome === "pass" ? 0 : 1, duration_ms: 83_400, output_tail: "ok", ...extra }, "norn");

  test("review after a passing check lists it: step, command, outcome, duration and where its output is", () => {
    const { st, rs } = history(stateFor(SLICE, SLICE_WF), SLICE_WF, started, done("done"), check("pass"));
    expect(st).toMatchObject({ step: "review" });
    const b = renderBrief(input(st, rs));
    expect(b.json.checks).toEqual({ since: "implement#1", items: [{ step: "test", attempt: 1, command: "bun test", outcome: "pass", exit_code: 0, duration_ms: 83_400, reason: null, log: `${UNIT}/receipts/0003-check.json` }] });
    expect(b.markdown).toContain(
      "## Checks since the last report\n\nThese checks ran on the code since implement#1 reported; nothing else has run on it yet.\n\n- test#1 `pass` in 1m 23s — `bun test` — output: `" + `${UNIT}/receipts/0003-check.json` + "`\n",
    );
    expect(b.markdown).toMatchSnapshot();
  });

  test("only checks after the last report count; the failing check under Rework is not repeated", () => {
    const { st, rs } = history(stateFor(SLICE, SLICE_WF), SLICE_WF, started, done("done"), check("fail", { log: `logs/${RUN}.log` }), started, done("done"), check("fail", { exit_code: null, reason: "timeout", duration_ms: 600_000, log: "logs/second.log" }), started, done("done"), check("pass", { duration_ms: 2_100 }));
    expect(st).toMatchObject({ step: "review" });
    const b = renderBrief(input(st, rs));
    expect(b.json.checks?.items.map((c) => [c.outcome, c.duration_ms])).toEqual([["pass", 2_100]]);
    const { st: st2, rs: rs2 } = history(stateFor(SLICE, SLICE_WF), SLICE_WF, started, done("done"), check("fail", { exit_code: null, reason: "timeout", duration_ms: 600_000, log: "logs/second.log" }));
    expect(renderBrief(input(st2, rs2)).json.checks).toBeNull(); // implement: the failing check is under Rework already
  });

  test("no check since the last report: no section", () => {
    const { st, rs } = history(stateFor(SLICE, SLICE_WF), SLICE_WF, started, done("done"), check("pass"), started, done("approve"));
    expect(st).toMatchObject({ step: "qa" });
    const b = renderBrief(input(st, rs));
    expect(b.json.checks).toBeNull();
    expect(b.markdown).not.toContain("## Checks");
  });
});

describe("Re-entry, fresh sessions, handoff and criteria", () => {
  const died = (s: UnitState) => receipt(s, "classify", { outcome: "died", rule: "agent.died", route: "retry", detail: "launch_unknown" }, "norn");
  const pass = (s: UnitState) => receipt(s, "check", { outcome: "pass", command: "bun test", exit_code: 0, duration_ms: 1, output_tail: "" }, "norn");
  const QA_WF = (() => {
    const wf = structuredClone(DECLARED);
    (wf.steps.qa as { criteria?: unknown }).criteria = "required";
    return wf;
  })();
  /** qa#1 fail → implement#2 → test → review#2 approve → qa#2, whose first session died */
  const qa2 = () =>
    history(at_("qa", { implement: 1, review: 1, qa: 1 }), QA_WF, started, done("fail", { findings: [{ severity: "blocking", title: "Count off by one" }] }), started, done("done"), pass, started, done("approve"), started, died);
  const HANDOFF = "## Goal\nFooter shows the total.\n\n## Progress\n- review#2 approve: no findings\n\n## Resume\nNothing left; report done.\n";

  test("a second qa after the code changed: why this attempt, earlier qa is history, review's Resume dropped", () => {
    const { st, rs } = qa2();
    expect(st).toMatchObject({ step: "qa", attempt: 2, retries_used: 1 });
    const b = renderBrief(input(st, rs, { workflow: QA_WF, handoff: HANDOFF, criteria: [{ id: "AC1", verifier: "agent" }, { id: "AC2", verifier: "agent" }] }));
    expect(b.json.rework).toBeNull();
    expect(b.json.history).toEqual({
      retry: { outcome: "qa.died", detail: "launch_unknown", at: at() },
      earlier: { attempt: 1, outcome: "fail", since: ["implement.done", "test.pass", "review.approve"] },
    });
    expect(b.json.context.resume_dropped).toBe("review#2");
    expect(b.markdown).not.toContain("Nothing left; report done.");
    expect(b.markdown).toContain("Footer shows the total.");
    expect(b.json.criteria).toEqual([
      { id: "AC1", verifier: "agent" },
      { id: "AC2", verifier: "agent" },
    ]);
    expect(b.markdown).toMatchSnapshot();
  });

  test("a fresh session of a rework step keeps its Rework (died is in-step, not the entry)", () => {
    const { st, rs } = history(at_("qa", { implement: 1, review: 1, qa: 1 }), DECLARED, started, done("fail", { handoff: QA_FAIL }), started, died);
    expect(st).toMatchObject({ step: "implement", attempt: 2, last_outcome: { step: "implement", outcome: "died" } });
    const b = renderBrief(input(st, rs, { workflow: DECLARED }));
    expect(b.json.rework).toMatchObject({ from: "qa.fail", counter: { name: "qa_loop", value: 1 }, report: { handoff: QA_FAIL } });
    expect(b.json.history).toEqual({ retry: { outcome: "implement.died", detail: "launch_unknown", at: at() }, earlier: null });
    expect(b.markdown).toContain("## Why this attempt");
  });

  test("the Resume of this step's own earlier report is kept; a first entry has no history", () => {
    const { st, rs } = history(stateFor(SLICE, SLICE_WF), SLICE_WF, started, (s) => receipt(s, "ask", { question: "Email or username?" }), (s) => receipt(s, "answer", { answer: "Email" }, "human"));
    const b = renderBrief(input(st, rs, { handoff: "## Resume\nWire the email field." }));
    expect(b.json.history).toBeNull();
    expect(b.json.context.resume_dropped).toBeNull();
    expect(b.markdown).toContain("Wire the email field.");
    expect(b.markdown).not.toContain("## Why this attempt");
  });

  describe("a re-review that declares last_findings checks the earlier findings first", () => {
    const REVIEW_WF = (() => {
      const wf = structuredClone(DECLARED);
      (wf.steps.review as { inputs?: unknown }).inputs = ["slice", "diff", "last_findings"];
      return wf;
    })();
    const EARLIER: Finding[] = [
      { severity: "blocking", title: "Count off by one", file: "src/count.ts", line: 12 },
      { severity: "minor", title: "Name the helper after what it returns" },
    ];
    /** review#1 changes_requested → implement#2 → test.pass → review#2 */
    const review2 = (wf: Workflow) => history(at_("review", { implement: 1, review: 1 }), wf, started, done("changes_requested", { findings: EARLIER }), started, done("done"), pass);

    test("the earlier review's findings are listed to check, fixed or not, and Inputs points at them", () => {
      const { st, rs } = review2(REVIEW_WF);
      expect(st).toMatchObject({ step: "review", attempt: 2 });
      const b = renderBrief(input(st, rs, { workflow: REVIEW_WF }));
      expect(b.json.rework).toBeNull();
      expect(b.json.history?.earlier).toEqual({ attempt: 1, outcome: "changes_requested", since: ["implement.done", "test.pass"], findings: EARLIER });
      expect(refOf(b, "last_findings")).toBe("see Earlier findings");
      expect(b.markdown).toContain("### Earlier findings (review#1)");
      expect(b.markdown).toContain("First check each earlier finding below against the current code: fixed or not.");
      expect(b.markdown).not.toContain("is history, not a result for this one");
      expect(b.markdown).toContain("1. **blocking** Count off by one — `src/count.ts:12`");
      expect(b.markdown).toMatchSnapshot();
    });

    test("a review that does not declare last_findings keeps the earlier attempt as history only", () => {
      const { st, rs } = review2(DECLARED);
      const b = renderBrief(input(st, rs, { workflow: DECLARED }));
      expect(b.json.history?.earlier).toEqual({ attempt: 1, outcome: "changes_requested", since: ["implement.done", "test.pass"] });
      expect(b.markdown).not.toContain("Earlier findings");
      expect(b.markdown).toContain("is history, not a result for this one");
    });

    test("no earlier findings: Last findings is none", () => {
      const { st, rs } = history(at_("review", { implement: 1, review: 1 }), REVIEW_WF, started, done("changes_requested"), started, done("done"), pass);
      const b = renderBrief(input(st, rs, { workflow: REVIEW_WF }));
      expect(b.json.history?.earlier?.findings).toBeUndefined();
      expect(refOf(b, "last_findings")).toBe("none");
    });
  });

  test("implement's Rework sorts the findings: blocking and major to fix, minor and nit left as notes", () => {
    const findings: Finding[] = [
      { severity: "minor", title: "Name the helper after what it returns" },
      { severity: "blocking", title: "Count off by one" },
      { severity: "nit", title: "Trailing space in the label" },
      { severity: "major", title: "Empty list crashes the footer" },
    ];
    const { st, rs } = history(at_("review", { implement: 1, review: 1 }), DECLARED, started, done("changes_requested", { findings }));
    expect(st).toMatchObject({ step: "implement", attempt: 2 });
    const b = renderBrief(input(st, rs, { workflow: DECLARED }));
    expect(b.json.rework?.findings?.items).toEqual(findings);
    const md = b.markdown;
    expect(md).not.toContain("for you to weigh");
    expect(md).toContain("Rework is the blocking and major findings: fix each one.");
    expect(md).toContain("### Notes (review: minor and nit)");
    expect(md).toContain("Leave these as notes: do not fix them in this round.");
    // the ones to fix come first, then the notes
    expect(md.indexOf("Empty list crashes the footer")).toBeLessThan(md.indexOf("### Notes (review: minor and nit)"));
    expect(md.indexOf("Count off by one")).toBeLessThan(md.indexOf("### Notes (review: minor and nit)"));
    expect(md.indexOf("Trailing space in the label")).toBeGreaterThan(md.indexOf("### Notes (review: minor and nit)"));
    expect(md).toMatchSnapshot();
  });

  test("without declared criteria the brief points at the spec's Acceptance section", () => {
    const { st, rs } = history(at_("review", { implement: 1, review: 1 }), QA_WF, started, done("approve"));
    const b = renderBrief(input(st, rs, { workflow: QA_WF }));
    expect(b.json.criteria).toBeNull();
    expect(b.markdown).toContain("The story spec's Acceptance section names the criteria; use its ids.");
    expect(b.markdown).toContain("never under `runs/`");
  });
});

// ------------------------------------------------------------------ golden replays of real runs

const FIX = join(import.meta.dir, "..", "fixtures", "sandbox");

/** Replay a copied unit (pinned workflow + receipts) through apply, then brief the cursor. */
function replay(dir: string, unit: UnitRef, paths: BriefInput["paths"]) {
  const wf = Bun.YAML.parse(readFileSync(join(FIX, dir, "workflow.yaml"), "utf8")) as Workflow;
  const receipts = readdirSync(join(FIX, dir, "receipts"))
    .sort()
    .map((file) => numbered(Number(file.slice(0, 4)), JSON.parse(readFileSync(join(FIX, dir, "receipts", file), "utf8")) as Receipt));
  let st = stateFor(unit, wf);
  for (const r of receipts) st = applyReceipts(st, [r], { workflow: wf, now: r.receipt.at }).state;
  const evidence_files = JSON.parse(readFileSync(join(FIX, dir, "evidence.json"), "utf8")) as Record<string, string[]>;
  return renderBrief({ ...input(st, receipts), unit, workflow: wf, mode: "manual", runner: null, paths, diff_range: null, evidence_files });
}

describe("golden replays (norn-sandbox-todoist)", () => {
  test("gh-1 story: qa.fail with handoff + evidence and no findings → implement#1 gets the failure (F22)", () => {
    const wt = "/w/norn-sandbox-todoist-worktrees/gh-1-projects-and-items";
    const spec = ".agents/specs/gh-1-projects-and-items";
    const b = replay("gh-1-story", { story: "gh-1", slice: null, dir: "_story", key: "gh-1" }, {
      worktree: wt,
      spec_dir: spec,
      story_file: `${spec}/story.md`,
      slice_file: null,
      unit_dir: `${spec}/runs/_story`,
    });
    expect(b.json.where).toMatchObject({ step: "implement", attempt: 1 });
    expect(b.json.rework).toMatchObject({ from: "qa.fail", counter: { name: "qa_loop", value: 1, max: 2 }, report: { outcome: "fail", evidence: { dir: `${wt}/${spec}/runs/_story/evidence/01M5MTEB6T37MVRHZ5FADDAQTK` } } });
    expect(b.json.rework?.report?.handoff).toContain("Repro in B12-repro.md");
    expect(b.json.rework?.report?.evidence?.files).toContain("B12-repro.md");
    // evidence is a folder and a count, the likely entry points named first
    expect(b.markdown).toContain("— 41 files: PERSON.md, report.md, AC10-tests.md, B1.md, B10.md and 36 more");
    expect(b.markdown).not.toContain("  - B30.md");
    // Rework comes right after the work, before how to finish and what to read
    const at = (h: string) => b.markdown.indexOf(`\n## ${h}\n`);
    expect(at("Rework")).toBeGreaterThan(at("Your work"));
    expect(at("Rework")).toBeLessThan(at("Finish with exactly one of"));
    expect(b.markdown).toMatchSnapshot();
  });

  test("gh-2/03: human-qa.reject → implement#2 gets the comment, not review#1's approve findings (F31)", () => {
    const wt = "/w/norn-sandbox-todoist-worktrees/gh-2-due-dates-with-today-and-upcoming-views--03-due-dates-in-project-lists";
    const spec = ".agents/specs/gh-2-due-dates-with-today-and-upcoming-views";
    const b = replay("gh-2-03", { story: "gh-2", slice: "gh-2/03", dir: "03-due-dates-in-project-lists", key: "gh-2/03" }, {
      worktree: wt,
      spec_dir: spec,
      story_file: `${spec}/story.md`,
      slice_file: `${spec}/slices/03-due-dates-in-project-lists.md`,
      unit_dir: `${spec}/runs/03-due-dates-in-project-lists`,
    });
    expect(b.json.where).toMatchObject({ step: "implement", attempt: 2 });
    expect(b.json.rework).toMatchObject({ from: "human-qa.reject", findings: null, decision: { judged: { step: "qa", outcome: "partial" } } });
    expect(b.json.rework?.decision?.comment).toContain("'Item not found'");
    // review#1's approve findings are not rework (History lists that report as one neutral line)
    const rework = b.markdown.slice(b.markdown.indexOf("\n## Rework\n"), b.markdown.indexOf("\n## Finish with"));
    expect(rework).toContain("'Item not found'");
    expect(rework).not.toContain("li.overdue");
    expect(b.markdown).toMatchSnapshot();
  });

  test("gh-2/03: review.approve → qa#1 is forward, no Rework (F17)", () => {
    const wf = Bun.YAML.parse(readFileSync(join(FIX, "gh-2-03", "workflow.yaml"), "utf8")) as Workflow;
    const unit: UnitRef = { story: "gh-2", slice: "gh-2/03", dir: "03-due-dates-in-project-lists", key: "gh-2/03" };
    const receipts = readdirSync(join(FIX, "gh-2-03", "receipts"))
      .sort()
      .slice(0, 5)
      .map((file) => numbered(Number(file.slice(0, 4)), JSON.parse(readFileSync(join(FIX, "gh-2-03", "receipts", file), "utf8")) as Receipt));
    let st = stateFor(unit, wf);
    for (const r of receipts) st = applyReceipts(st, [r], { workflow: wf, now: r.receipt.at }).state;
    expect(st).toMatchObject({ step: "qa" });
    const b = renderBrief({ ...input(st, receipts), unit, workflow: wf });
    expect(b.json.rework).toBeNull();
    expect(b.json.context.notes?.items).toHaveLength(3);
  });
});

describe("Rulings (F28): gate reasons as story-level notes", () => {
  const SLICE1 = sliceUnit("gh-1", "01", "list");
  const gateAt = (unit: UnitRef) => stateFor(unit, SLICE_WF, { step: "human-qa", attempt: 1 });
  const ruling = (unit: UnitRef, kind: "approve" | "reject", comment: string | undefined, atMs: number, head?: string) => ({
    unit: unit.key,
    receipts: [numbered(7, { ...receipt(gateAt(unit), kind, { ...(comment === undefined ? {} : { comment }), ...(head ? { head_sha: head } : {}) }, "human"), who: "jakub@mac", slice: unit.slice, at: new Date(atMs).toISOString() })],
  });
  const HEAD = "818e9ed".padEnd(40, "0");

  test("storyRulings collects gate comments of every unit, oldest first, skipping empty and duplicate ones", () => {
    const a = ruling(SLICE1, "approve", "AC6 wins over B6: keep the raw count", Date.parse("2026-10-23T11:00:00Z"));
    const b = ruling(SLICE, "reject", "  ", Date.parse("2026-10-23T12:00:00Z"));
    const c = ruling(storyUnit(), "approve", undefined, Date.parse("2026-10-23T13:00:00Z"));
    const d = ruling(SLICE, "reject", "Item not found must be shown", Date.parse("2026-10-23T10:00:00Z"));
    const out = storyRulings([a, b, c, d, a]);
    expect(out.map((r) => `${r.unit} ${r.step}#${r.attempt} ${r.decision}: ${r.comment}`)).toEqual([
      "gh-1/02 human-qa#1 reject: Item not found must be shown",
      "gh-1/01 human-qa#1 approve: AC6 wins over B6: keep the raw count",
    ]);
  });

  test("every later brief of the story carries the rulings, the one already in Rework excepted", () => {
    const rulings = storyRulings([ruling(SLICE1, "approve", "AC6 wins over B6: keep the raw count", Date.parse("2026-10-23T11:00:00Z"), HEAD)]);
    expect(rulings[0]?.head_sha).toBe(HEAD);
    const b = renderBrief(input(stateFor(SLICE, SLICE_WF), [], { rulings }));
    expect(b.json.rulings).toEqual(rulings);
    expect(b.markdown).toContain("## Rulings");
    // Rulings answer questions; they never stand in for a criterion's verdict on new code
    expect(b.markdown).toContain("A ruling never turns a criterion into `pass`");
    expect(b.markdown).toContain("At most a ruling informs a `person` verdict");
    expect(b.markdown).not.toContain("settle the questions");
    // each ruling is tied to the head it judged
    expect(b.markdown).toContain(`- gh-1/01 human-qa#1 approve by jakub@mac (2026-10-23T11:00:00.000Z) at head \`${HEAD}\`:\n  > AC6 wins over B6: keep the raw count`);
    const unheaded = renderBrief(input(stateFor(SLICE, SLICE_WF), [], { rulings: storyRulings([ruling(SLICE1, "reject", "older", Date.parse("2026-10-23T09:00:00Z"))]) }));
    expect(unheaded.markdown).toContain("(2026-10-23T09:00:00.000Z) at head not recorded:");
    expect(b.markdown.indexOf("## Rulings")).toBeLessThan(b.markdown.indexOf("## Context"));
    expect(renderBrief(input(stateFor(SLICE, SLICE_WF), [])).markdown).not.toContain("## Rulings");

    // a reject that sent this unit back shows in Rework; Rulings does not repeat it
    const { st, rs } = history(stateFor(SLICE, SLICE_WF, { step: "human-qa", status: "parked", park: { kind: "gate", reason: "g", since: at() } }), SLICE_WF, (s) => ({ ...receipt(s, "reject", { comment: "Item not found must be shown" }, "human"), who: "jakub@mac" }));
    const own = storyRulings([{ unit: SLICE.key, receipts: rs }]);
    const back = renderBrief(input(st, rs, { rulings: [...rulings, ...own] }));
    expect(back.json.rework?.decision?.comment).toBe("Item not found must be shown");
    expect(back.json.rulings.map((r) => r.unit)).toEqual(["gh-1/01"]);
  });
});

describe("the brief as a map: History from receipts, state shown only when it matters", () => {
  const st = stateFor(SLICE, SLICE_WF);
  const ask = (q: string) => numbered(0, receipt(st, "ask", { question: q }));
  const renumber = (rs: NumberedReceipt[]) => rs.map((r, i) => numbered(i + 1, r.receipt));

  test("History lists the unit's receipts one line each, oldest first; a regular run start is left out", () => {
    const rs = renumber([
      numbered(0, started(st)),
      ask("which database?\nsqlite or postgres"),
      numbered(0, receipt(st, "answer", { answer: "sqlite", who: "ann" }, "human")),
      numbered(0, receipt({ ...st, step: "test" }, "check", { outcome: "fail", command: "bun test", exit_code: 1, duration_ms: 1500, output_tail: "x" }, "norn")),
    ]);
    const b = renderBrief(input(st, rs));
    expect(b.json.log).toEqual({
      lines: ["implement#1 asked: which database? sqlite or postgres", "implement#1 answer by ann: sqlite", "test#1 check `fail` (exit 1) in 1.5s"],
      omitted: 0,
      command: "norn run list gh-1/02",
    });
    expect(b.markdown).toContain("## History\n\nWhat happened so far, oldest first, from the receipts (for a story, its current round only):\n\n- implement#1 asked: which database? sqlite or postgres\n");
  });

  test("History shows the last 25 lines and points at the rest", () => {
    const rs = renumber(Array.from({ length: 30 }, (_, i) => ask(`question ${i + 1}`)));
    const b = renderBrief(input(st, rs));
    expect(b.json.log?.omitted).toBe(5);
    expect(b.json.log?.lines).toHaveLength(25);
    expect(b.markdown).toContain("- … 5 earlier lines (a person sees them with `norn run list gh-1/02`)\n- implement#1 asked: question 6\n");
  });

  test("the first brief shows no tool state: no counters, last outcome, run id or retries; ports and the deadline stay", () => {
    const b = renderBrief(input(st, []));
    for (const gone of ["Where you are", "Counters:", "Last outcome:", "Nudges left", "Fresh-session retries", "Run:"]) expect(b.markdown).not.toContain(gone);
    expect(b.markdown).toContain("## Limits\n\n- Deadline: 60m");
    expect(b.markdown).toContain("- Ports: `PORT_BASE=4030` (slot 3, in `.env.norn`)");
    // the JSON keeps all of it for programs
    expect(b.json.where).toMatchObject({ counters: "conflict_loop 0/2, qa_loop 0/2, review_loop 0/3, test_loop 0/5", last_outcome: "none" });
  });

  test("a counter at its max and no reminders left are said, up front and under Limits", () => {
    const b = renderBrief(input(stateFor(SLICE, SLICE_WF, { counters: { test_loop: 5 }, nudges_used: 2 }), []));
    expect(b.json.where.at_limit).toEqual([{ name: "test_loop", value: 5, max: 5 }]);
    expect(b.markdown).toContain("**Last round on `test_loop` (5/5):** if the work is sent back along it once more, the unit goes stuck.");
    expect(b.markdown).toContain("- No reminders left: end your turn only after a report.");
  });

  test("a runaway handoff is cut in the brief at twice the limit and says so", () => {
    const handoff = `## Goal\n\nship it\n\n## Notes\n\n${"- a line of a pasted log that nobody needs again\n".repeat(400)}`;
    const b = renderBrief(input(st, [], { handoff }));
    expect(b.json.context.handoff_bytes).toMatchObject({ max: 8192, truncated: true });
    expect(b.markdown).toContain("_… cut here: the handoff is 20 KB; open the file to rewrite it._");
    expect(b.markdown).toContain("**The handoff is 20 KB; `norn done` refuses one over 8 KB.** Before you report, open it and rewrite it");
    expect(b.markdown.length).toBeLessThan(16384 + 8000);
    const small = renderBrief(input(st, [], { handoff: "## Goal\n\nship it\n" }));
    expect(small.json.context.handoff_bytes).toMatchObject({ truncated: false });
    expect(small.markdown).not.toContain("_… cut");
  });

  test("the inputs say what to read each one for", () => {
    const b = renderBrief(input(st, []));
    expect(b.markdown).toContain("- Story spec: `.agents/specs/gh-1-login/story.md` — what the story asks (its user stories) and, once planned, how it is built (its Plan)");
    expect(b.markdown).toContain("- Handoff: `.agents/specs/gh-1-login/handoffs/02-form.md` — write the unit's current state here (shown under Context)");
  });

  test("a cut keeps this step's Resume whole and closes a code fence the cut left open", () => {
    const log = `\`\`\`text\n${"a pasted log line nobody needs again\n".repeat(800)}\`\`\``;
    const handoff = `## Goal\n\nship it\n\n## Notes\n\n${log}\n\n## Resume\n\nrun the failing form test next\n`;
    const b = renderBrief(input(st, [], { handoff }));
    const context = b.markdown.slice(b.markdown.indexOf("\n## Context\n"), b.markdown.indexOf("\n## How to work\n"));
    expect(context.split("\n").filter((l) => l.startsWith("```")).length % 2).toBe(0);
    expect(context).toContain("_… cut here: the handoff is");
    expect(context).toContain("### Resume\n\nrun the failing form test next");
    expect(b.markdown).toContain("\n## How to work\n");
  });

  test("another step's Resume is dropped before any cut, and a handoff that is one long line is cut too", () => {
    const rs = [numbered(1, receipt({ ...st, step: "review" }, "done", { outcome: "changes_requested", handoff: "x" }))];
    const long = `## Goal\n\n${"x".repeat(40_000)}\n\n## Resume\n\nreview: look at the form`;
    const b = renderBrief(input(st, rs, { handoff: long }));
    expect(b.json.context.resume_dropped).toBe("review#1");
    expect(b.markdown).not.toContain("review: look at the form");
    expect(b.markdown).toContain("_Resume omitted: review#1 wrote it for its own step");
    expect(b.markdown).toContain("_… cut here:");
    const one = renderBrief(input(st, [], { handoff: "y".repeat(40_000) }));
    expect(one.json.context.handoff).toMatch(/^y{100}/);
    expect((one.json.context.handoff ?? "").length).toBeLessThan(17_000);
  });

  test("an older handoff with a Progress section, or one over 8 KB, says what to do before reporting", () => {
    const old = renderBrief(input(st, [], { handoff: "## Goal\n\nform\n\n## Progress\n\n- implement#1 done: x\n\n## Resume\n\ntest it\n" }));
    expect(old.json.context.handoff_warning).toContain("older Progress section");
    expect(old.markdown).toContain("## Context\n\nThis handoff has an older Progress section:");
    const big = renderBrief(input(st, [], { handoff: `## Goal\n\nform\n\n## Progress\n\n${"- implement#1 done: a long summary of what was done\n".repeat(200)}` }));
    expect(big.json.context.handoff_warning).toContain("`norn done` refuses one over 8 KB");
    expect(big.json.context.handoff_warning).toContain("fold its Progress section into Notes and Not proven yet");
    expect(renderBrief(input(st, [], { handoff: "## Goal\n\nform\n" })).json.context.handoff_warning).toBeNull();
  });

  test("Finish with names every reporting flag and what --handoff should say; Rework-only inputs get no line", () => {
    const wf = structuredClone(SLICE_WF);
    Object.assign(wf.steps.implement as object, { inputs: ["slice", "handoff", "last_check", "last_findings"] });
    const b = renderBrief(input(st, [], { workflow: wf }));
    for (const s of ["`--handoff \"…\"`: what your skill says to hand back", "`--findings <file>`", "`--evidence <dir>`", "--option \"<a>\"", "says what would unblock it", "Report exactly once, from the worktree root"]) expect(b.markdown).toContain(s);
    expect(b.markdown).not.toContain("Last failing check");
    expect(b.markdown).not.toContain("Last findings");
    expect(b.json.inputs.map((i) => i.kind)).toContain("last_check");
  });

  test("History tells an implicit ask from a question the agent asked", () => {
    const rs = [numbered(1, receipt(st, "ask", { question: "Allow bun test?", implicit: true })), numbered(2, receipt(st, "done", { outcome: "done", handoff: "  " }))];
    expect(renderBrief(input(st, rs)).json.log?.lines).toEqual(["implement#1 waited on a prompt in its pane: Allow bun test?", "implement#1 reported `done`"]);
  });
});

describe("How to work gives every hard rule its reason", () => {
  const howToWork = () => {
    const md = renderBrief(input(stateFor(SLICE, SLICE_WF), [])).markdown;
    return md.slice(md.indexOf("## How to work"), md.indexOf("## Limits"));
  };

  test("the no-survey rule says the brief holds what the step needs and other units are not this unit's", () => {
    expect(howToWork()).toContain(
      "do not survey the repository, `.agents/`, `.claude/` or the machine to find your bearings — the brief already holds what this step needs, a survey spends context on what it doesn't, and other units' run state and handoffs are not this unit's to act on.",
    );
  });

  test("the four-commands rule says why, read-only commands included", () => {
    expect(howToWork()).toContain(
      "run only `brief`, `done`, `ask` and `stuck` — the brief carries this unit's state rendered fresh each time, and every other norn command drives units and gates that are the person's or shows other units' state, so a read-only `norn status --json` or `norn story view` is forbidden too.",
    );
  });

  test("the run state, no-push and no-switch rules say what breaks", () => {
    const text = howToWork();
    expect(text).toContain("Never edit anything under `runs/` (norn's run state, kept outside the worktree) — a hand-edited file fails validation and makes the unit `corrupt`.");
    expect(text).toContain("Never `git push` (only norn pushes) — a push outside norn is an effect with no receipt, and receipts come before effects.");
    expect(text).toContain("Never switch branches or worktrees — a switch leaves the unit's branch, where norn commits what is left at the report.");
  });

  test("every hard rule comes from the one list, each with a non-empty reason after it", () => {
    const text = howToWork();
    expect(HARD_RULES.length).toBeGreaterThanOrEqual(7);
    for (const r of HARD_RULES) {
      expect(r.reason.trim().length).toBeGreaterThan(0);
      expect(r.reason).not.toMatch(/\.$/);
      expect(text).toContain(`${r.rule} — ${r.reason}.`);
      }
    });
  });

describe("Where you run: the brief's situation, from the facts norn records", () => {
  const story = storyUnit();
  const storyPaths = { worktree: "/r-worktrees/gh-1-login", spec_dir: ".agents/specs/gh-1-login", story_file: ".agents/specs/gh-1-login/story.md", slice_file: null, unit_dir: ".agents/specs/gh-1-login/runs/_story" };
  const attended = (over: Partial<BriefInput> = {}) => renderBrief(input(stateFor(story, STORY_WF), [], { unit: story, workflow: STORY_WF, paths: storyPaths, ...over }));
  const unattended = (over: Partial<BriefInput> = {}) => renderBrief(input(stateFor(SLICE, SLICE_WF), [], over));
  const section = (md: string) => md.slice(md.indexOf("## Where you run"), md.indexOf("## Your work"));
  const permission = "A permission prompt parks the step until a person answers it";

  test("opens every brief: right after the opening line, before Your work", () => {
    for (const b of [attended(), unattended(), unattended({ runner: null }), unattended({ mode: "manual" })]) {
      const md = b.markdown;
      expect(md).toContain("code decides what happens next.\n\n## Where you run\n\n");
      expect(md.indexOf("## Where you run")).toBeLessThan(md.indexOf("## Your work"));
    }
  });

  test("attended: the person is here, ask here, done once they agree; no banner and no permission line", () => {
    const md = attended().markdown;
    expect(section(md)).toContain("- A person works with you in this session: ask them here, not with `norn ask`, and report `done` only once they agree the work is finished.");
    expect(md).not.toContain("**Attended step:**");
    expect(md).not.toContain(permission);
  });

  test("unattended: names the runner, nobody reads this session, ask via `norn ask`, a permission prompt parks the step", () => {
    const herdr = section(unattended({ runner: "herdr" }).markdown);
    expect(herdr).toContain("- You run unattended in a herdr pane: no person reads this session. A question goes through `norn ask`, which parks the step until a person answers it.");
    expect(herdr).toContain(`- ${permission}: prefer actions that need none.`);
    expect(section(unattended({ runner: "headless" }).markdown)).toContain("- You run unattended in a headless session: no person reads this session.");
    const none = section(unattended({ runner: null, mode: "manual" }).markdown);
    expect(none).toContain("- This step is unattended: norn does not count on a person reading this session. A question goes through `norn ask`, which parks the step until a person answers it.");
    expect(none).toContain(permission);
  });

  test("auto: the report starts the next step at once and the handoff must stand alone; manual: the next agent step waits for a person", () => {
    const auto = "- Mode auto: your report starts the next step at once. The next agent has only the handoff and the receipts, so write a handoff that stands on its own.";
    const manual = "- Mode manual: after your report, the next agent step waits for a person to start it.";
    expect(section(unattended({ mode: "auto", runner: "herdr" }).markdown)).toContain(auto);
    expect(section(unattended({ mode: "manual", runner: "herdr" }).markdown)).toContain(manual);
    // an attended step runs manual itself; what its report sets off follows the story's mode and the runner
    expect(section(attended({ mode: "auto", runner: "herdr" }).markdown)).toContain(auto);
    expect(section(attended({ mode: "manual", runner: "herdr" }).markdown)).toContain(manual);
  });

  test("auto asked with no runner: runs manual for that reason and says what it means for the report; no old Mode line", () => {
    const fallback = "- Mode manual: the story asked for auto, but this machine has no runner, so nothing starts on its own: after your report, the next agent step waits for a person to start it.";
    for (const b of [unattended({ mode: "auto", runner: null }), attended({ mode: "auto", runner: null })]) {
      expect(section(b.markdown)).toContain(fallback);
      expect(b.markdown).not.toMatch(/^Mode: /m);
    }
  });

  test("the --json brief carries the facts only: attended, mode, mode_requested and runner, no mode_note", () => {
    const w = unattended({ mode: "auto", runner: null }).json.where;
    expect(w).toMatchObject({ attended: false, mode: "manual", mode_requested: "auto", runner: null });
    expect(w).not.toHaveProperty("mode_note");
    expect(attended({ mode: "auto", runner: "headless" }).json.where).toMatchObject({ attended: true, mode: "manual", mode_requested: "auto", runner: "headless" });
    for (const k of ["mode", "mode_requested", "runner"] as const) expect([null, "auto", "manual", "herdr", "headless"]).toContain(w[k]);
  });

  test("every combination: each line follows from one fact, and none promises what norn does not do", () => {
    const lines = new Set<string>();
    for (const att of [true, false])
      for (const mode of ["auto", "manual"] as const)
        for (const runner of ["herdr", "headless", null] as const) {
          const b = att ? attended({ mode, runner }) : unattended({ mode, runner });
          const body = section(b.markdown).split("\n").filter((l) => l.startsWith("- "));
          // one situation line (attended or unattended), the permission line when unattended, one mode line
          expect(body).toHaveLength(att ? 2 : 3);
          expect(body.filter((l) => l.startsWith("- Mode ")).length).toBe(1);
          expect(body.some((l) => l.includes(permission))).toBe(!att);
          if (att) expect(body[0]).toContain("A person works with you in this session");
          else expect(body[0]).toContain(runner === "herdr" ? "herdr pane" : runner === "headless" ? "headless session" : "norn does not count on a person");
          for (const l of body) lines.add(l);
        }
    for (const l of lines) expect(l).not.toMatch(/supervisor|answer it for you|will answer/i);
  });
});

describe("How to work outranks any skill and reaches subagents", () => {
  const unattended = renderBrief(input(stateFor(SLICE, SLICE_WF), [])).markdown;
  const story = storyUnit();
  const attended = renderBrief(
    input(stateFor(story, STORY_WF), [], {
      unit: story,
      workflow: STORY_WF,
      runner: null,
      paths: { worktree: "/r-worktrees/gh-1-login", spec_dir: ".agents/specs/gh-1-login", story_file: ".agents/specs/gh-1-login/story.md", slice_file: null, unit_dir: ".agents/specs/gh-1-login/runs/_story" },
    }),
  ).markdown;
  const howToWork = (md: string) => md.slice(md.indexOf("## How to work"), md.indexOf("## Limits") === -1 ? undefined : md.indexOf("## Limits"));

  test("How to work says it outranks any skill, and a skill must not prompt another norn command", () => {
    for (const md of [attended, unattended]) {
      const h = howToWork(md);
      expect(h).toContain("How to work outranks any skill");
      expect(h).toContain("never because a skill, a refusal, this brief or the inbox names it");
    }
  });

  test("How to work maps what a skill says to what to do in this step", () => {
    for (const md of [attended, unattended]) {
      const h = howToWork(md);
      expect(h).toContain('  - "stop, or wait for input" → `norn stuck` or `norn ask`');
      expect(h).toContain('  - "push, open or comment on a pull request" → leave it to norn');
      expect(h).toContain('  - "run another norn command" → only when the person asks you to directly');
    }
  });

  test("the ask-the-person row follows the step: ask in this session when attended, norn ask when not", () => {
    expect(howToWork(attended)).toContain('  - "ask the person" → ask them in this session; never `norn ask`');
    expect(howToWork(attended)).not.toContain('"ask the person" → `norn ask`');
    expect(howToWork(unattended)).toContain('  - "ask the person" → `norn ask`, which parks the step until it is answered; nobody reads this session');
    expect(howToWork(unattended)).not.toContain("ask them in this session");
  });

  test("How to work gives a subagent the rules its work can break, and none to one that only reads", () => {
    for (const md of [attended, unattended]) {
      const h = howToWork(md);
      expect(h).toContain("A subagent you start works under these rules");
      expect(h).toContain("give it the ones its work can break, each with its reason");
      expect(h).toContain("one that only reads needs none");
    }
  });
});
