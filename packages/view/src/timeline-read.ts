/**
 * loadTimelines (O4, X1, D1): every unit's timeline — its receipts and the trace events of the
 * 14-day window, merged — for a front end that shows timelines. The project view carries none
 * (B1–B3): the cockpit, status and inbox never read the trace; only a caller that asks reads it here.
 * Local files only, no writes.
 */
import type { FileError } from "@norn/core";
import type { TraceEvent } from "@norn/schema";
import { loadSnapshot, readTrace, scanWorktrees, withSliceWorktrees } from "@norn/store";
import { mergeTimeline, receiptEntry, TIMELINE_TYPES, traceEntries, traceUnits } from "./timeline.ts";
import type { TimelineEntry } from "./types.ts";

export interface LoadTimelinesOptions {
  repoRoot: string;
  /** norn home (default NORN_HOME_DIR or ~/.norn) */
  home?: string;
  /** ms epoch; default Date.now() */
  now?: number;
  env?: Record<string, string | undefined>;
  /** trace window lower bound (ISO); default 14 days before now */
  traceSince?: string;
}

export interface Timelines {
  /** unit key → entries, oldest first */
  timeline: Record<string, TimelineEntry[]>;
  /** trace lines of a timeline type that failed to read */
  errors: FileError[];
}

const TRACE_WINDOW_MS = 14 * 86_400_000;

export function loadTimelines(opts: LoadTimelinesOptions): Timelines {
  const now = opts.now ?? Date.now();
  const wts = scanWorktrees(opts.repoRoot);
  const snap = loadSnapshot({ repoRoot: opts.repoRoot, storyRoots: [...wts.stories.values()], home: opts.home, env: opts.env, includeApplied: true });
  const trace = readTrace(opts.repoRoot, { since: opts.traceSince ?? new Date(now - TRACE_WINDOW_MS).toISOString(), types: TIMELINE_TYPES });
  const byUnit = new Map<string, TraceEvent[]>();
  for (const ev of trace.events)
    for (const k of traceUnits(ev)) {
      const list = byUnit.get(k);
      if (list) list.push(ev);
      else byUnit.set(k, [ev]);
    }
  const timeline: Record<string, TimelineEntry[]> = {};
  for (const read of snap.stories) {
    const story = withSliceWorktrees(read, (slice) => wts.slices.get(slice), { includeApplied: true });
    for (const u of story.units) {
      const entries = (u.receipts ?? u.unapplied).map(receiptEntry);
      for (const ev of byUnit.get(u.unit.key) ?? []) entries.push(...traceEntries(ev, u.unit.key));
      timeline[u.unit.key] = mergeTimeline(entries);
    }
  }
  return { timeline, errors: trace.errors };
}
