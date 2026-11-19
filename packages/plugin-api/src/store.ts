/**
 * The store slot: where a unit's run data lives (a folder on this machine, git refs shared by a team,
 * ...). The store keeps the kernel's documents as opaque JSON inside its own validated envelopes and
 * provides the primitives the kernel's journal rules stand on: immutable numbered receipts, a state
 * written by compare-and-swap, claims, a mailbox and artifacts kept out of the repo.
 *
 * Every store honours one concurrency rule: two writers racing on the same unit, claim or mailbox never
 * both succeed against the same expected version, and a crash at any point leaves either the old or
 * the new record, never a mix. A store's clock is the host's `now()`, never its own.
 */
import { check, IsoTime, NonEmpty, NonNegInt, PosInt, SLICE_NN_PATTERN, type ValidationResult } from "@norn/schema";
import { type Static, type TSchema, Type } from "@sinclair/typebox";
import type { HostContext } from "./host.ts";
import type { PluginResult } from "./result.ts";
import { GenericStoryKey, parseStoryKey } from "./story-key.ts";

/**
 * Ids the store files things under (receipt ids, message ids). Kept to characters every backend can
 * put in a file name or a git tree path unescaped, so an id never needs encoding to be found again.
 */
export const STORE_ID_PATTERN = "^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$";
export const StoreId = Type.String({ pattern: STORE_ID_PATTERN, description: "A receipt or message id, e.g. a ULID" });

/** A unit: a story key (`gh-12`) or one of its slices (`gh-12/03`). */
export const UNIT_ID_PATTERN = "^[a-z][a-z0-9]{0,7}-[1-9][0-9]*(?:/[0-9]{2,3})?$";
export const UnitId = Type.String({ pattern: UNIT_ID_PATTERN, description: "Unit id <story> or <story>/<nn>, e.g. gh-12 or gh-12/03" });

export interface UnitRef {
  story: string;
  /** the slice number as written (`03`), or null for the story's own unit */
  slice: string | null;
}

const STORE_ID_RE = new RegExp(STORE_ID_PATTERN);
const NN_RE = new RegExp(SLICE_NN_PATTERN);

export function isStoreId(id: unknown): id is string {
  return typeof id === "string" && STORE_ID_RE.test(id);
}

/** `gh-12/03` → `{ story: "gh-12", slice: "03" }`; null for anything that is not a unit id. */
export function parseUnitId(unit: unknown): UnitRef | null {
  if (typeof unit !== "string") return null;
  const cut = unit.indexOf("/");
  const story = cut < 0 ? unit : unit.slice(0, cut);
  const slice = cut < 0 ? null : unit.slice(cut + 1);
  if (!parseStoryKey(story)) return null;
  if (slice !== null && !NN_RE.test(slice)) return null;
  return { story, slice };
}

export function isUnitId(unit: unknown): unit is string {
  return parseUnitId(unit) !== null;
}

/** Whether `story` names a story (never one of its slices): what claims, mailboxes and artifacts are kept by. */
export function isStoryUnit(story: unknown): story is string {
  return parseUnitId(story)?.slice === null;
}

/** The unit of one slice: `sliceUnitId("gh-12", 3)` → `gh-12/03`. */
export function sliceUnitId(story: string, nn: number | string): string {
  if (!parseStoryKey(story)) throw new RangeError(`not a story key: ${JSON.stringify(story)}`);
  const padded = String(nn).padStart(2, "0");
  if (!NN_RE.test(padded)) throw new RangeError(`bad slice number: ${nn}`);
  return `${story}/${padded}`;
}

/**
 * An artifact path made canonical (`specs/./a.md` and `specs//a.md` are both `specs/a.md`), or null
 * when it may not name an artifact: empty, absolute, naming a folder, holding a backslash or a NUL, or
 * with any `..` segment. Refusing `..` outright rather than resolving it means no spelling of a path
 * can reach outside the story's artifacts, whatever the backend does with the result.
 */
export function normalizeArtifactPath(path: unknown): string | null {
  if (typeof path !== "string" || path === "" || path.startsWith("/") || path.endsWith("/")) return null;
  if (path.includes("\\") || path.includes("\0")) return null;
  const parts = path.split("/").filter((p) => p !== "" && p !== ".");
  if (parts.length === 0 || parts.includes("..")) return null;
  return parts.join("/");
}

/**
 * The existing artifact that `path` would turn into a folder or a file of its own name, or null when
 * there is none. A name may be a file or a folder, never both: a git tree holding both is one `git
 * fsck` refuses, so a shared store could never publish it, and every store answers the same way.
 * Both paths must already be normalized.
 */
export function artifactPathClash(existing: Iterable<string>, path: string): string | null {
  const under = `${path}/`;
  for (const other of existing) {
    if (other === path) continue;
    if (other.startsWith(under) || path.startsWith(`${other}/`)) return other;
  }
  return null;
}

