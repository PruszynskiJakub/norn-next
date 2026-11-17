/**
 * Receipts and state of units, and the listing and archiving of them. Each receipt is its own file
 * and the state one file, each written atomically: a crash leaves the old record or the new.
 */
import {
  fail,
  type HostContext,
  isStoreId,
  isStoryUnit,
  type ListUnitsQuery,
  type NewReceipt,
  ok,
  type PluginResult,
  StoredReceipt,
  StoredState,
  type UnitRecord,
} from "@norn/plugin-api";
import { type Layout, isHidden, RECEIPT_FILE_RE, STATE_FILE, unitOfDir } from "./layout.ts";
import { type LockTuning, withLock } from "./lock.ts";
import { corrupt, readRecord, toJson } from "./records.ts";

interface ReceiptName {
  seq: number;
  id: string;
  name: string;
}

export interface Units {
  list(q: ListUnitsQuery): Promise<PluginResult<string[]>>;
  read(unit: string): Promise<PluginResult<UnitRecord>>;
  append(unit: string, r: NewReceipt): Promise<PluginResult<{ seq: number; replayed: boolean }>>;
  commit(unit: string, data: unknown, expectVersion: number | null): Promise<PluginResult<{ version: number }>>;
  archive(story: string): Promise<PluginResult<{ archived: string[] }>>;
}

export function units(ctx: HostContext, at: Layout, tuning: LockTuning): Units {
  /**
   * The receipt files of a unit by name, checked to be 1..n without gaps or a repeated id. A gap or a
   * stranger in the folder means something other than this store wrote there.
   */
  async function receiptNames(unit: string): Promise<PluginResult<ReceiptName[]>> {
    const dir = at.receipts(unit);
    const out: ReceiptName[] = [];
    for (const name of await ctx.files.list(dir)) {
      if (isHidden(name)) continue;
      const m = RECEIPT_FILE_RE.exec(name);
      if (!m || !isStoreId(m[2])) return corrupt(`${dir}/${name}`, "not a receipt file name");
      out.push({ seq: Number(m[1]), id: m[2] as string, name });
    }
    out.sort((a, b) => a.seq - b.seq);
    const ids = new Set<string>();
    for (const [i, r] of out.entries()) {
      if (r.seq !== i + 1) return corrupt(`${dir}/${r.name}`, `receipt seq ${r.seq} where ${i + 1} was due`);
      if (ids.has(r.id)) return corrupt(`${dir}/${r.name}`, `receipt id ${r.id} repeats`);
      ids.add(r.id);
    }
    return ok(out);
  }

  async function exists(unit: string): Promise<boolean> {
    if ((await ctx.files.list(at.unit(unit))).includes(STATE_FILE)) return true;
    return (await ctx.files.list(at.receipts(unit))).some((n) => !isHidden(n));
  }

  async function isArchived(story: string): Promise<boolean> {
    return (await ctx.files.read(at.archived(story))) !== null;
  }

  /** The units a story has anything written for, sorted. */
  async function storyUnits(story: string): Promise<string[]> {
    const out: string[] = [];
    for (const name of await ctx.files.list(at.units(story))) {
      const unit = unitOfDir(story, name);
      if (unit !== null && (await exists(unit))) out.push(unit);
    }
    return out.sort();
  }

  async function readState(unit: string): Promise<PluginResult<StoredState | null>> {
    return readRecord(ctx, at.state(unit), StoredState);
  }

  return {
    list: async (q) => {
      const stories = q.story !== undefined ? [q.story] : (await ctx.files.list(at.stories)).filter((n) => isStoryUnit(n));
      const out: string[] = [];
      for (const story of stories) {
        if ((await isArchived(story)) !== (q.archived === true)) continue;
        out.push(...(await storyUnits(story)));
      }
      return ok(out.sort());
    },

    read: async (unit) => {
      const state = await readState(unit);
      if (!state.ok) return state;
      const names = await receiptNames(unit);
      if (!names.ok) return names;
      const receipts: StoredReceipt[] = [];
      for (const n of names.value) {
        const path = `${at.receipts(unit)}/${n.name}`;
        const r = await readRecord(ctx, path, StoredReceipt);
        if (!r.ok) return r;
        // a file that vanished between the listing and the read was never removed by this store
        if (r.value === null) return corrupt(path, "listed but gone");
        if (r.value.seq !== n.seq || r.value.id !== n.id) return corrupt(path, `holds receipt ${r.value.seq}-${r.value.id}`);
        receipts.push(r.value);
      }
      return ok({ state: state.value, receipts });
    },

    append: (unit, r) =>
      withLock(ctx, `${at.receipts(unit)}.lock`, tuning, async (): Promise<PluginResult<{ seq: number; replayed: boolean }>> => {
        const names = await receiptNames(unit);
        if (!names.ok) return names;
        const known = names.value.find((n) => n.id === r.id);
        if (known) return ok({ seq: known.seq, replayed: true });
        const seq = names.value.length + 1;
        const text = toJson({ seq, id: r.id, at: ctx.now(), data: r.data } satisfies StoredReceipt) as string;
        await ctx.files.write(at.receipt(unit, seq, r.id), text);
        return ok({ seq, replayed: false });
      }),

    commit: (unit, data, expectVersion) =>
      withLock(ctx, `${at.state(unit)}.lock`, tuning, async () => {
        const cur = await readState(unit);
        if (!cur.ok) return cur;
        const version = cur.value?.version ?? null;
        if (version !== expectVersion) return conflict(`state of ${unit} is at version ${version}, not ${expectVersion}`);
        const next = (version ?? 0) + 1;
        await ctx.files.write(at.state(unit), toJson({ version: next, data } satisfies StoredState) as string);
        return ok({ version: next });
      }),

    archive: (story) =>
      withLock(ctx, `${at.archived(story)}.lock`, tuning, async () => {
        if (await isArchived(story)) return ok({ archived: [] });
        const moved = await storyUnits(story);
        if (moved.length > 0) await ctx.files.write(at.archived(story), JSON.stringify({ archived_at: ctx.now() }));
        return ok({ archived: moved });
      }),
  };
}

function conflict<T>(why: string): PluginResult<T> {
  return fail("conflict", `local store: ${why}`, false);
}
