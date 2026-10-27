/**
 * Honest QA (QV1–QV8) and notes for a person (NT1–NT4). Pure: `norn done` asks `checkReport`
 * whether a report may be written; inbox and brief read verdicts and notes from receipts. Decide
 * never reads the prose Acceptance section (P8) — only frontmatter `criteria` and the report.
 */
import { type AgentStep, type Criterion, type CriterionVerdict, type Note, noteId, outcomeEdge, type OutcomeSpec, type Receipt, type Verdict } from "@norn/schema";
import type { NumberedReceipt } from "./facts.ts";
import { epoch } from "./time.ts";
import { reportableOutcomes } from "./workflow.ts";

/** QV5: `fail` > `unverified` > `person` > `pass`. */
const VERDICT_RANK: Readonly<Record<Verdict, number>> = { pass: 0, person: 1, unverified: 2, fail: 3 };

/** QV5: the worst verdict in a report; null for an empty one. */
export function worstVerdict(report: readonly CriterionVerdict[]): Verdict | null {
  let worst: Verdict | null = null;
  for (const c of report) if (worst === null || VERDICT_RANK[c.verdict] > VERDICT_RANK[worst]) worst = c.verdict;
  return worst;
}

export type CriteriaRefusalCode = "criteria_required" | "invalid_criteria" | "pass_without_capability" | "outcome_contradicts_verdicts";

export interface CriteriaRefusal {
  code: CriteriaRefusalCode;
  error: string;
  do_instead: string;
  details?: Record<string, unknown>;
}

export interface CriteriaCheckInput {
  /** the cursor step and its name */
  step: AgentStep;
  step_name: string;
  outcome: string;
  /** the `--criteria` report, already schema-valid (CriteriaReport); null = none given */
  report: readonly CriterionVerdict[] | null;
  /** the unit's frontmatter `criteria` (slice file, or story.md for the story unit); null = none declared */
  criteria: readonly Criterion[] | null;
  /** `--note` values (NT1) */
  notes: readonly Note[];
  /** QV5a: capabilities of the agent reporting (config `agents.<name>.capabilities`; none declared = []) */
  capabilities: readonly string[];
}

export type CriteriaCheck =
  | {
      ok: true;
      worst: Verdict | null;
      /** QV4: `checked` against frontmatter ids; `unchecked` when the unit declares no criteria; null = no report */
      coverage: "checked" | "unchecked" | null;
    }
  | { ok: false; refusal: CriteriaRefusal };

const edgeVerdict = (step: AgentStep, outcome: string): Verdict | undefined => {
  const spec = step.outcomes[outcome] as OutcomeSpec | undefined;
  return spec === undefined ? undefined : outcomeEdge(spec).verdict;
};

const doneCmd = (o: string, criteria: boolean) => `norn done ${o}${criteria ? " --criteria <file>" : ""} --handoff "…"`;

/**
 * QV3–QV5, NT1: may this `norn done <outcome>` be written with this report and these notes?
 * - QV3: `criteria: required` (or an outcome gated by `verdict`) needs a report;
 * - QV4: with frontmatter `criteria`, the report covers exactly those ids, once each; a note's
 *   `--note-criterion` names one of them;
 * - QV5a: `pass` only for criteria whose `needs` the reporting agent's capabilities cover;
 * - QV5: an outcome with `verdict: v` only when the worst verdict in the report is `v`.
 */
