/**
 * Machine-local runtime files of one checkout's heartbeat, in the gitignored trace dir (§7.1):
 * - `heartbeat.json`  this checkout's heartbeat_id (ID2, see AGENTS.md) and, since R5.5,
 *                     `last_tick_at` — when a tick last finished here (status/inbox show it, N3)
 * - `failures.json`   R4.3: per unit, the last act effect that failed (send, resume, launch, push),
 *                     read back into Facts so the inbox shows it under Unblock
 * Both are diagnostic local state, never committed; an unreadable file, or one of the wrong shape,
 * reads as empty (S2, readLocalJson).
 */
import { join } from "node:path";
import type { ActFailure } from "@norn/core";
import { atomicWriteJson } from "./fsx.ts";
import { readLocalJson } from "./local-json.ts";
import { traceDir } from "./paths.ts";

export interface HeartbeatFile {
  heartbeat_id?: string;
  created_at?: string;
  /** R5.5: ISO time the last tick on this checkout finished */
  last_tick_at?: string;
}

export const heartbeatFilePath = (root: string) => join(traceDir(root), "heartbeat.json");
const failuresPath = (root: string) => join(traceDir(root), "failures.json");

export function readHeartbeatFile(root: string): HeartbeatFile {
  return readLocalJson("local-heartbeat", heartbeatFilePath(root), {}, root);
}

export function writeHeartbeatFile(root: string, hb: HeartbeatFile): void {
  atomicWriteJson(heartbeatFilePath(root), hb);
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
  return readLocalJson("local-failures", failuresPath(root), {}, root).units ?? {};
}

export function writeActFailures(root: string, units: Record<string, ActFailure>): void {
  atomicWriteJson(failuresPath(root), { units });
}
