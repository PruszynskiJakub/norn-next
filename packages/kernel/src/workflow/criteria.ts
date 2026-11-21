/**
 * Honest QA: whether `done <outcome>` may be recorded with a criteria report. Pure, so the host only
 * reads the report and the unit's declared criteria and asks; decide never reads the prose
 * Acceptance section, only frontmatter `criteria` and the report.
 */
import { type Criterion, type CriterionVerdict, reportPath, type Verdict } from "@norn/schema";
import type { AgentStepSpec } from "./graph.ts";

/** `fail` > `unverified` > `person` > `pass`. */
const VERDICT_RANK: Readonly<Record<Verdict, number>> = { pass: 0, person: 1, unverified: 2, fail: 3 };

/** The worst verdict in a report; null for an empty one. */
export function worstVerdict(report: readonly CriterionVerdict[]): Verdict | null {
  let worst: Verdict | null = null;
  for (const c of report) if (worst === null || VERDICT_RANK[c.verdict] > VERDICT_RANK[worst]) worst = c.verdict;
  return worst;
}

export function verdictCounts(report: readonly CriterionVerdict[]): Record<Verdict, number> {
  const out: Record<Verdict, number> = { pass: 0, fail: 0, person: 0, unverified: 0 };
  for (const c of report) out[c.verdict]++;
  return out;
}

export type CriteriaRefusalCode = "criteria_required" | "invalid_criteria" | "outcome_contradicts_verdicts";

export interface CriteriaRefusal {
  code: CriteriaRefusalCode;
  error: string;
  do_instead: string;
}

export interface CriteriaCheckInput {
  step: string;
  spec: Pick<AgentStepSpec, "criteria" | "verdict">;
  /** the outcomes `done` may report at the step, in the workflow's order */
  outcomes: readonly string[];
  outcome: string;
  /** the report, already valid against `CriteriaReport`; null when none was given */
  report: readonly CriterionVerdict[] | null;
  /** the unit's frontmatter `criteria`; null when it declares none */
  criteria: readonly Criterion[] | null;
  /** how the report command is spelled, for the refusals' do_instead */
  done?: string;
}

export type CriteriaCheck =
  | {
      ok: true;
      worst: Verdict | null;
      /** `checked` against the declared ids; `unchecked` when the unit declares none; null without a report */
      coverage: "checked" | "unchecked" | null;
    }
  | { ok: false; refusal: CriteriaRefusal };

/** Whether a step asks for a report at all: `criteria: required`, or an outcome gated by a verdict. */
export function wantsCriteria(spec: Pick<AgentStepSpec, "criteria" | "verdict">): boolean {
  return spec.criteria || Object.keys(spec.verdict).length > 0;
}

/**
 * May this `done <outcome>` be recorded with this report?
 * - `criteria: required`, or an outcome gated by `verdict`, needs a report;
 * - each id once, and with declared criteria exactly those ids;
 * - an outcome gated by verdict `v` only when the report's worst verdict is `v`.
 */
export function checkCriteriaReport(input: CriteriaCheckInput): CriteriaCheck {
  const { spec, outcome, report } = input;
  const done = input.done ?? "norn done";
  const withReport = (o: string) => `${done} ${o}`;
  const gated = spec.verdict[outcome];
  const no = (code: CriteriaRefusalCode, error: string, do_instead: string): CriteriaCheck => ({ ok: false, refusal: { code, error, do_instead } });
  const expected = input.criteria ? [...new Set(input.criteria.map((c) => c.id))] : null;

  if (!report) {
    if (spec.criteria || gated !== undefined)
      return no(
        "criteria_required",
        spec.criteria
          ? `step ${input.step} produces criteria with every outcome: one verdict per criterion`
          : `outcome '${outcome}' is gated by verdict '${gated}': it needs a criteria report to check against`,
        `write the report (a JSON array of {id, verdict, ...}${expected ? ` covering ${expected.join(", ")}` : ""}) to ${reportPath("criteria")}, then run: ${withReport(outcome)}`,
      );
    return { ok: true, worst: null, coverage: null };
  }

  const ids = report.map((c) => c.id);
  const dup = [...new Set(ids.filter((id, i) => ids.indexOf(id) !== i))];
  if (dup.length) return no("invalid_criteria", `the criteria report lists ${dup.join(", ")} more than once`, `give each criterion exactly one verdict${expected ? `: ${expected.join(", ")}` : ""}, then report again`);
  if (expected) {
    const missing = expected.filter((id) => !ids.includes(id));
    const unknown = ids.filter((id) => !expected.includes(id));
    if (missing.length || unknown.length) {
      const what = [missing.length ? `missing ${missing.join(", ")}` : "", unknown.length ? `unknown ${unknown.join(", ")}` : ""].filter(Boolean).join("; ");
      return no("invalid_criteria", `the criteria report must cover exactly the unit's criteria (${expected.join(", ")}): ${what}`, `give one verdict for each of ${expected.join(", ")} and no other ids, then report again`);
    }
  }

  const worst = worstVerdict(report) as Verdict;
  if (gated !== undefined && gated !== worst) {
    const matching = input.outcomes.filter((o) => spec.verdict[o] === worst);
    const culprits = report.filter((c) => c.verdict === worst).map((c) => c.id);
    return no(
      "outcome_contradicts_verdicts",
      `outcome '${outcome}' needs the worst verdict to be '${gated}', but it is '${worst}' (${culprits.join(", ")})${matching.length ? `; the matching outcome is ${matching.map((o) => `'${o}'`).join(" or ")}` : ""}`,
      matching.length ? matching.map(withReport).join(" | ") : `no outcome of ${input.step} is gated by '${worst}': re-check ${culprits.join(", ")}, or report \`norn stuck "<why>"\``,
    );
  }
  return { ok: true, worst, coverage: expected ? "checked" : "unchecked" };
}
