/**
 * A story's units on its run ref in this clone: receipts filed by seq, a state moved by
 * compare-and-swap, and the archive marker. The ref moves by `git update-ref <ref> <new> <old>`,
 * so two writers in this clone never both land against one old commit; flush publishes it.
 */
import {
  isStoreId,
  isStoryUnit,
  type ListUnitsQuery,
  type NewReceipt,
  ok,
  parseJson,
  parseUnitId,
  type PluginResult,
  StoredReceipt,
  StoredState,
  type UnitRecord,
} from "@norn/plugin-api";
import { localCell, mutate, read } from "./cell.ts";
import { conflict, corrupt, invalid, type RefsContext, toJson } from "./context.ts";
import { listRefs, readBlobs } from "./git.ts";
import { ARCHIVED_FILE, RUNS_PREFIX, receiptsDir, runRef, type SeqFile, seqFiles, seqName, statePath, unitsIn } from "./layout.ts";
import { loadSnapshot, type Snapshot } from "./tree.ts";

/** The unit's receipt files, checked gapless from 1; a gap or a misnamed file is corruption. */
function receiptFiles(snap: Snapshot, unit: string): PluginResult<SeqFile[]> {
  const files = seqFiles(snap, receiptsDir(unit));
  if (files === null) return corrupt(`${unit}: a receipt file is misnamed`);
  for (const [i, f] of files.entries()) if (f.seq !== i + 1) return corrupt(`${unit}: receipt seq ${f.seq} where ${i + 1} belongs`);
  return ok(files);
}

async function readState(rc: RefsContext, snap: Snapshot, unit: string): Promise<PluginResult<StoredState | null>> {
  const sha = snap.files.get(statePath(unit));
  if (sha === undefined) return ok(null);
  const texts = await readBlobs(rc.git, [sha]);
  if (!texts.ok) return texts;
  return parseJson(StoredState, texts.value.get(sha) as string, `${unit} state`);
}

export async function listUnits(rc: RefsContext, q: ListUnitsQuery = {}): Promise<PluginResult<string[]>> {
  if (q.story !== undefined && !isStoryUnit(q.story)) return invalid(`not a story: ${JSON.stringify(q.story)}`);
  const refs = await listRefs(rc.git, q.story === undefined ? RUNS_PREFIX : runRef(q.story));
  if (!refs.ok) return refs;
  const units: string[] = [];
  for (const [name, head] of refs.value) {
    const story = name.slice(RUNS_PREFIX.length);
    if (!isStoryUnit(story) || (q.story !== undefined && story !== q.story)) continue;
    const snap = await loadSnapshot(rc.git, head);
    if (!snap.ok) return snap;
    if (snap.value.files.has(ARCHIVED_FILE) === (q.archived === true)) units.push(...unitsIn(snap.value, story));
  }
  return ok(units.sort());
}

export async function readUnit(rc: RefsContext, unit: string): Promise<PluginResult<UnitRecord>> {
  const ref = parseUnitId(unit);
  if (!ref) return invalid(`not a unit: ${JSON.stringify(unit)}`);
  const snap = await read(rc.git, localCell(rc.git, runRef(ref.story)));
  if (!snap.ok) return snap;
  const files = receiptFiles(snap.value, unit);
  if (!files.ok) return files;
  const state = await readState(rc, snap.value, unit);
  if (!state.ok) return state;
  const texts = await readBlobs(rc.git, files.value.map((f) => f.sha));
  if (!texts.ok) return texts;
  const receipts: StoredReceipt[] = [];
  for (const f of files.value) {
    const r = parseJson(StoredReceipt, texts.value.get(f.sha) as string, `${unit} receipt ${f.seq}`);
    if (!r.ok) return r;
    if (r.value.seq !== f.seq || r.value.id !== f.id) return corrupt(`${unit}: receipt filed as ${f.seq}-${f.id} holds ${r.value.seq}-${r.value.id}`);
    receipts.push(r.value);
  }
  return ok({ state: state.value, receipts });
}

export async function appendReceipt(rc: RefsContext, unit: string, r: NewReceipt): Promise<PluginResult<{ seq: number; replayed: boolean }>> {
  const ref = parseUnitId(unit);
  if (!ref) return invalid(`not a unit: ${JSON.stringify(unit)}`);
  if (!isStoreId(r.id)) return invalid(`not a receipt id: ${JSON.stringify(r.id)}`);
  const json = toJson(r.data);
  if (json === null) return invalid("receipt data is not JSON");
  return mutate<{ seq: number; replayed: boolean }>(rc, localCell(rc.git, runRef(ref.story)), async (snap) => {
    const files = receiptFiles(snap, unit);
    if (!files.ok) return files;
    const known = files.value.find((f) => f.id === r.id);
    if (known) return ok({ result: { seq: known.seq, replayed: true } });
    const seq = files.value.length + 1;
    const text = `{"seq":${seq},"id":${JSON.stringify(r.id)},"at":${JSON.stringify(rc.now())},"data":${json}}`;
    return ok({ result: { seq, replayed: false }, writes: new Map([[`${receiptsDir(unit)}/${seqName(seq, r.id)}`, text]]) });
  });
}

export async function commitState(rc: RefsContext, unit: string, data: unknown, expectVersion: number | null): Promise<PluginResult<{ version: number }>> {
  const ref = parseUnitId(unit);
  if (!ref) return invalid(`not a unit: ${JSON.stringify(unit)}`);
  const json = toJson(data);
  if (json === null) return invalid("state data is not JSON");
  return mutate(rc, localCell(rc.git, runRef(ref.story)), async (snap) => {
    const state = await readState(rc, snap, unit);
    if (!state.ok) return state;
    const current = state.value?.version ?? null;
    if (current !== expectVersion) return conflict(`${unit} state is at version ${current}, not ${expectVersion}`);
    const version = (current ?? 0) + 1;
    return ok({ result: { version }, writes: new Map([[statePath(unit), `{"version":${version},"data":${json}}`]]) });
  });
}

export async function archive(rc: RefsContext, story: string): Promise<PluginResult<{ archived: string[] }>> {
  if (!isStoryUnit(story)) return invalid(`not a story: ${JSON.stringify(story)}`);
  return mutate(rc, localCell(rc.git, runRef(story)), async (snap) => {
    const units = unitsIn(snap, story);
    if (units.length === 0 || snap.files.has(ARCHIVED_FILE)) return ok({ result: { archived: [] } });
    return ok({ result: { archived: units }, writes: new Map([[ARCHIVED_FILE, JSON.stringify({ archived_at: rc.now() })]]) });
  });
}