/** One receipt as the store keeps it; `seq` is assigned by the store, 1..n without gaps per unit. */
export const StoredReceipt = Type.Object(
  {
    seq: PosInt,
    id: StoreId,
    /** when the store took it, from the host's clock */
    at: IsoTime,
    data: Type.Unknown(),
  },
  { additionalProperties: false, title: "StoredReceipt" },
);
export type StoredReceipt = Static<typeof StoredReceipt>;

/** A unit's state; `version` counts commits from 1, and only `commitState` moves it. */
export const StoredState = Type.Object({ version: PosInt, data: Type.Unknown() }, { additionalProperties: false, title: "StoredState" });
export type StoredState = Static<typeof StoredState>;

/** Who holds a story's claim, and until when. `version` moves on every change, so a reader can compare-and-swap. */
export const ClaimRecord = Type.Object(
  {
    story: GenericStoryKey,
    holder: NonEmpty,
    acquired_at: IsoTime,
    expires_at: IsoTime,
    version: PosInt,
  },
  { additionalProperties: false, title: "ClaimRecord" },
);
export type ClaimRecord = Static<typeof ClaimRecord>;

/** A message as a story's mailbox keeps it; `at` is when the store took it. */
export const StoredMessage = Type.Object(
  { id: StoreId, from: NonEmpty, at: IsoTime, data: Type.Unknown() },
  { additionalProperties: false, title: "StoredMessage" },
);
export type StoredMessage = Static<typeof StoredMessage>;

/** What `readUnit` answers; a unit nothing was written to reads as no state and no receipts. */
export const UnitRecord = Type.Object(
  { state: Type.Union([StoredState, Type.Null()]), receipts: Type.Array(StoredReceipt) },
  { additionalProperties: false, title: "UnitRecord" },
);
export type UnitRecord = Static<typeof UnitRecord>;

export const SyncOutcome = Type.Object({ fetched: NonNegInt }, { additionalProperties: false });
export type SyncOutcome = Static<typeof SyncOutcome>;

export interface StoreCapabilities {
  /** what one machine writes, others see (after `sync`) */
  shared: boolean;
  /** `distributed` claims are decided by a remote every machine pushes to; `local` ones by this machine alone */
  claims: "local" | "distributed";
  /** the store offers `mailbox` */
  mailbox: boolean;
  /** the store offers `artifacts` */
  artifacts: boolean;
  /** `claims.takeOver` is offered (plugin API 1.8): a person can move a story's claim from another holder to this machine */
  takeover?: boolean;
}

export interface ListUnitsQuery {
  /** only this story's units: its own and its slices' */
  story?: string;
  /** true lists archived units only; otherwise only units not archived */
  archived?: boolean;
}

export interface NewReceipt {
  id: string;
  data: unknown;
}

/**
 * A story's claim. Every call names a story key (never a slice); a malformed one is `invalid`. Time
 * comes from the host's `now()`: a claim is expired once `now() >= expires_at`.
 */
export interface StoreClaims {
  /** the claim as stored, expired or not, or null when nobody holds one */
  read(story: string): Promise<PluginResult<ClaimRecord | null>>;
  /**
   * Take the claim for `ttlMs` from now. It succeeds when no claim is held, the claim has expired, or
   * `holder` already holds it (which extends it and keeps `acquired_at`); otherwise `conflict`. With
   * `expectVersion` the claim must also be at that version (null: no claim held), else `conflict`.
   */
  acquire(story: string, holder: string, ttlMs: number, expectVersion?: number | null): Promise<PluginResult<ClaimRecord>>;
  /** Extend the claim `holder` holds to `ttlMs` from now; `conflict` when another holds it, `not_found` when none is held. */
  renew(story: string, holder: string, ttlMs: number): Promise<PluginResult<ClaimRecord>>;
  /** Give the claim up; `conflict` when another holds it, and releasing a claim nobody holds is not an error. */
  release(story: string, holder: string): Promise<PluginResult<null>>;
  /**
   * A person's takeover: give the claim to `holder` for `ttlMs` from now whoever holds it and whether
   * or not it expired, as long as it is still at `expectVersion` (null: no claim held); otherwise
   * `conflict`. `acquired_at` is now unless `holder` already held a live claim. Offered exactly when
   * `capabilities.takeover` is true.
   */
  takeOver?(story: string, holder: string, ttlMs: number, expectVersion: number | null): Promise<PluginResult<ClaimRecord>>;
}

export interface NewMessage {
  id: string;
  from: string;
  data: unknown;
}

/** Messages to a story's runs, delivered until acknowledged. */
export interface StoreMailbox {
  /** idempotent by id: a message sent (or acknowledged) before is not sent again, and answers replayed */
  send(story: string, m: NewMessage): Promise<PluginResult<{ replayed: boolean }>>;
  /** the messages not yet acknowledged, in the order they were sent */
  receive(story: string): Promise<PluginResult<StoredMessage[]>>;
  /** acknowledge messages so `receive` stops returning them; unknown ids are ignored */
  ack(story: string, ids: string[]): Promise<PluginResult<null>>;
}

