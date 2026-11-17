/**
 * `norn watch [--interval <duration>] [--max-ticks <n>]`: tick on an interval until a signal stops it.
 * The first SIGINT or SIGTERM lets the tick in flight finish and ends the pause at once; a second
 * stops the process, which is the entry's to do. Each tick's report goes to stderr as one JSON line as it
 * happens; stdout gets one summary when the loop ends.
 */
import type { TickReport } from "@norn/runtime";
import { defineCommand, opt } from "../command.ts";
import { durationMs } from "../config/derive.ts";
import { Duration } from "../config/schema.ts";
import { rendered, usageError } from "../output.ts";
import { failedCount, tickLines } from "../tick-report.ts";

const DEFAULT_INTERVAL = "30s";
const DURATION = new RegExp(Duration.pattern as string);

/** Resolves after `ms`, or as soon as the signal aborts, so a stop never waits out the interval. */
function pause(ms: number, signal: AbortSignal | undefined): Promise<void> {
  return new Promise((resolve) => {
    if (signal?.aborted) return resolve();
    const done = () => {
      clearTimeout(timer);
      signal?.removeEventListener("abort", done);
      resolve();
    };
    const timer = setTimeout(done, ms);
    signal?.addEventListener("abort", done, { once: true });
  });
}

export interface WatchSummary {
  ticks: number;
  failed_actions: number;
  skipped_locked: number;
  interval: string;
}

function summaryText(s: WatchSummary): string {
  const skipped = s.skipped_locked ? `, ${s.skipped_locked} skipped while another tick ran` : "";
  return `Stopped after ${s.ticks} tick${s.ticks === 1 ? "" : "s"} (${s.failed_actions} failed action${s.failed_actions === 1 ? "" : "s"}${skipped}).`;
}

const progress = (r: TickReport) => ({
  tick_id: r.tick_id,
  ...(r.skipped ? { skipped: r.skipped } : {}),
  actions: r.outcomes.length,
  failed: failedCount(r),
  lines: tickLines(r),
});

export const watchCommand = defineCommand({
  name: "watch",
  summary: "Tick on an interval until a signal stops it",
  usage: "norn watch [--interval <duration>] [--max-ticks <n>]",
  options: {
    interval: { type: "string" },
    "max-ticks": { type: "string" },
  },
  optionHelp: {
    "--interval <duration>": `between ticks, as 30s or 2m (default ${DEFAULT_INTERVAL})`,
    "--max-ticks <n>": "stop after this many ticks",
  },
  async run(ctx, args) {
    const interval = opt.str(args, "interval") ?? DEFAULT_INTERVAL;
    if (!DURATION.test(interval)) throw usageError(`bad --interval '${interval}' (use e.g. 30s, 2m)`, "norn watch --interval 30s");
    const maxRaw = opt.str(args, "max-ticks");
    const max = maxRaw === undefined ? Number.POSITIVE_INFINITY : Number(maxRaw);
    if (!(Number.isInteger(max) || max === Number.POSITIVE_INFINITY) || max < 1) throw usageError(`bad --max-ticks '${maxRaw}' (a whole number from 1)`, "norn watch --max-ticks 10");
    const ms = durationMs(interval);
    // built before the loop: a config or plugin that does not resolve refuses once, not every interval
    const runtime = await ctx.runtime();
    const signal = ctx.io.signal;
    const summary: WatchSummary = { ticks: 0, failed_actions: 0, skipped_locked: 0, interval };
    while (summary.ticks < max && !signal?.aborted) {
      const report = await runtime.tick();
      summary.ticks++;
      if (report.skipped === "locked") summary.skipped_locked++;
      summary.failed_actions += failedCount(report);
      ctx.io.log?.(JSON.stringify(progress(report)));
      if (summary.ticks >= max || signal?.aborted) break;
      await pause(ms, signal);
    }
    // a failed action is retried by the next tick, so a long watch that saw one still ended as asked
    return rendered(summary, summaryText(summary));
  },
});
