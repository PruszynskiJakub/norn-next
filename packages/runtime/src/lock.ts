/**
 * The per-repo tick lock. Two ticks deciding over the same facts would both act on them, so a tick
 * runs only while it holds the lock file; a lock older than the stale timeout was left by a crashed
 * tick and is taken over rather than blocking the repo for good. A live tick keeps its lock fresh
 * with a heartbeat: a check or a wait step may run longer than the stale timeout, and a takeover then
 * would run the same check twice, at once, in the same worktree.
 */
import { type HostContext, parseJson } from "@norn/plugin-api";
import { IsoTime, NonEmpty } from "@norn/schema";
import { Type } from "@sinclair/typebox";

export const DEFAULT_LOCK_STALE_MS = 10 * 60_000;

export interface TickLock {
  release(): Promise<void>;
}

const LockFile = Type.Object({ tick_id: NonEmpty, at: IsoTime }, { additionalProperties: false });

/** The lock's path under the repo's machine folder, outside every worktree. */
export function tickLockPath(ctx: HostContext): string {
  return `${ctx.repo.dataDir}/tick.lock`;
}

/** Whether the lock as read was left by a crashed tick: older than `staleMs`, or unreadable (a writer that died mid-write). */
function isStale(ctx: HostContext, text: string, staleMs: number): boolean {
  const lock = parseJson(LockFile, text, "tick lock");
  if (!lock.ok) return true;
  return Date.parse(ctx.now()) - Date.parse(lock.value.at) >= staleMs;
}

/**
 * Take over a stale lock. Only the writer that creates the takeover marker may remove the stale lock,
 * and it removes it only if it still reads as the stale one it saw: without that, two ticks finding
 * the same stale lock could each remove the other's fresh one and both run.
 */
async function takeOver(ctx: HostContext, path: string, seen: string, body: string, staleMs: number): Promise<boolean> {
  const marker = `${path}.takeover`;
  if (!(await ctx.files.create(marker, body))) {
    // a takeover that crashed leaves its marker; once it is stale itself it holds nobody off
    const other = await ctx.files.read(marker);
    if (other !== null && !isStale(ctx, other, staleMs)) return false;
    await ctx.files.remove(marker);
    if (!(await ctx.files.create(marker, body))) return false;
  }
  try {
    if ((await ctx.files.read(path)) !== seen) return false;
    await ctx.files.remove(path);
    return await ctx.files.create(path, body);
  } finally {
    await ctx.files.remove(marker);
  }
}

/** Take the lock for `tickId`, or null when a live tick holds it. */
export async function acquireTickLock(ctx: HostContext, tickId: string, staleMs: number = DEFAULT_LOCK_STALE_MS): Promise<TickLock | null> {
  const path = tickLockPath(ctx);
  const body = `${JSON.stringify({ tick_id: tickId, at: ctx.now() })}\n`;
  let held = await ctx.files.create(path, body);
  if (!held) {
    const seen = await ctx.files.read(path);
    // the holder released it between our create and our read: try once more rather than skip a tick for nothing
    if (seen === null) held = await ctx.files.create(path, body);
    else if (isStale(ctx, seen, staleMs)) held = await takeOver(ctx, path, seen, body, staleMs);
  }
  if (!held) return null;
  let current = body;
  let beating: Promise<void> = Promise.resolve();
  // refreshed while it is still this tick's: a lock another tick took over is never written back
  const beat = async (): Promise<void> => {
    if ((await ctx.files.read(path)) !== current) return;
    const next = `${JSON.stringify({ tick_id: tickId, at: ctx.now() })}\n`;
    await ctx.files.write(path, next);
    current = next;
  };
  const timer = setInterval(() => {
    beating = beating.then(beat).catch(() => {});
  }, heartbeatMs(staleMs));
  return {
    // removed only while it is still this tick's: a tick that outlived the stale timeout lost the lock to another
    release: async () => {
      clearInterval(timer);
      await beating;
      if ((await ctx.files.read(path)) === current) await ctx.files.remove(path);
    },
  };
}

/** Several beats inside one stale timeout, so one late beat never lets the lock read as stale. */
export function heartbeatMs(staleMs: number): number {
  return Math.max(10, Math.floor(staleMs / 4));
}
