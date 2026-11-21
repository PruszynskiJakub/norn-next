/**
 * The step kind slot: a head key a workflow step may name beyond the kernel's own (`open-pr`,
 * `update-branch`, `await-merge`, ...). The kernel's decide never calls `run`: it emits an action, the
 * host calls `run` and records the outcome as a receipt, so a step kind performs and reports and never
 * picks the next step.
 */
import { OUTCOME_NAME_PATTERN } from "@norn/schema";
import type { Static, TSchema } from "@sinclair/typebox";
import type { Forge } from "./forge.ts";
import type { HostContext } from "./host.ts";
import type { PluginResult } from "./result.ts";
import type { Tracker } from "./tracker.ts";
import type { Vcs } from "./vcs.ts";

/**
 * The configured providers a step kind may use (plugin API 1.4), so one kind works over whichever
 * forge or vcs a repo picked without naming a provider. Only the host's `run` sees them; decide never does.
 */
export interface StepKindSlots {
  vcs?: Vcs;
  forge?: Forge;
  tracker?: Tracker;
}

/** Head keys the kernel runs itself; a plugin may not provide a step kind by these names. */
export const BUILTIN_STEP_KINDS = ["agent", "check", "gate", "slices"] as const;
export type BuiltinStepKind = (typeof BUILTIN_STEP_KINDS)[number];

/**
 * The keys a workflow file writes a step with (plugin API 1.21). The set is closed: what a step's
 * actor needs beyond them goes under `with:`, and a step kind is named by value (`by: forge.open-pr`),
 * so no plugin can collide with a key and no feature needs a new one.
 */
export const STEP_KEYS = ["by", "do", "with", "reads", "produces", "allow", "attended", "limits", "outcomes", "on", "description", "use", "like"] as const;

/**
 * Every key a step may hold beside a head key: the step keys, the older form's keys, which a pinned
 * document holds for good, and the keys only a pinned document holds (`role`, plugin API 1.23; `asks`, 1.26). A step
 * kind's name or config key may not be one of these, or the loader could not tell which key of a
 * pinned step is its head. It grows only with the pinned document, never with what a file writes.
 */
export const STEP_KEYWORDS = [
  "use",
  "like",
  "description",
  "outcomes",
  "means",
  "verdict",
  "skills",
  "inputs",
  "produces",
  "attended",
  "by",
  "model",
  "criteria",
  "hand_back",
  "writes",
  "deadline",
  "nudges",
  "retries",
  "timeout",
  "exits",
  "on",
  "do",
  "with",
  "reads",
  "allow",
  "limits",
  "role",
  "asks",
] as const;

/** The slots a step kind or signal source may work over; a workflow names it `<slot>.<name>`, so a workflow moves between providers unchanged. */
export const KIND_SLOTS = ["vcs", "forge", "tracker"] as const;
export type KindSlot = (typeof KIND_SLOTS)[number];

/** What is wrong with a declared `slot`; null when it is absent or one of `KIND_SLOTS`. */
export function slotProblem(slot: unknown): string | null {
  return slot === undefined || (KIND_SLOTS as readonly unknown[]).includes(slot) ? null : `slot must be ${KIND_SLOTS.map((s) => `"${s}"`).join(", ").replace(/, ([^,]*)$/, " or $1")}`;
}

/** The outcome a `wait` kind answers while what it waits for has not happened; never routed. */
export const WAITING_OUTCOME = "waiting";

export const STEP_KIND_NAME_PATTERN = "^[a-z][a-z0-9-]*$";

/**
 * `effect`: run once per attempt (open a pull request, push, integrate); `wait`: run every tick until
 * it answers an outcome other than `waiting` (a merge, a review elsewhere).
 */
export type StepKindMode = "effect" | "wait";

export interface StepKindInput<C = Record<string, unknown>> {
  unit: string;
  story: string;
  step: string;
  /** the step's extra keys, already validated against `configSchema` */
  config: C;
  /** the unit's worktree, when the host has one for it */
  worktree?: string;
  /** the repo's configured slots; a slot the repo has none of is absent */
  slots?: StepKindSlots;
  /** the unit's branch, as the host made it; a kind over the slots cannot learn it from a provider-neutral vcs */
  branch?: string;
  /**
   * The story's base: `branch` as the forge names it (`main`), `ref` as the vcs resolves its newest
   * known commit (`origin/main`), so a kind compares against the base the host last fetched.
   */
  base?: StepKindBase;
  /**
   * Each name the kind `reads` that the unit's workflow produces → its file, relative to the worktree,
   * as the producing step declares it (plugin API 1.20). A name no step produces is absent.
   */
  reads?: Record<string, string>;
  /**
   * Each name the kind `produces` → its file, relative to the worktree (plugin API 1.22). The kind
   * writes it there; the host reads it back into the story's documents once the kind answers, so a
   * later step, in this worktree or another, reads it.
   */
  produces?: Record<string, string>;
  /**
   * The receipt the host wrote before running the kind (the run's intent); the idempotence key of
   * every effect the kind asks a provider for, so a run the host repeats after a crash replays it.
   */
  receipt_id?: string;
}

