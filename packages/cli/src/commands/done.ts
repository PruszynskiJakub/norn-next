/**
 * `norn done <outcome> --handoff "…" [--findings <file>] [--evidence <dir>]` (§9.3, §10): the
 * only way an agent step completes. The outcome must be declared at the pinned step (W3);
 * findings are copied into the receipt, evidence into runs/<unit>/evidence/<run_id>/.
 */
import { existsSync, readFileSync, statSync } from "node:fs";
import { isAbsolute, resolve } from "node:path";
import { reportableOutcomes } from "@norn/core";
import { type AgentStep, type Finding, type ReceiptOf, validate } from "@norn/schema";
import { ensureEvidenceDir } from "@norn/store";
import { defineCommand, opt } from "../command.ts";
import type { Context } from "../context.ts";
import { refuse, usageError } from "../output.ts";
import { stepOfSession } from "../runtime/agent-unit.ts";
import { appendProgress, reported, reportHeader, reportTarget, writeReport } from "../runtime/report.ts";

const SEVERITIES = new Set(["blocking", "major", "minor", "nit"]);
const str = (v: unknown) => (typeof v === "string" && v.trim() ? v : undefined);

/**
 * Normalize a findings file: a JSON array of findings, or `{findings: [...]}` as the review
 * and qa skills write it. Keys outside the receipt schema fold into `detail`.
 */
export function parseFindings(text: string, file: string): Finding[] {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch (e) {
    throw refuse(`findings file ${file} is not valid JSON: ${(e as Error).message}`, "write the findings as JSON ({\"findings\": [...]}) and report again", "bad_findings");
  }
  const list = Array.isArray(raw) ? raw : typeof raw === "object" && raw !== null && Array.isArray((raw as { findings?: unknown }).findings) ? (raw as { findings: unknown[] }).findings : null;
  if (!list) throw refuse(`findings file ${file} must hold a JSON array or {"findings": [...]}`, "fix the findings file and report again", "bad_findings");
  return list.map((x, i) => {
    const o = (typeof x === "object" && x !== null ? x : {}) as Record<string, unknown>;
    const severity = str(o.severity)?.toLowerCase();
    const title = str(o.title) ?? str(o.summary);
    if (!severity || !SEVERITIES.has(severity) || !title)
      throw refuse(`finding ${i + 1} in ${file} needs a title and a severity (blocking | major | minor | nit)`, "fix the findings file and report again", "bad_findings");
    const f: Finding = { severity: severity as Finding["severity"], title };
    const id = str(o.id);
    if (id) f.id = id;
    const fileRef = str(o.file);
    if (fileRef) f.file = fileRef;
    if (typeof o.line === "number" && Number.isInteger(o.line) && o.line > 0) f.line = o.line;
    const criterion = str(o.criterion) ?? (typeof o.criterion === "number" ? String(o.criterion) : undefined);
    if (criterion) f.criterion = criterion;
    const repro = str(o.repro);
    if (repro) f.repro = repro;
    const extra = [str(o.detail), str(o.axis) && `Axis: ${o.axis}`, str(o.suggestion) && `Suggestion: ${o.suggestion}`].filter(Boolean);
    if (extra.length) f.detail = extra.join("\n");
    return f;
  });
}

const abs = (ctx: Context, p: string) => (isAbsolute(p) ? p : resolve(ctx.cwd, p));

export const doneCommand = defineCommand({
  name: "done",
  summary: "Report that the current step finished with a declared outcome (§9.3); then end your turn",
  usage: 'norn done <outcome> --handoff "…" [--findings <file>] [--evidence <dir>]',
  options: { handoff: { type: "string" }, findings: { type: "string" }, evidence: { type: "string" } },
  positionals: { min: 1, max: 1 },
  async run(ctx, args) {
    const outcome = args.positionals[0] as string;
    const handoff = opt.str(args, "handoff")?.trim();
    if (!handoff) throw usageError("norn done needs --handoff \"<short summary of what was done>\"", `norn done ${outcome} --handoff "…"`);
    const t = reportTarget(ctx, "done");
    const step = stepOfSession(t.s) as AgentStep;
    const valid = reportableOutcomes(step);
    if (outcome === "ask" || outcome === "stuck") throw refuse(`'${outcome}' is reported with its own verb`, outcome === "ask" ? 'norn ask "<question>"' : 'norn stuck "<reason>"', "use_verb");
    if (!valid.includes(outcome))
      throw refuse(`outcome '${outcome}' is not declared at step ${t.s.state.step}; valid: ${valid.join(", ")}`, valid.map((o) => `norn done ${o} --handoff "…"`).join(" | "), "invalid_outcome", { valid });

    let findings: Finding[] | undefined;
    const findingsFile = opt.str(args, "findings");
    if (findingsFile) {
      const p = abs(ctx, findingsFile);
      if (!existsSync(p)) throw refuse(`findings file not found: ${findingsFile}`, "write the findings file, then report again", "bad_findings");
      findings = parseFindings(readFileSync(p, "utf8"), findingsFile);
    }
    const evidenceSrc = opt.str(args, "evidence");
    const evidencePath = evidenceSrc ? abs(ctx, evidenceSrc) : null;
    if (evidencePath && !(existsSync(evidencePath) && statSync(evidencePath).isDirectory()))
      throw refuse(`evidence directory not found: ${evidenceSrc}`, "pass the directory your skill wrote evidence to, then report again", "bad_evidence");

    const receipt: ReceiptOf<"done"> = { kind: "done", ...reportHeader(ctx, t), outcome, handoff };
    if (findings) receipt.findings = findings;
    if (evidencePath) receipt.evidence = `evidence/${t.run_id}`;
    const check = validate("receipt", receipt);
    if (!check.ok) throw refuse(`receipt does not validate: ${check.errors.map((e) => `${e.path} ${e.message}`).join("; ")}`, "fix the arguments and report again", "invalid_receipt");
    // evidence sits beside the receipt it belongs to; copied before the receipt lands (P6)
    if (evidencePath) ensureEvidenceDir(t.s.runsDir, t.run_id, evidencePath);
    const written = writeReport(t, receipt);
    appendProgress(t.s.runsDir, `${t.s.state.step}#${t.s.state.attempt} ${outcome}: ${handoff}`);
    return reported(t, "done", written, { outcome, ...(findings ? { findings: findings.length } : {}), ...(evidencePath ? { evidence: receipt.evidence } : {}) });
  },
});
