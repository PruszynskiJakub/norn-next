/**
 * The refs store's own records, beside the envelopes plugin-api defines. A released claim stays on
 * its ref as a tombstone carrying the version, so a claim taken after a release never reuses a
 * version a reader may still be holding to compare against.
 */
import { ClaimRecord, GenericStoryKey } from "@norn/plugin-api";
import { IsoTime, PosInt, VERSION_PATTERN } from "@norn/schema";
import { type Static, Type } from "@sinclair/typebox";

export const ReleasedClaim = Type.Object(
  { story: GenericStoryKey, version: PosInt, released_at: IsoTime },
  { additionalProperties: false, title: "ReleasedClaim" },
);
export type ReleasedClaim = Static<typeof ReleasedClaim>;

export const ClaimFile = Type.Union([ClaimRecord, ReleasedClaim], { title: "ClaimFile" });
export type ClaimFile = Static<typeof ClaimFile>;

export const ArchivedMarker = Type.Object({ archived_at: IsoTime }, { additionalProperties: false, title: "ArchivedMarker" });
export type ArchivedMarker = Static<typeof ArchivedMarker>;

/** The lowest norn version that may act on the store's data. */
export const FloorFile = Type.Object({ version: Type.String({ pattern: VERSION_PATTERN }) }, { additionalProperties: false, title: "FloorFile" });
export type FloorFile = Static<typeof FloorFile>;
