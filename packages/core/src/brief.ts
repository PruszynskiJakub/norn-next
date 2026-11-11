/** Briefing renderer: `norn brief [--json]` built from data only (state, pinned step, inputs, handoff, receipts). */
import {
  type AgentStep,
  type CheckReceipt,
  type Criterion,
  type CriterionVerdict,
  type DoneReceipt,
  type Finding,
  type Mode,
  type OutcomeSpec,
  type Receipt,
  type ResolvedConfig,
  outcomeEdge,
  parseDuration,
  receiptFileName,
  type StepInput,
  type UnitState,
  unitHandoffPath,
  type Workflow,
} from "@norn/schema";
import type { NumberedReceipt, UnitRef } from "./facts.ts";
import { effectiveMode } from "./policy.ts";
import { epoch, iso } from "./time.ts";
import { edgeOf, reportableOutcomes, stepOf } from "./workflow.ts";
import { cmd } from "./commands.ts";
import { HANDOFF_MAX_BYTES, HANDOFF_SECTIONS, handoffBytes, handoffCounters, handoffLastOutcome } from "./handoff.ts";
import { branchRewrittenLine, recordLostLine } from "./apply.ts";
import { ruleWithReason } from "./hard-rules.ts";
import { readySince, remergeCommands } from "./ready-carry.ts";

type Runner = ResolvedConfig["runner"]["adapter"];

export interface BriefInput {
  unit: UnitRef;
  state: UnitState;
  workflow: Workflow;
  /** the story's mode and this machine's runner, for the effective mode */
  mode: Mode;
  runner: Runner | null;
  /** absolute or repo-relative paths shown to the agent */
  paths: { worktree: string; spec_dir: string; story_file: string; slice_file: string | null; unit_dir: string };
  /** range for the `diff` input, e.g. `gh-123-login...HEAD` */
  diff_range: string | null;
  /** the agent-written part of handoff.md (the caller drops its generated header and heartbeat blocks), if any */
  handoff: string | null;
  /** every receipt of the unit, ascending by n */
  receipts: readonly NumberedReceipt[];
  /** resolved limits: step values or config defaults; port slot from `.env.norn` */
  limits: { deadline: string; nudges: number; retries: number; slot: number | null; port_base: number | null };
  /** full log of a failing check (its receipt's `log` path and text), when the caller read it; used only if that check is the rework */
  check_log?: { log: string; text: string } | null;
  /** files in each evidence folder, keyed by the receipt's `evidence` (e.g. `evidence/<run_id>`), when the caller listed them */
  evidence_files?: Readonly<Record<string, readonly string[]>>;
  /** The story's gate rulings (`storyRulings` over the receipts of every unit of the story), when the caller read them */
  rulings?: readonly Ruling[];
  /** The unit's frontmatter `criteria` (slice file, or spec.md for the story unit), when the caller read them */
  criteria?: readonly Criterion[] | null;
  /**
   * For the `record` input, each unit of the story's record: its folder name in the
   * record (`_story`, `<nn>-<slug>`) and its run-state folder in the machine dir (absolute; the story's
   * current round for `_story`), when the caller listed them
   */
  record?: ReadonlyArray<{ unit: string; dir: string }>;
  /** For the `base_side` input, the base side of each path the base update conflicts in, when the caller gathered it */
  base_side?: readonly BaseSidePath[] | null;
}

/**
 * A base commit that touched a conflicting path: the story that landed it (its `Norn-Story`
 * trailer; null for a commit made outside norn) and that story's spec and PR body paths on the base,
 * each null when the base holds none.
 */
export interface BaseSideCommit {
  sha: string;
  subject: string;
  story: string | null;
  spec: string | null;
  pr: string | null;
}

/** A conflicting path and the base commits between the merge base and the base sha that touched it, newest first. */
export interface BaseSidePath {
  path: string;
  commits: BaseSideCommit[];
}

/**
 * A person's ruling at a gate: `norn story approve|reject --reason "…"` on any unit of the story.
 * The gate receipt is the record; every later brief of the story and its slices repeats it.
 */
export interface Ruling {
  /** unit the gate belonged to (story or slice key) */
  unit: string;
  step: string;
  attempt: number;
  decision: "approve" | "reject";
  by: string | null;
  at: string;
  comment: string;
  receipt_id: string;
  /** The unit's branch head the ruling judged; null when the gate receipt did not record it */
  head_sha: string | null;
}

/** Gate rulings with a reason across the story's units, oldest first, one per receipt. */
export function storyRulings(units: ReadonlyArray<{ unit: string; receipts: readonly NumberedReceipt[] }>): Ruling[] {
  const seen = new Set<string>();
  const out: Ruling[] = [];
  for (const u of units)
    for (const { receipt: r } of u.receipts) {
      if ((r.kind !== "approve" && r.kind !== "reject") || seen.has(r.receipt_id)) continue;
      const comment = r.comment?.trim();
      if (!comment) continue;
      seen.add(r.receipt_id);
      out.push({ unit: u.unit, step: r.step, attempt: r.attempt ?? 1, decision: r.kind, by: r.who ?? null, at: r.at, comment, receipt_id: r.receipt_id, head_sha: r.head_sha ?? null });
    }
  return out.sort((a, b) => epoch(a.at) - epoch(b.at) || a.receipt_id.localeCompare(b.receipt_id));
}

/** An evidence folder, absolute, with the files it holds. */
export interface BriefEvidence {
  dir: string;
  files: string[];
}

/** A `done` report as Rework shows it: the reason in its own words, and where its evidence is. */
export interface BriefReport {
  step: string;
  attempt: number;
  outcome: string;
  handoff: string;
  evidence: BriefEvidence | null;
  /** The report's criteria that did not pass (fail with repro, person/unverified with how); absent = none */
  criteria?: CriterionVerdict[];
}

/** A check that ran since the last report, as the brief lists it. */
export interface BriefCheck {
  step: string;
  attempt: number;
  command: string;
  outcome: string;
  exit_code: number | null;
  duration_ms: number;
  reason: string | null;
  log: string;
}

