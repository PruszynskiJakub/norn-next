/**
 * `norn tick`: run one tick: read facts, decide, act. One invocation is one tick, for cron, scripts and
 * a person stepping through by hand; `watch` loops it. Another tick holding the lock is busy (exit 5),
 * and a tick whose actions partly failed exits 1 with its whole report.
 */
import { defineCommand } from "../command.ts";
import { busyError, ExitCode, rendered, withExit } from "../output.ts";
import { failedCount, tickMarkdown } from "../tick-report.ts";

export const tickCommand = defineCommand({
  name: "tick",
  acts: true,
  summary: "Run one tick: read facts, decide, act",
  usage: "norn tick",
  async run(ctx) {
    const report = await (await ctx.runtime()).tick();
    if (report.skipped === "locked") throw busyError("another tick holds this repo's tick lock", "wait for it to finish, then norn tick", "tick_locked", { tick_id: report.tick_id });
    const out = rendered(report, tickMarkdown(report));
    return failedCount(report) > 0 ? withExit(out, ExitCode.error) : out;
  },
});
