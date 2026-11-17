/**
 * One tick: take the lock, gather facts, decide, carry out every decision in order, write the trace,
 * release the lock. The lock is released whatever happens in between, so a failed tick never blocks
 * the next one.
 */
import { type Decision, decide } from "@norn/kernel";
import { ulid } from "@norn/schema";
import { act } from "./act.ts";
import type { RuntimeEnv, TickContext } from "./env.ts";
import { gatherFacts } from "./facts.ts";
import { acquireTickLock } from "./lock.ts";
import { TickTrace } from "./trace.ts";
import type { TickReport } from "./types.ts";

/** A tick id whose time part is the host's clock, so trace files sort by when their tick ran. */
export function newTickId(now: string): string {
  return ulid(Date.parse(now));
}

const message = (e: unknown): string => (e instanceof Error ? e.message : String(e));

/** Gather, decide and act; anything that stops the tick short is a problem in the report, never a throw past the lock. */
async function run(env: RuntimeEnv, tickId: string, trace: TickTrace, problems: string[]): Promise<Decision[]> {
  const gathered = await gatherFacts(env, tickId);
  if (!gathered.ok) {
    problems.push(`facts: ${gathered.failure.message}`);
    return [];
  }
  problems.push(...gathered.value.problems);
  trace.facts = gathered.value.facts;
  const t: TickContext = { env, tickId, facts: gathered.value.facts, workflows: gathered.value.workflows };
  // decide is handed a copy: the act handlers read the facts it decided from, and decide must not be able to change them
  const decisions = decide(structuredClone(t.facts), t.workflows, env.config.kernel);
  // in order, one at a time: a story's claim comes before its units' actions, its flush and release after them
  for (const [i, d] of decisions.entries()) trace.record(await act(t, d, i));
  return decisions;
}

export async function tick(env: RuntimeEnv, tickId: string): Promise<TickReport> {
  const lock = await acquireTickLock(env.ctx, tickId, env.config.lockStaleMs);
  if (!lock) return { tick_id: tickId, skipped: "locked", decisions: [], outcomes: [], problems: [] };
  const trace = new TickTrace(env.ctx, tickId);
  const problems: string[] = [];
  try {
    let decisions: Decision[] = [];
    try {
      decisions = await run(env, tickId, trace, problems);
    } catch (e) {
      problems.push(`the tick stopped: ${message(e)}`);
    }
    const report: TickReport = { tick_id: tickId, decisions, outcomes: trace.entries, problems };
    const lost = await trace.write(report);
    if (lost) problems.push(lost);
    return report;
  } finally {
    await lock.release();
  }
}
