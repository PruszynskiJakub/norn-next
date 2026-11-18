/**
 * `norn done <outcome> [--criteria <file>] [--note <text>] [--report-id <id>]`: report the step done
 * with an outcome. The unit and run come from NORN_UNIT and NORN_RUN_ID. A criteria report is
 * validated against `CriteriaReport` here; the runtime checks it against the step (`criteria:
 * required`, the outcome's `verdict`) and the unit's declared criteria, and keeps it on the receipt.
 * The runtime also refuses a done while a merge waits to be concluded in the unit's worktree
 * (`merge_unfinished`); this command only renders that refusal.
 */
import { isAbsolute, resolve } from "node:path";
import { parseJson } from "@norn/plugin-api";
import { reportRun } from "@norn/runtime";
import { CriteriaReport, type CriterionVerdict } from "@norn/schema";
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

export const doneCommand = defineCommand({
  name: "done",
  summary: "Report the step done with an outcome",
  usage: "norn done <outcome> [--criteria <file>] [--note <text>] [--report-id <id>]",
  options: {
    criteria: { type: "string" },
    note: { type: "string" },
    "report-id": { type: "string" },
  },
  optionHelp: {
    "--criteria <file>": "the criteria report: a JSON array with one verdict per acceptance criterion; a step with `criteria: required` needs it",
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
    // the outcome is in the id: retrying the same report replays it, a second different one is refused as reported
    const reportId = reportIdOf(ctx, args, `${runId}.done.${outcome}`);
    const r = await reportRun(await ctx.runtimeEnv(), unit, runId, { verb: "done", outcome, ...(note !== undefined && { text: note }), ...(criteria !== undefined && { criteria }) }, reportId);
    if (!r.ok) throw fromRefusal(r.refusal);
    const value = { unit, run_id: runId, verb: "done", outcome, report_id: reportId, ...r.value };
    const c = r.value.criteria;
    const judged = c ? ` (criteria: worst \`${c.worst}\`${c.coverage ? `, coverage ${c.coverage}` : ""})` : "";
    return rendered(value, `Reported ${unit} done with outcome \`${outcome}\`${judged}${r.value.replayed ? " (recorded before)" : ""}. End your turn.`);
  },
});
