/**
 * The local change record: one JSON file per change under the repo's machine folder. It is the
 * forge's own memory of what was opened, never norn's record of a step; whether a change merged is
 * read from git every time and only remembered here once seen, so the moment it was first seen stays put.
 */
import { fail, type HostContext, ok, parseJson, type PluginResult } from "@norn/plugin-api";
import { IsoTime, NonEmpty, PosInt } from "@norn/schema";
import { type Static, Type } from "@sinclair/typebox";

const Sha = Type.String({ pattern: "^[0-9a-f]{40}([0-9a-f]{24})?$" });

export const ChangeRecord = Type.Object(
  {
    id: PosInt,
    head_branch: NonEmpty,
    base_branch: NonEmpty,
    title: NonEmpty,
    body: Type.String(),
    draft: Type.Boolean(),
    opened_at: IsoTime,
    /** every receipt id performed on this change, the opening one first: the idempotence key */
    receipts: Type.Array(NonEmpty, { minItems: 1 }),
    /** the base's tip when the change was opened: a head already inside it has nothing to merge */
    base_sha_at_open: Sha,
    /** the head's commit at open, and at merge once merged; used when the head branch is gone */
    head_sha: Sha,
    /** a person closed the change unmerged (by editing this file; there is no close effect) */
    closed_at: Type.Optional(IsoTime),
    merged_at: Type.Optional(IsoTime),
    merge_sha: Type.Optional(Sha),
  },
  { additionalProperties: false, title: "LocalChangeRecord" },
);
export type ChangeRecord = Static<typeof ChangeRecord>;

const NAME_RE = /^([1-9][0-9]*)\.json$/;

export function changesDir(ctx: HostContext): string {
  return `${ctx.repo.dataDir}/changes`;
}

export function recordPath(ctx: HostContext, id: number): string {
  return `${changesDir(ctx)}/${id}.json`;
}

export function encode(r: ChangeRecord): string {
  return `${JSON.stringify(r, null, 2)}\n`;
}

/** Turn a rejected host file call into a failure, since a provider call never throws. */
export async function io<T>(what: string, run: () => Promise<T>): Promise<PluginResult<T>> {
  try {
    return ok(await run());
  } catch (e) {
    return fail("unavailable", `${what}: ${e instanceof Error ? e.message : String(e)}`);
  }
}

export async function readRecord(ctx: HostContext, id: number): Promise<PluginResult<ChangeRecord | null>> {
  const path = recordPath(ctx, id);
  const text = await io(`read ${path}`, () => ctx.files.read(path));
  if (!text.ok || text.value === null) return text as PluginResult<null>;
  const r = parseJson(ChangeRecord, text.value, path);
  if (!r.ok) return r;
  // a record whose id disagrees with its file name is corrupt: answering with either would be a guess
  if (r.value.id !== id) return fail("invalid", `${path}: holds change ${r.value.id}`, false);
  return r;
}

/** Every change record, oldest (lowest id) first; one unreadable record fails the whole read. */
export async function readAll(ctx: HostContext): Promise<PluginResult<ChangeRecord[]>> {
  const names = await io(`list ${changesDir(ctx)}`, () => ctx.files.list(changesDir(ctx)));
  if (!names.ok) return names;
  const ids = names.value.flatMap((n) => {
    const m = NAME_RE.exec(n);
    return m ? [Number(m[1])] : [];
  });
  ids.sort((a, b) => a - b);
  const out: ChangeRecord[] = [];
  for (const id of ids) {
    const r = await readRecord(ctx, id);
    if (!r.ok) return r;
    if (r.value) out.push(r.value);
  }
  return ok(out);
}
