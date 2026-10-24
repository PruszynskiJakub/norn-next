/**
 * Briefing renderer (B3, B5, B6): `norn brief [--json]` built from data only — state,
 * pinned workflow step, inputs, handoff and receipts. Pure and snapshot-testable (B4).
 */
import {
  type AgentStep,
  type CheckReceipt,
  type CriterionVerdict,
  type DoneReceipt,
  type Finding,
  type Mode,
  type OutcomeSpec,
  type Receipt,
  outcomeEdge,
  parseDuration,
  type StepInput,
  type UnitState,
  type Workflow,
} from "@norn/schema";
import type { NumberedReceipt, UnitRef } from "./facts.ts";
import { effectiveMode } from "./inbox.ts";
import { epoch, iso } from "./time.ts";
import { edgeOf, reportableOutcomes, stepOf } from "./workflow.ts";

export interface BriefInput {
  unit: UnitRef;
  state: UnitState;
  /** the unit's pinned workflow */
  workflow: Workflow;
  /** the story's mode and this machine's runner, for the effective mode (MO2) */
  mode: Mode;
  runner: string | null;
  /** absolute or repo-relative paths shown to the agent */
  paths: { worktree: string; spec_dir: string; story_file: string; slice_file: string | null; unit_dir: string };
  /** range for the `diff` input, e.g. `gh-123-login...HEAD` */
  diff_range: string | null;
  /** handoff.md text, if any */
  handoff: string | null;
  /** every receipt of the unit, ascending by n */
  receipts: readonly NumberedReceipt[];
  /** resolved limits: step values or config defaults; port slot from `.env.norn` */
  limits: { deadline: string; nudges: number; retries: number; slot: number | null; port_base: number | null };
  /** full log of a failing check (its receipt's `log` path and text), when the caller read it; used only if that check is the rework */
  check_log?: { log: string; text: string } | null;
  /** files in each evidence folder, keyed by the receipt's `evidence` (e.g. `evidence/<run_id>`), when the caller listed them */
  evidence_files?: Readonly<Record<string, readonly string[]>>;
  /** F28/O2: the story's gate rulings (`storyRulings` over the receipts of every unit of the story), when the caller read them */
  rulings?: readonly Ruling[];
}

/**
 * A person's ruling at a gate (O2): `norn approve|--reject --reason "…"` on any unit of the story.
 * The gate receipt is the record; every later brief of the story and its slices repeats it (F28).
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
}

/** Gate rulings with a reason across the story's units, oldest first, one per receipt (F28). */
export function storyRulings(units: ReadonlyArray<{ unit: string; receipts: readonly NumberedReceipt[] }>): Ruling[] {
  const seen = new Set<string>();
  const out: Ruling[] = [];
  for (const u of units)
    for (const { receipt: r } of u.receipts) {
      if ((r.kind !== "approve" && r.kind !== "reject") || seen.has(r.receipt_id)) continue;
      const comment = r.comment?.trim();
      if (!comment) continue;
      seen.add(r.receipt_id);
      out.push({ unit: u.unit, step: r.step, attempt: r.attempt, decision: r.kind, by: r.who ?? null, at: r.at, comment, receipt_id: r.receipt_id });
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
  /** QV2: the report's criteria that did not pass (fail with repro, person/unverified with how); absent = none */
  criteria?: CriterionVerdict[];
}

export interface BriefJson {
  where: { story: string; slice: string | null; step: string; attempt: number; mode: Mode; mode_note: string | null; attended: boolean; run_id: string | null };
  work: { skill: string; instructions: string | null; description: string | null };
  inputs: Array<{ kind: string; label: string; ref: string }>;
  rework: {
    /** `<step>.<outcome>` that sent the work back */
    from: string;
    /** the counted edge taken (W4): the fix round */
    counter: { name: string; value: number; max: number } | null;
    check: { step: string; command: string; exit_code: number | null; reason: string | null; output_tail: string; log: string | null } | null;
    /** a step that reported a failing outcome: its handoff and evidence */
    report: BriefReport | null;
    findings: { step: string; outcome: string; items: Finding[] } | null;
    /** a gate rejection: the person's comment verbatim and what they judged */
    decision: { step: string; by: string | null; comment: string | null; judged: BriefReport | null } | null;
    detail: string | null;
    /**
     * BS5 base mode: `git: update` stopped on conflicts — merge `sha` (the tip of `ref`) into the
     * story branch in this worktree, resolve, commit the merge; never rebase. Absent otherwise.
     */
    base?: { ref: string; sha: string; conflicts: string[] };
  } | null;
  /** F28: gate rulings of the story, oldest first (the one shown under Rework excepted) */
  rulings: Ruling[];
  context: {
    handoff: string | null;
    answers: Array<{ question: string; answer: string }>;
    /** findings of the previous step on a forward entry: for information, not rework */
    notes: { step: string; outcome: string; items: Finding[] } | null;
  };
  /** `verdict`: QV5 — reportable only when the worst verdict of the criteria report is this one */
  finish: Array<{ command: string; means: string; verdict?: string }>;
  limits: { attended: boolean; deadline: string | null; deadline_at: string | null; nudges_left: number | null; retries_left: number | null; slot: number | null; port_base: number | null };
}

export interface Briefing {
  markdown: string;
  json: BriefJson;
}

const TAIL_LINES = 60;
/** evidence files listed by name in the markdown; the JSON lists them all */
const MAX_FILES = 50;

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
  const json: BriefJson = {
    where: where(input, step),
    work: { skill: step.skill, instructions: step.instructions ?? null, description: step.description ?? null },
    inputs: inputs(input, step, rw),
    rework: rw,
    rulings: rulingsFor(input),
    context: { handoff: input.handoff?.trim() ? demoteHeadings(input.handoff.trim(), 3) : null, answers: answers(input), notes: rw ? null : notes(input) },
    finish: finish(step),
    limits: limits(input, step),
  };
  return { markdown: markdown(json), json };
}

