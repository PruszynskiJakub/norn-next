/**
 * Trace retention (O7; D11, D13): the `trace.retain` window and how it reads. The 14-day minimum (the
 * timelines' window, B25) and the duration form (B26) are checked here, where the value is used, not
 * in the config schema, so a bad value never fails config loading.
 */
import type { UnitFacts } from "@norn/core";
import { DURATION_PATTERN, parseDuration, type ResolvedConfig } from "@norn/schema";
import { listHookFiles, listRunTraces, liveRun } from "@norn/store";

/** B25: the shortest window: the timelines show 14 days, so tidy never deletes what they still show. */
export const MIN_TRACE_RETAIN = "14d";
const MIN_MS = parseDuration(MIN_TRACE_RETAIN);
const DURATION = new RegExp(DURATION_PATTERN);

export type RetainCheck = { ok: true; retain: string; ms: number } | { ok: false; reason: "form" | "short"; retain: string };

/** A `trace.retain` / `--retain` value: a duration of at least 14d. */
export function checkRetain(retain: string): RetainCheck {
  if (!DURATION.test(retain)) return { ok: false, reason: "form", retain };
  const ms = parseDuration(retain);
  return ms < MIN_MS ? { ok: false, reason: "short", retain } : { ok: true, retain, ms };
}

/** The window the trace is kept for: `trace.retain`, or the 14d minimum when that value does not apply. */
export function effectiveRetain(config: ResolvedConfig): { retain: string; ms: number } {
  const c = checkRetain(config.trace.retain);
  return c.ok ? c : { retain: MIN_TRACE_RETAIN, ms: MIN_MS };
}

/** D12: day pairs dated before this UTC day are older than the window. */
export const retainCutoffDay = (now: number, ms: number) => new Date(now - ms).toISOString().slice(0, 10);

/** A unit hook file tidy prunes (B28). */
export interface PrunedHookFile {
  /** story or slice key */
  unit: string;
  /** trace-relative */
  file: string;
  bytes: number;
}

/** A run whose briefings and transcripts tidy prunes (B29). */
export interface PrunedRun {
  run_id: string;
  /** trace-relative dirs */
  files: string[];
  bytes: number;
}

/**
 * D12 (B28–B30): what tidy prunes besides day pairs — the hook files of units with no live run whose
 * last write is before `cutoffMs`, and the briefings and transcripts of runs that are not live whose
 * newest file is before it. A unit counts as live while its run is running or parked, or while a
 * `started` receipt is not yet applied (a launch in flight); its runs count as live with it.
 */
export function unitTracesBefore(root: string, units: readonly UnitFacts[], cutoffMs: number): { hook_files: PrunedHookFile[]; runs: PrunedRun[] } {
  const liveUnits = new Set<string>();
  const liveRuns = new Set<string>();
  for (const u of units) {
    const launching = u.unapplied.filter((r) => r.receipt.kind === "started");
    if (!liveRun(u.state) && !launching.length) continue;
    liveUnits.add(unitKey(u.unit.story, u.unit.slice));
    if (u.state?.run) liveRuns.add(u.state.run.run_id);
    for (const r of launching) if (r.receipt.run_id) liveRuns.add(r.receipt.run_id);
  }
  const hook_files = listHookFiles(root)
    .filter((f) => !liveUnits.has(unitKey(f.story, f.slice)) && f.mtimeMs < cutoffMs)
    .map((f) => ({ unit: unitKey(f.story, f.slice), file: f.file, bytes: f.bytes }));
  const runs = listRunTraces(root)
    .filter((r) => !liveRuns.has(r.run_id) && r.newestMs < cutoffMs)
    .map((r) => ({ run_id: r.run_id, files: r.files, bytes: r.bytes }));
  return { hook_files, runs };
}

const unitKey = (story: string, slice: string | null) => slice ?? story;

/** A `trace.retain` value that does not apply, for `norn doctor`'s warnings; null when it does. */
export function retainWarning(retain: string): string | null {
  const c = checkRetain(retain);
  if (c.ok) return null;
  return c.reason === "form"
    ? `trace.retain ${retain} is not a duration (like ${MIN_TRACE_RETAIN}): norn tidy refuses to prune until it is`
    : `trace.retain ${retain} is under ${MIN_TRACE_RETAIN}, the trace window's minimum: norn tidy refuses to prune until it is at least ${MIN_TRACE_RETAIN}`;
}

/** Bytes for a person: `950 B`, `30.0 KB`, `2.4 GB` (decimal units). */
export function formatBytes(n: number): string {
  if (n < 1000) return `${n} B`;
  const units = ["KB", "MB", "GB", "TB"];
  let v = n / 1000;
  let i = 0;
  while (v >= 1000 && i < units.length - 1) {
    v /= 1000;
    i++;
  }
  return `${v.toFixed(1)} ${units[i]}`;
}
