/**
 * The per-run event log: what a run's hooks reported, normalized, in seq order. Hook processes run
 * concurrently, so a batch claims its first seq by exclusive create (`ctx.files.create`) of its
 * file: the loser re-reads the log and claims the next free seq, and two batches never share one.
 * Every file is validated on read; a file that fails is a problem for that run's facts, never a guess.
 */
import { fail, type HarnessEvent, HarnessEvent as HarnessEventSchema, type HostContext, ok, parseJson, type PluginResult, validateHarnessEvent } from "@norn/plugin-api";
import { NonNegInt } from "@norn/schema";
import { type Static, Type } from "@sinclair/typebox";
import { batchesDir, batchName, batchSeq } from "./paths.ts";

export const EventBatch = Type.Object(
  {
    first_seq: NonNegInt,
    /** seqs first_seq, first_seq+1, ... in order */
    events: Type.Array(HarnessEventSchema, { minItems: 1 }),
  },
  { additionalProperties: false, title: "EventBatch" },
);
export type EventBatch = Static<typeof EventBatch>;

export interface EventLogRead {
  /** every valid batch's events, ascending by seq */
  events: HarnessEvent[];
  /** a batch file that failed validation, or a gap, named with its file */
  problems: string[];
  /** the seq the next batch would claim */
  next_seq: number;
}

/** Losing this many claims in a row means something other than a racing hook holds the names. */
const MAX_CLAIMS = 64;

const errorText = (e: unknown): string => (e instanceof Error ? e.message : String(e));

/**
 * Append `events` as one batch. Their seqs are restamped from the seq the batch claims, so a caller
 * may normalize with the seq it read and lose the race harmlessly. Idempotence is the caller's:
 * appending the same events twice records them twice.
 */
export async function appendEvents(ctx: HostContext, unit: string, runId: string, events: HarnessEvent[]): Promise<PluginResult<EventBatch>> {
  if (events.length === 0) return fail("invalid", "an event batch holds at least one event", false);
  for (const e of events) {
    const valid = validateHarnessEvent(e);
    if (!valid.ok) return fail("invalid", `event ${e.type}: ${valid.errors.map((x) => `${x.path || "/"} ${x.message}`).join("; ")}`, false);
    if (e.run_id !== runId) return fail("invalid", `event ${e.type} is for run ${e.run_id}, not ${runId}`, false);
  }
  const dir = batchesDir(ctx, unit, runId);
  try {
    for (let i = 0; i < MAX_CLAIMS; i++) {
      const { next_seq } = await readEvents(ctx, unit, runId);
      const batch: EventBatch = { first_seq: next_seq, events: events.map((e, n) => ({ ...e, seq: next_seq + n })) };
      if (await ctx.files.create(`${dir}/${batchName(next_seq)}`, `${JSON.stringify(batch)}\n`)) return ok(batch);
    }
  } catch (e) {
    return fail("unavailable", `appending to ${dir}: ${errorText(e)}`);
  }
  return fail("conflict", `appending to ${dir}: lost ${MAX_CLAIMS} claims in a row`);
}

export async function readEvents(ctx: HostContext, unit: string, runId: string): Promise<EventLogRead> {
  const dir = batchesDir(ctx, unit, runId);
  const events: HarnessEvent[] = [];
  const problems: string[] = [];
  let next_seq = 0;
  // a bad batch's length is unknown, so the seqs after it cannot be called missing
  let afterBad = false;
  // the listing is sorted and names are zero-padded, so batches come in seq order
  for (const name of await ctx.files.list(dir)) {
    const first = batchSeq(name);
    if (first === null) continue;
    const path = `${dir}/${name}`;
    const text = await ctx.files.read(path);
    if (text === null) continue;
    // a bad batch still holds its seq: the next one is claimed past it, never over it
    const claimed = Math.max(next_seq, first + 1);
    const parsed = parseJson(EventBatch, text, `event batch ${path}`);
    if (!parsed.ok) {
      problems.push(parsed.failure.message);
      next_seq = claimed;
      afterBad = true;
      continue;
    }
    const batch = parsed.value;
    const stray = batch.events.find((e, n) => e.seq !== first + n || e.run_id !== runId);
    if (batch.first_seq !== first || stray) {
      problems.push(`event batch ${path}: its seqs or run do not match its name`);
      next_seq = claimed;
      afterBad = true;
      continue;
    }
    if (first > next_seq && !afterBad) problems.push(`event log ${dir}: seqs ${next_seq}..${first - 1} are missing`);
    if (first < next_seq) problems.push(`event batch ${path}: overlaps seqs before ${next_seq}`);
    events.push(...batch.events);
    next_seq = Math.max(next_seq, first + batch.events.length);
    afterBad = false;
  }
  return { events, problems, next_seq };
}