/**
 * Text files kept with a story's run data rather than in the repo (specs, handoffs). Every path goes
 * through `normalizeArtifactPath`; one it refuses is `invalid`. A write whose path would make a name
 * both a file and a folder (`a` beside `a/b`) is a `conflict` and writes nothing (`artifactPathClash`).
 */
export interface StoreArtifacts {
  /** the text, or null when there is none */
  read(story: string, path: string): Promise<PluginResult<string | null>>;
  write(story: string, path: string, text: string): Promise<PluginResult<null>>;
  /** every artifact's normalized path, sorted */
  list(story: string): Promise<PluginResult<string[]>>;
  /** removing a missing artifact is not an error */
  remove(story: string, path: string): Promise<PluginResult<null>>;
}

/**
 * The lowest norn version that may act on the store's data (plugin API 1.13). Each norn raises it to
 * its own version as it acts, so a record shape an older norn would read as corrupt never reaches
 * one: that norn finds the floor above itself and refuses to act. The floor only ever rises, and two
 * racing raises leave the higher of the two.
 */
export interface StoreFloor {
  /** the floor as `X.Y.Z`, or null while no norn has recorded one */
  read(): Promise<PluginResult<string | null>>;
  /** raise the floor to `version` unless it already stands there or higher; answers the floor after. A version not `X.Y.Z` is `invalid`. */
  raise(version: string): Promise<PluginResult<{ floor: string }>>;
}

export interface Store {
  readonly name: string;
  readonly capabilities: StoreCapabilities;
  /** unit ids, sorted */
  listUnits(q?: ListUnitsQuery): Promise<PluginResult<string[]>>;
  /** The state and every receipt, ascending by seq. An archived unit still reads. */
  readUnit(unit: string): Promise<PluginResult<UnitRecord>>;
  /**
   * Add a receipt as seq n+1. Receipts are immutable and idempotent by id within the unit: the same
   * id again answers the original seq with `replayed` true and writes nothing, whatever its data.
   */
  appendReceipt(unit: string, r: NewReceipt): Promise<PluginResult<{ seq: number; replayed: boolean }>>;
  /**
   * Replace the unit's state by compare-and-swap: `expectVersion` null means no state may exist yet,
   * otherwise it must be the current version. A mismatch is `conflict` and writes nothing.
   */
  commitState(unit: string, data: unknown, expectVersion: number | null): Promise<PluginResult<{ version: number }>>;
  claims: StoreClaims;
  mailbox?: StoreMailbox;
  artifacts?: StoreArtifacts;
  /** the norn version floor; a store without one lets any norn act on its data */
  floor?: StoreFloor;
  /**
   * Move every unit of the story out of the default `listUnits`; the units still read, and list with
   * `archived: true`. Answers the units it moved, so archiving again moves none. The kernel archives
   * only a story nothing writes to any more.
   */
  archive(story: string): Promise<PluginResult<{ archived: string[] }>>;
  /** shared stores: fetch other machines' writes */
  sync?(): Promise<PluginResult<SyncOutcome>>;
  /**
   * shared stores: publish the story's run data, refused as `conflict` when the remote moved since it
   * was last fetched; `pushed` is false when the remote already had everything
   */
  flush?(story: string): Promise<PluginResult<{ pushed: boolean }>>;
  /**
   * shared stores: whether this clone's run data of the story and the remote's as last synced each
   * hold writes the other lacks, so flush can publish neither over the other. Reads this clone only.
   * Optional (plugin API 1.16); without it a host cannot tell a diverged story from a flush that
   * failed for a moment.
   */
  diverged?(story: string): Promise<PluginResult<boolean>>;
  /**
   * shared stores: when the story's run data diverged, replace this clone's with the remote's as last
   * synced, keeping what it drops where a person can still read it (`kept_at`); `dropped` is null when
   * nothing diverged and nothing changed. Optional (plugin API 1.16); the host calls it only for a
   * story whose claim this clone holds, once a person said to carry the story on from the remote's record.
   */
  adoptRemote?(story: string): Promise<PluginResult<{ dropped: string | null; kept_at?: string }>>;
}

/** How a plugin offers a store; the host validates the config against `configSchema` before `create`. */
export interface StoreFactory<S extends TSchema = TSchema> {
  configSchema: S;
  create(ctx: HostContext, config: Static<S>): Store;
}

export function validateStoredReceipt(value: unknown): ValidationResult<StoredReceipt> {
  return check(StoredReceipt, value);
}

export function validateStoredState(value: unknown): ValidationResult<StoredState> {
  return check(StoredState, value);
}

export function validateClaimRecord(value: unknown): ValidationResult<ClaimRecord> {
  return check(ClaimRecord, value);
}

export function validateStoredMessage(value: unknown): ValidationResult<StoredMessage> {
  return check(StoredMessage, value);
}

export function validateUnitRecord(value: unknown): ValidationResult<UnitRecord> {
  return check(UnitRecord, value);
}