export interface StepKindBase {
  branch: string;
  ref: string;
}

export interface StepKindOutcome {
  /** one of the kind's declared `outcomes`, or `waiting` from a `wait` kind */
  outcome: string;
  /** data recorded with the outcome receipt; the kernel routes by `outcome` alone */
  detail?: unknown;
}

/**
 * A name a step kind reads (plugin API 1.20): one an agent step declares under `produces:`, or one the
 * host provides. A bare name must be produced on every path to a step of the kind, which the loader
 * checks; `{name, fallback}` is optional, and `fallback` says what the kind does without it, for a
 * workflow that reaches the step on a path no producer is on.
 */
export type StepKindRead = string | { name: string; fallback: string };

/** The name a read declares, bare or optional. */
export const readName = (read: StepKindRead): string => (typeof read === "string" ? read : read.name);

/**
 * A file a step kind writes for the steps after it (plugin API 1.22), under the rule an agent step's
 * produced file follows: `name` is what a later step reads it by, and `file` is relative to the
 * story's spec folder. It is due on every outcome the kind answers.
 */
/**
 * Whether a path stays inside the folder it is relative to on every host: not absolute, no `..`
 * segment, no backslash (a separator on Windows, a plain character elsewhere) and no drive letter.
 * The one rule for a produced file, whether an agent step or a step kind declares it.
 */
export const staysInside = (file: string): boolean => !file.startsWith("/") && !file.includes("\\") && !/^[A-Za-z]:/.test(file) && !file.split("/").includes("..");

/** Why a produced file breaks the path rule, worded for whoever declared it. */
export const LEAVES_SPEC_FOLDER = "leaves the story's spec folder: name a path inside it, without `..`, with `/` between folders and no drive letter";

/**
 * What a step kind does that a person must stand before (plugin API 1.24), since no one can take it
 * back once others act on it: `outward` reaches past the repo and its story branch (a deploy, a
 * release, a post others act on), `cost` spends money, `forge-write` changes what a forge lets others
 * merge or act on (marking a pull request ready, merging). A workflow loads only when a person's step
 * no policy grant delegates stands on every path to a step of such a kind.
 */
export const KIND_EFFECTS = ["outward", "cost", "forge-write"] as const;
export type KindEffect = (typeof KIND_EFFECTS)[number];

/**
 * The effects of the kinds over a slot, fixed by the core whichever plugin provides them (plugin API
 * 1.25): a workflow moves between providers unchanged, so a provider that left an effect out would
 * move the person's floor with it.
 */
export const SLOT_KIND_EFFECTS: Readonly<Record<string, readonly KindEffect[]>> = Object.freeze({
  "forge.await-merge": ["forge-write"],
  "forge.open-pr": [],
  "vcs.update-branch": [],
  "vcs.integrate": [],
  "vcs.push": [],
  "vcs.verify-base": [],
});

/** The effects a kind has: the core's for a kind over a slot it names, else those its plugin declares. */
export function kindEffects(namespace: string | undefined, name: string, declared: readonly KindEffect[] | undefined): readonly KindEffect[] {
  const fixed = namespace === undefined ? undefined : SLOT_KIND_EFFECTS[`${namespace}.${name}`];
  return fixed ?? declared ?? [];
}

export interface StepKindProduct {
  name: string;
  file: string;
}

export interface StepKindDefinition<S extends TSchema = TSchema> {
  /** the head key, the same as the key the plugin provides it under */
  name: string;
  /** the step's extra keys beside the head key */
  configSchema: S;
  /** every outcome `run` may answer; each must be routed by a step that uses the kind */
  outcomes: string[];
  mode: StepKindMode;
  /** what the kind reads that an earlier step produces; absent: nothing */
  reads?: StepKindRead[];
  /** the files the kind writes for later steps; absent: none */
  produces?: StepKindProduct[];
  /**
   * The slot the kind works over (plugin API 1.21): a workflow names it `<slot>.<name>`
   * (`vcs.update-branch`). Absent, it is named after the plugin that provides it (`vercel.preview`).
   */
  slot?: KindSlot;
  /** the effects a person must stand before (`KIND_EFFECTS`); absent: none */
  effects?: readonly KindEffect[];
  run(input: StepKindInput<Static<S>>, ctx: HostContext): Promise<PluginResult<StepKindOutcome>>;
}

const NAME_RE = new RegExp(STEP_KIND_NAME_PATTERN);
const OUTCOME_RE = new RegExp(OUTCOME_NAME_PATTERN);
const RESERVED: ReadonlySet<string> = new Set([...BUILTIN_STEP_KINDS, ...STEP_KEYWORDS]);

type Loose = Record<string, unknown>;