export function checkReport(input: CriteriaCheckInput): CriteriaCheck {
  const { step, outcome, report, criteria } = input;
  const gated = edgeVerdict(step, outcome);
  const refuse = (code: CriteriaRefusalCode, error: string, do_instead: string, details?: Record<string, unknown>): CriteriaCheck => ({
    ok: false,
    refusal: { code, error, do_instead, ...(details ? { details } : {}) },
  });
  const expected = criteria ? [...new Set(criteria.map((c) => c.id))] : null;

  // NT1/QV4: a note about a criterion names a declared one
  if (expected) {
    const bad = input.notes.filter((n) => n.criterion !== undefined && !expected.includes(n.criterion)).map((n) => n.criterion as string);
    if (bad.length)
      return refuse("invalid_criteria", `--note-criterion ${bad.join(", ")} is not a criterion of this unit; its criteria are ${expected.join(", ")}`, `name one of ${expected.join(", ")} with --note-criterion, or drop it`, { expected, unknown: bad });
  }

  if (!report) {
    // QV3: required by the step, or implied by an outcome gated on a verdict (QV5)
    if (step.criteria === "required" || gated)
      return refuse(
        "criteria_required",
        step.criteria === "required"
          ? `step ${input.step_name} requires a criteria report (criteria: required): one verdict per criterion`
          : `outcome '${outcome}' is gated by verdict '${gated}': it needs a criteria report to check against`,
        `write the report (a JSON array of {id, verdict, …}) and run: ${doneCmd(outcome, true)}`,
      );
    return { ok: true, worst: null, coverage: null };
  }

  // QV4: each id once; exactly the frontmatter ids when declared
  const ids = report.map((c) => c.id);
  const dup = [...new Set(ids.filter((id, i) => ids.indexOf(id) !== i))];
  if (dup.length)
    return refuse("invalid_criteria", `the criteria report lists ${dup.join(", ")} more than once`, `give each criterion exactly one verdict${expected ? `: ${expected.join(", ")}` : ""}, then report again`, { duplicate: dup });
  if (expected) {
    const missing = expected.filter((id) => !ids.includes(id));
    const unknown = ids.filter((id) => !expected.includes(id));
    if (missing.length || unknown.length) {
      const what = [missing.length ? `missing ${missing.join(", ")}` : "", unknown.length ? `unknown ${unknown.join(", ")}` : ""].filter(Boolean).join("; ");
      return refuse("invalid_criteria", `the criteria report must cover exactly the unit's criteria (${expected.join(", ")}): ${what}`, `give one verdict for each of ${expected.join(", ")} and no other ids, then report again`, {
        expected,
        missing,
        unknown,
      });
    }
  }

  // QV5a (C2): `pass` means observed in this session — a criterion whose `needs` this agent lacks
  // cannot be observed here, whatever a person ruled earlier on other code
  const lacking = report.flatMap((c) => {
    if (c.verdict !== "pass") return [];
    const missing = (criteria?.find((x) => x.id === c.id)?.needs ?? []).filter((n) => !input.capabilities.includes(n));
    return missing.length ? [{ id: c.id, missing }] : [];
  });
  if (lacking.length) {
    const what = lacking.map((l) => `${l.id} (needs ${l.missing.join(", ")})`).join(", ");
    return refuse(
      "pass_without_capability",
      `${what}: this agent has ${input.capabilities.length ? `only ${input.capabilities.join(", ")}` : "no declared capabilities"} (config agents.<name>.capabilities), so it cannot have observed ${lacking.length === 1 ? "it" : "them"} pass; a person's earlier ruling does not verify a criterion on the current code`,
      `report ${lacking.map((l) => l.id).join(", ")} as {"verdict": "unverified", "reason": "no ${lacking[0]?.missing[0]} in this session", "how": "<the exact steps a person or an equipped agent follows to check it>"} and report the outcome matching the worst verdict (${doneCmd(reportableOutcomes(step).find((o) => edgeVerdict(step, o) === "unverified") ?? "unverified", true)})`,
      { criteria: lacking, capabilities: [...input.capabilities] },
    );
  }

  // QV5: the outcome must match the worst verdict when it is gated
  const worst = worstVerdict(report) as Verdict;
  if (gated && gated !== worst) {
    const matching = reportableOutcomes(step).filter((o) => edgeVerdict(step, o) === worst);
    const culprits = report.filter((c) => c.verdict === worst).map((c) => c.id);
    return refuse(
      "outcome_contradicts_verdicts",
      `outcome '${outcome}' needs the worst verdict to be '${gated}', but it is '${worst}' (${culprits.join(", ")})${matching.length ? `; the matching outcome is ${matching.map((o) => `'${o}'`).join(" or ")}` : ""}`,
      matching.length ? matching.map((o) => doneCmd(o, true)).join(" | ") : `no outcome of ${input.step_name} is gated by '${worst}'; re-check ${culprits.join(", ")} or report norn stuck "<why>"`,
      { worst, matching, criteria: culprits },
    );
  }
  return { ok: true, worst, coverage: expected ? "checked" : "unchecked" };
}

