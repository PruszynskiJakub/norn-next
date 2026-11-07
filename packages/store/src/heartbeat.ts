/**
 * Machine-local runtime files of one checkout's heartbeat, in its machine dir:
 * - `heartbeat.json`: this checkout's heartbeat_id (one per checkout, not per `watch` process, so
 *   every tick recognises its own claim) and `last_tick_at`, when a tick last finished here
 * - `failures.json`: per unit, the last act effect that failed (send, resume, launch, push),
 *   read back into Facts so the inbox shows it under Unblock
 * Both are diagnostic local state, never committed; an unreadable or wrong-shaped file reads as empty.
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
  /** ISO time the last tick on this checkout finished */
  last_tick_at?: string;
  /** How long that tick took, in ms */
  last_tick_ms?: number;
  /** The tick interval recorded by `norn watch` or `norn tick --interval` */
  interval?: string;
}

export function readHeartbeatFile(root: string): HeartbeatFile {
  return readLocalJson("local-heartbeat", heartbeatFilePath(root), {}, root);
}

function writeHeartbeatFile(root: string, hb: HeartbeatFile): void {
  atomicWriteJson(heartbeatFilePath(root), hb);
}

/** This checkout's heartbeat_id; created on first use (keeps `last_tick_at`). */
export function heartbeatId(root: string, now: number): string {
  // Every tick names the checkout its machine dir belongs to
  ensureCheckoutFile(root);
  const cur = readHeartbeatFile(root);
  if (cur.heartbeat_id && /^[0-9A-HJKMNP-TV-Z]{26}$/.test(cur.heartbeat_id)) return cur.heartbeat_id;
  const id = ulid(now);
  writeHeartbeatFile(root, { ...cur, heartbeat_id: id, created_at: new Date(now).toISOString() });
  return id;
}

/** This checkout's heartbeat_id as recorded, null when none yet; never creates one. */
export function recordedHeartbeatId(root: string): string | null {
  return readHeartbeatFile(root).heartbeat_id ?? null;
}

/** Record that a tick finished now and how long it took (keeps the heartbeat_id). */
export function markTick(root: string, at: string, ms?: number): void {
  writeHeartbeatFile(root, { ...readHeartbeatFile(root), last_tick_at: at, ...(ms === undefined ? {} : { last_tick_ms: ms }) });
}

/** How long the last tick here took, in ms; null when not recorded. */
export function lastTickMs(root: string): number | null {
  const ms = readHeartbeatFile(root).last_tick_ms;
  return typeof ms === "number" && ms >= 0 ? ms : null;
}

/** Record the interval ticks run at on this checkout (keeps everything else). */
export function recordInterval(root: string, interval: string): void {
  ensureCheckoutFile(root);
  writeHeartbeatFile(root, { ...readHeartbeatFile(root), interval });
}

export function recordedInterval(root: string): string | null {
  return readHeartbeatFile(root).interval ?? null;
}

/** `last_tick_at` as ms epoch; null = no tick recorded. */
export function lastTickAt(root: string): number | null {
  const at = readHeartbeatFile(root).last_tick_at;
  const t = at ? Date.parse(at) : Number.NaN;
  return Number.isFinite(t) ? t : null;
}

/** Unit key → last failed act effect. */
export function readActFailures(root: string): Record<string, ActFailure> {
  return readLocalJson("local-failures", actFailuresPath(root), {}, root).units ?? {};
}

export function writeActFailures(root: string, units: Record<string, ActFailure>): void {
  atomicWriteJson(actFailuresPath(root), { units });
}
