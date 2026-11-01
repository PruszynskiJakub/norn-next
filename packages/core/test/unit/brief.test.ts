import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { Receipt, UnitState, Workflow } from "@norn/schema";
import { applyReceipts } from "../../src/apply.ts";
import { type BriefInput, renderBrief, storyRulings } from "../../src/brief.ts";
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
    st = applyReceipts(st, [nr], { workflow: wf, now: at(), limits: { nudges: 2, retries: 1 } }).state;
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

describe("renderBrief (B3)", () => {
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
      "## Your work\n\nUse the `implement` skill.\n\nBuild the slice test-first.\n\nBase mode: merge the base commit named in Rework; never rebase.\n\n## Inputs",
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
    expect(b.json.where).toMatchObject({ mode: "manual", attended: true, mode_note: null });
    expect(b.json.context.answers).toEqual([{ question: "Email or username?", answer: "Email" }]);
    expect(b.markdown).toMatchSnapshot();
  });

  test("declared inputs, entered from review: findings shown, a failing check settled by a later pass is not (B6)", () => {
    const wf = structuredClone(SLICE_WF);
    (wf.steps.implement as { inputs?: unknown }).inputs = ["slice", "last_check", "last_findings"];
    const { st, rs } = history(stateFor(SLICE, wf), wf, started, done("done"), (s) =>
      receipt(s, "check", { outcome: "fail", command: "bun test", exit_code: 2, duration_ms: 1, output_tail: "boom" }, "norn"), started, done("done"), (s) =>
      receipt(s, "check", { outcome: "pass", command: "bun test", exit_code: 0, duration_ms: 1, output_tail: "" }, "norn"), started, done("changes_requested", { findings: [{ severity: "major", title: "Edge case" }] }));
    const b = renderBrief(input(st, rs, { workflow: wf }));
    // the failing check was fixed by a later pass: it is not rework (B6)
    expect(b.json.rework?.check).toBeNull();
    expect(b.json.rework?.findings?.items[0]?.title).toBe("Edge case");
    expect(b.json.inputs.map((i) => i.kind)).toEqual(["slice", "last_check", "last_findings"]);
  });

  test("declared last_check shows only the failure after the previous attempt, not an older one (B6)", () => {
    const wf = structuredClone(SLICE_WF);
    (wf.steps.implement as { inputs?: unknown }).inputs = ["last_check"];
    const fail = (tailText: string) => (s: UnitState) => receipt(s, "check", { outcome: "fail", command: "bun test", exit_code: 1, duration_ms: 1, output_tail: tailText }, "norn");
    const { st, rs } = history(stateFor(SLICE, wf), wf, started, done("done"), fail("old"), started, done("done"), fail("new"));
    const b = renderBrief(input(st, rs, { workflow: wf }));
    expect(b.json.rework?.check?.output_tail).toBe("new");
  });

  test("declared inputs drop findings and checks that a later pass settled; a gate reject shows its comment (B6)", () => {
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

/** SLICE_WF with implement declaring the rework inputs (B6), as the shipped workflows do. */
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

describe("Rework only when sent back (B3, B6, W4)", () => {
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
    expect(b.markdown).toContain("### Notes from review (non-blocking)");
    expect(b.markdown).toMatchSnapshot();
  });

  test("test.fail after the qa rework round: the check only; qa's failure was settled by the previous attempt (B6)", () => {
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

describe("Re-entry, fresh sessions, handoff and criteria (B2, C2, QV1)", () => {
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
    const b = renderBrief(input(st, rs, { workflow: QA_WF, handoff: HANDOFF, criteria: [{ id: "AC1", verifier: "agent" }, { id: "AC2", verifier: "agent", needs: ["browser"] }], capabilities: [] }));
    expect(b.json.rework).toBeNull();
    expect(b.json.history).toEqual({
      retry: { outcome: "qa.died", detail: "launch_unknown", at: at() },
      earlier: { attempt: 1, outcome: "fail", since: ["implement.done", "test.pass", "review.approve"] },
    });
    expect(b.json.context.resume_dropped).toBe("review#2");
    expect(b.markdown).not.toContain("Nothing left; report done.");
    expect(b.markdown).toContain("Footer shows the total.");
    expect(b.json.criteria).toEqual([
      { id: "AC1", verifier: "agent", needs: [], missing: [] },
      { id: "AC2", verifier: "agent", needs: ["browser"], missing: ["browser"] },
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
  for (const r of receipts) st = applyReceipts(st, [r], { workflow: wf, now: r.receipt.at, limits: { nudges: 2, retries: 1 } }).state;
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
    expect(b.markdown).not.toContain("`see Rework`\n\n## Context");
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
    expect(b.markdown).not.toContain("li.overdue");
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
    for (const r of receipts) st = applyReceipts(st, [r], { workflow: wf, now: r.receipt.at, limits: { nudges: 2, retries: 1 } }).state;
    expect(st).toMatchObject({ step: "qa" });
    const b = renderBrief({ ...input(st, receipts), unit, workflow: wf });
    expect(b.json.rework).toBeNull();
    expect(b.json.context.notes?.items).toHaveLength(3);
  });
});

describe("Rulings (F28, O2): gate reasons as story-level notes", () => {
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
    // C2/QV5a: rulings answer questions; they never stand in for a criterion's verdict on new code
    expect(b.markdown).toContain("A ruling never turns a criterion into `pass`");
    expect(b.markdown).toContain("At most a ruling informs a `person` verdict");
    expect(b.markdown).not.toContain("settle the questions");
    // each ruling is tied to the head it judged (C2)
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