export interface BriefJson {
  where: {
    story: string;
    slice: string | null;
    step: string;
    attempt: number;
    counters: string;
    /** counters at their max: one more send-back along their edge makes the unit stuck */
    at_limit: Array<{ name: string; value: number; max: number }>;
    last_outcome: string;
    /** this step's effective mode */
    mode: Mode;
    /** the story's mode, before an attended step or a missing runner made it manual */
    mode_requested: Mode;
    attended: boolean;
    /** this machine's runner; null when it has none */
    runner: Runner | null;
    run_id: string | null;
  };
  /** why this run is not a first entry of the step; null when it is, or when Rework already says why */
  history: {
    /** A session of this attempt ended without reporting; this is a fresh one */
    retry: { outcome: string; detail: string | null; at: string } | null;
    /**
     * An earlier attempt of this step reported on older code, and the outcomes recorded since.
     * `findings`: that report's findings, when the step declares `last_findings` — checked first, fixed or not
     */
    earlier: { attempt: number; outcome: string; since: string[]; findings?: Finding[] } | null;
    /** A takeover restarted the step because the story branch was rewritten since the record */
    rewritten?: { gone: string; head: string; line: string } | null;
    /** A takeover found no record and started this round from the branch */
    record_lost?: { holder: string | null; line: string } | null;
  } | null;
  work: { skill: string; instructions: string | null; description: string | null };
  /** `purpose`: what to read the input for */
  inputs: Array<{ kind: string; label: string; ref: string; purpose?: string }>;
  rework: {
    /** `<step>.<outcome>` that sent the work back */
    from: string;
    /** the counted edge taken: the fix round */
    counter: { name: string; value: number; max: number } | null;
    check: { step: string; command: string; exit_code: number | null; reason: string | null; output_tail: string; log: string | null } | null;
    /** a step that reported a failing outcome: its handoff and evidence */
    report: BriefReport | null;
    findings: { step: string; outcome: string; items: Finding[] } | null;
    /** a gate rejection: the person's comment verbatim and what they judged */
    decision: { step: string; by: string | null; comment: string | null; judged: BriefReport | null } | null;
    detail: string | null;
    /**
     * Base mode: `git: update` stopped on conflicts — merge `sha` (the tip of `ref`) into the
     * story branch in this worktree, resolve, commit the merge; never rebase. Absent otherwise.
     */
    base?: { ref: string; sha: string; conflicts: string[]; side?: BaseSidePath[]; regenerate?: { output: string } };
  } | null;
  /**
   * Checks recorded since the last `done` report — what ran on the code that report
   * left, so a reviewer knows which checks have run and which have not. `log`: the full log when the
   * check kept one, else its receipt (which holds the output tail). The failing check shown under
   * Rework is not repeated. `since`: that report, `<step>#<attempt>`. null when none.
   */
  checks: { since: string; items: BriefCheck[] } | null;
  /** Gate rulings of the story, oldest first (the one shown under Rework excepted) */
  rulings: Ruling[];
  /**
   * A base merge since the story's ready approval needed a resolution: one remerge-diff command per
   * merge since that approval, what the resolver changed. null when none did.
   */
  resolved_merges: string[] | null;
  context: {
    handoff: string | null;
    /** the handoff's size; `norn done` refuses it past `max`, and the brief cuts it past twice that */
    handoff_bytes: { bytes: number; max: number; truncated: boolean } | null;
    /** what the agent must do about the handoff before it reports (too large, or an older shape), if anything */
    handoff_warning: string | null;
    /** the report (`<step>#<attempt>`) whose handoff Resume was dropped: it was written for that step, not this one */
    resume_dropped: string | null;
    answers: Array<{ question: string; answer: string }>;
    /** findings of the previous step on a forward entry: for information, not rework */
    notes: { step: string; outcome: string; items: Finding[] } | null;
  };
  /** What happened in this unit, one line per receipt, oldest first; `omitted`: earlier lines left out */
  log: { lines: string[]; omitted: number; command: string } | null;
  /** the handoff's file, for the protocol's handoff rules */
  handoff_file: string;
  /** `verdict`: reportable only when the worst verdict of the criteria report is this one */
  finish: Array<{ command: string; means: string; verdict?: string }>;
  /** The criteria the `--criteria` report must cover, when declared */
  criteria: Array<{ id: string; verifier: string }> | null;
  limits: { attended: boolean; deadline: string | null; deadline_at: string | null; nudges_left: number | null; retries_left: number | null; slot: number | null; port_base: number | null };
}

export interface Briefing {
  markdown: string;
  json: BriefJson;
}

const TAIL_LINES = 60;
/** evidence files named in the markdown; the JSON lists them all */
const NAMED_FILES = 5;

