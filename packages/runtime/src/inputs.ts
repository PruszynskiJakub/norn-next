/**
 * The inputs row's sources: the text of each input kind other than the story's documents (the last
 * check, the last findings, the story's record, a resolution, the base side of a conflict, the change
 * so far, and a story document named after the kind as the fallback). The mount table writes what
 * these answer under `.agents/inputs/`.
 */
import type { BriefInputs, KernelReceipt, UnitJournal } from "@norn/kernel";
import type { CriterionVerdict } from "@norn/schema";
import { cutFrom } from "./branches.ts";
import type { RuntimeEnv } from "./env.ts";
import { baseSideOf, recordOf, type Resolved, resolutionOf } from "./input-history.ts";
import { readStepRun } from "./step-runs.ts";
import { readStoryDoc } from "./story-docs.ts";

/** An input's text and how the brief labels it, or a note saying why norn holds none. */
export type InputText = { label: string; text: string } | { label?: string; note: string };

/** What sent the work back, or the last finding on the record: newest first, the brief's own rework receipt winning. */
function findingsReceipt(record: UnitJournal, reworkFrom: number | undefined): KernelReceipt | undefined {
  if (reworkFrom !== undefined) {
    const r = record.receipts.find((x) => x.seq === reworkFrom);
    if (r && r.data.kind !== "check.finished") return r;
  }
  const handsBackFindings = (step: string | undefined, outcome: string | undefined): boolean =>
    step !== undefined && outcome !== undefined && record.state?.workflow.doc.steps[step]?.hand_back?.[outcome] === "findings";
  return record.receipts.findLast((r) => {
    const d = r.data;
    if (d.kind === "gate.decided") return d.outcome === "reject";
    return d.kind === "run.reported" && d.verb === "done" && (d.text !== undefined || d.criteria !== undefined) && handsBackFindings(d.step, d.outcome);
  });
}

/** The criteria a report did not pass, one line each, with the repro or how to check it. */
export function unsettledCriteria(criteria: readonly CriterionVerdict[] | undefined): string {
  const lines = (criteria ?? [])
    .filter((c) => c.verdict !== "pass")
    .map((c) => `- \`${c.id}\` ${c.verdict}${c.repro ? `: ${c.repro}` : ""}${c.reason ? ` (${c.reason})` : ""}${c.how ? `; how to check: ${c.how}` : ""}${c.evidence ? `; evidence: ${c.evidence}` : ""}`);
  return lines.length > 0 ? `\n\nCriteria not passed:\n\n${lines.join("\n")}` : "";
}

function findingsText(r: KernelReceipt): string | null {
  const d = r.data;
  if (d.kind === "gate.decided") return `\`${d.step ?? "the gate"}\` was decided \`${d.outcome}\` by ${d.by}${d.reason ? `:\n\n${d.reason}` : "."}`;
  if (d.kind === "run.reported") return `\`${d.step ?? "a step"}\` reported \`${d.verb}${d.outcome ? ` ${d.outcome}` : ""}\`${d.text ? `:\n\n${d.text}` : "."}${unsettledCriteria(d.criteria)}`;
  return null;
}

async function lastCheckText(env: RuntimeEnv, record: UnitJournal): Promise<string | null> {
  const r = record.receipts.findLast((x) => x.data.kind === "check.finished");
  if (!r || r.data.kind !== "check.finished") return null;
  const d = r.data;
  const head = `Check \`${d.step ?? "check"}\` exited ${d.exit} (\`${d.outcome}\`).`;
  const run = await readStepRun(env.ctx, record.unit);
  const tail = run && run.run_id === d.run_id ? run.output?.trimEnd() : undefined;
  return tail ? `${head}\n\nThe end of its output:\n\n${tail}` : head;
}

const resolved = (label: string, got: Resolved): InputText => ("note" in got ? { label, note: got.note } : { label, text: got.text });

/** The text of the input `kind` for the unit of `record`. */
export async function inputText(env: RuntimeEnv, record: UnitJournal, brief: BriefInputs, kind: string): Promise<InputText> {
  const unit = record.unit;
  switch (kind) {
    case "last_check": {
      const text = await lastCheckText(env, record);
      return text === null ? { label: "the last check's result", note: "no check has run for this unit yet" } : { label: "the last check's result", text };
    }
    case "last_findings": {
      const r = findingsReceipt(record, brief.rework_from);
      const text = r ? findingsText(r) : null;
      return text === null ? { label: "the last findings", note: "no findings are recorded for this unit yet" } : { label: "the last findings sent back", text };
    }
    case "diff":
      return { label: "the change so far", note: `run \`git diff ${cutFrom(unit, env.config.base)}...HEAD\` in this worktree` };
    case "record":
      return resolved("the story's record: every unit's outcomes, gate rulings and criteria reports with their evidence", await recordOf(env, record));
    case "resolution":
      return resolved("the resolution to review: each merge's remerge-diff and the conflicts this round recorded", resolutionOf(record));
    case "base_side":
      return resolved("the base side of the conflict: the base commit to merge and what it changed in each conflicting path", await baseSideOf(env, record));
    default: {
      // a kind the host has no rule for: a story document of that name, when one was kept
      const kept = await readStoryDoc(env, unit, `${kind}.md`);
      if (kept.ok && kept.value !== null) return { label: `the story's ${kind}`, text: kept.value };
      return { note: "norn holds nothing for this input yet" };
    }
  }
}
