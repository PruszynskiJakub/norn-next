/**
 * `norn done <outcome> [--criteria <file>] [--findings <file>] [--note <text>] [--report-id <id>]`:
 * report the step done with an outcome. The unit and run come from NORN_UNIT and NORN_RUN_ID. A
 * findings file is read and normalized here and copied into the receipt; the runtime refuses an
 * outcome whose `hand_back` is findings when the report carries nothing to rework. A criteria report is
 * validated against `CriteriaReport` here; the runtime checks it against the step (`criteria:
 * required`, the outcome's `verdict`) and the unit's declared criteria, and keeps it on the receipt.
 * The runtime also refuses a done while a merge waits to be concluded in the unit's worktree or a
 * step sent to merge the base has not merged it (`merge_unfinished`), while the worktree holds
 * uncommitted work (`dirty_worktree`), or while the unit's commits leave a conflict unresolved
 * (`conflict_markers`); this command only renders those refusals.
 */
import { isAbsolute, resolve } from "node:path";
import { parseJson } from "@norn/plugin-api";
import { FINDINGS_SHAPE, reportRun } from "@norn/runtime";
import { CriteriaReport, type CriterionVerdict, type Finding } from "@norn/schema";
import { Type } from "@sinclair/typebox";
import { defineCommand, opt } from "../command.ts";
import type { CliContext } from "../context.ts";
import { refuse, rendered } from "../output.ts";
import { agentRunOf, fromRefusal, reportIdOf } from "./agent-support.ts";

const REPORT_SHAPE =
  'write the report as a JSON array, one entry per criterion: [{"id": "AC1", "verdict": "pass", "evidence": "..."}, ...]; pass needs evidence, fail repro, person how, unverified reason and how; then report again';

/** Read and validate a `--criteria` file, relative to where the command runs. */
async function readCriteria(ctx: CliContext, file: string): Promise<CriterionVerdict[]> {
  const path = isAbsolute(file) ? file : resolve(ctx.io.cwd, file);
  let text: string | null;
  try {
    text = await (await ctx.host()).files.read(path);
  } catch (e) {
    throw refuse(`criteria file ${file} cannot be read: ${(e as Error).message}`, REPORT_SHAPE, "invalid_criteria");
  }
  if (text === null) throw refuse(`criteria file not found: ${file}`, REPORT_SHAPE, "invalid_criteria");
  const v = parseJson(CriteriaReport, text, `criteria file ${file}`);
  if (!v.ok) throw refuse(v.failure.message, REPORT_SHAPE, "invalid_criteria");
  return v.value;
}

const FINDINGS_HINT = `write ${FINDINGS_SHAPE}, or the findings array alone, then report again`;
/** An array of findings or `{findings: [...]}`; each entry is checked and normalized one by one, so a refusal names the entry. */
const FindingsFile = Type.Union([Type.Array(Type.Unknown()), Type.Object({ findings: Type.Array(Type.Unknown()) })]);
const SEVERITIES: ReadonlySet<string> = new Set(["blocking", "major", "minor", "nit"]);
const text = (v: unknown): string | undefined => (typeof v === "string" && v.trim() ? v.trim() : undefined);

/**
 * Normalize a findings file: a JSON array of findings, or `{findings: [...]}` as the review and qa
 * skills write it. Keys the receipt does not keep (a review's `axis`, `suggestion`) fold into
 * `detail`, so nothing the reviewer wrote is lost on the way to the rework.
 */
