/**
 * The kernel's journal over a Store: the only kernel code that does IO, and only through the store.
 * It holds the write rules: receipts before effects, state last as the commit point, a commit that
 * lost a race re-read and never forced, and anything failing validation read as corrupt, never guessed.
 */
import { fail, ok, type PluginResult, type Store } from "@norn/plugin-api";
import { check, deriveUlid } from "@norn/schema";
import { type KernelReceipt, type ReceiptData, ReceiptIntent } from "../model/receipts.ts";
import type { RunState } from "../model/run-state.ts";
import { validateReceiptData, validateRunState } from "../model/validate.ts";
import { readRunState, schemaReason } from "./format.ts";

const validateReceiptIntent = (v: unknown) => check(ReceiptIntent, v);

/** A unit as the journal read it: its state and receipts validated against the kernel's schemas. */
export interface UnitJournal {
  unit: string;
  /** the store's state version; null when nothing was committed yet */
  version: number | null;
  state: RunState | null;
  /** every receipt, ascending by seq */
  receipts: KernelReceipt[];
  /** the receipts above `state.applied_through` */
  unapplied: KernelReceipt[];
  /** why the unit's record failed validation; `state` and `receipts` are then empty, never a partial read */
  corrupt?: string;
  /** set with `corrupt` when the record holds a valid `unit.marked` corrupt receipt: decide's mark is already there */
  corrupt_marked?: boolean;
}

/**
 * One act: the receipt that says it is about to happen, the effect, the receipt of how it went, and
 * the state committed last. A step already on the record is not repeated: an intent found written is
 * not written again, and an effect is not performed again once its outcome receipt is written (or,
 * for an act with no outcome receipt, once a committed state has applied its intent).
 *
 * The one window no record can close is a crash after the effect and before the receipt that says it
 * happened: a replay performs the effect again, under the same intent id. That is why a plugin effect
 * is idempotent by the receipt id it runs under.
 */
export interface ActPlan<T> {
  intent: ReceiptIntent;
  perform(): Promise<PluginResult<T>>;
  /** the receipt recording how the effect went; null when the intent alone is the record */
  outcome: ((value: T) => ReceiptData) | null;
  /** the state to commit, computed from the unit as it reads after both receipts; null commits nothing */
  next(unit: UnitJournal): { state: RunState; expectVersion: number | null } | null;
}

export interface ActOutcome<T> {
  /** the effect's value, or null when an earlier pass had already performed it */
  value: T | null;
  performed: boolean;
  /** the committed version, or null when `next` committed nothing */
  version: number | null;
}

/** The id of the receipt recording how the effect under intent `intentId` went; derived, so a replay finds it. */
export function outcomeReceiptId(intentId: string): string {
  return deriveUlid(intentId, 1);
}

/**
 * A corrupt read: nothing of the record is handed on but why, and whether decide's mark is on it.
 * The mark is the one receipt read from a corrupt record, and only to say it is there.
 */
function corruptUnit(unit: string, version: number | null, reason: string, record: readonly { data: unknown }[]): UnitJournal {
  const marked = record.some((r) => {
    const data = validateReceiptData(r.data);
    return data.ok && data.value.kind === "unit.marked" && data.value.ended === "corrupt";
  });
  return { unit, version, state: null, receipts: [], unapplied: [], corrupt: reason, ...(marked ? { corrupt_marked: true } : {}) };
}

export class Journal {
  constructor(readonly store: Store) {}

  /** Read and validate a unit; a failing envelope or document comes back as `corrupt`, not as a failure. */
  async readUnit(unit: string): Promise<PluginResult<UnitJournal>> {
    const read = await this.store.readUnit(unit);
    if (!read.ok) return read;
    const record = read.value;
    const version = record.state?.version ?? null;
    const receipts: KernelReceipt[] = [];
    for (const r of record.receipts) {
      const data = validateReceiptData(r.data);
      if (!data.ok) return ok(corruptUnit(unit, version, `receipt ${r.seq} (${r.id}): ${schemaReason(data.errors)}`, record.receipts));
      receipts.push({ seq: r.seq, id: r.id, at: r.at, data: data.value });
    }
    if (record.state === null) return ok({ unit, version, state: null, receipts, unapplied: receipts });
    const state = readRunState(record.state.data);
    if (!state.ok) return ok(corruptUnit(unit, version, `run state v${version}: ${state.reason}`, record.receipts));
    const s = state.state;
    if (s.unit !== unit) return ok(corruptUnit(unit, version, `run state v${version} is for unit ${s.unit}`, record.receipts));
    // a corrupt mark is only settled by a state that ended corrupt; below it the record was read as
    // corrupt once, and the mark's own seq could make a numbering fault look whole again
    const mark = receipts.find((r) => r.data.kind === "unit.marked" && r.data.ended === "corrupt");
    if (mark && s.ended !== "corrupt") return ok(corruptUnit(unit, version, `marked corrupt by receipt ${mark.seq}, and the run state never ended corrupt`, record.receipts));
    const last = receipts.at(-1)?.seq ?? 0;
    if (s.applied_through > last) return ok(corruptUnit(unit, version, `run state v${version} applied through receipt ${s.applied_through}, but the unit has ${last}`, record.receipts));
    return ok({ unit, version, state: s, receipts, unapplied: receipts.filter((r) => r.seq > s.applied_through) });
  }