/** What is wrong with a value offered as the step kind `key`; empty when it fits the contract. */
export function stepKindProblems(key: string, value: unknown): string[] {
  if (value === null || typeof value !== "object") return ["is not an object"];
  const v = value as Loose;
  const out: string[] = [];
  if (!NAME_RE.test(key)) out.push(`name must match ${STEP_KIND_NAME_PATTERN}`);
  else if (RESERVED.has(key)) out.push("is a name the kernel keeps for itself");
  if (v.name !== key) out.push(`needs name ${JSON.stringify(key)}, the key it is provided under`);
  if (v.mode !== "effect" && v.mode !== "wait") out.push('mode must be "effect" or "wait"');
  if (typeof v.run !== "function") out.push("lacks run");
  const schema = v.configSchema as Loose | null | undefined;
  if (schema === null || typeof schema !== "object") out.push("needs a configSchema");
  else if (schema.properties !== null && typeof schema.properties === "object") {
    const clash = Object.keys(schema.properties as Loose).filter((k) => RESERVED.has(k) || k === key);
    if (clash.length > 0) out.push(`config keys ${clash.join(", ")} clash with step keys`);
  }
  const outcomes = v.outcomes;
  if (!Array.isArray(outcomes) || outcomes.length === 0) out.push("needs at least one outcome");
  else {
    const bad = outcomes.filter((o) => typeof o !== "string" || !OUTCOME_RE.test(o));
    if (bad.length > 0) out.push(`outcomes ${bad.map((o) => JSON.stringify(o)).join(", ")} are not outcome names`);
    if (new Set(outcomes).size !== outcomes.length) out.push("outcomes repeat");
    if (outcomes.includes(WAITING_OUTCOME)) out.push(`outcome ${WAITING_OUTCOME} is implied for a wait kind and never declared`);
  }
  if (v.reads !== undefined) out.push(...readsProblems(v.reads));
  if (v.produces !== undefined) out.push(...producesProblems(v.produces));
  const slot = slotProblem(v.slot);
  if (slot) out.push(slot);
  if (v.effects !== undefined) out.push(...effectsProblems(v.effects));
  return out;
}

function effectsProblems(effects: unknown): string[] {
  if (!Array.isArray(effects) || !effects.every((e) => (KIND_EFFECTS as readonly unknown[]).includes(e))) return [`effects must be a list of ${KIND_EFFECTS.map((e) => `"${e}"`).join(", ").replace(/, ([^,]*)$/, " or $1")}`];
  return new Set(effects).size === effects.length ? [] : ["effects repeat"];
}

function readsProblems(reads: unknown): string[] {
  if (!Array.isArray(reads)) return ["reads must be a list"];
  const shaped = reads.every((r) => typeof r === "string" || (r !== null && typeof r === "object" && typeof r.name === "string" && typeof r.fallback === "string" && r.fallback.trim() !== ""));
  if (!shaped) return ["a read is a name, or {name, fallback} with the fallback it takes without it"];
  const names = (reads as StepKindRead[]).map(readName);
  const out: string[] = [];
  const bad = names.filter((n) => !OUTCOME_RE.test(n));
  if (bad.length > 0) out.push(`reads ${bad.map((n) => JSON.stringify(n)).join(", ")} are not input names`);
  if (new Set(names).size !== names.length) out.push("reads repeat");
  return out;
}

function producesProblems(produces: unknown): string[] {
  if (!Array.isArray(produces)) return ["produces must be a list"];
  const shaped = produces.every((p) => p !== null && typeof p === "object" && typeof p.name === "string" && typeof p.file === "string" && p.file.trim() !== "");
  if (!shaped) return ["a product is {name, file}: the name later steps read it by and its file in the story's spec folder"];
  const names = (produces as StepKindProduct[]).map((p) => p.name);
  const out: string[] = [];
  const bad = names.filter((n) => !OUTCOME_RE.test(n));
  if (bad.length > 0) out.push(`produces ${bad.map((n) => JSON.stringify(n)).join(", ")} ${bad.length === 1 ? "is not an input name" : "are not input names"}`);
  if (new Set(names).size !== names.length) out.push("produces repeat");
  for (const p of produces as StepKindProduct[]) if (!staysInside(p.file)) out.push(`produces ${p.name} names ${JSON.stringify(p.file)}, which ${LEAVES_SPEC_FOLDER}`);
  return out;
}

/**
 * Whether `answer` is one the kind may give: a declared outcome, or `waiting` from a `wait` kind. The
 * host checks every answer before recording it, so a plugin cannot route a unit by an outcome no
 * workflow was checked against.
 */
export function stepKindAnswerProblem(def: Pick<StepKindDefinition, "name" | "mode" | "outcomes">, answer: unknown): string | null {
  const outcome = (answer as Loose | null)?.outcome;
  if (typeof outcome !== "string") return `step kind ${def.name} answered no outcome`;
  if (outcome === WAITING_OUTCOME) return def.mode === "wait" ? null : `step kind ${def.name} is an effect and cannot answer ${WAITING_OUTCOME}`;
  return def.outcomes.includes(outcome) ? null : `step kind ${def.name} answered ${JSON.stringify(outcome)}, which it does not declare`;
}
