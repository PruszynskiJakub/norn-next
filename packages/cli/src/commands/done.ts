/**
 * `norn done <outcome> --handoff "…" [--findings <file>] [--evidence <dir>] [--criteria <file>]
 * [--note "…" [--note-criterion <id>]]…` (§9.3, §10): the only way an agent step completes. The
 * outcome must be declared at the pinned step (W3); findings are copied into the receipt, evidence
 * into runs/<unit>/evidence/<run_id>/. The criteria report (QV2) is validated against
 * `CriteriaReport`, its coverage against the unit's frontmatter `criteria` (QV4), its `pass`
 * verdicts against the agent's capabilities (QV5a) and the outcome against its worst verdict (QV5); notes (NT1) never block and never change the route.
 */
import { existsSync, readFileSync, statSync } from "node:fs";
import { isAbsolute, join, resolve } from "node:path";
import { checkReport, reportableOutcomes, unverifiedNeeds, verdictCounts } from "@norn/core";
import { type AgentStep, type Criterion, type CriterionVerdict, type Finding, type Note, type ReceiptOf, ulid, validate } from "@norn/schema";
import { appendTrace, ensureEvidenceDir, git as rawGit, readSliceFile, readStoryFile } from "@norn/store";
import { defineCommand, type ParsedArgs, opt } from "../command.ts";
import type { Context } from "../context.ts";
import { corruptError, refuse, usageError } from "../output.ts";
import { stepOfSession, type UnitSession } from "../runtime/agent-unit.ts";
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

/** QV2: read and validate a `--criteria` file (a JSON array, CriteriaReport). */
export function parseCriteria(text: string, file: string): CriterionVerdict[] {
  const how = "write the report as a JSON array: [{\"id\": \"AC1\", \"verdict\": \"pass\", \"evidence\": \"…\"}, …] — pass needs evidence, fail repro, person how, unverified reason and how — then report again";
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch (e) {
    throw refuse(`criteria file ${file} is not valid JSON: ${(e as Error).message}`, how, "invalid_criteria");
  }
  const v = validate("criteria-report", raw);
  if (!v.ok) throw refuse(`criteria file ${file} does not validate: ${v.errors.map((e) => `${e.path || "/"} ${e.message}`).join("; ")}`, how, "invalid_criteria", { errors: v.errors });
  return v.value;
}

/** NT1: `--note` values in order; each `--note-criterion` belongs to the `--note` before it. */
export function parseNotes(args: ParsedArgs): Note[] {
  const notes: Note[] = [];
  for (const o of args.order ?? []) {
    if (o.name === "note") {
      const text = typeof o.value === "string" ? o.value.trim() : "";
      if (!text) throw usageError("--note needs a text", 'norn done <outcome> --handoff "…" --note "<question for a person>"');
      notes.push({ text });
    } else if (o.name === "note-criterion") {
      const last = notes.at(-1);
      const id = typeof o.value === "string" ? o.value.trim() : "";
      if (!last || last.criterion !== undefined || !id)
        throw usageError("--note-criterion <id> follows the --note it belongs to (one per note)", 'norn done <outcome> --handoff "…" --note "<text>" --note-criterion AC3');
      last.criterion = id;
    }
  }
  return notes;
}

/** QV1/QV4: the unit's frontmatter `criteria` — its slice file, or story.md for the story unit; null = none declared. */
function unitCriteria(s: UnitSession): Criterion[] | null {
  const file = s.unit.slice ? join(s.specPath, "slices", `${s.unit.dir}.md`) : join(s.specPath, "story.md");
  const r = s.unit.slice ? readSliceFile(file, s.worktree) : readStoryFile(file, s.worktree);
  if (r.ok) return r.value.frontmatter.criteria ?? null;
  if (r.reason === "missing") return null;
  throw corruptError(`${file} failed validation (S2): its criteria cannot be checked`, `stop and tell the person: norn why ${s.unit.key}`, r.error ? [r.error] : []);
}

/**
 * BS5: the base a base-mode step (entered by a `git: update` conflict) must merge — the newest
 * classify `conflict` receipt with a base routed to the current step; null for any other step.
 */
function baseToMerge(s: UnitSession): NonNullable<ReceiptOf<"classify">["base"]> | null {
  const r = s.receipts.findLast(({ receipt: r }) => r.kind === "classify" && r.outcome === "conflict" && !!r.base && r.route === s.state.step)?.receipt;
  return r?.kind === "classify" && r.base ? r.base : null;
}

/**
 * BS5 (audit H1): before a base-mode step reports done, the merge is concluded — no merge or rebase in
 * progress, no unmerged path, the base sha an ancestor of HEAD — and no conflict marker is left in the
 * conflicting paths or the files changed since the merge. Returns what the done receipt records.
 */
