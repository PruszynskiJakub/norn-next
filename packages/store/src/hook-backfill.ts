/**
 * The one-time backfill of the per-unit hook files (B11, B12, D5): a norn upgraded while runs are
 * live finds their hook lines only in the day files, so the first tick of the per-unit hook files
 * copies them over, once per unit, deduplicated by event id. `trace/hooks/backfill.json` records
 * when that tick ran (`since`) and the units done; it is never pruned.
 */
import type { HookTrace } from "@norn/schema";
import { atomicWriteJson } from "./fsx.ts";
import { readLocalJson } from "./local-json.ts";
import { hookBackfillPath } from "./paths.ts";
import { appendMissingUnitHooks, dayHookLines, type HookUnit } from "./trace.ts";

/** A unit with a live run (or an unknown launch, R5.1) and when that run began. */
export interface BackfillRun {
  unit: HookUnit & { key: string };
  started_at: string;
}

/**
 * D5: copy the hook lines of each live run that began before the backfill's `since` and whose unit
 * is not yet `done` from the day files (from the earliest such run's start) into its unit's hook
 * file, then record those units as done. The first call writes `backfill.json` with `since` = `now`.
 * Runs begun after `since` need nothing: no day file is read for them (B11). A crash before `done`
 * is written just copies again next time, deduplicated by event id (B12). Run under the tick lock.
 */
export function backfillHookFiles(root: string, runs: readonly BackfillRun[], now: string): void {
  const path = hookBackfillPath(root);
  // a missing (or unreadable) file reads as no backfill yet: this tick is the first
  let { since, done } = readLocalJson("local-hook-backfill", path, { since: "", done: [] }, root);
  if (!since) {
    since = now;
    atomicWriteJson(path, { since, done });
  }
  const pending = runs.filter((r) => r.started_at < since && !done.includes(r.unit.key));
  if (!pending.length) return;
  const from = pending.map((r) => r.started_at).sort()[0] as string;
  const lines = new Map<string, HookTrace[]>(pending.map((r) => [r.unit.key, []]));
  for (const ev of dayHookLines(root, from)) {
    const run = pending.find((r) => ownedBy(ev, r.unit) && ev.fact.at >= r.started_at);
    if (run) lines.get(run.unit.key)?.push(ev);
  }
  for (const r of pending) appendMissingUnitHooks(root, r.unit, lines.get(r.unit.key) ?? []);
  atomicWriteJson(path, { since, done: [...done, ...pending.map((r) => r.unit.key)] });
}

/** The unit a hook line fired in: `norn hook` stamps the worktree's story, and its slice in a slice worktree. */
function ownedBy(ev: HookTrace, unit: HookUnit): boolean {
  return ev.fact.story === unit.story && (ev.fact.slice ?? null) === (unit.slice ?? null);
}
