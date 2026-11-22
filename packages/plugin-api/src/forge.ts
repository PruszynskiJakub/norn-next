/**
 * The forge slot: where a story's change is reviewed and merged (GitHub pull requests, nothing at
 * all, ...). A FORGE IS NEVER A STATE STORE. It reports what a change request is and performs effects
 * on it; whether a step finished is norn's own record, never read back from a title or a label.
 */
import { check, IsoTime, NonEmpty, PosInt, TaggedUnion, type ValidationResult } from "@norn/schema";
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

/** A check that failed on a change's head: what the forge calls it, and where its run is. */
export const FailedCheck = Type.Object({ name: NonEmpty, url: Type.Optional(Type.String()) }, { additionalProperties: false, title: "FailedCheck" });
export type FailedCheck = Static<typeof FailedCheck>;

/**
 * The checks on a change's head with where its failures are (plugin API 1.27): `failed` names each
 * check that failed or was cut short, empty unless `summary` is `failure`. `conflicts` is true when the
 * change conflicts with its base, which a forge that runs no checks on such a change (GitHub) must
 * say, since its checks would then stay `none` or `pending` for good; absent when the forge did not ask.
 */
export const ChecksReport = Type.Object(
  { summary: ChecksSummary, failed: Type.Array(FailedCheck), conflicts: Type.Optional(Type.Boolean()) },
  { additionalProperties: false, title: "ChecksReport" },
);
export type ChecksReport = Static<typeof ChecksReport>;

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
  /** the checks with their failures' whereabouts (plugin API 1.27); a forge without it reports only `checks` */
  checkReport?(id: number): Promise<PluginResult<ChecksReport>>;
  /**
   * where the forge serves `path` of `commit` (plugin API 1.28): `image` a URL a markdown image shows
   * inline, `link` one a reader opens. Pinned to the commit, so it keeps naming that file whatever
   * moves later; visible to whoever can see the repo. Null when the forge cannot serve it. Optional; a
   * forge that offers it reports `raw_urls`, and without it the files are named as text.
   */
  fileUrl?(commit: string, path: string, form: FileUrlForm): Promise<PluginResult<string | null>>;
  perform(effect: ForgeEffect, meta: EffectMeta): Promise<PluginResult<ForgeEffectOutcome>>;
}

/** How a forge's file URL is used: shown inline as an image, or opened as a link. */
export type FileUrlForm = "image" | "link";

export interface ForgeFactory<S extends TSchema = TSchema> {
  configSchema: S;
  create(ctx: HostContext, config: Static<S>): Forge;
}

export function validateChangeRequest(value: unknown): ValidationResult<ChangeRequest> {
  return check(ChangeRequest, value);
}

export function validateChecksReport(value: unknown): ValidationResult<ChecksReport> {
  return check(ChecksReport, value);
}

export function validateForgeEffect(value: unknown): ValidationResult<ForgeEffect> {
  return check(ForgeEffect, value);
}

export function validateForgeEffectOutcome(value: unknown): ValidationResult<ForgeEffectOutcome> {
  return check(ForgeEffectOutcome, value);
}
