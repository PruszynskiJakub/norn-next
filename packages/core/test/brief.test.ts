import { describe, expect, test } from "bun:test";
import type { Receipt, UnitState } from "@norn/schema";
import { applyReceipts } from "../src/apply.ts";
import { type BriefInput, renderBrief } from "../src/brief.ts";
import type { NumberedReceipt } from "../src/facts.ts";
import { at, numbered, receipt, SLICE_WF, sliceUnit, STORY_WF, stateFor, storyUnit } from "./fixtures.ts";

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

  test("rework after a failing check shows the output tail and log", () => {
    const { st, rs } = history(stateFor(SLICE, SLICE_WF), SLICE_WF, started, done("done"), (s) =>
      receipt(s, "check", { outcome: "fail", command: "bun test", exit_code: 1, duration_ms: 900, output_tail: "✓ a\n✗ login rejects empty password\n  expected 400, got 200", log: `logs/${RUN}.log` }, "norn"),
    );
    expect(st).toMatchObject({ step: "implement", attempt: 2 });
    const b = renderBrief(input(st, rs, { handoff: "## Goal\nLogin form\n\n## Progress\n- form renders" }));
    expect(b.json.rework).toMatchObject({ from: "test.fail", check: { exit_code: 1, log: `.agents/specs/gh-1-login/runs/02-form/logs/${RUN}.log` }, findings: null });
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

  test("declared inputs drop findings and checks that a later pass settled (B6)", () => {
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
    expect(b.json.rework).toBeNull();
  });

  test("non-agent steps have no briefing", () => {
    expect(() => renderBrief(input(stateFor(SLICE, SLICE_WF, { step: "test" }), []))).toThrow("not an agent step");
  });
});
