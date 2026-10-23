/**
 * Briefing renderer (B3, B5, B6): `norn brief [--json]` built from data only — state,
 * pinned workflow step, inputs, handoff and receipts. Pure and snapshot-testable (B4).
 */
import {
  type AgentStep,
  type CheckReceipt,
  type DoneReceipt,
  type Finding,
  type Mode,
  type OutcomeSpec,
  outcomeEdge,
  parseDuration,
  type StepInput,
  type UnitState,
  type Workflow,
} from "@norn/schema";
import type { NumberedReceipt, UnitRef } from "./facts.ts";
import { effectiveMode } from "./inbox.ts";
import { epoch, iso } from "./time.ts";
import { reportableOutcomes, stepOf } from "./workflow.ts";

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
}

export interface BriefJson {
  where: { story: string; slice: string | null; step: string; attempt: number; mode: Mode; mode_note: string | null; attended: boolean; run_id: string | null };
  work: { skill: string; instructions: string | null; description: string | null };
  inputs: Array<{ kind: string; label: string; ref: string }>;
  rework: {
    from: string;
    check: { step: string; command: string; exit_code: number | null; reason: string | null; output_tail: string; log: string | null } | null;
    findings: { step: string; outcome: string; items: Finding[] } | null;
    detail: string | null;
  } | null;
  context: { handoff: string | null; answers: Array<{ question: string; answer: string }> };
  finish: Array<{ command: string; means: string }>;
  limits: { attended: boolean; deadline: string | null; deadline_at: string | null; nudges_left: number | null; retries_left: number | null; slot: number | null; port_base: number | null };
}

export interface Briefing {
  markdown: string;
  json: BriefJson;
}

const TAIL_LINES = 60;

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
  const json: BriefJson = {
    where: where(input, step),
    work: { skill: step.skill, instructions: step.instructions ?? null, description: step.description ?? null },
    inputs: inputs(input, step),
    rework: rework(input, step),
    context: { handoff: input.handoff?.trim() ? demoteHeadings(input.handoff.trim(), 3) : null, answers: answers(input) },
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

function inputs(input: BriefInput, step: AgentStep): BriefJson["inputs"] {
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
      case "last_check":
      case "last_findings":
        return [{ kind: i, label: i === "last_check" ? "Last failing check" : "Last findings", ref: "see Rework" }];
    }
  });
}

const isFailingCheck = (r: NumberedReceipt): r is NumberedReceipt & { receipt: CheckReceipt } => r.receipt.kind === "check" && r.receipt.outcome === "fail";
const hasFindings = (r: NumberedReceipt): r is NumberedReceipt & { receipt: DoneReceipt } => r.receipt.kind === "done" && !!r.receipt.findings?.length;

/**
 * Receipts that can still be rework for the current attempt (B6): those after both the last
 * passing check (which settles every earlier failure) and the last receipt of an earlier
 * attempt of this step (whose run already addressed what came before it). What remains is
 * the failure that sent the unit back here.
 */
function liveSince({ state: st, receipts }: BriefInput): readonly NumberedReceipt[] {
  const cut = receipts.findLastIndex(
    ({ receipt: r }) => (r.kind === "check" && r.outcome === "pass") || (r.step === st.step && r.attempt !== st.attempt),
  );
  return receipts.slice(cut + 1);
}

/** B3 Rework: the receipt that sent the unit back here, plus declared `last_check` / `last_findings` that are still live (B6). */
function rework(input: BriefInput, step: AgentStep): BriefJson["rework"] {
  const { state: st, receipts } = input;
  const declared = new Set((step.inputs ?? []).filter((i): i is "last_check" | "last_findings" => i === "last_check" || i === "last_findings"));
  const entering = st.last_outcome && st.last_outcome.step !== st.step ? receipts.find((r) => r.receipt.receipt_id === st.last_outcome?.receipt_id) : undefined;
  const fromFailure = entering && (isFailingCheck(entering) || hasFindings(entering) || (entering.receipt.kind === "classify" && entering.receipt.outcome === "conflict"));
  if (!fromFailure && !declared.size) return null;

  const live = liveSince(input);
  const check = (fromFailure && entering && isFailingCheck(entering) ? entering : declared.has("last_check") ? live.findLast(isFailingCheck) : undefined) ?? null;
  const found = (fromFailure && entering && hasFindings(entering) ? entering : declared.has("last_findings") ? live.findLast(hasFindings) : undefined) ?? null;
  const detail = fromFailure && entering?.receipt.kind === "classify" ? (entering.receipt.detail ?? `${entering.receipt.step}: ${entering.receipt.outcome}`) : null;
  if (!check && !found && !detail) return null;
  return {
    from: st.last_outcome ? `${st.last_outcome.step}.${st.last_outcome.outcome}` : "previous runs",
    check: check && {
      step: check.receipt.step,
      command: check.receipt.command,
      exit_code: check.receipt.exit_code,
      reason: check.receipt.reason ?? null,
      output_tail: tail(input.check_log && input.check_log.log === check.receipt.log ? input.check_log.text : check.receipt.output_tail),
      log: check.receipt.log ? `${input.paths.unit_dir}/${check.receipt.log}` : null,
    },
    findings: found && { step: found.receipt.step, outcome: found.receipt.outcome, items: found.receipt.findings ?? [] },
    detail,
  };
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
  const out = reportableOutcomes(step).map((o) => ({
    command: `norn done ${o} --handoff "…"`,
    means: outcomeEdge(step.outcomes[o] as OutcomeSpec).means ?? `step finished with outcome ${o}`,
  }));
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
    out.push("## Rework", "", `You are here because of \`${b.rework.from}\`. Address every point below first.`, "");
    const c = b.rework.check;
    if (c) {
      out.push(`### Failing check (${c.step})`, "");
      out.push(`- Command: \`${c.command}\``);
      out.push(`- Exit code: ${c.exit_code ?? "none"}${c.reason ? ` (${c.reason})` : ""}`);
      if (c.log) out.push(`- Full log: \`${c.log}\``);
      out.push("", "```text", c.output_tail, "```", "");
    }
    const f = b.rework.findings;
    if (f) {
      out.push(`### Findings (${f.step}: ${f.outcome})`, "");
      f.items.forEach((x, i) => {
        const where = x.file ? ` — \`${x.file}${x.line ? `:${x.line}` : ""}\`` : "";
        const crit = x.criterion ? ` [${x.criterion}]` : "";
        out.push(`${i + 1}. **${x.severity}**${crit} ${x.title}${where}`);
        if (x.detail) out.push(`   ${x.detail}`);
        if (x.repro) out.push(`   Repro: ${x.repro}`);
      });
      out.push("");
    }
    if (b.rework.detail) out.push(b.rework.detail, "");
  }

  out.push("## Context", "");
  if (b.context.answers.length) {
    out.push("Answers to your questions in this step:", "");
    for (const a of b.context.answers) out.push(`- Q: ${a.question}`, `  A: ${a.answer}`);
    out.push("");
  }
  out.push(b.context.handoff ? b.context.handoff : "No handoff yet — you are the first run of this unit.", "");

  out.push("## Finish with exactly one of", "");
  for (const f of b.finish) out.push(`- \`${f.command}\` — ${f.means}`);
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
