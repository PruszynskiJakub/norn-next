/**
 * `norn watch [--interval <duration>] [--max-ticks <n>]`: tick on an interval until a signal stops it.
 * The first SIGINT or SIGTERM lets the tick in flight finish and ends the pause at once; a second
 * stops the process, which is the entry's to do. Each tick's report goes to stderr as one JSON line as it
 * happens; stdout gets one summary when the loop ends.
 *
 * The interval is the longest a watch waits, not the pace of a story:
 * - a tick that carried out an action is followed at once, up to `SETTLE_TICKS` in a row, since its
 *   action usually leaves the next one ready (a report applied, a step to start);
 * - a receipt another process records during the pause (`norn done`, a person's answer) or a detached
 *   check that finishes rewrites the wake stamp, which ends the pause within about a second;
 */
import { readWake, type TickReport, wakeWriterOf } from "@norn/runtime";
import { defineCommand, opt } from "../command.ts";
import { durationMs } from "../config/derive.ts";
import { Duration } from "../config/schema.ts";
import { rendered, usageError } from "../output.ts";
import { failedCount, tickLines } from "../tick-report.ts";
import { wireRuntime } from "../wiring.ts";

const DEFAULT_INTERVAL = "30s";
const DURATION = new RegExp(Duration.pattern as string);

/** At most this many ticks in a row follow an acting tick at once, so a unit that acts on every tick never spins. */
export const SETTLE_TICKS = 3;
/** How often a pause reads the wake stamp. */
export const WAKE_POLL_MS = 500;
/** The quiet after a wake before the tick, so a burst of receipts (a report and its events) is one tick. */
export const WAKE_SETTLE_MS = 250;

type Sleep = (ms: number, signal?: AbortSignal) => Promise<void>;

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

/** Whether `stamp` announces a receipt this watch has not ticked on: new since `seen`, and not its own runtime's. */
const wakesOn = (stamp: string | null, seen: string | null, self: string): boolean => stamp !== null && stamp !== seen && wakeWriterOf(stamp) !== self;

/**
 * Pause up to `ms`, ending early on the signal or on a stamp another process wrote. `before` is the
 * stamp read before the tick: one that changed while the tick ran wakes at once, unless the tick's own
 * receipts wrote it, as the tick already acted on those.
 */
async function pauseUntilWake(sleep: Sleep, ms: number, read: () => Promise<string | null>, before: string | null, self: string, signal: AbortSignal | undefined): Promise<void> {
  let seen = await read();
  if (wakesOn(seen, before, self)) return sleep(WAKE_SETTLE_MS, signal);
  let left = ms;
  while (left > 0 && !signal?.aborted) {
    const step = Math.min(WAKE_POLL_MS, left);
    await sleep(step, signal);
    left -= step;
    const now = await read();
    if (wakesOn(now, seen, self)) return sleep(Math.min(WAKE_SETTLE_MS, left), signal);
    seen = now;
  }
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

/** A failed action is retried an interval later, never at once: what failed now (an outage) most likely fails again now. */
const acted = (r: TickReport): boolean => r.outcomes.some((o) => o.ok);

export const watchCommand = defineCommand({
  name: "watch",
  summary: "Tick on an interval until a signal stops it",
  usage: "norn watch [--interval <duration>] [--max-ticks <n>]",
  options: {
    interval: { type: "string" },
    "max-ticks": { type: "string" },
  },
  optionHelp: {
    "--interval <duration>": `the longest pause between ticks, as 30s or 2m (default ${DEFAULT_INTERVAL})`,
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
    const env = await ctx.workflowEnv();
    const runtime = wireRuntime(env);
    const host = await ctx.host();
    const read = () => readWake(host);
    const sleep: Sleep = ctx.io.sleep ? ctx.io.sleep.bind(ctx.io) : pause;
    const log = (line: string) => ctx.io.log?.(line);
    const signal = ctx.io.signal;
    const summary: WatchSummary = { ticks: 0, failed_actions: 0, skipped_locked: 0, interval };
    let settling = 0;
    while (summary.ticks < max && !signal?.aborted) {
      const before = await read();
      const report = await runtime.tick();
      summary.ticks++;
      if (report.skipped === "locked") summary.skipped_locked++;
      summary.failed_actions += failedCount(report);
      log(JSON.stringify(progress(report)));
      if (summary.ticks >= max || signal?.aborted) break;
      if (acted(report) && settling < SETTLE_TICKS) {
        settling++;
        continue;
      }
      settling = 0;
      await pauseUntilWake(sleep, ms, read, before, env.wakeBy, signal);
    }
    // a failed action is retried by the next tick, so a long watch that saw one still ended as asked
    return rendered(summary, summaryText(summary));
  },
});
