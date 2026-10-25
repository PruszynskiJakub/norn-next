/**
 * Machine-local runtime files of one checkout, kept in the gitignored trace dir (§7.1):
 * - `heartbeat.json`  this checkout's heartbeat_id (ID2), stable across `tick` runs so a
 *                     claim taken by one tick is "mine" for the next (T4); `last_tick_at` (R5.5)
 *                     (read and written through @norn/store's heartbeat.ts)
 * - `remote.json`     remote sync cache: last sync time, default branch (H5 throttle)
 * - `notified.json`   inbox item ids already notified (O3: once per item, receipt-first)
 * - `records.json`    GR6 base-branch records still owed (retried by later ticks, throttled),
 *                     each with the merge facts to write (`merge`, StoryMerge)
 * - `foreign.json`    commit shas already traced as `foreign_commits` (Q6: once per sha)
 * - `base.json`       per story, the last `story.base` measured (BS1; store/base.ts)
 */
import { join } from "node:path";
import type { StoryFacts } from "@norn/core";
import { type StoryMerge, ulid } from "@norn/schema";
import { appendTrace, atomicWriteJson, readHeartbeatFile, readText, traceDir, writeHeartbeatFile } from "@norn/store";

function readJson<T>(path: string): T | null {
  const raw = readText(path);
  if (raw === null) return null;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

const remotePath = (root: string) => join(traceDir(root), "remote.json");
const notifiedPath = (root: string) => join(traceDir(root), "notified.json");

/** This checkout's heartbeat_id; created on first use (keeps `last_tick_at`, R5.5). */
export function heartbeatId(root: string, now: number): string {
  const cur = readHeartbeatFile(root);
  if (cur.heartbeat_id && /^[0-9A-HJKMNP-TV-Z]{26}$/.test(cur.heartbeat_id)) return cur.heartbeat_id;
  const id = ulid(now);
  writeHeartbeatFile(root, { ...cur, heartbeat_id: id, created_at: new Date(now).toISOString() });
  return id;
}

export interface RemoteCache {
  /** ms epoch of the last successful sync (GR1) */
  synced_at: number | null;
  /** ms epoch of the last attempt (success or not) */
  attempted_at: number | null;
  last_error: string | null;
  default_branch: string | null;
}

export function readRemoteCache(root: string): RemoteCache {
  const c = readJson<Partial<RemoteCache>>(remotePath(root)) ?? {};
  return { synced_at: c.synced_at ?? null, attempted_at: c.attempted_at ?? null, last_error: c.last_error ?? null, default_branch: c.default_branch ?? null };
}

export function writeRemoteCache(root: string, c: RemoteCache): void {
  atomicWriteJson(remotePath(root), c);
}

const KEEP_NOTIFIED = 2000;

export function readNotified(root: string): Set<string> {
  return new Set(readJson<{ ids?: string[] }>(notifiedPath(root))?.ids ?? []);
}

/** Persist a newly notified id before the notification is sent (receipt-first, O3). */
export function markNotified(root: string, ids: Set<string>, id: string): void {
  ids.add(id);
  atomicWriteJson(notifiedPath(root), { ids: [...ids].slice(-KEEP_NOTIFIED) });
}

const recordsPath = (root: string) => join(traceDir(root), "records.json");

/** GR6: a merged story whose `status: done` record on the base branch is still owed (deferred or failed). */
export interface PendingRecord {
  story: string;
  spec_dir: string;
  status: "done";
  /** ms epoch of the last attempt (throttle) */
  attempted_at: number;
  attempts: number;
  reason: string;
  /** how the PR landed (GR6 done record), written into story.md `merge:` with the status */
  merge?: StoryMerge;
}

export function readPendingRecords(root: string): PendingRecord[] {
  return readJson<{ records?: PendingRecord[] }>(recordsPath(root))?.records ?? [];
}

export function writePendingRecords(root: string, records: PendingRecord[]): void {
  atomicWriteJson(recordsPath(root), { records });
}

const foreignPath = (root: string) => join(traceDir(root), "foreign.json");
const KEEP_FOREIGN = 5000;

/**
 * Q6: one `foreign_commits` trace event per story for the commits not traced before (once per
 * sha). The seen set is written first, so a crash never traces the same sha twice.
 */
export function traceForeignCommits(root: string, stories: StoryFacts[], tick_id: string, now: number): number {
  const seen = new Set(readJson<{ shas?: string[] }>(foreignPath(root))?.shas ?? []);
  const fresh: Array<{ story: string; commits: NonNullable<StoryFacts["foreign_commits"]> }> = [];
  for (const s of stories) {
    const commits = (s.foreign_commits ?? []).filter((c) => !seen.has(c.sha));
    for (const c of commits) seen.add(c.sha);
    if (commits.length) fresh.push({ story: s.key, commits });
  }
  if (!fresh.length) return 0;
  atomicWriteJson(foreignPath(root), { shas: [...seen].slice(-KEEP_FOREIGN) });
  const at = new Date(now).toISOString();
  for (const f of fresh) appendTrace(root, { type: "foreign_commits", id: ulid(now), at, tick_id, unit: f.story, commits: f.commits });
  return fresh.length;
}

