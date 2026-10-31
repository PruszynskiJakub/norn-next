/**
 * Machine-local runtime files of one checkout, kept in its machine dir `<norn home>/repos/<id>/` (B5):
 * - `heartbeat.json`  this checkout's heartbeat_id (ID2), stable across `tick` runs so a
 *                     claim taken by one tick is "mine" for the next (T4); `last_tick_at` (R5.5)
 *                     (heartbeat.ts)
 * - `remote.json`     remote sync cache: last sync time, default branch (H5 throttle)
 * - `notified.json`   inbox item ids already notified (O3: once per item, receipt-first)
 * - `records.json`    GR6 base-branch records still owed (retried by later ticks, throttled),
 *                     each with the merge facts to write (`merge`, StoryMerge)
 * - `foreign.json`    commit shas already traced as `foreign_commits` (Q6: once per sha)
 * - `base.json`       per story, the last `story.base` measured (BS1; base.ts)
 * - `notices.json`    one-time notices already shown on this checkout (B13)
 * Every read is validated (S2, BUG-4): a file that is unreadable or of the wrong shape reads as
 * empty through `readLocalJson`, never as a cast of what was there. Paths are in paths.ts.
 */
import type { StoryFacts } from "@norn/core";
import type { StoryMerge } from "@norn/schema";
import { atomicWriteJson } from "./fsx.ts";
import { readLocalJson } from "./local-json.ts";
import { foreignCommitsPath, noticesPath, notifiedPath, pendingRecordsPath, remoteCachePath } from "./paths.ts";
import { appendTrace, traceEvent } from "./trace.ts";

export interface RemoteCache {
  /** ms epoch of the last successful sync (GR1) */
  synced_at: number | null;
  /** ms epoch of the last attempt (success or not) */
  attempted_at: number | null;
  last_error: string | null;
  default_branch: string | null;
}

export function readRemoteCache(root: string): RemoteCache {
  const c = readLocalJson("local-remote", remoteCachePath(root), {}, root);
  return { synced_at: c.synced_at ?? null, attempted_at: c.attempted_at ?? null, last_error: c.last_error ?? null, default_branch: c.default_branch ?? null };
}

export function writeRemoteCache(root: string, c: RemoteCache): void {
  atomicWriteJson(remoteCachePath(root), c);
}

const KEEP_NOTIFIED = 2000;

export function readNotified(root: string): Set<string> {
  return new Set(readLocalJson("local-notified", notifiedPath(root), {}, root).ids ?? []);
}

/** Persist a newly notified id before the notification is sent (receipt-first, O3). */
export function markNotified(root: string, ids: Set<string>, id: string): void {
  ids.add(id);
  atomicWriteJson(notifiedPath(root), { ids: [...ids].slice(-KEEP_NOTIFIED) });
}

/**
 * B13: true the first time notice `id` is asked for on this checkout, then false. A notice file that
 * cannot be read or written never fails the command: the notice shows again.
 */
export function firstNotice(root: string, id: string): boolean {
  const shown = readLocalJson("local-notices", noticesPath(root), {}, root).shown ?? [];
  if (shown.includes(id)) return false;
  try {
    atomicWriteJson(noticesPath(root), { shown: [...shown, id] });
  } catch {
    // presentation only: shown again next time
  }
  return true;
}

/** GR6: a merged story whose `status: done` record on the base branch is still owed (deferred or failed). */
export interface PendingRecord {
  story: string;
  spec_dir: string;
  status: "done";
  /** ms epoch of the last attempt (throttle) */
  attempted_at: number;
  attempts: number;
  reason: string;
  /** how the PR landed (GR6 done record), written into spec.md `merge:` with the status */
  merge?: StoryMerge;
}

export function readPendingRecords(root: string): PendingRecord[] {
  return readLocalJson("local-records", pendingRecordsPath(root), {}, root).records ?? [];
}

export function writePendingRecords(root: string, records: PendingRecord[]): void {
  atomicWriteJson(pendingRecordsPath(root), { records });
}

const KEEP_FOREIGN = 5000;

/**
 * Q6: one `foreign_commits` trace event per story for the commits not traced before (once per
 * sha). The seen set is written first, so a crash never traces the same sha twice.
 */
export function traceForeignCommits(root: string, stories: StoryFacts[], tick_id: string, now: number): number {
  const seen = new Set(readLocalJson("local-foreign", foreignCommitsPath(root), {}, root).shas ?? []);
  const fresh: Array<{ story: string; commits: NonNullable<StoryFacts["foreign_commits"]> }> = [];
  for (const s of stories) {
    const commits = (s.foreign_commits ?? []).filter((c) => !seen.has(c.sha));
    for (const c of commits) seen.add(c.sha);
    if (commits.length) fresh.push({ story: s.key, commits });
  }
  if (!fresh.length) return 0;
  atomicWriteJson(foreignCommitsPath(root), { shas: [...seen].slice(-KEEP_FOREIGN) });
  for (const f of fresh) appendTrace(root, traceEvent("foreign_commits", now, { tick_id, unit: f.story, commits: f.commits }));
  return fresh.length;
}

