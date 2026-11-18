/**
 * The agent's side (what `norn brief`, `norn done`, `norn ask` and `norn stuck` will call): the
 * brief of the unit's live run, and a report recorded as the kernel's `run.reported` receipt through
 * the Journal, plus a `report.made` event in the run's log so the session reads as reported and the
 * stop hook lets the turn end. The documents the agent edited in its worktree (the handoff, the spec)
 * are read back into the story's documents first, so the next step's inputs carry them.
 *
 * A report is idempotent by its report id (the receipt's id derives from it), so a retried command
 * records once. It is refused, never guessed at, when the run is not the unit's live one or `done`
 * names an outcome the step does not route.
 */
import { type BriefInputs, checkCriteriaReport, renderBrief, type UnitJournal, verdictCounts, worstVerdict } from "@norn/kernel";
import type { HarnessEvent, VcsUnfinished } from "@norn/plugin-api";
import { STORE_ID_PATTERN } from "@norn/plugin-api";
import type { CriterionVerdict, Finding, Note, Verdict } from "@norn/schema";
import { renderInputFrom } from "./brief-context.ts";
import { declaredCriteria } from "./criteria.ts";
import { readBackDocs, worktreeOf } from "./inputs.ts";
import type { RuntimeEnv } from "./env.ts";
import { appendEvents, readEvents } from "./events/log.ts";
import { type LiveStep, liveStepOf, reportOnRecord } from "./live-run.ts";

export type ReportRequest =
  | { verb: "done"; outcome: string; text?: string; criteria?: CriterionVerdict[]; findings?: Finding[] }
  | { verb: "ask"; question: string }
  | { verb: "stuck"; reason: string };

/** A refusal in the CLI's machine contract: what went wrong and what to do instead. */
export interface ReportRefusal {
  error: string;
  do_instead: string;
  code?: string;
}

export type Refusable<T> = { ok: true; value: T } | { ok: false; refusal: ReportRefusal };

export interface ReportRecorded {
  /** the receipt's seq in the unit's record */
  seq: number;
  /** the same report id was recorded before; nothing new was written */
  replayed: boolean;
  /** the criteria report as checked, when one came with the report */
  criteria?: CriteriaSummary;
}

export interface CriteriaSummary {
  worst: Verdict;
  /**
   * `checked` against the unit's declared criteria; `unchecked` when it declares none. Absent only on
   * a replay whose declared criteria cannot be read now: the receipt holds the report, not the check.
   */
  coverage?: "checked" | "unchecked";
  counts: Record<Verdict, number>;
}

export interface BriefShown {
  unit: string;
  run_id: string;
  markdown: string;
}

/** The receipt id a report id records under: deterministic, so a retry finds the first. */
export function reportReceiptId(reportId: string): string {
  return `report-${reportId}`;
}

const refuse = <T>(error: string, do_instead: string, code?: string): Refusable<T> => ({ ok: false, refusal: { error, do_instead, ...(code && { code }) } });

const REPORT_ID = new RegExp(STORE_ID_PATTERN);

/** The unit's record and its live agent step, or why an agent cannot act on it now. */
async function liveAgent(env: RuntimeEnv, unit: string): Promise<Refusable<{ record: UnitJournal; live: LiveStep }>> {
  const read = await env.journal.readUnit(unit);
  if (!read.ok) return refuse(`cannot read ${unit}: ${read.failure.message}`, "try again; if it keeps failing, tell the person", read.failure.code);
  const record = read.value;
  if (record.corrupt !== undefined) return refuse(`${unit} is corrupt: ${record.corrupt}`, "end your turn: a person has to look at the unit's record", "corrupt");
  if (record.state?.ended !== undefined) return refuse(`${unit} has ended ${record.state.ended}`, "end your turn: the unit takes no more reports", "ended");
  const live = liveStepOf(record.state, record.unapplied);
  if (!live) return refuse(`${unit} has no run in progress`, "end your turn: no step of this unit is waiting on you", "no_run");
  if (!live.agent) return refuse(`${unit} is at ${live.step}, which runs no agent`, "end your turn: no agent step of this unit is waiting on you", "not_agent");
  return { ok: true, value: { record, live } };
}