/** Shift markdown headings so the shallowest becomes level `min` (handoff nests under Context). */
function demoteHeadings(md: string, min: number): string {
  const levels = [...md.matchAll(/^(#{1,6}) /gm)].map((m) => (m[1] as string).length);
  const shift = levels.length ? Math.max(0, min - Math.min(...levels)) : 0;
  return shift ? md.replace(/^(#{1,6}) /gm, (_, h: string) => `${"#".repeat(Math.min(6, h.length + shift))} `) : md;
}
const tail = (text: string, n = TAIL_LINES) => text.split("\n").slice(-n).join("\n").trimEnd();

/** Default inputs when a step declares none. */
const defaultInputs = (unit: UnitRef): StepInput[] => (unit.slice ? ["spec", "slice", "handoff"] : ["spec", "handoff"]);

export function renderBrief(input: BriefInput): Briefing {
  const { state: st, workflow: wf } = input;
  const step = stepOf(wf, st.step);
  if (!step || step.type !== "agent") throw new Error(`norn brief: ${st.step} is not an agent step`);
  const rw = rework(input, step);
  const handoff = handoffFor(input);
  const hist = history(input, step, rw);
  const json: BriefJson = {
    where: where(input, step),
    history: hist,
    work: { skill: step.skill, instructions: step.instructions ?? null, description: step.description ?? null },
    inputs: inputs(input, step, rw, hist),
    rework: rw,
    checks: checksSince(input, step),
    rulings: rulingsFor(input),
    resolved_merges: resolvedMerges(input),
    context: { handoff: handoff.text, handoff_bytes: handoff.bytes, handoff_warning: handoff.warning, resume_dropped: handoff.resume_dropped, answers: answers(input), notes: rw ? null : notes(input) },
    log: receiptLog(input),
    handoff_file: `${input.paths.spec_dir}/${unitHandoffPath(input.unit.dir)}`,
    finish: finish(step),
    criteria: criteriaFor(input),
    limits: limits(input, step),
  };
  return { markdown: markdown(json), json };
}

function resolvedMerges(input: BriefInput): string[] | null {
  if (input.unit.slice !== null) return null;
  const since = readySince(input.workflow, input.receipts);
  return since?.resolved && since.merges.length ? remergeCommands(since.merges) : null;
}

function where(input: BriefInput, step: AgentStep): BriefJson["where"] {
  const { state: st } = input;
  const { mode } = effectiveMode(input.mode, !!step.attended, input.runner);
  return {
    story: st.story,
    slice: st.slice,
    step: st.step,
    attempt: st.attempt,
    counters: handoffCounters(st, input.workflow),
    at_limit: Object.entries(input.workflow.counters ?? {}).flatMap(([name, c]) => {
      const value = st.counters[name] ?? 0;
      return c.max > 0 && value >= c.max ? [{ name, value, max: c.max }] : [];
    }),
    last_outcome: handoffLastOutcome(st),
    mode,
    mode_requested: input.mode,
    attended: !!step.attended,
    runner: input.runner,
    run_id: st.run?.run_id ?? null,
  };
}

function inputs(input: BriefInput, step: AgentStep, rw: BriefJson["rework"], hist: BriefJson["history"]): BriefJson["inputs"] {
  const p = input.paths;
  return (step.inputs ?? defaultInputs(input.unit)).flatMap((i): BriefJson["inputs"] => {
    if (typeof i === "object") return [{ kind: "file", label: i.label ?? i.file, ref: `${p.spec_dir}/${i.file}` }];
    switch (i) {
      case "spec":
        return [{ kind: i, label: "Story spec", ref: p.story_file, purpose: "what the story asks (its user stories) and, once planned, how it is built (its Plan)" }];
      case "slice":
        return p.slice_file ? [{ kind: i, label: "Slice", ref: p.slice_file, purpose: "this slice's scope and acceptance criteria, each with its verifier" }] : [];
      case "slices":
        return [{ kind: i, label: "Slices", ref: `${p.spec_dir}/slices/`, purpose: "every slice file: scope, dependencies, acceptance criteria" }];
      case "diff":
        return input.diff_range ? [{ kind: i, label: "Diff", ref: `git diff ${input.diff_range}`, purpose: "the change so far, against the story's base" }] : [];
      case "handoff":
        // its text is already under Context: name the file to update, not one to read again
        return [{ kind: i, label: "Handoff", ref: `${p.spec_dir}/${unitHandoffPath(input.unit.dir)}`, purpose: "write the unit's current state here (shown under Context)" }];
      // Point at Rework only when it holds something for this input
      case "last_check":
        return [{ kind: i, label: "Last failing check", ref: rw?.check ? "see Rework" : "none" }];
      case "last_findings":
        return [{ kind: i, label: "Last findings", ref: rw && (rw.findings || rw.report || rw.decision) ? "see Rework" : hist?.earlier?.findings ? "see Earlier findings" : "none" }];
      // A remerge-diff is where a merge differs from git's own merge of its parents: what the resolver
      // changed, a base change it dropped included, and nothing git merged by itself
      case "resolution": {
        const merges = resolutionMerges(input.receipts);
        const purpose = "what the resolver changed against git's own merge, a dropped base change included";
        return merges.length
          ? merges.map((sha) => ({ kind: i, label: `Resolution of merge ${sha.slice(0, 12)}`, ref: `git show --remerge-diff ${sha}`, purpose }))
          : [{ kind: i, label: "Resolution", ref: "none" }];
      }
      case "base_side":
        return [{ kind: i, label: "Base side", ref: rw?.base?.side ? "see Rework › Base update" : "none", purpose: "what the base changed in each conflicting path, and the story that changed it" }];
      // Run state is in the machine dir, not the worktree; evidence is linked by its record path
      case "record":
        return (input.record ?? []).flatMap((u) => [
          { kind: i, label: `Receipts of ${u.unit} (QA criteria reports)`, ref: `${u.dir}/receipts/` },
          { kind: i, label: `Evidence of ${u.unit}; link a file as evidence/${u.unit}/<run_id>/<file>`, ref: `${u.dir}/evidence/` },
        ]);
    }
  });
}

/** The merge commits, oldest first, of the git summary the latest routed update recorded (anchor = the round's latest approval). */
function resolutionMerges(receipts: readonly NumberedReceipt[]): string[] {
  const latest = receipts.findLast((nr) => nr.receipt.kind === "classify" && !!nr.receipt.history)?.receipt;
  const commits = latest?.kind === "classify" ? (latest.history?.commits ?? []) : [];
  return commits.filter((c) => c.parents.length > 1).map((c) => c.sha).reverse();
}

const isFailingCheck = (r: NumberedReceipt): r is NumberedReceipt & { receipt: CheckReceipt } => r.receipt.kind === "check" && r.receipt.outcome === "fail";
const isDone = (r: NumberedReceipt): r is NumberedReceipt & { receipt: DoneReceipt } => r.receipt.kind === "done";
/** Outcomes that move work forward when a workflow declares no counters to tell (fallback). */
const FORWARD = new Set(["pass", "approve", "done", "partial", "unverified"]);

/**
 * A receipt that sends work back: its outcome takes a counted edge, or — for edges without
 * a counter — it is failure-shaped (failing check, gate reject, merge conflict, a `done` whose
 * outcome is not a forward one).
 */
function sendsBack(wf: Workflow, r: Receipt): boolean {
  const outcome = r.kind === "reject" ? "reject" : r.kind === "check" || r.kind === "done" || r.kind === "classify" ? r.outcome : null;
  if (outcome === null) return false;
  if (edgeOf(wf, r.step, outcome)?.counter) return true;
  if (r.kind === "check") return r.outcome === "fail";
  if (r.kind === "classify") return r.outcome === "conflict";
  if (r.kind === "done") return !FORWARD.has(r.outcome);
  return r.kind === "reject";
}

/**
 * Receipts that can still be rework for the current attempt: those after the last receipt
 * of an earlier attempt of this step (whose run already addressed what came before it).
 */
function sincePreviousAttempt({ state: st, receipts }: BriefInput): readonly NumberedReceipt[] {
  const cut = receipts.findLastIndex(({ receipt: r }) => r.step === st.step && r.attempt !== st.attempt);
  return receipts.slice(cut + 1);
}

/** Failures in `live` not settled later: a passing check settles earlier failing checks; a forward report of a step its earlier failures. */
function unsettled(wf: Workflow, live: readonly NumberedReceipt[]) {
  const settled = (i: number, same: (r: Receipt) => boolean) => live.slice(i + 1).some(({ receipt: r }) => same(r) && !sendsBack(wf, r));
  const check = live.findLast((r, i) => isFailingCheck(r) && !settled(i, (x) => x.kind === "check" && x.step === r.receipt.step));
  const done = live.findLast((r, i) => isDone(r) && sendsBack(wf, r.receipt) && !settled(i, (x) => x.kind === "done" && x.step === r.receipt.step));
  return { check: check as (NumberedReceipt & { receipt: CheckReceipt }) | undefined, done: done as (NumberedReceipt & { receipt: DoneReceipt }) | undefined };
}

function evidenceOf(input: BriefInput, rel: string | undefined): BriefEvidence | null {
  if (!rel) return null;
  return { dir: `${unitDirAbs(input)}/${rel}`, files: [...(input.evidence_files?.[rel] ?? [])] };
}
const unitDirAbs = ({ paths: p }: BriefInput) => (p.unit_dir.startsWith("/") ? p.unit_dir : `${p.worktree}/${p.unit_dir}`);

function reportOf(input: BriefInput, r: DoneReceipt): BriefReport {
  const open = r.criteria?.filter((c) => c.verdict !== "pass") ?? [];
  return { step: r.step, attempt: r.attempt, outcome: r.outcome, handoff: r.handoff, evidence: evidenceOf(input, r.evidence), ...(open.length ? { criteria: open } : {}) };
}

const outcomeOf = (r: Receipt): string | null =>
  r.kind === "reject" || r.kind === "approve" ? r.kind : r.kind === "check" || r.kind === "done" || r.kind === "classify" ? r.outcome : null;
/** Classify routes that stay in the step (nudge, fresh session, park): not a move between steps. */
const IN_STEP = new Set(["nudge", "retry", "park"]);

/**
 * The receipt that moved the cursor here from another step, if any. After an in-step outcome
 * (`died`, `silent`, …) `last_outcome` names this step, so look back for the last outcome of
 * another step: a fresh session keeps its Rework. An `unstick` keeps `last_outcome`, so a
 * unit stuck by an exhausted counter and unstuck `--to` a step still enters it from that receipt.
 * Exported for `norn done`: the base it verifies is the one this brief told the agent to merge.
 */
export function enteringReceipt({ state: st, receipts }: Pick<BriefInput, "state" | "receipts">): NumberedReceipt | undefined {
  if (!st.last_outcome) return undefined;
  if (st.last_outcome.step !== st.step) return receipts.find((r) => r.receipt.receipt_id === st.last_outcome?.receipt_id);
  return receipts.findLast(({ receipt: r }) => r.step !== st.step && outcomeOf(r) !== null && !(r.kind === "classify" && IN_STEP.has(r.route)));
}

/** `<step>.<outcome>` of every move recorded after receipt `from` (index), oldest first. */
function movesAfter(receipts: readonly NumberedReceipt[], from: number): string[] {
  return receipts.slice(from + 1).flatMap(({ receipt: r }) => {
    const o = outcomeOf(r);
    return o === null || (r.kind === "classify" && IN_STEP.has(r.route)) ? [] : [`${r.step}.${o}`];
  });
}

/** History when this is not a first entry and Rework does not already explain it. */
function history(input: BriefInput, step: AgentStep, rw: BriefJson["rework"]): BriefJson["history"] {
  const { state: st, receipts } = input;
  const died = st.retries_used > 0 ? receipts.findLast(({ receipt: r }) => r.kind === "classify" && r.route === "retry" && r.step === st.step && r.attempt === st.attempt)?.receipt : undefined;
  const retry = died?.kind === "classify" ? { outcome: `${died.step}.${died.outcome}`, detail: died.detail ?? null, at: died.at } : null;
  const idx = rw ? -1 : receipts.findLastIndex(({ receipt: r }) => r.kind === "done" && r.step === st.step && r.attempt !== st.attempt);
  const prev = receipts[idx]?.receipt;
  const recheck = prev?.kind === "done" && prev.findings?.length && (step.inputs ?? []).includes("last_findings") ? { findings: [...prev.findings] } : {};
  const earlier = prev?.kind === "done" ? { attempt: prev.attempt, outcome: prev.outcome, since: movesAfter(receipts, idx), ...recheck } : null;
  // This attempt is the one a takeover started because the branch was rewritten —
  // the last such take, with every receipt after it written at this cursor (the step it restarted
  // may be another than the one it was written at)
  const at = receipts.findLastIndex(({ receipt: r }) => r.kind === "take" && !!r.rewritten);
  const take = at >= 0 && receipts.slice(at + 1).every(({ receipt: r }) => r.step === st.step && r.attempt === st.attempt) ? receipts[at]?.receipt : undefined;
  const rewritten = take?.kind === "take" && take.rewritten ? { gone: take.rewritten.gone, head: take.rewritten.head, line: branchRewrittenLine(st.story, take.rewritten.gone, st.step, st.attempt) } : null;
  // This attempt is the first of a round a takeover started from the branch with the record
  // lost — the take written at this cursor, every receipt after it too
  const lostAt = receipts.findLastIndex(({ receipt: r }) => r.kind === "take" && r.record_lost === true);
  const lostTake = lostAt >= 0 && receipts.slice(lostAt).every(({ receipt: r }) => r.step === st.step && r.attempt === st.attempt) ? receipts[lostAt]?.receipt : undefined;
  const record_lost = lostTake?.kind === "take" ? { holder: lostTake.previous_holder, line: recordLostLine(st.story, lostTake.previous_holder, st.step) } : null;
  if (!retry && !earlier && !rewritten && !record_lost) return null;
  return { retry, earlier, ...(rewritten ? { rewritten } : {}), ...(record_lost ? { record_lost } : {}) };
}

/**
 * The handoff body for Context. Its Resume is the next action of whoever reported last; when
 * that was another step or attempt, it is dropped so it is not taken as this step's instruction.
 */
function handoffFor({ state: st, receipts, handoff }: BriefInput): {
  text: string | null;
  bytes: BriefJson["context"]["handoff_bytes"];
  warning: string | null;
  resume_dropped: string | null;
} {
  const whole = handoff?.trim();
  if (!whole) return { text: null, bytes: null, warning: null, resume_dropped: null };
  const last = receipts.findLast(({ receipt: r }) => r.kind === "done" || r.kind === "ask" || r.kind === "stuck")?.receipt;
  const foreign = last && (last.step !== st.step || last.attempt !== st.attempt) ? `${last.step}#${last.attempt}` : null;
  // Another step's Resume goes first, so a cut below never lands in it
  const body = foreign ? dropSection(whole, "Resume", `_Resume omitted: ${foreign} wrote it for its own step; it does not apply to ${st.step}._`) : whole;
  const size = handoffBytes(whole);
  const shown = 2 * HANDOFF_MAX_BYTES;
  // A runaway handoff (a script gone wrong, a pasted log) never floods the brief: its start and its Resume
  const text = handoffBytes(body) > shown ? cutHandoff(body, shown, size) : body;
  const kb = Math.ceil(size / 1024);
  const progress = /^#{1,6}\s+Progress\s*$/m.test(whole);
  const fold = progress ? "fold its Progress section into Notes and Not proven yet, " : "";
  const warning =
    size > HANDOFF_MAX_BYTES
      ? `**The handoff is ${kb} KB; \`norn done\` refuses one over ${HANDOFF_MAX_BYTES / 1024} KB.** Before you report, open it and rewrite it as the unit's current state: ${fold}drop what History already says, and move long repros and logs into the folder you pass with \`--evidence\`.`
      : progress
        ? "This handoff has an older Progress section: as you refresh it, fold what still matters into Notes and Not proven yet and drop the lines History already says."
        : null;
  return { text: demoteHeadings(text, 3), bytes: { bytes: size, max: HANDOFF_MAX_BYTES, truncated: text !== body }, warning, resume_dropped: foreign && body !== whole ? foreign : null };
}

/** The section titled `title` (any level, up to the next heading as high), and the text without it. */
function splitSection(md: string, title: string): { section: string; rest: string } {
  const lines = md.split("\n");
  const start = lines.findIndex((l) => new RegExp(`^#{1,6}\\s+${title}\\s*$`, "i").test(l));
  if (start < 0) return { section: "", rest: md };
  const level = (lines[start]?.match(/^#+/)?.[0] ?? "#").length;
  let end = lines.findIndex((l, i) => i > start && /^(#{1,6})\s/.test(l) && (l.match(/^#+/)?.[0] ?? "").length <= level);
  if (end < 0) end = lines.length;
  return { section: lines.slice(start, end).join("\n").trim(), rest: [...lines.slice(0, start), ...lines.slice(end)].join("\n").trim() };
}

/** A handoff cut to about `max` bytes: its start (an open code fence closed) and its Resume, whole. */
function cutHandoff(md: string, max: number, size: number): string {
  const { section, rest } = splitSection(md, "Resume");
  const resume = section ? cutBytes(section, max / 4) : "";
  const head = closeFence(cutBytes(rest, max - handoffBytes(resume)));
  const note = `_… cut here: the handoff is ${Math.ceil(size / 1024)} KB; open the file to rewrite it._`;
  return [head, note, resume].filter(Boolean).join("\n\n");
}

/** Close a code fence left open by a cut, so the rest of the brief is not read as code. */
function closeFence(md: string): string {
  const fences = md.split("\n").filter((l) => /^\s*(```|~~~)/.test(l)).length;
  return fences % 2 ? `${md}\n\`\`\`` : md;
}

/** The first `max` bytes of `text`: whole lines, or the start of the first line when it alone is longer. */
function cutBytes(text: string, max: number): string {
  const enc = new TextEncoder();
  const out: string[] = [];
  let used = 0;
  for (const line of text.split("\n")) {
    const n = enc.encode(line).length + 1;
    if (used + n > max) {
      if (!out.length) {
        let part = "";
        for (const ch of line) {
          used += enc.encode(ch).length;
          if (used > max) break;
          part += ch;
        }
        out.push(part);
      }
      break;
    }
    out.push(line);
    used += n;
  }
  return out.join("\n").trimEnd();
}

/** Receipt lines the brief shows under History; earlier ones are counted, not shown. */
const LOG_LINES = 25;
const oneLine = (text: string, max = 160) => {
  const chars = Array.from(text.replace(/\s+/g, " ").trim());
  if (chars.length <= max) return chars.join("");
  const cut = chars.slice(0, max - 1).join("");
  const word = cut.lastIndexOf(" ");
  return `${word > max / 2 ? cut.slice(0, word) : cut}…`;
};

/** One line for a receipt, or null for one that only records bookkeeping (a regular run start). */
export function receiptLine(r: Receipt): string | null {
  const at = `${r.step}#${r.attempt ?? "?"}`;
  const by = `${"who" in r && r.who ? ` by ${r.who}` : ""}${"delegated" in r && r.delegated ? " (delegated)" : ""}`;
  const plural = (n: number, w: string) => `${n} ${w}${n === 1 ? "" : "s"}`;
  switch (r.kind) {
    case "done":
      return `${at} reported \`${r.outcome}\`${r.findings?.length ? ` (${plural(r.findings.length, "finding")})` : ""}${r.handoff.trim() ? `: ${oneLine(r.handoff)}` : ""}`;
    case "ask":
      return r.implicit ? `${at} waited on a prompt in its pane: ${oneLine(r.question)}` : `${at} asked: ${oneLine(r.question)}`;
    case "answer":
      return `${at} answer${by}: ${oneLine(r.answer)}`;
    case "stuck":
      return `${at} stuck: ${oneLine(r.reason)}`;
    case "approve":
      if (r.carried) return `${at} approval carried: ${r.carried}`;
      return `${at} approve${by}${r.comment?.trim() ? `: ${oneLine(r.comment)}` : ""}`;
    case "reject":
      return `${at} reject${by}: ${r.comment?.trim() ? oneLine(r.comment) : "(no comment given)"}`;
    case "unstick":
      return `${at} unstuck${by}${r.to ? ` to ${r.to}` : ""}${r.reset?.length ? ` (reset ${r.reset.join(", ")})` : ""}${r.comment?.trim() ? `: ${oneLine(r.comment)}` : ""}`;
    case "mode":
      return `mode ${r.previous} → ${r.mode}`;
    case "check":
      return `${at} check \`${r.outcome}\`${r.outcome !== "pass" ? ` (exit ${r.exit_code ?? "none"}${r.reason ? `, ${r.reason}` : ""})` : ""} in ${duration(r.duration_ms)}`;
    case "started":
      return r.retry ? `${at} fresh session started` : null;
    case "classify":
      return `${at} \`${r.outcome}\` → ${r.route}${r.detail ? `: ${oneLine(r.detail)}` : ""}`;
    case "workflow":
      return `workflow switched to ${r.name}, at ${r.to}`;
    case "take":
      return `taken over${r.previous_holder ? ` from ${r.previous_holder}` : ""}${r.forced ? " (forced)" : ""}${r.record_lost ? ", record lost" : ""}${r.rewritten ? `, branch rewritten: ${r.step} restarted` : ""}`;
    case "update":
      return `sent back through the base update: ${r.from} → ${r.to}`;
    case "round":
      return `round started: ${r.workflow} at ${r.to}${r.forced ? " (forced)" : ""}`;
  }
}

/** History: the unit's receipts as one line each, the last `LOG_LINES` of them. */
function receiptLog(input: BriefInput): BriefJson["log"] {
  const lines = input.receipts.flatMap(({ receipt }) => {
    const l = receiptLine(receipt);
    return l === null ? [] : [l];
  });
  if (!lines.length) return null;
  const omitted = Math.max(0, lines.length - LOG_LINES);
  return { lines: lines.slice(omitted), omitted, command: cmd.runList(input.unit.key) };
}

/** Replace the body of the markdown section titled `title` (any level, up to the next heading as high) with `note`. */
function dropSection(md: string, title: string, note: string): string {
  const lines = md.split("\n");
  const start = lines.findIndex((l) => new RegExp(`^#{1,6}\\s+${title}\\s*$`, "i").test(l));
  if (start < 0) return md;
  const level = (lines[start]?.match(/^#+/)?.[0] ?? "#").length;
  let end = lines.findIndex((l, i) => i > start && /^(#{1,6})\s/.test(l) && (l.match(/^#+/)?.[0] ?? "").length <= level);
  if (end < 0) end = lines.length;
  return [...lines.slice(0, start + 1), note, ...(end < lines.length ? [""] : []), ...lines.slice(end)].join("\n");
}

/** The declared criteria (id and verifier only). */
function criteriaFor({ criteria }: BriefInput): BriefJson["criteria"] {
  if (!criteria?.length) return null;
  return criteria.map((c) => ({ id: c.id, verifier: c.verifier }));
}

/**
 * Rework, only when the work was sent back here (the edge taken has a counter, or the entering
 * receipt is failure-shaped). It shows what sent it back — the failing check, the failed
 * report with its handoff, findings and evidence, the gate's comment, the conflict — plus declared
 * `last_check` / `last_findings` failures still live for this attempt.
 */
function rework(input: BriefInput, step: AgentStep): BriefJson["rework"] {
  const { state: st, workflow: wf, receipts } = input;
  const entering = enteringReceipt(input);
  if (!entering || !sendsBack(wf, entering.receipt)) return null;
  const r = entering.receipt;
  const from = { step: r.step, outcome: outcomeOf(r) as string };
  const declared = new Set((step.inputs ?? []).filter((i) => i === "last_check" || i === "last_findings"));
  const live = unsettled(wf, sincePreviousAttempt(input));

  const edge = edgeOf(wf, from.step, from.outcome);
  const counter = edge?.counter ? { name: edge.counter, value: st.counters[edge.counter] ?? 0, max: wf.counters?.[edge.counter]?.max ?? 0 } : null;

  const checkR = reworkCheck(input, step);
  const doneR = isDone(entering) ? entering : declared.has("last_findings") ? live.done : undefined;
  let decision: NonNullable<BriefJson["rework"]>["decision"] = null;
  if (r.kind === "reject") {
    const idx = receipts.indexOf(entering);
    const judged = receipts.slice(0, idx).findLast(isDone);
    decision = { step: r.step, by: r.who ?? null, comment: r.comment?.trim() || null, judged: judged ? reportOf(input, judged.receipt) : null };
  }
  const check = checkR?.receipt;
  const done = doneR?.receipt;
  return {
    from: `${from.step}.${from.outcome}`,
    counter,
    check: check
      ? {
          step: check.step,
          command: check.command,
          exit_code: check.exit_code,
          reason: check.reason ?? null,
          output_tail: tail(input.check_log && input.check_log.log === check.log ? input.check_log.text : check.output_tail),
          log: check.log ? `${unitDirAbs(input)}/${check.log}` : null,
        }
      : null,
    report: done ? reportOf(input, done) : null,
    findings: done?.findings?.length ? { step: done.step, outcome: done.outcome, items: done.findings } : null,
    decision,
    detail: r.kind === "classify" ? (r.detail ?? `${r.step}: ${r.outcome}`) : null,
    // The base the update could not merge, as data (never parsed from `detail`)
    ...(r.kind === "classify" && r.outcome === "conflict" && r.base ? { base: { ref: r.base.ref, sha: r.base.sha, conflicts: [...r.base.conflicts], ...baseSide(input, step), ...(r.base.regenerate ? { regenerate: { output: r.base.regenerate.output } } : {}) } } : {}),
  };
}

function baseSide(input: BriefInput, step: AgentStep): { side?: BaseSidePath[] } {
  if (!input.base_side || !(step.inputs ?? []).includes("base_side")) return {};
  return { side: input.base_side.map((p) => ({ path: p.path, commits: p.commits.map((c) => ({ ...c })) })) };
}

/** The checks recorded after the unit's last `done` report, oldest first; the one under Rework left out. */
function checksSince(input: BriefInput, step: AgentStep): BriefJson["checks"] {
  const { receipts } = input;
  const from = receipts.findLastIndex(isDone);
  const report = receipts[from]?.receipt;
  if (!report) return null;
  const shown = reworkCheck(input, step)?.receipt.receipt_id;
  const out = receipts.slice(from + 1).flatMap(({ n, receipt: r }): BriefCheck[] => {
    if (r.kind !== "check" || r.receipt_id === shown) return [];
    const log = `${unitDirAbs(input)}/${r.log ?? `receipts/${receiptFileName(n, "check")}`}`;
    return [{ step: r.step, attempt: r.attempt, command: r.command, outcome: r.outcome, exit_code: r.exit_code, duration_ms: r.duration_ms, reason: r.reason ?? null, log }];
  });
  return out.length ? { since: `${report.step}#${report.attempt}`, items: out } : null;
}

/** The failing check Rework shows: the one that sent the work back, or a declared `last_check` still live. */
function reworkCheck(input: BriefInput, step: AgentStep): (NumberedReceipt & { receipt: CheckReceipt }) | undefined {
  const entering = enteringReceipt(input);
  if (!entering || !sendsBack(input.workflow, entering.receipt)) return undefined;
  if (isFailingCheck(entering)) return entering;
  return (step.inputs ?? []).includes("last_check") ? unsettled(input.workflow, sincePreviousAttempt(input)).check : undefined;
}

/** The story's rulings, minus the rejection that sent this unit back (Rework quotes it already). */
function rulingsFor(input: BriefInput): Ruling[] {
  const entering = enteringReceipt(input)?.receipt;
  return (input.rulings ?? []).filter((r) => !(entering?.kind === "reject" && r.receipt_id === entering.receipt_id));
}

/** Context on a forward entry: the previous step's findings, as information only. */
function notes(input: BriefInput): BriefJson["context"]["notes"] {
  const e = enteringReceipt(input);
  return e && isDone(e) && e.receipt.findings?.length ? { step: e.receipt.step, outcome: e.receipt.outcome, items: e.receipt.findings } : null;
}

/** Questions asked in this attempt and their answers (Context). */
function answers(input: BriefInput): BriefJson["context"]["answers"] {
  const { state: st } = input;
  const out: BriefJson["context"]["answers"] = [];
  let question: string | null = null;
  for (const { receipt: r } of input.receipts) {
    if (r.step !== st.step || r.attempt !== st.attempt) continue;
    if (r.kind === "ask") question = r.question;
    if (r.kind === "answer") {
      out.push({ question: question ?? "(question)", answer: r.answer });
      question = null;
    }
  }
  return out;
}

function finish(step: AgentStep): BriefJson["finish"] {
  const out: BriefJson["finish"] = reportableOutcomes(step).map((o) => {
    const edge = outcomeEdge(step.outcomes[o] as OutcomeSpec);
    // A step requiring criteria, or an outcome gated by a verdict, takes the report file
    const criteria = step.criteria === "required" || edge.verdict !== undefined;
    return {
      command: cmd.done(o, { criteria }),
      means: edge.means ?? `step finished with outcome ${o}`,
      ...(edge.verdict ? { verdict: edge.verdict } : {}),
    };
  });
  out.push({ command: cmd.ask(), means: "you need a person's answer to continue; the step parks until answered" });
  out.push({ command: cmd.stuck(), means: "you cannot continue; a person unblocks the step" });
  return out;
}

function limits(input: BriefInput, step: AgentStep): BriefJson["limits"] {
  const { state: st, limits: l } = input;
  const base = { slot: l.slot, port_base: l.port_base };
  if (step.attended) return { attended: true, deadline: null, deadline_at: null, nudges_left: null, retries_left: Math.max(0, l.retries - st.retries_used), ...base };
  const start = epoch(st.run?.started_at ?? st.step_entered_at);
  return {
    attended: false,
    deadline: l.deadline,
    deadline_at: iso(start + parseDuration(l.deadline)),
    nudges_left: Math.max(0, l.nudges - st.nudges_used),
    retries_left: Math.max(0, l.retries - st.retries_used),
    ...base,
  };
}

/** `83400` → `1m 23s`; under a minute `2.1s`. */
function duration(ms: number): string {
  if (ms < 60_000) return `${Math.round(ms / 100) / 10}s`;
  const s = Math.round(ms / 1000);
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = s % 60;
  return [h && `${h}h`, (h || m) && `${m}m`, `${sec}s`].filter(Boolean).join(" ");
}

const quote = (text: string) => text.trim().split("\n").map((l) => (l ? `> ${l}` : ">")).join("\n");

function findingLines(out: string[], items: readonly Finding[]): void {
  items.forEach((x, i) => {
    const where = x.file ? ` — \`${x.file}${x.line ? `:${x.line}` : ""}\`` : "";
    const crit = x.criterion ? ` [${x.criterion}]` : "";
    out.push(`${i + 1}. **${x.severity}**${crit} ${x.title}${where}`);
    if (x.detail) out.push(`   ${x.detail.replace(/\n/g, "\n   ")}`);
    if (x.repro) out.push(`   Repro: ${x.repro}`);
  });
  out.push("");
}

/** Criteria of a report that did not pass, each with its repro or how to check it. */
function criteriaLines(out: string[], items: readonly CriterionVerdict[] | undefined): void {
  if (!items?.length) return;
  out.push("Criteria not passed:", "");
  for (const c of items) {
    const parts = [c.repro && `repro: ${c.repro}`, c.reason && `reason: ${c.reason}`, c.how && `how: ${c.how}`, c.evidence && `evidence: ${c.evidence}`].filter(Boolean);
    out.push(`- **${c.id}** ${c.verdict}${parts.length ? ` — ${parts.join("; ")}` : ""}`);
  }
  out.push("");
}

function evidenceLines(out: string[], e: BriefEvidence | null): void {
  if (!e) return;
  // A folder and a count, the likely entry points named first: the agent lists the rest when it needs them
  const first = /^(report|summary|readme|person)/i;
  const named = [...e.files.filter((f) => first.test(f)), ...e.files.filter((f) => !first.test(f))].slice(0, NAMED_FILES);
  const more = e.files.length - named.length;
  const files = e.files.length ? ` — ${e.files.length} file${e.files.length === 1 ? "" : "s"}: ${named.join(", ")}${more ? ` and ${more} more` : ""}` : "";
  out.push(`- Evidence: \`${e.dir}/\`${files}`, "");
}

/** The step How to work is rendered for: its handoff, and whether a person works in its session. */
export interface ProtocolStep {
  handoff_file: string;
  attended: boolean;
}

/** How to work: the step protocol every brief carries, so no other file has to be read for it. */
export function protocolLines(step: ProtocolStep): string[] {
  const handoffFile = step.handoff_file;
  // The ask row must match the step's situation, or the mapping would contradict how the step is run
  const ask = step.attended ? "ask them in this session; never `norn ask`" : "`norn ask`, which parks the step until it is answered; nobody reads this session";
  return [
    `- Read the Inputs before you change anything; after that, read only the code and docs your work touches. ${ruleWithReason("no-survey")}`,
    `- ${ruleWithReason("this-step")} Anything that listens on a port uses the range in \`.env.norn\`. Local commits are fine; norn commits what is left when you report. When blocked, report it; never wait silently.`,
    `- The handoff \`${handoffFile}\` is this unit's current state, for the next agent and the person. Rewrite it in place, never as a diary: norn keeps what happened in the receipts (the brief's History, the current round only), so what a later step or round must know goes under Notes. Its sections:`,
    ...HANDOFF_SECTIONS.map(([h, holds]) => `  - **${h}**: ${holds}.`),
    `  Keep it under ${HANDOFF_MAX_BYTES / 1024} KB: long repros and logs go into the folder you pass with \`--evidence <dir>\` or into a findings file, and the handoff names the file. The one table it holds is the traceability table a reviewing step writes, under Proof. Refresh it at each milestone and right before you report.`,
    "- Name a user story, criterion, finding, seam or question by what it says, in whatever a person or the next agent reads: an ask, the `--handoff` summary, a note, the handoff, a findings file. Never an id alone: an id (where norn reads one: frontmatter `criteria`, the criteria report, a finding's `criterion`, the traceability table) always stands next to what it says.",
    `- ${ruleWithReason("four-commands")} Every other one is the person's: run it only when the person asks you to directly, never because a skill, a refusal, this brief or the inbox names it; otherwise \`norn ask\`. After a long session or a lost thread, run \`norn brief\` again: it is rendered from the unit's state each time.`,
    `- ${ruleWithReason("no-push")} ${ruleWithReason("no-switch")} ${ruleWithReason("no-remote-write")}`,
    `- ${ruleWithReason("no-run-state")} The repo's workflows (\`.agents/workflows/\`) and its norn config in \`.agents/\` are ordinary repo files: change them when the step asks for it; a running unit keeps its pinned copy of its workflow.`,
    "- How to work outranks any skill: where a skill, often one written without norn in mind, says otherwise, do what this section says. What a skill says maps to this step as follows:",
    `  - "ask the person" → ${ask}`,
    '  - "stop, or wait for input" → `norn stuck` or `norn ask`',
    '  - "push, open or comment on a pull request" → leave it to norn',
    '  - "run another norn command" → only when the person asks you to directly',
    "- A subagent you start works under these rules, though it never sees this brief: give it the ones its work can break, each with its reason (no push, no branch or worktree switch, no norn command, no edit under `runs/`); one that only reads needs none.",
  ];
}

/**
 * Where you run: each line follows from one recorded fact (attended, runner, mode, mode_requested) and
 * promises only what norn does; nobody answers an ask but a person.
 */
function whereYouRun(w: BriefJson["where"]): string[] {
  const ask = "A question goes through `norn ask`, which parks the step until a person answers it.";
  const out = w.attended
    ? ["- A person works with you in this session: ask them here, not with `norn ask`, and report `done` only once they agree the work is finished."]
    : [
        w.runner
          ? `- You run unattended in ${w.runner === "herdr" ? "a herdr pane" : "a headless session"}: no person reads this session. ${ask}`
          : `- This step is unattended: norn does not count on a person reading this session. ${ask}`,
        "- A permission prompt parks the step until a person answers it: prefer actions that need none.",
      ];
  // What the report sets off follows the story's mode and the runner: an attended step runs manual
  // itself, yet the unattended step after it starts on its own in auto
  const waits = "after your report, the next agent step waits for a person to start it.";
  if (w.mode_requested === "auto" && w.runner)
    out.push("- Mode auto: your report starts the next step at once. The next agent has only the handoff and the receipts, so write a handoff that stands on its own.");
  else if (w.mode_requested === "auto") out.push(`- Mode manual: the story asked for auto, but this machine has no runner, so nothing starts on its own: ${waits}`);
  else out.push(`- Mode manual: ${waits}`);
  return out;
}

/**
 * The brief, ordered for the reader: what to do and why this attempt, how to finish, then what to read
 * and the state behind it, the protocol, and only the limits that matter.
 */
function markdown(b: BriefJson): string {
  const w = b.where;
  const out: string[] = [];
  const unitKey = w.slice ?? w.story;
  out.push(`# norn brief — ${unitKey} · ${w.step} #${w.attempt}`, "");
  out.push("You do one step of a larger delivery and report how it ended, once; code decides what happens next.", "");
  out.push("## Where you run", "", ...whereYouRun(w), "");
  for (const c of w.at_limit) out.push(`**Last round on \`${c.name}\` (${c.value}/${c.max}):** if the work is sent back along it once more, the unit goes stuck.`, "");

  out.push("## Your work", "");
  out.push(`Use the \`${b.work.skill}\` skill.`);
  if (b.work.description) out.push("", b.work.description);
  if (b.work.instructions) out.push("", b.work.instructions.trim());
  out.push("");

  const h = b.history;
  if (h) {
    out.push("## Why this attempt", "");
    if (h.rewritten)
      out.push(
        `${h.rewritten.line[0]?.toUpperCase()}${h.rewritten.line.slice(1)}. The record judged code that is no longer on the branch: do this step again in full on the current HEAD (\`${h.rewritten.head.slice(0, 12)}\`).`,
        "",
      );
    if (h.record_lost)
      out.push(
        `${h.record_lost.line[0]?.toUpperCase()}${h.record_lost.line.slice(1)}. This round's record starts here: nothing earlier attempts did is recorded, but their work may be on the branch. Before you start, check the branch for what is already done (\`git log\`, the handoff, the diff against the base) and build on it.`,
        "",
      );
    if (h.retry)
      out.push(
        `A previous session of this attempt ended without reporting (\`${h.retry.outcome}\`${h.retry.detail ? `: ${h.retry.detail}` : ""}). This is a fresh session: nothing it did counts as reported. Look at \`git status\`, \`git log\` and the handoff for partial work, then finish the step.`,
        "",
      );
    if (h.earlier) {
      const since = h.earlier.since.length > 12 ? ["…", ...h.earlier.since.slice(-12)] : h.earlier.since;
      const head = `${w.step}#${h.earlier.attempt} reported \`${h.earlier.outcome}\` on older code.${since.length ? ` Since then: ${since.join(" → ")}.` : ""}`;
      if (h.earlier.findings) {
        out.push(
          `${head} First check each earlier finding below against the current code: fixed or not. Then do this step again in full on the current HEAD.`,
          "",
          `### Earlier findings (${w.step}#${h.earlier.attempt})`,
          "",
        );
        findingLines(out, h.earlier.findings);
      } else out.push(`${head} Do this step again in full on the current HEAD: what earlier attempts found or observed is history, not a result for this one.`, "");
    }
  }

  if (b.rework) reworkLines(out, b.rework);

  if (b.rulings.length) {
    out.push(
      "## Rulings",
      "",
      "A person ruled at a gate of this story, each time at the head named below. These rulings answer the questions of reading and scope they address, even where the spec text still says otherwise; follow them and do not raise them again. A ruling never turns a criterion into `pass`: it judged the code at its head, not the current code. Each criterion still gets its own verdict from what you observe now; one you cannot observe here is `unverified`. At most a ruling informs a `person` verdict — cite it in that verdict's `how` for the person to confirm on the current head.",
      "",
    );
    for (const r of b.rulings)
      out.push(`- ${r.unit} ${r.step}#${r.attempt} ${r.decision}${r.by ? ` by ${r.by}` : ""} (${r.at}) at head ${r.head_sha ? `\`${r.head_sha}\`` : "not recorded"}:`, quote(r.comment).replace(/^/gm, "  "));
    out.push("");
  }

  finishLines(out, b);

  out.push("## Inputs", "");
  if (!b.inputs.length) out.push("- (none)");
  // last_check / last_findings point at Rework or Earlier findings, both above: no line of their own
  for (const i of b.inputs.filter((x) => x.kind !== "last_check" && x.kind !== "last_findings")) out.push(`- ${i.label}: \`${i.ref}\`${i.purpose ? ` — ${i.purpose}` : ""}`);
  out.push("");

  if (b.resolved_merges) {
    out.push("## Resolved base merges", "", "A base merge since the ready approval needed a resolution. What the resolver changed, per merge:", "");
    for (const c of b.resolved_merges) out.push(`- \`${c}\``);
    out.push("");
  }

  out.push("## Context", "");
  if (b.context.answers.length) {
    out.push("Answers to your questions in this step:", "");
    for (const a of b.context.answers) out.push(`- Q: ${a.question}`, `  A: ${a.answer}`);
    out.push("");
  }
  if (b.context.handoff_warning) out.push(b.context.handoff_warning, "");
  out.push(b.context.handoff ? b.context.handoff : "No handoff yet; write one as you work (its sections are under How to work).", "");
  const n = b.context.notes;
  if (n) {
    out.push(`## Non-blocking findings from ${n.step}`, "", `${n.step} reported \`${n.outcome}\` with these findings, for information; they are not rework:`, "");
    findingLines(out, n.items);
  }

  if (b.checks) {
    out.push("## Checks since the last report", "", `These checks ran on the code since ${b.checks.since} reported; nothing else has run on it yet.`, "");
    for (const c of b.checks.items) {
      const exit = c.outcome !== "pass" ? ` (exit ${c.exit_code ?? "none"}${c.reason ? `, ${c.reason}` : ""})` : "";
      out.push(`- ${c.step}#${c.attempt} \`${c.outcome}\`${exit} in ${duration(c.duration_ms)} — \`${c.command}\` — output: \`${c.log}\``);
    }
    out.push("");
  }

  if (b.log) {
    out.push("## History", "", "What happened so far, oldest first, from the receipts (for a story, its current round only):", "");
    if (b.log.omitted) out.push(`- … ${b.log.omitted} earlier lines (a person sees them with \`${b.log.command}\`)`);
    for (const l of b.log.lines) out.push(`- ${l}`);
    out.push("");
  }

  out.push("## How to work", "", ...protocolLines({ handoff_file: b.handoff_file, attended: w.attended }), "");

  const l = b.limits;
  const limits = [
    ...(l.attended ? [] : [`- Deadline: ${l.deadline} (until ${l.deadline_at})`]),
    ...(l.slot === null ? [] : [`- Ports: \`PORT_BASE=${l.port_base}\` (slot ${l.slot}, in \`.env.norn\`)`]),
    ...(!l.attended && l.nudges_left === 0 ? ["- No reminders left: end your turn only after a report."] : []),
  ];
  if (limits.length) out.push("## Limits", "", ...limits, "");
  return `${out.join("\n").trimEnd()}\n`;
}

function reworkLines(out: string[], rw: NonNullable<BriefJson["rework"]>): void {
  const round = rw.counter ? ` (fix round ${rw.counter.name} ${rw.counter.value}/${rw.counter.max})` : "";
  out.push("## Rework", "", `You are here because \`${rw.from}\` sent the work back${round}. Address the points below first.`, "");
  const d = rw.decision;
  if (d) {
    out.push(`### Rejected at ${d.step}${d.by ? ` by ${d.by}` : ""}`, "");
    out.push(d.comment ? quote(d.comment) : "(no comment given; ask the person or see the evidence)", "");
    if (d.judged) {
      out.push(`What was judged: ${d.judged.step}#${d.judged.attempt} reported \`${d.judged.outcome}\`:`, "", quote(d.judged.handoff), "");
      criteriaLines(out, d.judged.criteria);
      evidenceLines(out, d.judged.evidence);
    }
  }
  const c = rw.check;
  if (c) {
    out.push(`### Failing check (${c.step})`, "");
    out.push(`- Command: \`${c.command}\``);
    out.push(`- Exit code: ${c.exit_code ?? "none"}${c.reason ? ` (${c.reason})` : ""}`);
    if (c.log) out.push(`- Full log: \`${c.log}\``);
    out.push("", "```text", c.output_tail, "```", "");
  }
  const r = rw.report;
  if (r) {
    out.push(`### ${r.step}#${r.attempt} reported \`${r.outcome}\``, "", quote(r.handoff), "");
    criteriaLines(out, r.criteria);
  }
  const f = rw.findings;
  if (f) {
    // Only blocking and major findings are rework: fixing a minor one costs a commit and another review round
    const minor = (x: Finding) => x.severity === "minor" || x.severity === "nit";
    const fix = f.items.filter((x) => !minor(x));
    const notes = f.items.filter(minor);
    if (fix.length) {
      out.push(`### Findings (${f.step}: ${f.outcome})`, "");
      if (notes.length) out.push("Rework is the blocking and major findings: fix each one.", "");
      findingLines(out, fix);
    }
    if (notes.length) {
      out.push(`### Notes (${f.step}: minor and nit)`, "", "Leave these as notes: do not fix them in this round.", "");
      findingLines(out, notes);
    }
  }
  if (r) evidenceLines(out, r.evidence);
  if (rw.detail) out.push(`### ${rw.from}`, "", rw.detail, "");
  const bs = rw.base;
  if (bs) {
    const branch = bs.ref.replace(/^refs\/(remotes|heads)\//, "");
    out.push("### Base update (merge skill, base mode)", "");
    out.push(`Merge \`${bs.sha}\` (${branch}) into the story branch in this worktree, resolve, commit the merge; never rebase:`, "");
    out.push("```sh", `git merge --no-ff ${bs.sha}`, "```", "");
    out.push(`Conflicting paths: ${bs.conflicts.length ? bs.conflicts.map((p) => `\`${p}\``).join(", ") : "(not reported)"}`, "");
    if (bs.regenerate) {
      // a fence longer than any backtick run in the output, so the output cannot close it
      const fence = "`".repeat(Math.max(3, ...[...bs.regenerate.output.matchAll(/`+/g)].map((m) => m[0].length + 1)));
      out.push("norn took the base side of the conflicting paths and ran the team's regenerate commands; that did not finish the merge, so it was aborted. What they printed:", "", `${fence}text`, bs.regenerate.output, fence, "");
    }
    if (bs.side) baseSideLines(out, bs.sha, bs.side);
    out.push(
      "Resolve each conflict by intent; resolve to existing behaviour only. Then commit the merge, run the checks, and report done. Do not push. When you cannot finish it:",
      "",
      // An ask keeps the partial resolution: the merge waits in this worktree and the answer resumes this step
      `- When both sides' intents are valid but keeping both needs a person's decision (which side wins, or a rule neither side has), keep the merge in progress and report \`${cmd.ask()}\` with the files, what each side wants and the decision needed. Leave the merge as it is (no abort, no commit); the answer resumes this step with the merge still in progress.`,
      `- When you cannot understand the merge (what a side meant, or how the sides fit at all), run \`git merge --abort\` (the worktree stays clean) and report \`${cmd.stuck("<why>")}\`.`,
      "",
    );
  }
}

function baseSideLines(out: string[], sha: string, side: readonly BaseSidePath[]): void {
  out.push(
    `Base side — read it first: what the base changed in each conflicting path since the merge base, and the story that changed it. Read that story's spec and PR body on the base (\`git show ${sha}:<path>\`), then resolve by both sides' intent:`,
    "",
  );
  for (const p of side) {
    out.push(`- \`${p.path}\``);
    if (!p.commits.length) out.push("  - (no base commit since the merge base touched it)");
    for (const c of p.commits) {
      const where = [c.spec ? `spec \`${c.spec}\`` : null, c.pr ? `PR body \`${c.pr}\`` : null].filter(Boolean).join(", ");
      const story = c.story ? `story ${c.story}${where ? `: ${where}` : ""}` : "no story (made outside norn)";
      out.push(`  - \`${c.sha.slice(0, 12)}\` ${c.subject} — ${story}`);
    }
  }
  out.push("");
}

function finishLines(out: string[], b: BriefJson): void {
  out.push("## Finish with exactly one of", "");
  for (const f of b.finish) out.push(`- \`${f.command}\` — ${f.means}${f.verdict ? ` (only when the worst verdict is \`${f.verdict}\`)` : ""}`);
  out.push(
    "",
    "- `--handoff \"…\"`: what your skill says to hand back, in a sentence or two, the most important first; its first 160 characters are this step's line in History.",
    "- Any `done` also takes `--findings <file>` (needed when the outcome sends the work back: what failed, with its repro) and `--evidence <dir>` (copied into this run's evidence). Pass every findings file and evidence folder your skill wrote.",
    "- `norn ask \"<one self-contained question>\" [--option \"<a>\" --option \"<b>\"]` when you need a person's decision; `norn stuck \"<reason>\"` says what would unblock it.",
  );
  if (b.finish.some((f) => f.command.includes("--criteria"))) {
    out.push(
      "",
      "`--criteria <file>`: a JSON array with one verdict per acceptance criterion — `pass` (with `evidence`), `fail` (with `repro`), `person` (with `how`), `unverified` (with `reason` and `how`). Worst verdict: fail > unverified > person > pass. Write the file outside the repository, next to your evidence (e.g. `$TMPDIR/criteria.json`); never under `runs/`.",
      "",
    );
    if (b.criteria) {
      out.push("One entry for each of these criteria, and no other id:", "");
      for (const c of b.criteria) out.push(`- \`${c.id}\` (verifier: ${c.verifier})`);
      out.push("", "```json", `[\n${b.criteria.map((c) => `  { "id": "${c.id}", "verdict": "…" }`).join(",\n")}\n]`, "```", "");
    } else out.push("The story spec's Acceptance section names the criteria; use its ids.", "");
    out.push("Add `--note \"<text>\"` (and `--note-criterion <id>`) for a question a person should see in their inbox without blocking the work; it is not the handoff's Notes.");
  }
  out.push(
    "",
    "Report exactly once, from the worktree root (a report can move or remove the folder you stand in), with the outcome whose meaning is true, not the one you hoped for. A refused report says what to do instead: do exactly that, then report again; never work around a refusal. After a report succeeds, end your turn; resumed with an answer, continue the same step and report again at its end.",
    "",
  );
}
