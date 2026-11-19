/**
 * The files store "local" writes, each validated on every read. A file that fails is reported as
 * `invalid` naming its path, never read past: the kernel marks the unit corrupt rather than act on a
 * guess.
 */
import { ClaimRecord, fail, type HostContext, ok, type PluginResult, parseJson, StoreId, StoredMessage } from "@norn/plugin-api";
import { IsoTime, NonNegInt, VERSION_PATTERN } from "@norn/schema";
import { type Static, type TSchema, Type } from "@sinclair/typebox";

/**
 * A story's claim file. The version outlives a release (`claim: null`), so a claim taken again after
 * a release never repeats a version a stale reader still holds.
 */
export const ClaimFile = Type.Object(
  { version: NonNegInt, claim: Type.Union([ClaimRecord, Type.Null()]) },
  { additionalProperties: false, title: "LocalClaimFile" },
);
export type ClaimFile = Static<typeof ClaimFile>;

/** A story's mailbox file: pending messages in send order, and every id acknowledged, so a resend after ack stays a replay. */
export const MailboxFile = Type.Object(
  { messages: Type.Array(StoredMessage), acked: Type.Array(StoreId) },
  { additionalProperties: false, title: "LocalMailboxFile" },
);
export type MailboxFile = Static<typeof MailboxFile>;

/** The lowest norn version that may act on this store's data. */
export const FloorFile = Type.Object({ version: Type.String({ pattern: VERSION_PATTERN }) }, { additionalProperties: false, title: "LocalFloorFile" });
export type FloorFile = Static<typeof FloorFile>;

export const ArchivedMarker = Type.Object({ archived_at: IsoTime }, { additionalProperties: false, title: "LocalArchivedMarker" });

export function corrupt<T>(path: string, why: string): PluginResult<T> {
  return fail("invalid", `local store: corrupt record ${path}: ${why}`, false);
}

/** The record at `path` validated against `schema`, or null when there is none. IO rejections propagate to the caller's guard. */
export async function readRecord<S extends TSchema>(ctx: HostContext, path: string, schema: S): Promise<PluginResult<Static<S> | null>> {
  const text = await ctx.files.read(path);
  if (text === null) return ok(null);
  const r = parseJson(schema, text, `local store: corrupt record ${path}`);
  return r.ok ? ok(r.value) : r;
}

/** The JSON text of a record, or null when `data` inside it is not JSON (a BigInt, a cycle, undefined). */
export function toJson(record: unknown): string | null {
  try {
    return JSON.stringify(record) ?? null;
  } catch {
    return null;
  }
}

/** Whether `data` can be kept as JSON at all; checked before any write so a refusal changes nothing. */
export const isJson = (data: unknown): boolean => data !== undefined && toJson(data) !== null;