function briefInputsOf(record: UnitJournal, live: LiveStep, spec: { skills: string[]; inputs: BriefInputs["inputs"]; model?: string }): BriefInputs {
  const state = record.state as NonNullable<UnitJournal["state"]>;
  // the state's rework belongs to the visit it is at; a live run of any other visit was not sent back by it
  const sameVisit = state.step === live.step && state.attempt === live.attempt;
  return {
    workflow: state.workflow.name,
    hash: state.workflow.hash,
    step: live.step,
    attempt: live.attempt,
    skills: [...spec.skills],
    inputs: structuredClone(spec.inputs),
    ...(spec.model !== undefined && { model: spec.model }),
    ...(sameVisit && state.rework_from !== undefined && { rework_from: state.rework_from }),
  };
}

export async function briefOf(env: RuntimeEnv, unit: string): Promise<Refusable<BriefShown>> {
  const found = await liveAgent(env, unit);
  if (!found.ok) return found;
  const { record, live } = found.value;
  const doc = record.state?.workflow.doc.steps[live.step];
  const brief = briefInputsOf(record, live, { skills: doc?.skills ?? [], inputs: doc?.inputs ?? [], ...(doc?.model !== undefined && { model: doc.model }) });
  const input = await renderInputFrom(env, record, brief, live.run.id);
  if (!input.ok) return refuse(`cannot brief ${unit}: ${input.failure.message}`, "tell the person: the unit's workflow does not load", input.failure.code);
  return { ok: true, value: { unit, run_id: live.run.id, markdown: renderBrief(input.value) } };
}

function eventOf(runId: string, req: ReportRequest): HarnessEvent {
  const base = { type: "report.made" as const, run_id: runId, seq: 0, at: "1970-01-01T00:00:00.000Z" };
  return req.verb === "done" ? { ...base, verb: "done", outcome: req.outcome } : { ...base, verb: req.verb };
}

function textOf(req: ReportRequest): string | undefined {
  const t = req.verb === "done" ? req.text : req.verb === "ask" ? req.question : req.reason;
  return t?.trim() ? t.trim() : undefined;
}

