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
import {
  type BriefInputs,
  checkCriteriaReport,
  type GuardedCode,
  grantOf,
  HANDOFF_MAX_BYTES,
  judgeChanges,
  producedOn,
  renderBrief,
  type UnitJournal,
  verdictCounts,
  worstVerdict,
} from "@norn/kernel";
import type { Capability, HarnessEvent, VcsUnfinished } from "@norn/plugin-api";
import { parseUnitId, STORE_ID_PATTERN } from "@norn/plugin-api";
import { type CriterionVerdict, type Finding, type Note, OUT_ENV, REPORT_TYPES, type ReportEvidence, reportPath, type Verdict } from "@norn/schema";
import { changesSince, hookDigest, ownedBy, snapshotOf } from "./detect.ts";
import { branchOf, baseRefOf, cutFrom } from "./branches.ts";
import { renderInputFrom } from "./brief-context.ts";
import { declaredCriteria } from "./criteria.ts";
import { baseConflictOf } from "./input-history.ts";
import { producedOf, readBackDocs, specFolder, worktreeOf } from "./inputs.ts";
import { collectReports } from "./reports.ts";
import { keepEvidence, keepsEvidence, moveEvidenceRef } from "./evidence-keep.ts";
import { renderSupervisorBrief, supervisorOfRun, supervisorReceipt } from "./supervisor.ts";
import { handoffArtifact } from "./story-docs.ts";
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
  /** the commit the report's evidence files were kept in, as the receipt names it */
  evidence?: ReportEvidence;
  /** a line per evidence file left out or kept uncompressed, and a ref that could not be moved */
  evidenceNotes?: string[];
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
  /** the visit the brief is of; absent for a supervisor's brief, which stands for no step of its own */
  workflow?: string;
  step?: string;
  attempt?: number;
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

function briefInputsOf(record: UnitJournal, live: LiveStep, spec: { skills: string[]; inputs: BriefInputs["inputs"]; model?: string }, grant: Capability[] | null): BriefInputs {
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
    ...(grant !== null && { grant }),
  };
}

