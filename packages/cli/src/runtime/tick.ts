/**
 * One heartbeat pass (H1): local lock → observe → decide → `tick.start` → act → log → `tick.end`
 * (R5.4) → `heartbeat.json` `last_tick_at` (R5.5). The tick trace record
 * holds the facts snapshot, the workflows and config decide used, each rule fired, action and
 * result (O4), so `norn why` replays decide on exactly the same inputs (O5) via store `readTickInputs`.
 */
import { decide, type Facts, type RepoWorkflows } from "@norn/core";
import { type TickTrace, type TickUnitRecord, ulid } from "@norn/schema";
import { acquireTickLock, appendTrace, markTick, type ReplayBlock, type ReplayWorkflowRef, readTraceFile, writeTraceFile, trackInbox } from "@norn/store";
import type { Context } from "../context.ts";
import { busyError } from "../output.ts";
import { NORN_VERSION } from "../version.ts";
import { type ActRecord, Actor } from "./act/index.ts";
import { type Observed, observe, type SyncMode, type SyncReport } from "./observe/index.ts";

export interface TickOptions {
  sync?: SyncMode;
}

export interface TickReport {
  tick_id: string;
  at: string;
  duration_ms: number;
  sync: SyncReport;
  /** one line per decision: unit, rule, action kind, result */
  decisions: Array<{ unit: string; rule: string; kind: string; ok: boolean; error?: string }>;
  /** inbox item ids notified this tick (O3) */
  notified: string[];
  /** trace day file the record went to */
  trace: string;
  failed: number;
  /** GR6: owed base-branch records retried this tick */
  records?: Array<{ story: string; state: string; reason?: string }>;
  /** K5: orphan worktrees/branches seen this tick (also in the trace facts); `norn tidy` cleans them */
  orphans?: Facts["orphans"];
}

const sha = (text: string) => new Bun.CryptoHasher("sha256").update(text).digest("hex");
const jsonSafe = <T>(v: T): T => JSON.parse(JSON.stringify(v ?? null)) as T;

function recordWorkflows(root: string, workflows: RepoWorkflows): Record<string, ReplayWorkflowRef> {
  const out: Record<string, ReplayWorkflowRef> = {};
  for (const [name, w] of Object.entries(workflows)) {
    const hash = w.source ? sha(w.source) : null;
    if (hash && readTraceFile(root, `workflows/${hash}.yaml`) === null) writeTraceFile(root, `workflows/${hash}.yaml`, w.source);
    out[name] = { hash, issues: w.issues };
  }
  return out;
}

export function traceRecord(obs: Observed, records: ActRecord[], startedAt: number, duration: number): TickTrace {
  const decisions: TickUnitRecord[] = records.map(({ decision, result }) => ({
    unit: decision.unit,
    rule: decision.rule,
    action: jsonSafe(decision.action) as TickUnitRecord["action"],
    result: { ok: result.ok, ...(result.error ? { error: result.error } : {}), ...(result.detail === undefined ? {} : { detail: jsonSafe(result.detail) }) },
    ...(result.briefing ? { briefing: result.briefing } : {}),
    ...(result.transcript ? { transcript: result.transcript } : {}),
  }));
  const replay: ReplayBlock = { workflows: recordWorkflows(obs.root, obs.workflows), config: obs.config };
  return {
    type: "tick",
    tick_id: obs.facts.tick_id,
    at: new Date(startedAt).toISOString(),
    heartbeat_id: obs.heartbeat_id,
    // O5: `norn why` labels a replay of a tick another norn recorded
    norn_version: NORN_VERSION,
    duration_ms: Math.max(0, Math.round(duration)),
    facts: jsonSafe({ ...obs.facts, replay }) as Record<string, unknown>,
    decisions,
  };
}

export async function runTick(ctx: Context, opts: TickOptions = {}): Promise<TickReport> {
  const startedAt = ctx.clock.now();
  const t0 = performance.now();
  const lock = await acquireTickLock(ctx.root, { note: "norn tick", now: () => ctx.clock.iso() });
  if (!lock.ok) throw busyError(`another tick is running (pid ${lock.holder.holder.pid} since ${lock.holder.acquired_at})`, "wait for it to finish; ticks are idempotent", "tick_locked");
  try {
    const tick_id = ulid(startedAt);
    const obs = await observe(ctx, { tick_id, backfillHooks: true, ...(opts.sync ? { sync: opts.sync } : {}) });
    const decisions = decide(obs.facts, obs.workflows, obs.config);
    // R5.4 (N2): the decisions reach the trace before act, so a tick that dies mid-act is explainable
    appendTrace(ctx.root, {
      type: "tick.start",
      tick_id,
      at: new Date(startedAt).toISOString(),
      heartbeat_id: obs.heartbeat_id,
      decisions: decisions.map((d) => ({ unit: d.unit, rule: d.rule, action: jsonSafe(d.action) as TickUnitRecord["action"] })),
    });
    const actor = new Actor(ctx, obs);
    const records = await actor.run(decisions);
    const recorded = await actor.retryRecords();
    // O3: notify from what is true after act (post-act local facts), so items resolved this tick
    // stay quiet and items created this tick are not a tick late
    const post = actor.postActFacts();
    await actor.notifyInbox(post);
    // O1 history: items needing a person that appeared or were resolved this tick, in the tick record
    const inbox = trackInbox(ctx.root, post, obs.facts, decisions, obs.config);
    const record = traceRecord(obs, records, startedAt, performance.now() - t0);
    if (inbox.changes.length) record.inbox = inbox.changes;
    const file = appendTrace(ctx.root, record);
    const failed = records.filter((r) => !r.result.ok).length;
    appendTrace(ctx.root, { type: "tick.end", tick_id, at: new Date(ctx.clock.now()).toISOString(), duration_ms: record.duration_ms, failed });
    // R5.5: the checkout's heartbeat is alive as of this tick
    markTick(ctx.root, new Date(ctx.clock.now()).toISOString());
    inbox.commit();
    const lines = records.map(({ decision, result }) => ({
      unit: decision.unit,
      rule: decision.rule,
      kind: decision.action.kind,
      ok: result.ok,
      ...(result.error ? { error: result.error } : {}),
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
    };
  } finally {
    lock.release();
  }
}
