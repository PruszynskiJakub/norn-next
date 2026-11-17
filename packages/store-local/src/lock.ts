/**
 * A mutex made of one exclusively created file. `files.write` alone cannot compare-and-swap, so every
 * read-check-write of a record runs while holding the lock beside it; two store instances (two
 * processes on this machine) then serialize on the file, not on anything in memory.
 */
import { fail, type HostContext, type PluginResult, parseJson } from "@norn/plugin-api";
import { NonEmpty } from "@norn/schema";
import { type Static, Type } from "@sinclair/typebox";

export interface LockTuning {
  /** how many times a writer tries for a held lock before giving up as `unavailable` */
  attempts: number;
  /** the pause between tries */
  retryMs: number;
  /** a lock older than this by its own timestamp belongs to a writer that died holding it, and is taken over */
  staleMs: number;
}

export const DEFAULT_LOCK_TUNING: Readonly<LockTuning> = Object.freeze({ attempts: 500, retryMs: 10, staleMs: 30_000 });

const LockFile = Type.Object({ token: NonEmpty, at: Type.String() }, { additionalProperties: false });
type LockFile = Static<typeof LockFile>;

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

function parseLock(text: string): LockFile | null {
  const r = parseJson(LockFile, text, "lock");
  return r.ok ? r.value : null;
}

/**
 * Run `fn` holding the lock at `path`. A lock is released however `fn` ends, a throw included; a
 * throw from `fn` becomes an `unavailable` failure, since a store call never throws.
 */
export async function withLock<T>(ctx: HostContext, path: string, tuning: LockTuning, fn: () => Promise<PluginResult<T>>): Promise<PluginResult<T>> {
  const token = crypto.randomUUID();
  let held: boolean;
  try {
    held = await acquire(ctx, path, token, tuning);
  } catch (e) {
    return fail("unavailable", `local store: lock ${path}: ${errText(e)}`);
  }
  if (!held) return fail("unavailable", `local store: lock ${path} is held by another writer; gave up after ${tuning.attempts} tries`);
  try {
    return await fn();
  } catch (e) {
    return fail("unavailable", `local store: ${errText(e)}`);
  } finally {
    await release(ctx, path, token);
  }
}

export const errText = (e: unknown): string => (e instanceof Error ? e.message : String(e));

function isStale(ctx: HostContext, lock: LockFile, staleMs: number): boolean {
  const age = Date.parse(ctx.now()) - Date.parse(lock.at);
  // an unreadable timestamp gives NaN, and a lock nobody can date is as good as abandoned
  return !(age < staleMs);
}

async function acquire(ctx: HostContext, path: string, token: string, tuning: LockTuning): Promise<boolean> {
  const body = (): string => JSON.stringify({ token, at: ctx.now() });
  /** an unparseable lock seen on the previous try: a creator mid-write gets one try's grace, a torn one from a crash does not get two */
  let tornBefore: string | null = null;
  for (let attempt = 0; attempt < tuning.attempts; attempt++) {
    if (await ctx.files.create(path, body())) return true;
    const text = await ctx.files.read(path);
    if (text === null) continue;
    const lock = parseLock(text);
    const abandoned = lock === null ? tornBefore === text : isStale(ctx, lock, tuning.staleMs);
    tornBefore = lock === null ? text : null;
    if (abandoned && (await breakLock(ctx, path, text, token, tuning))) continue;
    await sleep(tuning.retryMs);
  }
  return false;
}

/**
 * Remove an abandoned lock. Two writers that both judged it abandoned must not both remove it, or the
 * second would remove the lock the first just made; so breaking needs its own exclusive `.break`
 * file, and the lock is re-read under it and removed only if it is still the one judged abandoned.
 */
async function breakLock(ctx: HostContext, path: string, seen: string, token: string, tuning: LockTuning): Promise<boolean> {
  const breaker = `${path}.break`;
  if (!(await ctx.files.create(breaker, JSON.stringify({ token, at: ctx.now() })))) {
    // a breaker that died between create and remove would wedge the lock for good: age it like a lock
    const text = await ctx.files.read(breaker);
    const other = text === null ? null : parseLock(text);
    if (text !== null && (other === null || isStale(ctx, other, tuning.staleMs))) await ctx.files.remove(breaker);
    return false;
  }
  try {
    if ((await ctx.files.read(path)) === seen) await ctx.files.remove(path);
    return true;
  } finally {
    await ctx.files.remove(breaker);
  }
}

/** Remove the lock if it is still this writer's; one taken over as stale belongs to someone else now. */
async function release(ctx: HostContext, path: string, token: string): Promise<void> {
  try {
    const text = await ctx.files.read(path);
    if (text !== null && parseLock(text)?.token === token) await ctx.files.remove(path);
  } catch {
    // a lock left behind ages into a stale one the next writer takes over; the record is already settled
  }
}