/** The brief of `runId` when it is the unit's supervisor, else of the unit's live run. */
export async function briefOf(env: RuntimeEnv, unit: string, runId?: string): Promise<Refusable<BriefShown>> {
  if (runId !== undefined) {
    const read = await env.journal.readUnit(unit);
    const sup = read.ok && read.value.corrupt === undefined ? supervisorOfRun(read.value, runId) : null;
    if (read.ok && sup) return { ok: true, value: { unit, run_id: runId, markdown: await renderSupervisorBrief(env, read.value, sup) } };
  }
  const found = await liveAgent(env, unit);
  if (!found.ok) return found;
  const { record, live } = found.value;
  const doc = record.state?.workflow.doc.steps[live.step];
  const grant = doc ? grantOf({ ...(doc.role !== undefined && { role: doc.role }), ...(doc.allow !== undefined && { allow: doc.allow }) }, env.config.kernel) : null;
  const brief = briefInputsOf(record, live, { skills: doc?.skills ?? [], inputs: doc?.inputs ?? [], ...(doc?.model !== undefined && { model: doc.model }) }, grant);
  const input = await renderInputFrom(env, record, brief, live.run.id);
  if (!input.ok) return refuse(`cannot brief ${unit}: ${input.failure.message}`, "tell the person: the unit's workflow does not load", input.failure.code);
  return { ok: true, value: { unit, run_id: live.run.id, workflow: brief.workflow, step: brief.step, attempt: brief.attempt, markdown: renderBrief(input.value) } };
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
      const evidence = earlier.data.kind === "run.reported" ? earlier.data.evidence : undefined;
      // a crash may have come between the receipt and the move; at the same commit the move is a no-op
      const unmoved = evidence ? await moveEvidenceRef(env, unit, evidence) : null;
      return {
        ok: true,
        value: { seq: earlier.seq, replayed: true, ...(summary !== undefined && { criteria: summary }), ...(evidence !== undefined && { evidence }), ...(unmoved !== null && { evidenceNotes: [unmoved] }) },
      };
    }
  }
  const supervised = await supervisorReport(env, unit, runId, req, receiptId);
  if (supervised) return supervised;
  const found = await liveAgent(env, unit);
  if (!found.ok) return found;
  const { record, live } = found.value;
  if (live.run.id !== runId)
    return refuse(`run ${runId} is not the live run of ${unit}; the live run is ${live.run.id}`, "end your turn: this session's run was replaced, and its report would move nothing", "stale_run");
  if (reportOnRecord(record, runId)) return refuse(`run ${runId} has reported already`, "end your turn: a run reports exactly once", "reported");
  const moved = await claimMovedRefusal(env, unit, runId);
  if (moved) return moved;
  if (req.verb === "done" && !live.outcomes.includes(req.outcome)) {
    const allowed = live.outcomes.map((o) => `\`${o}\``).join(", ");
    return refuse(`outcome ${JSON.stringify(req.outcome)} is not one step ${live.step} routes`, `report one of ${allowed || "the step's outcomes"}`, "outcome");
  }
  if (req.verb === "ask" && !textOf(req)) return refuse("an ask without a question", "ask one self-contained question", "invalid");
  if (req.verb === "done") {
    const collected = await collectReports(env, unit, { criteria: req.criteria !== undefined, findings: req.findings !== undefined });
    if (!collected.ok) return refuse(collected.error, collected.do_instead, collected.code);
    req = { ...req, ...collected.value, ...(req.criteria !== undefined && { criteria: req.criteria }), ...(req.findings !== undefined && { findings: req.findings }) };
  }
  if (req.verb === "done") {
    const handBack = handBackRefusal(live, req);
    if (handBack) return handBack;
    const missing = await producedRefusal(env, record, live, req.outcome);
    if (missing) return missing;
    const long = await handoffSizeRefusal(env, unit);
    if (long) return long;
    const stopped = await unfinishedRefusal(env, unit);
    if (stopped) return stopped;
    const hooked = await hooksRefusal(env, record.unit, live);
    if (hooked) return hooked;
    const detected = await detectedRefusal(env, record, live, req.outcome);
    if (detected) return detected;
    const dirty = await uncommittedRefusal(env, unit, live.run.executor, live.run.code);
    if (dirty) return dirty;
    const unmerged = await baseUnmergedRefusal(env, record, live);
    if (unmerged) return unmerged;
    const marked = await conflictMarkersRefusal(env, unit);
    if (marked) return marked;
  }
  const text = textOf(req);
  const outcome = req.verb === "done" ? req.outcome : undefined;
  // before the receipt: once it is applied the next step may launch, and it must read what this run wrote
  await readBackDocs(env, unit, undefined, producedOf(env, record));
  let criteria: { report: CriterionVerdict[]; summary: CriteriaSummary } | undefined;
  if (req.verb === "done") {
    const checked = await checkCriteria(env, unit, live, req);
    if (!checked.ok) return checked;
    criteria = checked.value ?? undefined;
  }
  const findings = req.verb === "done" && req.findings !== undefined && req.findings.length > 0 ? req.findings : undefined;
  const notes = notesOf(criteria?.report);
  // last before the receipt, once nothing can refuse the report: only the report that counts keeps its files
  let evidence: ReportEvidence | undefined;
  const evidenceNotes: string[] = [];
  if (req.verb === "done" && keepsEvidence(env, live.criteria)) {
    const kept = await keepEvidence(env, unit, runId);
    if (!kept.ok) return refuse(kept.error, "report again with the same command", kept.code);
    evidence = kept.value.evidence;
    evidenceNotes.push(...kept.value.notes);
  }
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
      ...(evidence !== undefined && { evidence }),
    },
  });
  if (!wrote.ok) return refuse(`cannot record the report: ${wrote.failure.message}`, "report again with the same report id", wrote.failure.code);
  if (!wrote.value.replayed) {
    // the receipt is the report; the event only lets the session read as reported before a tick applies it
    const { next_seq } = await readEvents(env.ctx, unit, runId);
    await appendEvents(env.ctx, unit, runId, [{ ...eventOf(runId, req), seq: next_seq, at: env.ctx.now() }]);
  }
  // after the receipt naming the commit: a ref never points at evidence no record holds
  const unmoved = evidence ? await moveEvidenceRef(env, unit, evidence) : null;
  if (unmoved !== null) evidenceNotes.push(unmoved);
  return {
    ok: true,
    value: {
      seq: wrote.value.seq,
      replayed: wrote.value.replayed,
      ...(criteria !== undefined && { criteria: criteria.summary }),
      ...(evidence !== undefined && { evidence }),
      ...(evidenceNotes.length > 0 && { evidenceNotes }),
    },
  };
}

