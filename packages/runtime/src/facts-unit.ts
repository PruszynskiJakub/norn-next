/**
 * One unit's facts: its record through the Journal (validated, or corrupt with the reason), the
 * session of its current run, and the step run the host remembers for it. A port that throws is read
 * as knowing nothing, never as a fact.
 */
import { type UnitFacts, type UnitJournal, validateReceiptData } from "@norn/kernel";
import { fail, ok, type PluginResult } from "@norn/plugin-api";
import type { RuntimeEnv } from "./env.ts";
import { readStepRun, stepRunFact } from "./step-runs.ts";

export interface UnitRead {
  facts: UnitFacts;
  journal: UnitJournal;
}

/**
 * Whether a corrupt record already carries its corrupt mark. The record fails validation as a whole,
 * so its receipts are read one by one here: a mark that validates on its own is the host's own, and
 * decide marks the unit once.
 */
async function corruptMarked(env: RuntimeEnv, unit: string): Promise<boolean> {
  const raw = await env.slots.store.readUnit(unit);
  if (!raw.ok) return false;
  return raw.value.receipts.some((r) => {
    const data = validateReceiptData(r.data);
    return data.ok && data.value.kind === "unit.marked" && data.value.ended === "corrupt";
  });
}

export async function readUnitFacts(env: RuntimeEnv, unit: string, problems: string[]): Promise<PluginResult<UnitRead>> {
  const read = await env.journal.readUnit(unit);
  if (!read.ok) return fail(read.failure.code, `${unit}: ${read.failure.message}`, read.failure.retryable);
  const j = read.value;
  const facts: UnitFacts = { id: unit, state: j.state, version: j.version, receipts: j.unapplied, session: null };
  if (j.corrupt !== undefined) {
    facts.corrupt = j.corrupt;
    if (await corruptMarked(env, unit)) facts.corrupt_marked = true;
    return ok({ facts, journal: j });
  }
  const run = j.state?.run ?? null;
  if (run) {
    try {
      facts.session = env.sessions.facts(unit, run.id);
    } catch (e) {
      problems.push(`${unit}: the session source failed: ${e instanceof Error ? e.message : String(e)}`);
    }
    const sr = stepRunFact(await readStepRun(env.ctx, unit), run);
    if (sr) facts.step_run = sr;
  }
  return ok({ facts, journal: j });
}