  /** Append a receipt under its deterministic id; the same id again is a replay and writes nothing. */
  async record(unit: string, intent: ReceiptIntent): Promise<PluginResult<{ seq: number; replayed: boolean }>> {
    const checked = validateReceiptIntent(intent);
    if (!checked.ok) return fail("invalid", `receipt for ${unit}: ${schemaReason(checked.errors)}`);
    return this.store.appendReceipt(unit, { id: intent.id, data: intent.data });
  }

  /** Commit the state by compare-and-swap; `conflict` means another writer moved first: re-read, never overwrite. */
  async commit(unit: string, state: RunState, expectVersion: number | null): Promise<PluginResult<{ version: number }>> {
    const checked = validateRunState(state);
    if (!checked.ok) return fail("invalid", `run state for ${unit}: ${schemaReason(checked.errors)}`);
    if (state.unit !== unit) return fail("invalid", `run state for unit ${state.unit} committed to ${unit}`);
    return this.store.commitState(unit, state, expectVersion);
  }

  /** Follow the act protocol for one effect on `unit`. */
  async act<T>(unit: string, plan: ActPlan<T>): Promise<PluginResult<ActOutcome<T>>> {
    const first = await this.readUnit(unit);
    if (!first.ok) return first;
    if (first.value.corrupt !== undefined) return fail("invalid", `${unit} is corrupt: ${first.value.corrupt}`);
    const outcomeId = outcomeReceiptId(plan.intent.id);
    const intentSeq = first.value.receipts.find((r) => r.id === plan.intent.id)?.seq;
    const appliedThrough = first.value.state?.applied_through ?? 0;
    const outcomeOnRecord = first.value.receipts.find((r) => r.id === outcomeId);
    if (intentSeq !== undefined && appliedThrough >= Math.max(intentSeq, outcomeOnRecord?.seq ?? 0) && (plan.outcome === null || outcomeOnRecord)) {
      // a committed state already covers this act: nothing is written, performed or committed again
      return ok({ value: null, performed: false, version: first.value.version });
    }
    if (intentSeq === undefined) {
      const wrote = await this.record(unit, plan.intent);
      if (!wrote.ok) return wrote;
    }
    let value: T | null = null;
    let performed = false;
    const done = plan.outcome !== null && outcomeOnRecord !== undefined;
    if (!done) {
      const effect = await performSafely(plan);
      if (!effect.ok) return effect;
      value = effect.value;
      performed = true;
      if (plan.outcome !== null) {
        const wrote = await this.record(unit, { id: outcomeId, data: plan.outcome(effect.value) });
        if (!wrote.ok) return wrote;
      }
    }
    const reread = await this.readUnit(unit);
    if (!reread.ok) return reread;
    if (reread.value.corrupt !== undefined) return fail("invalid", `${unit} is corrupt: ${reread.value.corrupt}`);
    const next = plan.next(reread.value);
    if (next === null) return ok({ value, performed, version: null });
    const committed = await this.commit(unit, next.state, next.expectVersion);
    if (!committed.ok) return committed;
    return ok({ value, performed, version: committed.value.version });
  }
}

/** An effect is plugin code: a throw is read as a failure, so the act stops with its intent on the record. */
async function performSafely<T>(plan: ActPlan<T>): Promise<PluginResult<T>> {
  try {
    return await plan.perform();
  } catch (e) {
    return fail("unknown", `effect for ${plan.intent.id} threw: ${e instanceof Error ? e.message : String(e)}`);
  }
}