/**
 * A report from the unit's supervisor, recorded as the receipt its subject takes, or null when `runId`
 * is not the supervisor at work. Nothing of the step's own run is read back or checked: a supervisor
 * changes nothing in the worktree, and what it reports stands only as its own.
 */
async function supervisorReport(env: RuntimeEnv, unit: string, runId: string, req: ReportRequest, receiptId: string): Promise<Refusable<ReportRecorded> | null> {
  const read = await env.journal.readUnit(unit);
  if (!read.ok || read.value.corrupt !== undefined) return null;
  const sup = supervisorOfRun(read.value, runId);
  if (!sup) return null;
  const moved = await claimMovedRefusal(env, unit, runId);
  if (moved) return moved;
  const receipt = supervisorReceipt(read.value, sup, req);
  if (!receipt.ok) return { ok: false, refusal: receipt.refusal };
  const wrote = await env.journal.record(unit, { id: receiptId, data: receipt.value });
  if (!wrote.ok) return refuse(`cannot record the report: ${wrote.failure.message}`, "report again with the same report id", wrote.failure.code);
  return { ok: true, value: { seq: wrote.value.seq, replayed: wrote.value.replayed } };
}

/**
 * Why a report cannot be recorded on this machine once another holder took the story's claim, or
 * null when it can: the run started under a claim this machine no longer holds, and the new holder
 * carries the story on from the shared record, so a receipt written here would move this machine's
 * copy ahead of that record, where no flush could publish it. Every verb is dropped, and why is kept
 * in the run's log. A claim nobody holds leaves the report to the next holder's record.
 */
async function claimMovedRefusal(env: RuntimeEnv, unit: string, runId: string): Promise<Refusable<never> | null> {
  const story = parseUnitId(unit)?.story ?? unit;
  const read = await env.slots.store.claims.read(story);
  if (!read.ok) return refuse(`cannot read the claim of ${story}: ${read.failure.message}`, "report again with the same command", read.failure.code);
  const holder = read.value?.holder;
  if (holder === undefined || isOwnHolder(env, holder)) return null;
  const message = `the report of run ${runId} was dropped: the claim of ${story} moved from ${env.config.holder} to ${holder}`;
  const { next_seq } = await readEvents(env.ctx, unit, runId);
  await appendEvents(env.ctx, unit, runId, [{ type: "hook.error", run_id: runId, seq: next_seq, at: env.ctx.now(), hook: "report", message }]);
  return refuse(message, `end your turn now and report nothing: ${holder} carries ${story} on, and this run's report would move nothing`, "claim_moved");
}

/** `holder` is this machine: its current name, or one it claimed under before. */
export function isOwnHolder(env: RuntimeEnv, holder: string): boolean {
  return holder === env.config.holder || (env.config.formerHolders ?? []).includes(holder);
}

/**
 * Who holds the claim of `unit`'s story when that is another machine, else null (this machine, or
 * nobody). A read that fails answers null: the caller then acts as if nothing moved.
 */
