/**
 * Writing what decide asked for onto a unit's record: its receipts in order, then the state last.
 * Decide numbered the new receipts after the last one its facts showed; when the store numbers them
 * otherwise, another writer moved the record since, and the state decide computed would claim to have
 * applied receipts it never saw. Nothing is committed then; the next tick decides from the record as
 * it is.
 */
import type { KernelFacts, ReceiptIntent, RunState, UnitFacts } from "@norn/kernel";
import { fail, ok, type PluginResult } from "@norn/plugin-api";
import type { RuntimeEnv } from "./env.ts";

/** The unit as the tick's facts showed it, or null when decide saw no record of it. */
export function unitInFacts(facts: KernelFacts, unit: string): UnitFacts | null {
  const story = facts.stories.find((s) => s.units.some((u) => u.id === unit));
  return story?.units.find((u) => u.id === unit) ?? null;
}

/** The highest seq the facts showed on the unit's record; the store numbers the next receipt one above. */
export function lastSeqIn(u: UnitFacts | null): number {
  return Math.max(u?.state?.applied_through ?? 0, u?.receipts.at(-1)?.seq ?? 0);
}

export interface Written {
  seqs: number[];
  /** the committed version, or null when there was no state to commit */
  version: number | null;
}

/**
 * Record `intents` (each idempotent by id, so a replay writes nothing twice), check each landed at the
 * seq decide gave it, run `before`, then commit `state` against `expectVersion` unless `before` failed.
 */
export async function writeAndCommit(
  env: RuntimeEnv,
  facts: KernelFacts,
  unit: string,
  intents: readonly ReceiptIntent[],
  state: RunState | null,
  expectVersion: number | null,
  before?: () => Promise<PluginResult<unknown>>,
): Promise<PluginResult<Written>> {
  const seen = unitInFacts(facts, unit);
  const first = lastSeqIn(seen) + 1;
  const seqs: number[] = [];
  for (const [i, intent] of intents.entries()) {
    const wrote = await env.journal.record(unit, intent);
    if (!wrote.ok) return wrote;
    seqs.push(wrote.value.seq);
    // a corrupt record shows decide no receipts, so there is no numbering of its to hold the store to
    if (seen?.corrupt === undefined && wrote.value.seq !== first + i)
      return fail("conflict", `${unit}: receipt ${intent.id} landed at seq ${wrote.value.seq}, decide numbered it ${first + i}; the record moved since facts were read`, true);
  }
  if (before) {
    // a failed hook keeps the state uncommitted, so the receipts stay unapplied and the next tick tries again
    const pre = await before();
    if (!pre.ok) return pre;
  }
  if (state === null) return ok({ seqs, version: null });
  const committed = await env.journal.commit(unit, state, expectVersion);
  // a commit that lost its compare-and-swap is read again by the next tick, never forced
  if (!committed.ok) return committed.failure.code === "conflict" ? fail("conflict", committed.failure.message, true) : committed;
  return ok({ seqs, version: committed.value.version });
}
