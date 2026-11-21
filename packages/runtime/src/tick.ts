/**
 * One tick: take the lock, gather facts, decide, carry out every decision in order, write the trace,
 * release the lock. The lock is released whatever happens in between, so a failed tick never blocks
 * the next one.
 */
import { type Decision, decide, type KernelFacts } from "@norn/kernel";
import { ulid } from "@norn/schema";
import { act } from "./act.ts";
import { heldProblems } from "./confirm.ts";
import type { RuntimeEnv, TickContext } from "./env.ts";
import { gatherFacts } from "./facts.ts";
import { mirrorSpec } from "./inputs.ts";
import { acquireTickLock } from "./lock.ts";
import { DEFAULT_TRACE_RETAIN_MS, pruneTraces } from "./retention.ts";
import { TickTrace } from "./trace.ts";
import type { TickReport } from "./types.ts";

/** A tick id whose time part is the host's clock, so trace files sort by when their tick ran. */
export function newTickId(now: string): string {
  return ulid(Date.parse(now));
}

const message = (e: unknown): string => (e instanceof Error ? e.message : String(e));

/**
 * Keep each live story's spec on its item as the tracker has it now, so a changed title or body
 * reaches the spec when it changes, not only at the next launch. Decide never reads the spec, so this
 * is host memory beside the tick, and a failure only leaves the spec as it was.
 */
async function mirrorSpecs(env: RuntimeEnv, facts: KernelFacts, problems: string[]): Promise<void> {
  for (const story of facts.stories) {
    const own = story.units.find((u) => u.id === story.key)?.state;
    if (!story.item || !own || own.ended !== undefined) continue;
    const mirrored = await mirrorSpec(env, story.key, story.item).catch((e: unknown) => ({ ok: false as const, failure: { message: message(e) } }));
    if (!mirrored.ok) problems.push(`${story.key}: spec: ${mirrored.failure.message}`);
  }
}

/** Gather, decide and act; anything that stops the tick short is a problem in the report, never a throw past the lock. */
async function run(env: RuntimeEnv, tickId: string, trace: TickTrace, problems: string[]): Promise<Decision[]> {
  const gathered = await gatherFacts(env, tickId);
  if (!gathered.ok) {
    problems.push(`facts: ${gathered.failure.message}`);
    return [];
  }
  problems.push(...gathered.value.problems);
  trace.facts = gathered.value.facts;
  await mirrorSpecs(env, gathered.value.facts, problems);
  const t: TickContext = { env, tickId, facts: gathered.value.facts, workflows: gathered.value.workflows, problems };
  // decide is handed a copy: the act handlers read the facts it decided from, and decide must not be able to change them
  const decisions = decide(structuredClone(t.facts), t.workflows, env.config.kernel);
  // in order, one at a time: a story's claim comes before its units' actions, its flush, finish and release after them
  const unfinished = new Map<string, string>();
  for (const [i, d] of decisions.entries()) {
    // a story whose finishing or last flush failed keeps its claim, so the next tick decides them again:
    // released over an unpublished record, no tick here flushes it again, and another clone reads the remote's stale one as free
    // the finish waits for the flush too: a worktree removed or an item closed before the record reached the remote tidies away work no other clone can see
    if (d.kind === "finish_story" && unfinished.has(d.story)) {
      trace.record({ decision: d, ok: false, error: `skipped: ${unfinished.get(d.story)} failed; the story is finished once its run data reaches the remote`, retryable: true });
      continue;
    }
    if (d.kind === "release_claim" && unfinished.has(d.story)) {
      trace.record({ decision: d, ok: false, error: `skipped: ${unfinished.get(d.story)} failed; the claim is kept for the next tick`, retryable: true });
      continue;
    }
    const outcome = await act(t, d, i);
    if (d.kind === "finish_story" && !outcome.ok) unfinished.set(d.story, "finishing the story");
    if (d.kind === "flush" && !outcome.ok) unfinished.set(d.story, "publishing the story's run data");
    trace.record(outcome);
  }
  return decisions;
}

export async function tick(env: RuntimeEnv, tickId: string): Promise<TickReport> {
  const lock = await acquireTickLock(env.ctx, tickId, env.config.lockStaleMs);
  if (!lock) return { tick_id: tickId, skipped: "locked", decisions: [], outcomes: [], problems: [] };
  const trace = new TickTrace(env.ctx, tickId);
  const problems: string[] = heldProblems(env.held);
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
    // after the tick's own trace, which is the newest and never old enough to go
    problems.push(...(await pruneTraces(env.ctx, tickId, env.config.traceRetainMs === undefined ? DEFAULT_TRACE_RETAIN_MS : env.config.traceRetainMs)));
    return report;
  } finally {
    await lock.release();
  }
}
