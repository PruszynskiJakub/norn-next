/**
 * `norn stuck <reason> [--report-id <id>]`: report the step stuck, with the reason. A reason that is
 * a question is reported as one (`norn ask`): an agent that ends stuck on a question waits on a
 * person's answer, which a stuck unit could only take through a rerun that drops the question.
 */
import { reportRun } from "@norn/runtime";
import { defineCommand } from "../command.ts";
import { rendered } from "../output.ts";
import { agentRunOf, fromRefusal, reportIdOf } from "./agent-support.ts";
import { asked } from "./ask.ts";

const isQuestion = (text: string): boolean => text.trim().endsWith("?");

export const stuckCommand = defineCommand({
  name: "stuck",
  acts: true,
  summary: "Report the step stuck, with the reason (a reason ending in ? is asked as a question)",
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
    if (isQuestion(reason)) return asked(ctx, args, unit, runId, reason);
    const reportId = reportIdOf(ctx, args, `${runId}.stuck`);
    const r = await reportRun(await ctx.runtimeEnv(), unit, runId, { verb: "stuck", reason }, reportId);
    if (!r.ok) throw fromRefusal(r.refusal);
    const value = { unit, run_id: runId, verb: "stuck", report_id: reportId, ...r.value };
    return rendered(value, `Reported ${unit} stuck${r.value.replayed ? " (recorded before)" : ""}. End your turn.`);
  },
});
