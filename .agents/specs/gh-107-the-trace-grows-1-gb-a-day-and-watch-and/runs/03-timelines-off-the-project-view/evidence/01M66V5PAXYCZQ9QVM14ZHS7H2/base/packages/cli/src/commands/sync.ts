/** `norn sync` (GR1): sync the remote now (issues, PRs, claim and mailbox refs) and run intake. */
import { defineCommand } from "../command.ts";
import { runTick } from "../runtime/tick.ts";

export const syncCommand = defineCommand({
  name: "sync",
  summary: "Sync the remote now and take in new stories (GR1, GR2)",
  usage: "norn sync",
  async run(ctx) {
    const report = await runTick(ctx, { sync: "force" });
    return { ...report, intake: report.decisions.filter((d) => d.kind === "intake_story").map((d) => ({ rule: d.rule, ok: d.ok, ...(d.error ? { error: d.error } : {}) })) };
  },
});
