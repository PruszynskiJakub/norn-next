/**
 * `norn done <outcome> [--note <text>] [--report-id <id>]`: report the step done with an outcome. The
 * unit and run come from NORN_UNIT and NORN_RUN_ID. The runtime collects the run's reports from its
 * `$NORN_OUT` (`criteria.json`, `findings.json`), validates them and copies them into the receipt; it
 * refuses an outcome whose `hand_back` is findings when the report carries nothing to rework, and
 * checks a criteria report against the step (`criteria: required`, the outcome's `verdict`) and the
 * unit's declared criteria. `--criteria <file>` and `--findings <file>` still name a report elsewhere,
 * read here, for a skill written before the run folder; each takes the place of its file in `$NORN_OUT`.
 * The runtime also refuses a done while a merge waits to be concluded in the unit's worktree or a
 * step sent to merge the base has not merged it (`merge_unfinished`), while the worktree holds
 * uncommitted work (`dirty_worktree`), while the unit's commits leave a conflict unresolved
 * (`conflict_markers`), or while its handoff holds more than 8 KB (`handoff_too_large`); this command
 * only renders those refusals. A QA report's evidence files (`$NORN_OUT/evidence/`) are kept by the
 * runtime as a commit the receipt names; this command prints a line for each one left out or kept as it was.
 */
import { isAbsolute, resolve } from "node:path";
import { CRITERIA_HINT, FINDINGS_HINT, parseCriteria, parseFindings, type ReportRecorded, reportRun } from "@norn/runtime";
import type { CriterionVerdict, Finding } from "@norn/schema";
import { defineCommand, opt } from "../command.ts";
import type { CliContext } from "../context.ts";
import { refuse, rendered } from "../output.ts";
import { agentRunOf, fromRefusal, reportIdOf } from "./agent-support.ts";

/** Read a file the command line names, relative to where the command runs; null when it is not there. */
async function readNamed(ctx: CliContext, file: string, what: string, hint: string, code: string): Promise<string> {
  const path = isAbsolute(file) ? file : resolve(ctx.io.cwd, file);
  let raw: string | null;
  try {
    raw = await (await ctx.host()).files.read(path);
  } catch (e) {
    throw refuse(`${what} file ${file} cannot be read: ${(e as Error).message}`, hint, code);
  }
  if (raw === null) throw refuse(`${what} file not found: ${file}`, hint, code);
  return raw;
}

async function readCriteria(ctx: CliContext, file: string): Promise<CriterionVerdict[]> {
  const v = parseCriteria(await readNamed(ctx, file, "criteria", CRITERIA_HINT, "invalid_criteria"), file);
  if (!v.ok) throw refuse(v.error, v.do_instead, v.code);
  return v.value;
}

async function readFindings(ctx: CliContext, file: string): Promise<Finding[]> {
  const v = parseFindings(await readNamed(ctx, file, "findings", FINDINGS_HINT, "invalid_findings"), file);
  if (!v.ok) throw refuse(v.error, v.do_instead, v.code);
  return v.value;
}

export const doneCommand = defineCommand({
  name: "done",
  acts: true,
  summary: "Report the step done with an outcome",
  usage: "norn done <outcome> [--note <text>] [--report-id <id>] [--criteria <file>] [--findings <file>]",
  options: {
    criteria: { type: "string" },
    findings: { type: "string" },
    note: { type: "string" },
    "report-id": { type: "string" },
  },
  optionHelp: {
    "--criteria <file>": "a criteria report written elsewhere than $NORN_OUT/criteria.json, read in its place",
    "--findings <file>": "findings written elsewhere than $NORN_OUT/findings.json, read in their place",
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
    // the notes are prose for the agent; the JSON names what was kept, so a file missing there was left out
    const { evidenceNotes, ...recorded } = r.value;
    const value = { unit, run_id: runId, verb: "done", outcome, report_id: reportId, ...recorded };
    return rendered(value, doneMarkdown(unit, outcome, r.value));
  },
});

/** What `norn done` prints: the report as recorded, then a line per evidence file left out or kept as it was. */
export function doneMarkdown(unit: string, outcome: string, r: ReportRecorded): string {
  const c = r.criteria;
  const judged = c ? ` (criteria: worst \`${c.worst}\`${c.coverage ? `, coverage ${c.coverage}` : ""})` : "";
  const kept = r.evidence ? ` Kept ${r.evidence.files.length} evidence file${r.evidence.files.length === 1 ? "" : "s"} in ${r.evidence.commit.slice(0, 12)}.` : "";
  const notes = (r.evidenceNotes ?? []).map((n) => `\n- ${n}`).join("");
  return `Reported ${unit} done with outcome \`${outcome}\`${judged}${r.replayed ? " (recorded before)" : ""}.${kept}${notes}${notes ? "\n\n" : " "}End your turn.`;
}