export async function reportRun(env: RuntimeEnv, unit: string, runId: string, req: ReportRequest, reportId: string): Promise<Refusable<ReportRecorded>> {
  const receiptId = reportReceiptId(reportId);
  if (!REPORT_ID.test(receiptId)) return refuse(`report id ${JSON.stringify(reportId)} is not one norn can record`, "use letters, digits, `.`, `_` and `-`, at most 120 of them", "invalid");
  const read = await env.journal.readUnit(unit);
  if (read.ok && read.value.corrupt === undefined) {
    // a retried command finds its first report, wherever the unit has moved since
    const earlier = read.value.receipts.find((r) => r.id === receiptId);
    if (earlier) {
      const kept = earlier.data.kind === "run.reported" ? earlier.data.criteria : undefined;
      const summary = kept ? await replayedSummary(env, unit, kept) : undefined;
      return { ok: true, value: { seq: earlier.seq, replayed: true, ...(summary !== undefined && { criteria: summary }) } };
    }
  }
  const found = await liveAgent(env, unit);
  if (!found.ok) return found;
  const { record, live } = found.value;
  if (live.run.id !== runId)
    return refuse(`run ${runId} is not the live run of ${unit}; the live run is ${live.run.id}`, "end your turn: this session's run was replaced, and its report would move nothing", "stale_run");
  if (reportOnRecord(record, runId)) return refuse(`run ${runId} has reported already`, "end your turn: a run reports exactly once", "reported");
  if (req.verb === "done" && !live.outcomes.includes(req.outcome)) {
    const allowed = live.outcomes.map((o) => `\`${o}\``).join(", ");
    return refuse(`outcome ${JSON.stringify(req.outcome)} is not one step ${live.step} routes`, `report one of ${allowed || "the step's outcomes"}`, "outcome");
  }
  if (req.verb === "ask" && !textOf(req)) return refuse("an ask without a question", "ask one self-contained question", "invalid");
  if (req.verb === "done") {
    const handBack = handBackRefusal(live, req);
    if (handBack) return handBack;
    const stopped = await unfinishedRefusal(env, unit);
    if (stopped) return stopped;
  }
  const text = textOf(req);
  const outcome = req.verb === "done" ? req.outcome : undefined;
  // before the receipt: once it is applied the next step may launch, and it must read what this run wrote
  await readBackDocs(env, unit);
  let criteria: { report: CriterionVerdict[]; summary: CriteriaSummary } | undefined;
  if (req.verb === "done") {
    const checked = await checkCriteria(env, unit, live, req);
    if (!checked.ok) return checked;
    criteria = checked.value ?? undefined;
  }
  const findings = req.verb === "done" && req.findings !== undefined && req.findings.length > 0 ? req.findings : undefined;
  const notes = notesOf(criteria?.report);
  const wrote = await env.journal.record(unit, {
    id: receiptId,
    data: {
      kind: "run.reported",
      step: live.step,
      attempt: live.attempt,
      run_id: runId,
      verb: req.verb,
      ...(outcome !== undefined && { outcome }),
      ...(text !== undefined && { text }),
      ...(criteria !== undefined && { criteria: criteria.report }),
      ...(findings !== undefined && { findings }),
      ...(notes.length > 0 && { notes }),
    },
  });
  if (!wrote.ok) return refuse(`cannot record the report: ${wrote.failure.message}`, "report again with the same report id", wrote.failure.code);
  if (!wrote.value.replayed) {
    // the receipt is the report; the event only lets the session read as reported before a tick applies it
    const { next_seq } = await readEvents(env.ctx, unit, runId);
    await appendEvents(env.ctx, unit, runId, [{ ...eventOf(runId, req), seq: next_seq, at: env.ctx.now() }]);
  }
  return { ok: true, value: { seq: wrote.value.seq, replayed: wrote.value.replayed, ...(criteria !== undefined && { criteria: criteria.summary }) } };
}

const FINDINGS_SHAPE =
  'a JSON file {"findings": [{"severity": "blocking" | "major" | "minor" | "nit", "title": "...", "detail"?, "file"?, "line"?, "criterion"?, "repro"?}]} with at least one finding';

/**
 * Why a `done` whose outcome hands findings back cannot be recorded as it is, or null when it can:
 * the step it sends the work back to reworks what the report carries, so one that carries nothing
 * leaves it nothing to do. Findings, a note, or a criteria report with a verdict short of `pass`
 * (each carries its repro or how to check it) are something to rework; an empty findings file is not.
 */
function handBackRefusal(live: LiveStep, req: Extract<ReportRequest, { verb: "done" }>): Refusable<never> | null {
  if (live.handBack[req.outcome] !== "findings") return null;
  const carries = (req.findings?.length ?? 0) > 0 || textOf(req) !== undefined || (req.criteria ?? []).some((c) => c.verdict !== "pass");
  if (carries) return null;
  const criteria = live.criteria || live.verdict[req.outcome] !== undefined ? " --criteria <file>" : "";
  return refuse(
    `step ${live.step} hands back findings with outcome ${req.outcome} (hand_back), and this report has none`,
    `write ${FINDINGS_SHAPE}, then run: norn done ${req.outcome}${criteria} --findings <file>`,
    "hand_back_required",
  );
}

