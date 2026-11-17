/**
 * The tracker slot: where stories come from (GitHub issues, a local folder, ...). A TRACKER IS NEVER
 * A STATE STORE. It reports facts about items and performs effects on them; norn's own run state
 * lives with norn. Labels and comments are display for people: nothing norn decides may be read back
 * from them, because a half-applied label change once left an item with two state labels and no way
 * to tell which one was true.
 */
import { check, IsoTime, NonEmpty, PosInt, TaggedUnion, type ValidationResult } from "@norn/schema";
import { type Static, type TSchema, Type } from "@sinclair/typebox";
import type { HostContext } from "./host.ts";
import type { PluginResult } from "./result.ts";
import { GenericStoryKey } from "./story-key.ts";

/** One story as the tracker holds it. The kernel validates every item a plugin returns against this. */
export const TrackerItem = Type.Object(
  {
    id: PosInt,
    /** `<keyPrefix>-<id>` of the tracker that returned it */
    key: GenericStoryKey,
    title: Type.String(),
    body: Type.String(),
    open: Type.Boolean(),
    assignees: Type.Array(NonEmpty),
    labels: Type.Array(NonEmpty),
    url: Type.Optional(Type.String()),
    updated_at: IsoTime,
  },
  { additionalProperties: false, title: "TrackerItem" },
);
export type TrackerItem = Static<typeof TrackerItem>;

/** A label as a tracker defines it: colour as six hex digits without `#`. */
export const TrackerLabel = Type.Object(
  { name: NonEmpty, color: Type.String({ pattern: "^[0-9a-fA-F]{6}$" }), description: Type.String() },
  { additionalProperties: false },
);
export type TrackerLabel = Static<typeof TrackerLabel>;

function effect<K extends string, P extends Record<string, TSchema>>(kind: K, props: P) {
  return Type.Object({ kind: Type.Literal(kind), ...props }, { additionalProperties: false });
}

const TRACKER_EFFECTS = [
  effect("assign", { id: PosInt, user: NonEmpty }),
  effect("comment", { id: PosInt, body: Type.String() }),
  effect("create", { title: NonEmpty, body: Type.String(), labels: Type.Array(NonEmpty), assignee: Type.Optional(NonEmpty) }),
  effect("close", { id: PosInt }),
  effect("labels", { id: PosInt, add: Type.Array(NonEmpty), remove: Type.Array(NonEmpty) }),
  effect("ensure_labels", { labels: Type.Array(TrackerLabel) }),
];

/**
 * A change norn asks a tracker to make. Every one is idempotent by its receipt id: performing it
 * again under the same id changes nothing more and answers as the first time did. `create` and
 * `comment` cannot be made idempotent by their content alone, so the tracker stores the receipt id
 * with what it made (a hidden marker in an issue body, a field in a local file) and finds it there.
 */
export const TrackerEffect = TaggedUnion("kind", TRACKER_EFFECTS, { title: "TrackerEffect" });
export type TrackerEffect = Static<typeof TrackerEffect>;
export type TrackerEffectKind = TrackerEffect["kind"];
export const TRACKER_EFFECT_KINDS = TRACKER_EFFECTS.map((v) => v.properties.kind.const) as TrackerEffectKind[];

export const TrackerEffectOutcome = Type.Object(
  {
    kind: Type.Union(TRACKER_EFFECTS.map((v) => v.properties.kind)),
    /** the item the effect made or changed; always set for `create`, absent for `ensure_labels` */
    id: Type.Optional(PosInt),
    key: Type.Optional(GenericStoryKey),
    url: Type.Optional(Type.String()),
    /** the receipt id had been performed before, so this answer is the first one found again */
    replayed: Type.Boolean(),
  },
  { additionalProperties: false, title: "TrackerEffectOutcome" },
);
export type TrackerEffectOutcome = Static<typeof TrackerEffectOutcome>;

/** What the tracker can do; the kernel never asks for an effect whose capability is false. */
export interface TrackerCapabilities {
  assign: boolean;
  labels: boolean;
  comment: boolean;
  create: boolean;
  close: boolean;
}

export interface IntakeQuery {
  label: string;
  /** `me` is whoever `whoami` names; null takes items whoever they are assigned to, nobody included */
  assignee: "me" | string | null;
}

export interface EffectMeta {
  /** the receipt the host wrote before asking; the idempotence key */
  receipt_id: string;
}

export interface Tracker {
  readonly name: string;
  /** the prefix of every key this tracker mints, matching `KEY_PREFIX_PATTERN` */
  readonly keyPrefix: string;
  readonly capabilities: TrackerCapabilities;
  whoami(): Promise<PluginResult<string>>;
  /** open items with the label (and the assignee, when given); never a closed one */
  intake(q: IntakeQuery): Promise<PluginResult<TrackerItem[]>>;
  /** the item open or closed; null when there is none with that id */
  get(id: number): Promise<PluginResult<TrackerItem | null>>;
  /** perform one effect; a failure changes nothing the tracker can avoid changing */
  perform(effect: TrackerEffect, meta: EffectMeta): Promise<PluginResult<TrackerEffectOutcome>>;
}

/**
 * How a plugin offers a tracker. The host validates the config against `configSchema` before
 * `create`, so a factory never sees a config it did not declare.
 */
export interface TrackerFactory<S extends TSchema = TSchema> {
  configSchema: S;
  create(ctx: HostContext, config: Static<S>): Tracker;
}

export function validateTrackerItem(value: unknown): ValidationResult<TrackerItem> {
  return check(TrackerItem, value);
}

export function validateTrackerEffect(value: unknown): ValidationResult<TrackerEffect> {
  return check(TrackerEffect, value);
}

export function validateTrackerEffectOutcome(value: unknown): ValidationResult<TrackerEffectOutcome> {
  return check(TrackerEffectOutcome, value);
}