export async function claimHeldElsewhere(env: RuntimeEnv, unit: string): Promise<string | null> {
  const read = await env.slots.store.claims.read(parseUnitId(unit)?.story ?? unit);
  const holder = read.ok ? read.value?.holder : undefined;
  return holder === undefined || isOwnHolder(env, holder) ? null : holder;
}

/** The findings report, as a refusal names it. */
export const FINDINGS_SHAPE = REPORT_TYPES.findings.shape;

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
  return refuse(
    `step ${live.step} hands back findings with outcome ${req.outcome} (hand_back), and this report has none`,
    `write the findings to ${reportPath("findings")}: ${FINDINGS_SHAPE}; at least one finding; then run: norn done ${req.outcome}`,
    "hand_back_required",
  );
}

/**
 * Why a `done` cannot be recorded while a file the step produces for that outcome is missing or empty
 * in the unit's worktree, or null when every one is there: a later step (or a step kind such as
 * open-pr) reads it, and would otherwise run on nothing. Read where read-back reads it, before it.
 */
async function producedRefusal(env: RuntimeEnv, record: UnitJournal, live: LiveStep, outcome: string): Promise<Refusable<never> | null> {
  const step = record.state?.workflow.doc.steps[live.step];
  if (!step) return null;
  const worktree = worktreeOf(env, record.unit);
  for (const p of producedOn(step, outcome)) {
    const file = `${specFolder(record.unit)}/${p.file}`;
    let text: string | null;
    try {
      text = await env.ctx.files.read(`${worktree}/${file}`);
    } catch {
      text = null;
    }
    if (text !== null && text.trim() !== "") continue;
    return refuse(
      `step ${live.step} produces \`${p.name}\` with outcome ${outcome}, and ${file} is ${text === null ? "missing" : "empty"}`,
      `write ${file} (\`${p.name}\`, which later steps read) in the worktree, then report again`,
      "produced_missing",
    );
  }
  return null;
}

/** The notes for a person a criteria report's verdicts carry, each naming its criterion. */
function notesOf(report: readonly CriterionVerdict[] | undefined): Note[] {
  return (report ?? []).flatMap((c) => (c.note !== undefined ? [{ text: c.note, criterion: c.id }] : []));
}

/**
 * Why a `done` cannot be recorded while the unit's handoff has grown past `HANDOFF_MAX_BYTES`, or
 * null when it can: the handoff is the unit's current state, and one that long has turned into a log
 * (repros, tables, a diary of attempts) that every later brief would carry. An ask or stuck is never
 * held back, as it hands nothing on.
 */
async function handoffSizeRefusal(env: RuntimeEnv, unit: string): Promise<Refusable<never> | null> {
  const file = `${specFolder(unit)}/${handoffArtifact(unit)}`;
  let text: string | null;
  try {
    text = await env.ctx.files.read(`${worktreeOf(env, unit)}/${file}`);
  } catch {
    // unreadable here is unreadable for read-back too: nothing long reaches the next brief
    return null;
  }
  const bytes = text === null ? 0 : new TextEncoder().encode(text.trim()).length;
  if (bytes <= HANDOFF_MAX_BYTES) return null;
  const kb = (n: number) => `${Math.ceil(n / 1024)} KB`;
  return refuse(
    `the handoff ${file} is ${kb(bytes)}; it may hold at most ${kb(HANDOFF_MAX_BYTES)}`,
    `rewrite it as the unit's current state (State, Notes): drop what the brief's history already says and the attempts that led nowhere, move long repros and logs into the findings (\`${reportPath("findings")}\`) when the outcome hands findings back, or into a file of their own under ${specFolder(unit)}/, and name it there, then report again`,
    "handoff_too_large",
  );
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
 * Why the done of a step sent to merge the base cannot be recorded, or null when it can: the step
 * takes the `base_side` input and the unit's latest merge of its base (a base update, or a slice's
 * integrate into the story branch) stopped on a conflict, yet the unit's branch does not contain that
 * commit, so the merge was never made (or was made on another branch).
 * Read before the markers, as a merge never made leaves none to find.
 */
