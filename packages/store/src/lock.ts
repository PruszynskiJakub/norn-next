/**
 * Exclusive lock files with dead-holder reclaim (H1 tick lock; shared by leases, K3).
 * A holder is a process identity (pid + start time); a lock whose holder is dead —
 * or whose content is unreadable — is reclaimed.
 */
import { linkSync, renameSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import type { ProcessIdentity } from "@norn/schema";
import { atomicWrite, createExclusive, isErrno, json, readText, safeUnlink } from "./fsx.ts";
import { parseLocalJson } from "./local-json.ts";
import { integrateLockPath, tickLockPath } from "./paths.ts";
import { defaultLiveness, type LivenessCheck, localProcess } from "./proc.ts";

let seq = 0;

/**
 * Remove `path` only if its content is still `expectedRaw` (the content judged stale).
 * Moves it aside atomically first; if what was moved is not the stale content (someone
 * replaced it in between), it is linked back. Returns true when the stale file is gone.
 */
export function removeIfUnchanged(path: string, expectedRaw: string): boolean {
  const aside = join(dirname(path), `.${basename(path)}.reclaim.${process.pid}.${seq++}`);
  try {
    renameSync(path, aside);
  } catch (e) {
    if (isErrno(e, "ENOENT")) return true;
    throw e;
  }
  const moved = readText(aside);
  if (moved !== expectedRaw) {
    try {
      linkSync(aside, path);
    } catch (e) {
      if (!isErrno(e, "EEXIST")) throw e;
    }
    safeUnlink(aside);
    return false;
  }
  safeUnlink(aside);
  return true;
}

/**
 * Replace `path` with `nextRaw` only if its content is still `expectedRaw`; false when it is gone or
 * someone else changed it (that content is left as it was). Moves it aside atomically first, as
 * removeIfUnchanged does.
 */
export function replaceIfUnchanged(path: string, expectedRaw: string, nextRaw: string): boolean {
  const next = join(dirname(path), `.${basename(path)}.replace.${process.pid}.${seq++}`);
  atomicWrite(next, nextRaw);
  const aside = join(dirname(path), `.${basename(path)}.reclaim.${process.pid}.${seq++}`);
  try {
    renameSync(path, aside);
  } catch (e) {
    safeUnlink(next);
    if (isErrno(e, "ENOENT")) return false;
    throw e;
  }
  if (readText(aside) !== expectedRaw) {
    try {
      linkSync(aside, path);
    } catch (e) {
      if (!isErrno(e, "EEXIST")) throw e;
    }
    safeUnlink(aside);
    safeUnlink(next);
    return false;
  }
  renameSync(next, path);
  safeUnlink(aside);
  return true;
}

export interface LockContent {
  holder: ProcessIdentity;
  acquired_at: string;
  /** free text: command, heartbeat id */
  note?: string;
}

export type LockResult =
  | { ok: true; path: string; content: LockContent; release: () => boolean; reclaimed: LockContent | null }
  | { ok: false; path: string; holder: LockContent };

/** S2: a lock of the wrong shape is unreadable (reclaimed); the raw text is kept for removeIfUnchanged. */
function parseLock(raw: string | null): LockContent | null {
  if (raw === null) return null;
  const r = parseLocalJson("local-lock", raw);
  return r.ok ? r.value : null;
}

export interface LockOptions {
  self?: ProcessIdentity;
  liveness?: LivenessCheck;
  now?: () => string;
  note?: string;
}

/** Acquire an exclusive lock file; reclaim it from a dead (or unreadable) holder. */
export async function acquireLock(path: string, opts: LockOptions = {}): Promise<LockResult> {
  const self = opts.self ?? localProcess.self();
  const alive = opts.liveness ?? defaultLiveness;
  const content: LockContent = { holder: self, acquired_at: (opts.now ?? (() => new Date().toISOString()))(), ...(opts.note ? { note: opts.note } : {}) };
  const raw = json(content);
  let reclaimed: LockContent | null = null;
  for (let i = 0; i < 5; i++) {
    if (createExclusive(path, raw)) {
      return {
        ok: true,
        path,
        content,
        reclaimed,
        release: () => (readText(path) === raw ? removeIfUnchanged(path, raw) : false),
      };
    }
    const curRaw = readText(path);
    if (curRaw === null) continue;
    const cur = parseLock(curRaw);
    if (cur && (await alive(cur.holder))) return { ok: false, path, holder: cur };
    if (removeIfUnchanged(path, curRaw)) reclaimed = cur ?? { holder: { pid: 1, pid_start: "unreadable" }, acquired_at: "" };
  }
  const cur = parseLock(readText(path));
  return { ok: false, path, holder: cur ?? { holder: { pid: 1, pid_start: "unknown" }, acquired_at: "" } };
}

/** The local tick lock (H1) at `.agents/norn/trace/tick.lock`. */
export function acquireTickLock(repoRoot: string, opts: LockOptions = {}): Promise<LockResult> {
  return acquireLock(tickLockPath(repoRoot), opts);
}

/** K6/BS3: the story's integrate lock at `.agents/norn/trace/integrate-<story>.lock`. */
export function acquireIntegrateLock(repoRoot: string, story: string, opts: LockOptions = {}): Promise<LockResult> {
  return acquireLock(integrateLockPath(repoRoot, story), opts);
}