function where(input: BriefInput, step: AgentStep): BriefJson["where"] {
  const { state: st } = input;
  const { mode, downgraded } = effectiveMode(input.mode, !!step.attended, input.runner);
  return {
    story: st.story,
    slice: st.slice,
    step: st.step,
    attempt: st.attempt,
    mode,
    mode_note: downgraded ? "auto requested, no runner; running manual" : null,
    attended: !!step.attended,
    run_id: st.run?.run_id ?? null,
  };
}

function inputs(input: BriefInput, step: AgentStep, rw: BriefJson["rework"]): BriefJson["inputs"] {
  const p = input.paths;
  return (step.inputs ?? defaultInputs(input.unit)).flatMap((i): BriefJson["inputs"] => {
    if (typeof i === "object") return [{ kind: "file", label: i.label ?? i.file, ref: `${p.spec_dir}/${i.file}` }];
    switch (i) {
      case "spec":
        return [{ kind: i, label: "Story spec", ref: p.story_file }];
      case "slice":
        return p.slice_file ? [{ kind: i, label: "Slice", ref: p.slice_file }] : [];
      case "slices":
        return [{ kind: i, label: "Slices", ref: `${p.spec_dir}/slices/` }];
      case "diff":
        return input.diff_range ? [{ kind: i, label: "Diff", ref: `git diff ${input.diff_range}` }] : [];
      case "handoff":
        return [{ kind: i, label: "Handoff", ref: `${p.unit_dir}/handoff.md` }];
      // B6: point at Rework only when it holds something for this input
      case "last_check":
        return [{ kind: i, label: "Last failing check", ref: rw?.check ? "see Rework" : "none" }];
      case "last_findings":
        return [{ kind: i, label: "Last findings", ref: rw && (rw.findings || rw.report || rw.decision) ? "see Rework" : "none" }];
    }
  });
}

const isFailingCheck = (r: NumberedReceipt): r is NumberedReceipt & { receipt: CheckReceipt } => r.receipt.kind === "check" && r.receipt.outcome === "fail";
const isDone = (r: NumberedReceipt): r is NumberedReceipt & { receipt: DoneReceipt } => r.receipt.kind === "done";
/** Outcomes that move work forward when a workflow declares no counters to tell (fallback). */
const FORWARD = new Set(["pass", "approve", "done", "partial", "unverified"]);