/** QV8: `unverified` criteria counted per capability in their frontmatter `needs`; `none` = no needs declared. */
export function unverifiedNeeds(report: readonly CriterionVerdict[], criteria: readonly Criterion[] | null): Record<string, number> {
  const out: Record<string, number> = {};
  for (const c of report) {
    if (c.verdict !== "unverified") continue;
    const needs = criteria?.find((x) => x.id === c.id)?.needs ?? [];
    for (const n of needs.length ? needs : ["none"]) out[n] = (out[n] ?? 0) + 1;
  }
  return out;
}

/** QV8: count per verdict. */
export function verdictCounts(report: readonly CriterionVerdict[]): Record<Verdict, number> {
  const out: Record<Verdict, number> = { pass: 0, fail: 0, person: 0, unverified: 0 };
  for (const c of report) out[c.verdict]++;
  return out;
}

/** QV7: the criteria a person checks at a gate — `person` and `unverified` verdicts of the report that led there. */
export function personCriteria(r: Receipt | undefined | null): CriterionVerdict[] {
  if (r?.kind !== "done" || !r.criteria) return [];
  return r.criteria.filter((c) => c.verdict === "person" || c.verdict === "unverified");
}

/** One line per criterion a person checks (QV7): `AC2 unverified (no browser here) — how: …`. */
export function criterionLine(c: CriterionVerdict): string {
  const why = c.verdict === "unverified" ? ` (${c.reason})` : "";
  const how = c.how ? ` — how: ${c.how}` : "";
  const ev = c.evidence ? ` — evidence: ${c.evidence}` : "";
  return `${c.id} ${c.verdict}${why}${how}${ev}`;
}

/** NT1–NT3: a note for a person from a `done` receipt of some unit of the story, not acknowledged yet. */
export interface StoryNote {
  /** `note:<receipt_id>:<n>` (NT2) */
  id: string;
  receipt_id: string;
  /** unit key (story or slice) the report belongs to */
  unit: string;
  step: string;
  attempt: number;
  text: string;
  criterion?: string;
  /** the report's time */
  at: string;
  who: string | null;
}

/**
 * NT2/NT3: the story's open notes — every note of a `done` receipt of any unit of the story,
 * minus those an `approve` receipt lists in `acknowledged_notes`, oldest first. A unit may appear
 * more than once (several worktrees hold copies of its runs/); receipts count once by id.
 */
export function openNotes(units: ReadonlyArray<{ unit: string; receipts: readonly NumberedReceipt[] }>): StoryNote[] {
  const seen = new Set<string>();
  const acknowledged = new Set<string>();
  const notes: StoryNote[] = [];
  for (const u of units)
    for (const { receipt: r } of u.receipts) {
      if (r.kind === "approve") for (const id of r.acknowledged_notes ?? []) acknowledged.add(id);
      if (r.kind !== "done" || !r.notes?.length || seen.has(r.receipt_id)) continue;
      seen.add(r.receipt_id);
      r.notes.forEach((n, i) =>
        notes.push({
          id: noteId(r.receipt_id, i + 1),
          receipt_id: r.receipt_id,
          unit: u.unit,
          step: r.step,
          attempt: r.attempt,
          text: n.text,
          ...(n.criterion ? { criterion: n.criterion } : {}),
          at: r.at,
          who: r.who ?? null,
        }),
      );
    }
  return notes.filter((n) => !acknowledged.has(n.id)).sort((a, b) => epoch(a.at) - epoch(b.at) || a.id.localeCompare(b.id));
}

/** NT2 title: `qa note on gh-4/01 (AC3): …`. */
export const noteTitle = (n: StoryNote) => `${n.step} note on ${n.unit}${n.criterion ? ` (${n.criterion})` : ""}: ${n.text}`;