async function verifyBaseMerge(ctx: Context, s: UnitSession, base: NonNullable<ReceiptOf<"classify">["base"]>): Promise<NonNullable<ReceiptOf<"done">["base_merge"]>> {
  const git = ctx.git;
  const cwd = s.worktree;
  const short = base.sha.slice(0, 12);
  const how = `conclude the merge of ${short}: resolve every conflict by intent, \`git add\` the files and \`git commit\` (never rebase), then report again; or \`git merge --abort\` and \`norn stuck "<why>"\``;
  const busy = await git.inProgress(cwd);
  if (busy.operation || busy.unmerged.length)
    throw refuse(`the merge of ${short} is not concluded: ${busy.operation ?? "merge"} in progress${busy.unmerged.length ? `, unmerged: ${busy.unmerged.join(", ")}` : ""}`, how, "merge_unfinished", busy);
  const head = await git.revParse(cwd, "HEAD");
  if (!head || !(await git.isAncestor(cwd, base.sha, head)))
    throw refuse(`${short} (the base) is not merged into the story branch: HEAD ${head?.slice(0, 12) ?? "?"} does not contain it`, `git merge --no-ff ${base.sha}, resolve, commit, then report again`, "merge_unfinished");
  const merge = await git.baseMergeCommit(cwd, base.sha, head);
  // the files the merge touched on the story side, and every fix-up after it
  const changed = merge ? await rawGit(cwd, ["diff", "--name-only", "-z", `${merge}^1`, head, "--"]) : null;
  const paths = [...new Set([...base.conflicts, ...(changed?.code === 0 ? changed.stdout.split("\0").filter(Boolean) : [])])].sort();
  const markers = [...(await git.conflictMarkers(cwd, { paths, rev: "HEAD" })), ...(await git.conflictMarkers(cwd, { paths }))];
  if (markers.length) {
    const where = [...new Set(markers.map((m) => `${m.path}:${m.line}`))];
    throw refuse(`conflict markers left after merging ${short}: ${where.join(", ")}`, how, "merge_unfinished", { markers: where });
  }
  return { sha: base.sha, merge, head };
}

export const doneCommand = defineCommand({
  name: "done",
  summary: "Report that the current step finished with a declared outcome (§9.3); then end your turn",
  usage: 'norn done <outcome> --handoff "…" [--findings <file>] [--evidence <dir>] [--criteria <file>] [--note "…" [--note-criterion <id>]]…',
  options: {
    handoff: { type: "string" },
    findings: { type: "string" },
    evidence: { type: "string" },
    criteria: { type: "string" },
    note: { type: "string", multiple: true },
    "note-criterion": { type: "string", multiple: true },
  },
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

    // QV2–QV5, NT1: the report and notes, checked against the step and the unit's frontmatter criteria
    const notes = parseNotes(args);
    let report: CriterionVerdict[] | null = null;
    const criteriaFile = opt.str(args, "criteria");
    if (criteriaFile) {
      const p = abs(ctx, criteriaFile);
      if (!existsSync(p)) throw refuse(`criteria file not found: ${criteriaFile}`, "write the criteria report, then report again", "invalid_criteria");
      report = parseCriteria(readFileSync(p, "utf8"), criteriaFile);
    }
    const declared = report || notes.some((n) => n.criterion !== undefined) || step.criteria === "required" ? unitCriteria(t.s) : null;
    // QV5a (C2): the reporting agent's declared capabilities bound what it may `pass`
    const capabilities = ctx.config.agents[t.agent]?.capabilities ?? [];
    const verdicts = checkReport({ step, step_name: t.s.state.step, outcome, report, criteria: declared, notes, capabilities });
    if (!verdicts.ok) throw refuse(verdicts.refusal.error, verdicts.refusal.do_instead, verdicts.refusal.code, verdicts.refusal.details);

    // BS5: a base-mode step reports done only with the base merged and nothing left unresolved
    const base = baseToMerge(t.s);
    const baseMerge = base ? await verifyBaseMerge(ctx, t.s, base) : null;

    const receipt: ReceiptOf<"done"> = { kind: "done", ...reportHeader(ctx, t), outcome, handoff };
    if (baseMerge) receipt.base_merge = baseMerge;
    if (findings) receipt.findings = findings;
    if (evidencePath) receipt.evidence = `evidence/${t.run_id}`;
    if (report) receipt.criteria = report;
    if (notes.length) receipt.notes = notes;
    const check = validate("receipt", receipt);
    if (!check.ok) throw refuse(`receipt does not validate: ${check.errors.map((e) => `${e.path} ${e.message}`).join("; ")}`, "fix the arguments and report again", "invalid_receipt");
    // evidence sits beside the receipt it belongs to; copied before the receipt lands (P6)
    if (evidencePath) ensureEvidenceDir(t.s.runsDir, t.run_id, evidencePath);
    const written = writeReport(t, receipt);
    appendProgress(t.s.runsDir, `${t.s.state.step}#${t.s.state.attempt} ${outcome}: ${handoff}`);
    // QV4/QV8: the report counted in the trace — unverified per capability, unchecked coverage
    if (report)
      appendTrace(t.s.root, {
        type: "criteria",
        id: ulid(ctx.clock.now()),
        at: receipt.at,
        unit: t.s.unit.key,
        run_id: t.run_id,
        step: receipt.step,
        attempt: receipt.attempt,
        receipt_id: receipt.receipt_id,
        outcome,
        rule: verdicts.coverage === "checked" ? "criteria.checked" : "criteria.unchecked_coverage",
        verdicts: verdictCounts(report),
        unverified_needs: unverifiedNeeds(report, declared),
      });
    return reported(t, "done", written, {
      outcome,
      ...(findings ? { findings: findings.length } : {}),
      ...(evidencePath ? { evidence: receipt.evidence } : {}),
      ...(report ? { criteria: { worst: verdicts.worst, coverage: verdicts.coverage, ...verdictCounts(report) } } : {}),
      ...(notes.length ? { notes: notes.length } : {}),
      ...(baseMerge ? { base_merge: baseMerge } : {}),
    });
  },
});
