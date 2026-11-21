/**
 * `norn brief`: print the brief of the step this agent runs, or, for a supervisor norn launched
 * beside it, the supervisor's own brief. The unit and run come from NORN_UNIT and NORN_RUN_ID.
 */
import { briefOf } from "@norn/runtime";
import { defineCommand } from "../command.ts";
import { rendered } from "../output.ts";
import { agentRunOf, fromRefusal } from "./agent-support.ts";

export const briefCommand = defineCommand({
  name: "brief",
  summary: "Print the brief of the step this agent runs",
  usage: "norn brief",
  async run(ctx) {
    const { unit, runId } = agentRunOf(ctx, "brief");
    // a supervisor norn launched beside the step's run is briefed with what it stands in for
    const shown = await briefOf(await ctx.runtimeEnv(), unit, runId);
    if (!shown.ok) throw fromRefusal(shown.refusal);
    // the brief is of the unit's live run; a session whose run was replaced must not work from it
    if (shown.value.run_id !== runId) {
      throw fromRefusal({
        error: `run ${runId} is not the live run of ${unit}; the live run is ${shown.value.run_id}`,
        do_instead: "end your turn: this session's run was replaced",
        code: "stale_run",
      });
    }
    return rendered(shown.value, shown.value.markdown);
  },
});
