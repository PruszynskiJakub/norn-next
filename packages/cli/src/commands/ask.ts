/**
 * `norn ask <question> [--report-id <id>]`: ask the person a question and wait for the answer.
 */
import { reportRun } from "@norn/runtime";
import { defineCommand, type ParsedArgs } from "../command.ts";
import type { CliContext } from "../context.ts";
import { rendered } from "../output.ts";
import { agentRunOf, fromRefusal, reportIdOf, shortHash } from "./agent-support.ts";

/** Record the run's question for the person; `norn stuck` with a question comes here too. */
export async function asked(ctx: CliContext, args: ParsedArgs, unit: string, runId: string, question: string) {
  // a run may ask again once answered: the question is in the id, so only a retry of the same one replays
  const reportId = reportIdOf(ctx, args, `${runId}.ask.${shortHash(question.trim())}`);
  const r = await reportRun(await ctx.runtimeEnv(), unit, runId, { verb: "ask", question }, reportId);
  if (!r.ok) throw fromRefusal(r.refusal);
  const value = { unit, run_id: runId, verb: "ask", report_id: reportId, ...r.value };
  return rendered(value, `Asked the person about ${unit}${r.value.replayed ? " (recorded before)" : ""}. End your turn: the answer comes back to this session.`);
}

export const askCommand = defineCommand({
  name: "ask",
  acts: true,
  summary: "Ask the person a question and wait for the answer",
  usage: "norn ask <question> [--report-id <id>]",
  options: {
    "report-id": { type: "string" },
  },
  optionHelp: {
    "--report-id <id>": "the report's id; a retry with the same id records it once",
  },
  positionals: { min: 1, max: 1 },
  restJoined: true,
  async run(ctx, args) {
    const { unit, runId } = agentRunOf(ctx, "ask");
    return asked(ctx, args, unit, runId, args.positionals[0] as string);
  },
});
