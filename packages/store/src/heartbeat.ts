/**
 * Machine-local runtime files of one checkout's heartbeat, in its machine dir (B5):
 * - `heartbeat.json`  this checkout's heartbeat_id (ID2, see AGENTS.md) and, since R5.5,
 *                     `last_tick_at` — when a tick last finished here (status/inbox show it, N3)
 * - `failures.json`   R4.3: per unit, the last act effect that failed (send, resume, launch, push),
 *                     read back into Facts so the inbox shows it under Unblock
 * Both are diagnostic local state, never committed; an unreadable file, or one of the wrong shape,
 * reads as empty (S2, readLocalJson).
 */
import type { ActFailure } from "@norn/core";
import { ulid } from "@norn/schema";
import { atomicWriteJson } from "./fsx.ts";
import { readLocalJson } from "./local-json.ts";
import { ensureCheckoutFile } from "./machine-dir.ts";
import { actFailuresPath, heartbeatFilePath } from "./paths.ts";

export interface HeartbeatFile {
  heartbeat_id?: string;
  created_at?: string;
  /** R5.5: ISO time the last tick on this checkout finished */
  last_tick_at?: string;
}

export function readHeartbeatFile(root: string): HeartbeatFile {
  return readLocalJson("local-heartbeat", heartbeatFilePath(root), {}, root);
}

function writeHeartbeatFile(root: string, hb: HeartbeatFile): void {
  atomicWriteJson(heartbeatFilePath(root), hb);
}

/** This checkout's heartbeat_id; created on first use (keeps `last_tick_at`, R5.5). */
export function heartbeatId(root: string, now: number): string {
  // D3: every tick names the checkout its machine dir belongs to
  ensureCheckoutFile(root);
  const cur = readHeartbeatFile(root);
  if (cur.heartbeat_id && /^[0-9A-HJKMNP-TV-Z]{26}$/.test(cur.heartbeat_id)) return cur.heartbeat_id;
  const id = ulid(now);
  writeHeartbeatFile(root, { ...cur, heartbeat_id: id, created_at: new Date(now).toISOString() });
  return id;
}

/** This checkout's heartbeat_id as recorded (S2: validated), null when none yet; never creates one. */
export function recordedHeartbeatId(root: string): string | null {
  return readHeartbeatFile(root).heartbeat_id ?? null;
}

/** R5.5: record that a tick finished now (keeps the heartbeat_id). */
export function markTick(root: string, at: string): void {
  writeHeartbeatFile(root, { ...readHeartbeatFile(root), last_tick_at: at });
}

/** R5.5: `last_tick_at` as ms epoch; null = no tick recorded. */
export function lastTickAt(root: string): number | null {
  const at = readHeartbeatFile(root).last_tick_at;
  const t = at ? Date.parse(at) : Number.NaN;
  return Number.isFinite(t) ? t : null;
}

/** R4.3: unit key → last failed act effect. */
export function readActFailures(root: string): Record<string, ActFailure> {
  return readLocalJson("local-failures", actFailuresPath(root), {}, root).units ?? {};
}

export function writeActFailures(root: string, units: Record<string, ActFailure>): void {
  atomicWriteJson(actFailuresPath(root), { units });
}
