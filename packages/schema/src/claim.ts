import { type Static, Type } from "@sinclair/typebox";
import { IsoTime, NonEmpty, NonNegInt, PosInt, ProcessIdentity, SliceKey, StoryKey, Ulid } from "./common.ts";

/** Blob behind `refs/norn/claims/<story>` (T2). */
export const ClaimBlob = Type.Object(
  {
    version: Type.Literal(1),
    story: StoryKey,
    /** `user@machine` */
    holder: Type.String({ pattern: "^[^@\\s]+@[^@\\s]+$" }),
    heartbeat_id: Ulid,
    acquired_at: IsoTime,
    renewed_at: IsoTime,
    expires_at: IsoTime,
    last_tick_id: Type.Union([Ulid, Type.Null()]),
    /** set when taken with `--force` before expiry (T5) */
    forced_from: Type.Optional(Type.String()),
  },
  { $id: "https://norn.dev/schema/claim.json", title: "norn claim blob", additionalProperties: false },
);
export type ClaimBlob = Static<typeof ClaimBlob>;

export const LeaseKind = Type.Union([Type.Literal("agent"), Type.Literal("check"), Type.Literal("slot")]);
export type LeaseKind = Static<typeof LeaseKind>;

/**
 * Machine-wide lease file in `~/.norn/leases/` (K3), created with O_EXCL.
 * Agent/check leases count against max_agents/max_checks; slot leases reserve
 * a port slot for a worktree. Dead holders are reclaimed by pid + start time.
 */
export const LeaseFile = Type.Object(
  {
    version: Type.Literal(1),
    kind: LeaseKind,
    /** slot number (slot leases; also recorded on agent leases for convenience) */
    slot: Type.Optional(NonNegInt),
    repo: NonEmpty,
    story: StoryKey,
    slice: Type.Union([SliceKey, Type.Null()]),
    run_id: Type.Union([Ulid, Type.Null()]),
    holder: ProcessIdentity,
    created_at: IsoTime,
    worktree: Type.Optional(NonEmpty),
    port_base: Type.Optional(PosInt),
  },
  { $id: "https://norn.dev/schema/lease.json", title: "norn machine lease", additionalProperties: false },
);
export type LeaseFile = Static<typeof LeaseFile>;