async function baseUnmergedRefusal(env: RuntimeEnv, record: UnitJournal, live: LiveStep): Promise<Refusable<never> | null> {
  const inputs = record.state?.workflow.doc.steps[live.step]?.inputs ?? [];
  if (!inputs.includes("base_side")) return null;
  const base = baseConflictOf(record);
  if (!base) return null;
  const branch = branchOf(record.unit);
  const short = base.sha.slice(0, 12);
  const r = await env.slots.vcs.isAncestor(base.sha, branch);
  if (!r.ok) return refuse(`cannot tell whether ${base.ref} at ${short} is merged into ${branch}: ${r.failure.message}`, "report again with the same command", r.failure.code);
  if (r.value) return null;
  return refuse(
    `${base.ref} at ${short}, the commit this step merges, is not merged into ${branch}: its head does not contain it`,
    `merge it in the worktree with \`git merge ${base.sha}\` (a merge commit, never a rebase), resolve every conflict, commit, then report again; if a person must choose, \`norn ask\``,
    "merge_unfinished",
  );
}

/** How many conflicts a refusal names before it counts the rest. */
const MARKERS_SHOWN = 10;

/**
 * Why a `done` cannot be recorded while the unit's commits since its base (a story's base, a slice's
 * story branch) leave a conflict unresolved, or null when they do not: a marker the tests and the
 * review miss would otherwise ship. Only commits are read, so it is checked after the worktree is
 * known clean.
 */
async function conflictMarkersRefusal(env: RuntimeEnv, unit: string): Promise<Refusable<never> | null> {
  const vcs = env.slots.vcs;
  if (!vcs.conflictMarkers) return null;
  const base = cutFrom(unit, await baseRefOf(env));
  const branch = branchOf(unit);
  // a unit run in the repo's own checkout (a vcs without worktrees) may have no branch of its own to read
  for (const ref of [base, branch]) {
    const at = await vcs.head(ref);
    if (at.ok && at.value === null) return null;
  }
  const r = await vcs.conflictMarkers(base, branch);
  if (!r.ok) return refuse(`cannot read the conflicts ${branch} left since ${base}: ${r.failure.message}`, "report again with the same command", r.failure.code);
  if (r.value.length === 0) return null;
  const where = r.value.map((m) => `${m.path}:${m.line}`);
  const named = where.slice(0, MARKERS_SHOWN).join(", ") + (where.length > MARKERS_SHOWN ? ` and ${where.length - MARKERS_SHOWN} more` : "");
  return refuse(
    `${branch} holds conflict markers left unresolved since ${base}: ${named}`,
    "resolve each conflict by the intent of both sides, remove its markers, commit, then report again; if a person must choose, `norn ask`",
    "conflict_markers",
  );
}

/** How many uncommitted paths a refusal names before it counts the rest. */
const DIRTY_SHOWN = 10;

/**
 * Why a `done` cannot be recorded while the unit's checkout holds work not committed, or null when
 * it can: the steps after it (a branch update, a push, a pull request) carry commits only, so what
 * is left in the worktree would be lost or make them fail. norn's own files there never count: the
 * run folder (inputs, reports) and the story's spec folder, which it reads back itself (though a repo that commits its
 * specs tracks them), and what it installed for the run's executor, which a repo's own `.gitignore`
 * can leave showing and which committing would carry norn's hooks into the branch. An ask or stuck
 * is never held back: the work is not handed on.
 */
