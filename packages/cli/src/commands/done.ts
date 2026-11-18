/**
 * `norn done <outcome> [--note <text>] [--report-id <id>]`: report the step done with an outcome.
 * The unit and run come from NORN_UNIT and NORN_RUN_ID.
 */
import { reportRun } from "@norn/runtime";
import { defineCommand, opt } from "../command.ts";
import { rendered } from "../output.ts";
import { agentRunOf, fromRefusal, reportIdOf } from "./agent-support.ts";

export const doneCommand = defineCommand({
  name: "done",
  summary: "Report the step done with an outcome",
  usage: "norn done <outcome> [--note <text>] [--report-id <id>]",
  options: {
    note: { type: "string" },
    "report-id": { type: "string" },
  },
  optionHelp: {
    "--note <text>": "what the next step should know",
    "--report-id <id>": "the report's id; a retry with the same id records it once",
  },
  positionals: { min: 1, max: 1 },
  async run(ctx, args) {
    const { unit, runId } = agentRunOf(ctx, "done");
    const outcome = args.positionals[0] as string;
    const note = opt.str(args, "note");
    // the outcome is in the id: retrying the same report replays it, a second different one is refused as reported
    const reportId = reportIdOf(ctx, args, `${runId}.done.${outcome}`);
    const r = await reportRun(await ctx.runtimeEnv(), unit, runId, { verb: "done", outcome, ...(note !== undefined && { text: note }) }, reportId);
    if (!r.ok) throw fromRefusal(r.refusal);
    const value = { unit, run_id: runId, verb: "done", outcome, report_id: reportId, ...r.value };
    return rendered(value, `Reported ${unit} done with outcome \`${outcome}\`${r.value.replayed ? " (recorded before)" : ""}. End your turn.`);
  },
});
