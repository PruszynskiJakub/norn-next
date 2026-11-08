/**
 * One heartbeat pass: local lock → observe → decide → `tick.start` → act → log → `tick.end`
 * → `heartbeat.json` `last_tick_at`. The tick trace record
 * holds the facts snapshot, the workflows and config decide used (as chunks of the day, store
 * `appendTick`), each rule fired, action and result, so `norn run view --why` replays decide on exactly the
 * same inputs via store `readTickInputs`.
 */
import { decide, type Facts, leavesFollowUp } from "@norn/core";
import { type TickSlowest, type TickTiming, type TickTrace, type TickUnitRecord, ulid } from "@norn/schema";
import { acquireTickLock, appendTick, appendTrace, markTick, trackInbox } from "@norn/store";
import type { Context } from "../context.ts";
import { busyError } from "../output.ts";
import { type ActRecord, Actor } from "./act/index.ts";
import type { RecordRetry } from "./act/lifecycle.ts";
import { type Observed, observe, type SyncMode, type SyncReport } from "./observe/index.ts";
import { tickTiming } from "./timing.ts";

export interface TickOptions {
  sync?: SyncMode;
}

export interface TickReport {
  tick_id: string;
  at: string;
  duration_ms: number;
  sync: SyncReport;
  /** one line per decision: unit, rule, action kind, result */
  decisions: Array<{ unit: string; rule: string; kind: string; ok: boolean; error?: string; warnings?: string[]; story?: string }>;
  /** inbox item ids notified this tick */
  notified: string[];
  /** trace day file the record went to */
  trace: string;
  failed: number;
  /** Owed base-branch records retried this tick */
  records?: RecordRetry[];
  /** Orphan worktrees/branches seen this tick (also in the trace facts); `norn tidy` cleans them */
  orphans?: Facts["orphans"];
  /** The tick's slowest phase (its full timing is in the trace record) */
  slowest: TickSlowest;
  /** An action of this tick that went through left the next tick something to do (`leavesFollowUp`); absent = none */
  follow_up?: true;
}

const jsonSafe = <T>(v: T): T => JSON.parse(JSON.stringify(v ?? null)) as T;

/** The tick record's fields beside its facts; store `appendTick` records the facts and replay inputs as chunks. */
export function traceRecord(obs: Observed, records: ActRecord[], startedAt: number, duration: number, version: string, timing?: TickTiming): Omit<TickTrace, "type" | "facts"> {
  const decisions: TickUnitRecord[] = records.map(({ decision, result, ms }) => ({
    unit: decision.unit,
    rule: decision.rule,
    action: jsonSafe(decision.action) as TickUnitRecord["action"],
    result: {
      ok: result.ok,
      ...(result.error ? { error: result.error } : {}),
      ...(result.detail === undefined ? {} : { detail: jsonSafe(result.detail) }),
      ...(result.warnings?.length ? { warnings: result.warnings } : {}),
      // The action's time, beside its result, never in `action`
      ms: Math.max(0, Math.round(ms)),
    },
    ...(result.briefing ? { briefing: result.briefing } : {}),
    ...(result.transcript ? { transcript: result.transcript } : {}),
  }));
  return {
    tick_id: obs.facts.tick_id,
    at: new Date(startedAt).toISOString(),
    heartbeat_id: obs.heartbeat_id,
    // `norn run view --why` labels a replay of a tick another norn recorded
    norn_version: version,
    duration_ms: Math.max(0, Math.round(duration)),
    decisions,
    // The sync outcome and where the tick spent its time, outside `facts`
    sync: { ...obs.sync },
    ...(timing ? { timing } : {}),
  };
}

export async function runTick(ctx: Context, opts: TickOptions = {}): Promise<TickReport> {
  const startedAt = ctx.clock.now();
  const t0 = performance.now();
  const lock = await acquireTickLock(ctx.root, { note: "norn tick", now: () => ctx.clock.iso() });
  if (!lock.ok) throw busyError(`another tick is running (pid ${lock.holder.holder.pid} since ${lock.holder.acquired_at})`, "wait for it to finish; ticks are idempotent", "tick_locked");
  try {
    const tick_id = ulid(startedAt);
    const tObserve = performance.now();
    const obs = await observe(ctx, { tick_id, backfillHooks: true, ...(opts.sync ? { sync: opts.sync } : {}) });
    const tDecide = performance.now();
    const decisions = decide(obs.facts, obs.workflows, obs.config);
    const tAct = performance.now();
    // The decisions reach the trace before act, so a tick that dies mid-act is explainable
    appendTrace(ctx.root, {
      type: "tick.start",
      tick_id,
      at: new Date(startedAt).toISOString(),
      heartbeat_id: obs.heartbeat_id,
      decisions: decisions.map((d) => ({ unit: d.unit, rule: d.rule, action: jsonSafe(d.action) as TickUnitRecord["action"] })),
    });
    const actor = new Actor(ctx, obs);
    const records = await actor.run(decisions);
    const tAfter = performance.now();
    const recorded = await actor.retryRecords();
    // Notify from what is true after act (post-act local facts), so items resolved this tick
    // stay quiet and items created this tick are not a tick late
    const post = actor.postActFacts();
    await actor.notifyInbox(post);
    // Inbox history: items needing a person that appeared or were resolved this tick, in the tick record
    const inbox = trackInbox(ctx.root, post, obs.facts, decisions, obs.config);
    const tEnd = performance.now();
    const timing = tickTiming(
      { observe_ms: tDecide - tObserve, decide_ms: tAct - tDecide, act_ms: tAfter - tAct, after_ms: tEnd - tAfter, observe: obs.timing.phases, calls: obs.timing.calls },
      records.map((r) => ({ unit: r.decision.unit, kind: r.decision.action.kind, ms: r.ms, ...(r.batched ? { batched: true } : {}) })),
    );
    const record = traceRecord(obs, records, startedAt, tEnd - t0, ctx.version, timing);
    if (inbox.changes.length) record.inbox = inbox.changes;
    const file = appendTick(ctx.root, record, { facts: obs.facts, workflows: obs.workflows, config: obs.config });
    const failed = records.filter((r) => !r.result.ok).length;
    appendTrace(ctx.root, { type: "tick.end", tick_id, at: new Date(ctx.clock.now()).toISOString(), duration_ms: record.duration_ms, failed, slowest: timing.slowest });
    // The checkout's heartbeat is alive as of this tick, and how long the tick took (status, cockpit)
    markTick(ctx.root, new Date(ctx.clock.now()).toISOString(), record.duration_ms);
    inbox.commit();
    const lines = records.map(({ decision, result }) => ({
      unit: decision.unit,
      rule: decision.rule,
      kind: decision.action.kind,
      ok: result.ok,
      ...(result.error ? { error: result.error } : {}),
      // The tick's output says what did not happen though the action went on
      ...(result.warnings?.length ? { warnings: result.warnings } : {}),
      ...(decision.action.kind === "intake_story" ? { story: decision.action.key } : {}),
    }));
    return {
      tick_id,
      at: record.at,
      duration_ms: record.duration_ms,
      sync: obs.sync,
      decisions: lines,
      notified: actor.notifiedNow,
      trace: file,
      failed: lines.filter((l) => !l.ok).length,
      ...(recorded.length ? { records: recorded } : {}),
      ...(obs.facts.orphans.worktrees.length || obs.facts.orphans.branches.length ? { orphans: obs.facts.orphans } : {}),
      slowest: timing.slowest,
      ...(records.some((r) => r.result.ok && leavesFollowUp(r.decision.action)) ? { follow_up: true as const } : {}),
    };
  } finally {
    lock.release();
  }
}