/**
 * A receipt that sends work back (W4): its outcome takes a counted edge, or — for edges without
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
 * Receipts that can still be rework for the current attempt (B6): those after the last receipt
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

/** The receipt that moved the cursor here from another step, if any. */
function enteringReceipt({ state: st, receipts }: BriefInput): NumberedReceipt | undefined {
  return st.last_outcome && st.last_outcome.step !== st.step ? receipts.find((r) => r.receipt.receipt_id === st.last_outcome?.receipt_id) : undefined;
}

/**
 * B3 Rework, only when the work was sent back here (W4: the edge taken has a counter, or the
 * entering receipt is failure-shaped). It shows what sent it back — the failing check, the failed
 * report with its handoff, findings and evidence, the gate's comment, the conflict — plus declared
 * `last_check` / `last_findings` failures still live for this attempt (B6).
 */
function rework(input: BriefInput, step: AgentStep): BriefJson["rework"] {
  const { state: st, workflow: wf, receipts } = input;
  const entering = enteringReceipt(input);
  if (!entering || !st.last_outcome || !sendsBack(wf, entering.receipt)) return null;
  const r = entering.receipt;
  const declared = new Set((step.inputs ?? []).filter((i) => i === "last_check" || i === "last_findings"));
  const live = unsettled(wf, sincePreviousAttempt(input));

  const edge = edgeOf(wf, st.last_outcome.step, st.last_outcome.outcome);
  const counter = edge?.counter ? { name: edge.counter, value: st.counters[edge.counter] ?? 0, max: wf.counters?.[edge.counter]?.max ?? 0 } : null;

  const checkR = isFailingCheck(entering) ? entering : declared.has("last_check") ? live.check : undefined;
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
    from: `${st.last_outcome.step}.${st.last_outcome.outcome}`,
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
    // BS5: the base the update could not merge, as data (never parsed from `detail`, P8)
    ...(r.kind === "classify" && r.outcome === "conflict" && r.base ? { base: { ref: r.base.ref, sha: r.base.sha, conflicts: [...r.base.conflicts] } } : {}),
  };
}

/** The story's rulings, minus the rejection that sent this unit back (Rework quotes it already). */
function rulingsFor(input: BriefInput): Ruling[] {
  const entering = enteringReceipt(input)?.receipt;
  return (input.rulings ?? []).filter((r) => !(entering?.kind === "reject" && r.receipt_id === entering.receipt_id));
}

/** B3 Context on a forward entry: the previous step's findings, as information only. */
function notes(input: BriefInput): BriefJson["context"]["notes"] {
  const e = enteringReceipt(input);
  return e && isDone(e) && e.receipt.findings?.length ? { step: e.receipt.step, outcome: e.receipt.outcome, items: e.receipt.findings } : null;
}

/** Questions asked in this attempt and their answers (B3 Context). */
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
    // QV3/QV5: a step requiring criteria, or an outcome gated by a verdict, takes the report file
    const criteria = step.criteria === "required" || edge.verdict !== undefined;
    return {
      command: `norn done ${o}${criteria ? " --criteria <file>" : ""} --handoff "…"`,
      means: edge.means ?? `step finished with outcome ${o}`,
      ...(edge.verdict ? { verdict: edge.verdict } : {}),
    };
  });
  out.push({ command: `norn ask "<question>"`, means: "you need a person's answer to continue; the step parks until answered" });
  out.push({ command: `norn stuck "<reason>"`, means: "you cannot continue; a person unblocks the step" });
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

// ---------------------------------------------------------------- markdown

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

/** QV2: criteria of a report that did not pass, each with its repro or how to check it. */
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
  out.push(`- Evidence: \`${e.dir}/\``);
  for (const f of e.files.slice(0, MAX_FILES)) out.push(`  - ${f}`);
  if (e.files.length > MAX_FILES) out.push(`  - … ${e.files.length - MAX_FILES} more`);
  out.push("");
}

