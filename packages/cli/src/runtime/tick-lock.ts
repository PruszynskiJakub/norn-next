/**
 * A person command that needs the tick lock waits for a running tick, up to 60s,
 * instead of refusing at once. One line on the progress log (stderr) says so, once, only when the
 * first try finds the lock busy; a dead holder is reclaimed at once by store (no wait). After 60s
 * on the context clock, or on the abort signal (Ctrl-C), it refuses `tick_locked` without taking
 * the lock. `tick`, `upgrade` and watch's per-tick lock take the store lock directly and refuse at once.
 */
import { acquireTickLock, type LockContent, type LockResult } from "@norn/store";
import type { Context } from "../context.ts";
import { busyError } from "../output.ts";

const TICK_WAIT_MS = 60_000;
const TICK_POLL_MS = 250;

export type HeldTickLock = Extract<LockResult, { ok: true }>;

/** Resolves after `ms`, or at once when `signal` aborts. */
export function abortableSleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (signal?.aborted) return resolve();
    const t = setTimeout(done, ms);
    function done() {
      clearTimeout(t);
      signal?.removeEventListener("abort", done);
      resolve();
    }
    signal?.addEventListener("abort", done, { once: true });
  });
}

/** `pid 4821, norn tick, since 11:42:03` (local time); note and time left out when the lock lacks them. */
function holderText(h: LockContent): string {
  const at = Date.parse(h.acquired_at);
  return [`pid ${h.holder.pid}`, ...(h.note ? [h.note] : []), ...(Number.isNaN(at) ? [] : [`since ${new Date(at).toTimeString().slice(0, 8)}`])].join(", ");
}

/**
 * Take the tick lock for a person command, waiting up to 60s for a running tick.
 * `retry` is the command's `do_instead` on a refusal. `signal` stops the wait (default: the run's
 * abort signal; null for watch's exit release, whose signal has already fired).
 */
export async function waitForTickLock(ctx: Context, note: string, retry: string, signal: AbortSignal | null = ctx.deps.signal ?? null): Promise<HeldTickLock> {
  const take = () => acquireTickLock(ctx.root, { note, now: () => ctx.clock.iso() });
  const started = ctx.clock.now();
  let lock = await take();
  if (lock.ok) return lock;
  ctx.log(`waiting for a running tick (${holderText(lock.holder)}) — up to ${TICK_WAIT_MS / 1000}s…`);
  for (;;) {
    if (signal?.aborted) throw busyError(`interrupted while waiting for a running tick (${holderText(lock.holder)})`, retry, "tick_locked", { holder: lock.holder });
    const left = TICK_WAIT_MS - (ctx.clock.now() - started);
    if (left <= 0) throw busyError(`a tick is still running (${holderText(lock.holder)}); waited ${TICK_WAIT_MS / 1000}s`, retry, "tick_locked", { holder: lock.holder });
    await ctx.sleep(Math.min(TICK_POLL_MS, left), signal ?? undefined);
    // An abort during the sleep never takes the lock
    if (signal?.aborted) continue;
    lock = await take();
    if (lock.ok) return lock;
  }
}
