/**
 * One unit's facts: its record through the Journal (validated, or corrupt with the reason), the
 * session of its current run, and the step run the host remembers for it. A port that throws is read
 * as knowing nothing, never as a fact.
 */
import { type UnitFacts, type UnitJournal, validateReceiptData } from "@norn/kernel";
import { fail, ok, type PluginResult } from "@norn/plugin-api";
import type { RuntimeEnv } from "./env.ts";
import type { GatherOptions } from "./facts.ts";
import { readDetachedCheck, stopDetachedCheck } from "./checks-detached.ts";
import { sessionReportOnRecord } from "./live-run.ts";
import { readStepRun, type StepRunRecord, stepRunFact, writeStepRun } from "./step-runs.ts";

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

/**
 * The unit's step run, a detached check of its current run read against its exit file, process and
 * deadline. Gathering facts writes two things here, both host memory and never run state: the
 * settled record (so a finished check's outcome outlives its files), and the stop of a check past
 * its deadline (a lingering check would hold the worktree while decide moves on). A read-only
 * gathering returns the settled record without either write.
 */
async function settledStepRun(env: RuntimeEnv, unit: string, run: { id: string; step: string; attempt: number }, problems: string[], opts: GatherOptions): Promise<StepRunRecord | null> {
  const record = await readStepRun(env.ctx, unit);
  if (!record || record.running !== true || record.kind !== "check" || stepRunFact(record, run) === undefined) return record;
  try {
    const read = await readDetachedCheck(env.ctx, record, env.ctx.now());
    if (read.stop && !opts.readOnly) await stopDetachedCheck(env.ctx, read.stop);
    if (!read.settled) return record;
    if (opts.readOnly) return read.settled;
    await writeStepRun(env.ctx, read.settled);
    return read.settled;
  } catch (e) {
    problems.push(`${unit}: the detached check could not be read: ${e instanceof Error ? e.message : String(e)}`);
    return record;
  }
}

/** The dialog the run's pane shows, on one line for a park's text; null when none, or the launcher cannot read one. */
async function probeDialog(env: RuntimeEnv, handle: string): Promise<string | null> {
  try {
    const text = (await env.launcher.dialog?.(handle)) ?? "";
    const line = text
      .split("\n")
      .map((l) => l.replace(/\s+/g, " ").trim())
      .filter((l) => l !== "")
      .join(" | ");
    return line === "" ? null : line;
  } catch {
    return null;
  }
}

/** Whether the run's process still runs; null when the launcher cannot tell, which is never read as dead. */
async function probeAlive(env: RuntimeEnv, handle: string): Promise<boolean | null> {
  try {
    return (await env.launcher.alive?.(handle)) ?? null;
  } catch {
    return null;
  }
}

export async function readUnitFacts(env: RuntimeEnv, unit: string, problems: string[], opts: GatherOptions = {}): Promise<PluginResult<UnitRead>> {
  const read = await env.journal.readUnit(unit);
  if (!read.ok) return fail(read.failure.code, `${unit}: ${read.failure.message}`, read.failure.retryable);
  const j = read.value;
  const facts: UnitFacts = { id: unit, state: j.state, version: j.version, receipts: j.unapplied, session: null };
  if (j.corrupt !== undefined) {
    facts.corrupt = j.corrupt;
    if (j.corrupt_marked === true || (await corruptMarked(env, unit))) facts.corrupt_marked = true;
    return ok({ facts, journal: j });
  }
  const run = j.state?.run ?? null;
  if (run) {
    try {
      const session = await env.sessions.facts(unit, run.id, run.session);
      if (session?.report && sessionReportOnRecord(j, run.id, session.report)) delete session.report;
      facts.session = session;
    } catch (e) {
      problems.push(`${unit}: the session source failed: ${e instanceof Error ? e.message : String(e)}`);
    }
    if (facts.session === null && run.session !== undefined) {
      const alive = await probeAlive(env, run.session);
      if (alive !== null) facts.run_alive = alive;
      if (alive === true) {
        const dialog = await probeDialog(env, run.session);
        if (dialog !== null) facts.run_dialog = dialog;
      }
    }
    const sr = stepRunFact(await settledStepRun(env, unit, run, problems, opts), run);
    if (sr) facts.step_run = sr;
  }
  return ok({ facts, journal: j });
}