export function parseFindings(raw: string, file: string): Finding[] {
  const parsed = parseJson(FindingsFile, raw, `findings file ${file}`);
  if (!parsed.ok) throw refuse(parsed.failure.message, FINDINGS_HINT, "invalid_findings");
  const held: unknown[] = Array.isArray(parsed.value) ? parsed.value : parsed.value.findings;
  return held.map((x, i) => {
    const o = (typeof x === "object" && x !== null ? x : {}) as Record<string, unknown>;
    const severity = text(o.severity)?.toLowerCase();
    const title = text(o.title) ?? text(o.summary);
    if (severity === undefined || !SEVERITIES.has(severity) || title === undefined)
      throw refuse(`finding ${i + 1} in ${file} needs a title and a severity (blocking | major | minor | nit)`, FINDINGS_HINT, "invalid_findings");
    const id = text(o.id);
    const where = text(o.file);
    const criterion = text(o.criterion) ?? (typeof o.criterion === "number" ? String(o.criterion) : undefined);
    const repro = text(o.repro);
    const detail = [text(o.detail), text(o.axis) && `Axis: ${text(o.axis)}`, text(o.suggestion) && `Suggestion: ${text(o.suggestion)}`].filter((d) => d).join("\n");
    return {
      ...(id !== undefined && { id }),
      severity: severity as Finding["severity"],
      ...(criterion !== undefined && { criterion }),
      ...(where !== undefined && { file: where }),
      ...(typeof o.line === "number" && Number.isInteger(o.line) && o.line > 0 && { line: o.line }),
      title,
      ...(detail !== "" && { detail }),
      ...(repro !== undefined && { repro }),
    };
  });
}

/** Read a `--findings` file, relative to where the command runs. */
async function readFindings(ctx: CliContext, file: string): Promise<Finding[]> {
  const path = isAbsolute(file) ? file : resolve(ctx.io.cwd, file);
  let raw: string | null;
  try {
    raw = await (await ctx.host()).files.read(path);
  } catch (e) {
    throw refuse(`findings file ${file} cannot be read: ${(e as Error).message}`, FINDINGS_HINT, "invalid_findings");
  }
  if (raw === null) throw refuse(`findings file not found: ${file}`, FINDINGS_HINT, "invalid_findings");
  return parseFindings(raw, file);
}

export const doneCommand = defineCommand({
  name: "done",
  summary: "Report the step done with an outcome",
  usage: "norn done <outcome> [--criteria <file>] [--findings <file>] [--note <text>] [--report-id <id>]",
  options: {
    criteria: { type: "string" },
    findings: { type: "string" },
    note: { type: "string" },
    "report-id": { type: "string" },
  },
  optionHelp: {
    "--criteria <file>": "the criteria report: a JSON array with one verdict per acceptance criterion; a step with `criteria: required` needs it",
    "--findings <file>": 'the findings to hand back: a JSON file, {"findings": [...]} or an array, each with a `title` and a `severity` (blocking, major, minor, nit); a step whose outcome hands back findings needs them or a note',
    "--note <text>": "what the next step should know",
    "--report-id <id>": "the report's id; a retry with the same id records it once",
  },
  positionals: { min: 1, max: 1 },
  async run(ctx, args) {
    const { unit, runId } = agentRunOf(ctx, "done");
    const outcome = args.positionals[0] as string;
    const note = opt.str(args, "note");
    const criteriaFile = opt.str(args, "criteria");
    const criteria = criteriaFile === undefined ? undefined : await readCriteria(ctx, criteriaFile);
    const findingsFile = opt.str(args, "findings");
    const findings = findingsFile === undefined ? undefined : await readFindings(ctx, findingsFile);
    // the outcome is in the id: retrying the same report replays it, a second different one is refused as reported
    const reportId = reportIdOf(ctx, args, `${runId}.done.${outcome}`);
    const r = await reportRun(await ctx.runtimeEnv(), unit, runId, { verb: "done", outcome, ...(note !== undefined && { text: note }), ...(criteria !== undefined && { criteria }), ...(findings !== undefined && { findings }) }, reportId);
    if (!r.ok) throw fromRefusal(r.refusal);
    const value = { unit, run_id: runId, verb: "done", outcome, report_id: reportId, ...r.value };
    const c = r.value.criteria;
    const judged = c ? ` (criteria: worst \`${c.worst}\`${c.coverage ? `, coverage ${c.coverage}` : ""})` : "";
    return rendered(value, `Reported ${unit} done with outcome \`${outcome}\`${judged}${r.value.replayed ? " (recorded before)" : ""}. End your turn.`);
  },
});