function markdown(b: BriefJson): string {
  const w = b.where;
  const out: string[] = [];
  const unitKey = w.slice ?? w.story;
  out.push(`# norn brief — ${unitKey} · ${w.step} #${w.attempt}`, "");

  out.push("## Where you are", "");
  out.push(`- Story: ${w.story}`);
  if (w.slice) out.push(`- Slice: ${w.slice}`);
  out.push(`- Step: ${w.step} (attempt ${w.attempt})`);
  out.push(`- Mode: ${w.mode}${w.mode_note ? ` (${w.mode_note})` : ""}${w.attended ? " · attended: work with the person in this session" : ""}`);
  if (w.run_id) out.push(`- Run: ${w.run_id}`);
  out.push("");

  out.push("## Your work", "");
  out.push(`Use the \`${b.work.skill}\` skill.`);
  if (b.work.description) out.push("", b.work.description);
  if (b.work.instructions) out.push("", b.work.instructions.trim());
  out.push("");

  out.push("## Inputs", "");
  if (!b.inputs.length) out.push("- (none)");
  for (const i of b.inputs) out.push(`- ${i.label}: \`${i.ref}\``);
  out.push("");

  if (b.rework) {
    const rw = b.rework;
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
      out.push(`### Findings (${f.step}: ${f.outcome})`, "");
      if (f.items.some((x) => x.severity === "minor" || x.severity === "nit")) out.push("Fix every blocking and major finding; minor and nit ones are for you to weigh.", "");
      findingLines(out, f.items);
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
      out.push("Resolve each conflict by intent; resolve to existing behaviour only. When no resolution fits without new behaviour, run `git merge --abort` (the worktree stays clean) and report `norn stuck \"<why>\"`. Otherwise commit the merge, run the checks, and report done. Do not push.", "");
    }
  }

  if (b.rulings.length) {
    out.push("## Rulings", "", "A person ruled at a gate of this story. These rulings answer the questions they address, even where the spec text still says otherwise; follow them and do not raise them again. A ruling never verifies an acceptance criterion: it judged the code as it was then, not the current code. Each criterion still gets its own verdict from what you observe now; one you cannot observe here is `unverified` (QV5a), never `pass`.", "");
    for (const r of b.rulings) out.push(`- ${r.unit} ${r.step}#${r.attempt} ${r.decision}${r.by ? ` by ${r.by}` : ""} (${r.at}):`, quote(r.comment).replace(/^/gm, "  "));
    out.push("");
  }

  out.push("## Context", "");
  if (b.context.answers.length) {
    out.push("Answers to your questions in this step:", "");
    for (const a of b.context.answers) out.push(`- Q: ${a.question}`, `  A: ${a.answer}`);
    out.push("");
  }
  out.push(b.context.handoff ? b.context.handoff : "No handoff yet — you are the first run of this unit.", "");
  const n = b.context.notes;
  if (n) {
    out.push(`### Notes from ${n.step} (non-blocking)`, "", `${n.step} reported \`${n.outcome}\` with these notes, for information:`, "");
    findingLines(out, n.items);
  }

  out.push("## Finish with exactly one of", "");
  for (const f of b.finish) out.push(`- \`${f.command}\` — ${f.means}${f.verdict ? ` (only when the worst verdict is \`${f.verdict}\`)` : ""}`);
  if (b.finish.some((f) => f.command.includes("--criteria")))
    out.push(
      "",
      "`--criteria <file>`: a JSON array with one verdict per acceptance criterion — `pass` (with `evidence`), `fail` (with `repro`), `person` (with `how`), `unverified` (with `reason` and `how`). Worst verdict: fail > unverified > person > pass.",
      "Add `--note \"<text>\"` (and `--note-criterion <id>`) for a question a person should see without blocking the work.",
    );
  out.push("", "Then end your turn. Never edit `runs/`; never push.", "");

  out.push("## Limits", "");
  const l = b.limits;
  if (l.attended) out.push("- Attended step: no deadline or nudges (MO4)");
  else {
    out.push(`- Deadline: ${l.deadline} (until ${l.deadline_at})`);
    out.push(`- Nudges left: ${l.nudges_left}`);
  }
  out.push(`- Fresh-session retries left: ${l.retries_left}`);
  out.push(l.slot === null ? "- Port slot: none" : `- Port slot: ${l.slot} (PORT_BASE=${l.port_base})`);
  return `${out.join("\n")}\n`;
}
