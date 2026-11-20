/**
 * The forge slot: where a story's change is reviewed and merged (GitHub pull requests, nothing at
 * all, ...). A FORGE IS NEVER A STATE STORE. It reports what a change request is and performs effects
 * on it; whether a step finished is norn's own record, never read back from a title or a label.
 */
import { check, FailedCheck, IsoTime, NonEmpty, PosInt, TaggedUnion, type ValidationResult } from "@norn/schema";
import { type Static, type TSchema, Type } from "@sinclair/typebox";
import type { HostContext } from "./host.ts";
import type { PluginResult } from "./result.ts";
import type { EffectMeta } from "./tracker.ts";

export const ChangeRequestState = Type.Union([Type.Literal("open"), Type.Literal("closed"), Type.Literal("merged")]);
export type ChangeRequestState = Static<typeof ChangeRequestState>;

export const ChangeRequest = Type.Object(
  {
    id: PosInt,
    url: Type.Optional(Type.String()),
    state: ChangeRequestState,
    draft: Type.Boolean(),
    head_branch: NonEmpty,
    base_branch: NonEmpty,
    head_sha: Type.String(),
    /** the commit the merge made on the base; set only once `state` is `merged` */
    merge_sha: Type.Optional(Type.String()),
    merged_at: Type.Optional(IsoTime),
    title: Type.String(),
  },
  { additionalProperties: false, title: "ChangeRequest" },
);
export type ChangeRequest = Static<typeof ChangeRequest>;

export const ChecksSummary = Type.Union([Type.Literal("pending"), Type.Literal("success"), Type.Literal("failure"), Type.Literal("none")]);
export type ChecksSummary = Static<typeof ChecksSummary>;

function effect<K extends string, P extends Record<string, TSchema>>(kind: K, props: P) {
  return Type.Object({ kind: Type.Literal(kind), ...props }, { additionalProperties: false });
}

const FORGE_EFFECTS = [
  effect("open", { head: NonEmpty, base: NonEmpty, title: NonEmpty, body: Type.String(), draft: Type.Boolean() }),
  effect("update", { id: PosInt, title: Type.Optional(NonEmpty), body: Type.Optional(Type.String()) }),
  effect("ready", { id: PosInt }),
];

/**
 * A change norn asks a forge to make, idempotent by its receipt id like a tracker effect: `open`
 * under a receipt id already performed answers with the change it opened then, never a second one.
 */
export const ForgeEffect = TaggedUnion("kind", FORGE_EFFECTS, { title: "ForgeEffect" });
export type ForgeEffect = Static<typeof ForgeEffect>;
export type ForgeEffectKind = ForgeEffect["kind"];
export const FORGE_EFFECT_KINDS = FORGE_EFFECTS.map((v) => v.properties.kind.const) as ForgeEffectKind[];

export const ForgeEffectOutcome = Type.Object(
  {
    kind: Type.Union(FORGE_EFFECTS.map((v) => v.properties.kind)),
    /** the change request as it stands after the effect */
    change: ChangeRequest,
    replayed: Type.Boolean(),
  },
  { additionalProperties: false, title: "ForgeEffectOutcome" },
);
export type ForgeEffectOutcome = Static<typeof ForgeEffectOutcome>;

export interface ForgeCapabilities {
  /** change requests can be opened as drafts and marked ready */
  draft: boolean;
  /** the forge reports checks run on a change's head */
  checks: boolean;
  /** the forge serves a commit's files at a URL */
  raw_urls: boolean;
}

export interface Forge {
  readonly name: string;
  readonly capabilities: ForgeCapabilities;
  /** every branch asked about, mapped to its newest change request (any state) or null */
  findChanges(branches: string[]): Promise<PluginResult<Record<string, ChangeRequest | null>>>;
  checks(id: number): Promise<PluginResult<ChecksSummary>>;
  /**
   * The checks that failed (or were cancelled) on change `id`'s head, each with its link and, where the
   * forge has them, the file and line it failed at. Asked only after `checks` answered `failure`, so a
   * pending or passing change costs no call. Optional (plugin API 1.19): a forge without it hands the agent no detail.
   */
  failures?(id: number): Promise<PluginResult<FailedCheck[]>>;
  perform(effect: ForgeEffect, meta: EffectMeta): Promise<PluginResult<ForgeEffectOutcome>>;
}

export interface ForgeFactory<S extends TSchema = TSchema> {
  configSchema: S;
  create(ctx: HostContext, config: Static<S>): Forge;
}

export function validateChangeRequest(value: unknown): ValidationResult<ChangeRequest> {
  return check(ChangeRequest, value);
}

/** One failed check as a forge reports it; the same shape a `ci.failed` signal carries to the agent. */
export { FailedCheck };

export function validateFailedChecks(value: unknown): ValidationResult<FailedCheck[]> {
  return check(Type.Array(FailedCheck), value);
}

export function validateForgeEffect(value: unknown): ValidationResult<ForgeEffect> {
  return check(ForgeEffect, value);
}

export function validateForgeEffectOutcome(value: unknown): ValidationResult<ForgeEffectOutcome> {
  return check(ForgeEffectOutcome, value);
}