async function uncommittedRefusal(env: RuntimeEnv, unit: string, executor: string, code: GuardedCode | undefined): Promise<Refusable<never> | null> {
  const vcs = env.slots.vcs;
  // a run that may not keep code answers for its tracked changes to the check; only what it left untracked is held here
  const list = code === undefined ? vcs.uncommitted?.bind(vcs) : vcs.untracked?.bind(vcs);
  if (!list) return null;
  const worktree = worktreeOf(env, unit);
  const r = await list(worktree);
  if (!r.ok) return refuse(`cannot tell whether ${worktree} holds uncommitted work: ${r.failure.message}`, "report again with the same command", r.failure.code);
  const owned = ownedBy(env, unit, executor);
  const left = r.value.filter((p) => !owned(p));
  if (left.length === 0) return null;
  const named = left.slice(0, DIRTY_SHOWN).join(", ") + (left.length > DIRTY_SHOWN ? ` and ${left.length - DIRTY_SHOWN} more` : "");
  if (code !== undefined)
    return refuse(`${worktree} holds files this run made: ${named}`, `delete them (this step keeps no code: code:${code}), or move a report into $${OUT_ENV}, then report again`, "dirty_worktree");
  return refuse(
    `${worktree} holds uncommitted work: ${named}`,
    "run `git status` in the worktree, commit the work this step made, then report again; ask a person about a change you cannot tell whether to commit",
    "dirty_worktree",
  );
}

/**
 * Why a `done` cannot be recorded once the agent's hook config differs from the one its launch pinned,
 * or null when it holds: hooks the agent changed, removed or turned off guarded nothing since, so what
 * it reports cannot be taken as a guarded run's. Only a person can tell what happened.
 */
async function hooksRefusal(env: RuntimeEnv, unit: string, live: LiveStep): Promise<Refusable<never> | null> {
  const pinned = live.run.hooks;
  if (pinned === undefined) return null;
  const worktree = worktreeOf(env, unit);
  if ((await hookDigest(env, live.run.executor, worktree)) === pinned) return null;
  return refuse(
    `the agent's hook config in ${worktree} changed since run ${live.run.id} started`,
    "put back the hooks norn installed (and any setting that turns hooks off) as the run found them, then report again; if you cannot, report stuck saying what changed",
    "hooks_changed",
  );
}

/**
 * Why the done of a run that may not keep code cannot be recorded as it is, or null when it can: what
 * changed since the visit's snapshot, judged as the check after the report judges it, so the agent puts
 * it right now rather than the unit parking later. Its processes still run here, so the tick's check
 * after killing them is the one that counts.
 */
async function detectedRefusal(env: RuntimeEnv, record: UnitJournal, live: LiveStep, outcome: string): Promise<Refusable<never> | null> {
  const code = live.run.code;
  if (code === undefined) return null;
  const snap = snapshotOf(record.receipts, live.run.id);
  if (snap === null) return refuse(`no snapshot of run ${live.run.id} is on the record, so what it changed cannot be checked`, "report stuck: a person has to look at the unit", "detect_failed");
  const seen = await changesSince(env, record.unit, worktreeOf(env, record.unit), snap, live.run.executor);
  if (!seen.ok) return refuse(`cannot check what run ${live.run.id} changed: ${seen.failure.message}`, "report again with the same command; if it keeps failing, report stuck", seen.failure.code);
  const judged = judgeChanges({ code, passes: live.verdict[outcome] === "pass", ...seen.value });
  if (judged.verdict !== "refused") return null;
  const fix =
    code === "read"
      ? `put the code back as the run found it (\`git restore <file>\`, \`git reset --keep ${snap.head ?? "<the run's first commit>"}\` for a commit), then report again; a change the code needs is a finding for the step that keeps code`
      : "report an outcome that does not pass the step (norn then resets what you changed), or put the code back as the run found it and report again";
  const repo = seen.value.remoteMoved || seen.value.configChanged || seen.value.hooksChanged;
  return refuse(
    `the run may not keep code (code:${code}), and ${judged.reasons.join("; ")}`,
    repo ? `put back what changed in the repo's git config, hooks or remote branch, or report stuck saying what changed; ${fix}` : fix,
    "code_changed",
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