/** The notes for a person a criteria report's verdicts carry, each naming its criterion. */
function notesOf(report: readonly CriterionVerdict[] | undefined): Note[] {
  return (report ?? []).flatMap((c) => (c.note !== undefined ? [{ text: c.note, criterion: c.id }] : []));
}

const CONCLUDE: Record<VcsUnfinished["operation"], string> = { merge: "git commit", rebase: "git rebase --continue", "cherry-pick": "git cherry-pick --continue" };

/**
 * Why a `done` cannot be recorded while the unit's checkout has a merge (or rebase, cherry-pick)
 * stopped half-way, or null when it can: the next step would find the operation still open and
 * fail on it, so the agent concludes it first. An ask or stuck is never held back, as a resolver may
 * leave the merge open on purpose for a person to choose.
 */
async function unfinishedRefusal(env: RuntimeEnv, unit: string): Promise<Refusable<never> | null> {
  const vcs = env.slots.vcs;
  if (!vcs.unfinished) return null;
  const worktree = worktreeOf(env, unit);
  const r = await vcs.unfinished(worktree);
  if (!r.ok) return refuse(`cannot tell whether a merge is in progress in ${worktree}: ${r.failure.message}`, "report again with the same command", r.failure.code);
  if (r.value === null) return null;
  const { operation, unmerged } = r.value;
  const left = unmerged.length > 0 ? `unmerged: ${unmerged.join(", ")}` : "every conflict resolved, not yet concluded";
  const conclude = CONCLUDE[operation];
  return refuse(
    `a ${operation} is still in progress in ${worktree} (${left})`,
    `resolve what is left, conclude the ${operation} with \`${conclude}\`, then report again; if a person must choose, \`norn ask\` with the ${operation} kept in progress`,
    "merge_unfinished",
  );
}

/**
 * The `done`'s criteria report checked against the step and the unit's declared criteria; null when
 * the step asks for none and none came. Declared criteria are read only when they can matter.
 */
async function checkCriteria(
  env: RuntimeEnv,
  unit: string,
  live: LiveStep,
  req: Extract<ReportRequest, { verb: "done" }>,
): Promise<Refusable<{ report: CriterionVerdict[]; summary: CriteriaSummary } | null>> {
  const report = req.criteria ?? null;
  let declared = null;
  if (report !== null || live.criteria) {
    const read = await declaredCriteria(env, unit);
    if (!read.ok)
      return read.failure.code === "invalid"
        ? refuse(`the unit's criteria cannot be checked: ${read.failure.message}`, `fix the frontmatter \`criteria\` (a list of {id, verifier}) in ${unit}'s spec or slice file, then report again`, "invalid_criteria")
        : refuse(`cannot read the unit's criteria: ${read.failure.message}`, "report again with the same command", read.failure.code);
    declared = read.value.criteria;
  }
  const c = checkCriteriaReport({ step: live.step, spec: { criteria: live.criteria, verdict: live.verdict }, outcomes: live.outcomes, outcome: req.outcome, report, criteria: declared });
  if (!c.ok) return refuse(c.refusal.error, c.refusal.do_instead, c.refusal.code);
  if (report === null || c.worst === null || c.coverage === null) return { ok: true, value: null };
  return { ok: true, value: { report, summary: { worst: c.worst, coverage: c.coverage, counts: verdictCounts(report) } } };
}

/**
 * The summary a retried `done` prints, rebuilt from the report its first call kept: the receipt was
 * checked when written, so coverage is read again from the declared criteria rather than re-judged.
 */
async function replayedSummary(env: RuntimeEnv, unit: string, report: CriterionVerdict[]): Promise<CriteriaSummary | undefined> {
  const worst = worstVerdict(report);
  if (worst === null) return undefined;
  const declared = await declaredCriteria(env, unit);
  const coverage = declared.ok ? (declared.value.criteria ? "checked" : "unchecked") : undefined;
  return { worst, ...(coverage !== undefined && { coverage }), counts: verdictCounts(report) };
}
