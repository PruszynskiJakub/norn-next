/**
 * `norn watch`'s pause between ticks ends early when another process appends a
 * receipt (`norn done`, `ask`, `stuck`, `story answer`, a finished `norn check-run`): store's
 * `appendReceipt` rewrites the wake file in the checkout's machine dir, and the pause watches that dir.
 *
 * A tick's own receipts never wake the watch that made them: the pause takes the stamp it finds when it
 * starts, after the tick, as its baseline. A stamp that changed during the tick wakes at once, unless
 * this process wrote it (its pid). A change is followed by `WAKE_SETTLE_MS` of quiet so a burst of
 * writes is one tick. `fs.watch` failing (or missing an event) falls back to the interval.
 */
import { type FSWatcher, watch } from "node:fs";
import { machineDir, readWake } from "@norn/store";
import type { Context } from "../context.ts";

/** A burst of receipt writes (a report and its answer, a check's receipt and log) wakes one tick. */
export const WAKE_SETTLE_MS = 250;

/** The wake stamp of `root`'s checkout now (null = none yet): what a tick started from. */
export function wakeStamp(root: string): string | null {
  return readWake(machineDir(root))?.stamp ?? null;
}

/**
 * Pause up to `ms` (through `ctx.sleep`), ending early on `signal` or on a receipt another process wrote
 * since `since` (the stamp read before the tick). Resolves `"wake"` or `"interval"`.
 */
export async function pauseUntilWake(ctx: Context, ms: number, since: string | null, signal?: AbortSignal): Promise<"wake" | "interval"> {
  const machine = machineDir(ctx.root);
  const now = readWake(machine);
  // a receipt another process wrote while the tick ran: the tick may not have seen it
  if (now && now.stamp !== since && now.pid !== process.pid) return "wake";
  const baseline = now?.stamp ?? null;
  const stop = new AbortController();
  const onAbort = () => stop.abort();
  signal?.addEventListener("abort", onAbort, { once: true });
  let woke = false;
  let settle: ReturnType<typeof setTimeout> | null = null;
  let watcher: FSWatcher | null = null;
  try {
    watcher = watch(machine, () => {
      if (woke || (readWake(machine)?.stamp ?? null) === baseline) return;
      woke = true;
      settle = setTimeout(() => stop.abort(), WAKE_SETTLE_MS);
    });
    watcher.on("error", () => {});
  } catch {
    watcher = null; // no machine dir to watch: the interval alone
  }
  try {
    if (!signal?.aborted) await ctx.sleep(ms, stop.signal);
  } finally {
    watcher?.close();
    if (settle) clearTimeout(settle);
    signal?.removeEventListener("abort", onAbort);
  }
  return woke && !signal?.aborted ? "wake" : "interval";
}
