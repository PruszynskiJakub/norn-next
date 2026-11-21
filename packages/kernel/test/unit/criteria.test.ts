import { describe, expect, test } from "bun:test";
import type { CriterionVerdict } from "@norn/schema";
import { checkCriteriaReport, type CriteriaCheckInput, worstVerdict } from "../../src/index.ts";

const QA_VERDICTS = { pass: "pass", fail: "fail", partial: "person", unverified: "unverified" } as const;
const OUTCOMES = ["pass", "fail", "partial", "unverified"];
const v = (id: string, verdict: CriterionVerdict["verdict"]): CriterionVerdict =>
  verdict === "pass"
    ? { id, verdict, evidence: "seen" }
    : verdict === "fail"
      ? { id, verdict, repro: "do x" }
      : verdict === "person"
        ? { id, verdict, how: "look" }
        : { id, verdict, reason: "no browser", how: "open it" };

const check = (over: Partial<CriteriaCheckInput>) =>
  checkCriteriaReport({ step: "qa", spec: { criteria: true, verdict: { ...QA_VERDICTS } }, outcomes: OUTCOMES, outcome: "pass", report: null, criteria: null, ...over });

describe("checkCriteriaReport", () => {
  test("the worst verdict ranks fail > unverified > person > pass", () => {
    expect(worstVerdict([v("a", "pass"), v("b", "person")])).toBe("person");
    expect(worstVerdict([v("a", "person"), v("b", "unverified")])).toBe("unverified");
    expect(worstVerdict([v("a", "unverified"), v("b", "fail"), v("c", "pass")])).toBe("fail");
    expect(worstVerdict([])).toBeNull();
  });

  test("a step with criteria: required refuses a done without a report; one without it takes none", () => {
    expect(check({})).toMatchObject({ ok: false, refusal: { code: "criteria_required" } });
    expect(check({ spec: { criteria: false, verdict: {} }, outcomes: ["done"], outcome: "done" })).toEqual({ ok: true, worst: null, coverage: null });
  });

  test("an outcome gated by a verdict needs a report though the step does not require one", () => {
    const r = check({ spec: { criteria: false, verdict: { unsure: "unverified" } }, outcomes: ["done", "unsure"], outcome: "unsure" });
    expect(r).toMatchObject({ ok: false, refusal: { code: "criteria_required", error: "outcome 'unsure' is gated by verdict 'unverified': it needs a criteria report to check against" } });
    expect(check({ spec: { criteria: false, verdict: { unsure: "unverified" } }, outcomes: ["done", "unsure"], outcome: "done" })).toMatchObject({ ok: true });
  });

  test("each outcome takes only the report whose worst verdict it is gated by", () => {
    const report = [v("AC1", "pass"), v("AC2", "person")];
    expect(check({ outcome: "partial", report })).toEqual({ ok: true, worst: "person", coverage: "unchecked" });
    expect(check({ outcome: "pass", report })).toMatchObject({ ok: false, refusal: { code: "outcome_contradicts_verdicts", do_instead: "norn done partial" } });
    expect(check({ outcome: "unverified", report: [v("AC1", "unverified"), v("AC2", "person")] })).toMatchObject({ ok: true, worst: "unverified" });
  });

  test("with declared criteria the report covers exactly them, once each", () => {
    const criteria = [
      { id: "AC1", verifier: "agent" as const },
      { id: "AC2", verifier: "test" as const },
    ];
    expect(check({ report: [v("AC1", "pass"), v("AC2", "pass")], criteria })).toEqual({ ok: true, worst: "pass", coverage: "checked" });
    expect(check({ report: [v("AC1", "pass")], criteria })).toMatchObject({ ok: false, refusal: { code: "invalid_criteria" } });
    expect(check({ report: [v("AC1", "pass"), v("AC1", "pass")] })).toMatchObject({ ok: false, refusal: { code: "invalid_criteria" } });
  });
});
