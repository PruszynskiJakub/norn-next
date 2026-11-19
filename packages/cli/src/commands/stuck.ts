/**
 * `norn stuck <reason> [--report-id <id>]`: report the step stuck, with the reason.
 */
import { reportRun } from "@norn/runtime";
import { defineCommand } from "../command.ts";
import { rendered } from "../output.ts";
import { agentRunOf, fromRefusal, reportIdOf } from "./agent-support.ts";

export const stuckCommand = defineCommand({
  name: "stuck",
  acts: true,
  summary: "Report the step stuck, with the reason",
  usage: "norn stuck <reason> [--report-id <id>]",
  options: {
    "report-id": { type: "string" },
  },
  optionHelp: {
    "--report-id <id>": "the report's id; a retry with the same id records it once",
  },
  positionals: { min: 1, max: 1 },
  restJoined: true,
  async run(ctx, args) {
    const { unit, runId } = agentRunOf(ctx, "stuck");
    const reason = args.positionals[0] as string;
    const reportId = reportIdOf(ctx, args, `${runId}.stuck`);
    const r = await reportRun(await ctx.runtimeEnv(), unit, runId, { verb: "stuck", reason }, reportId);
    if (!r.ok) throw fromRefusal(r.refusal);
    const value = { unit, run_id: runId, verb: "stuck", report_id: reportId, ...r.value };
    return rendered(value, `Reported ${unit} stuck${r.value.replayed ? " (recorded before)" : ""}. End your turn.`);
  },
});
