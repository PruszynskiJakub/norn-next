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
 * Every other key a workflow step may hold. A step kind's name or config key may not be one of these,
 * or the loader could not tell which key of a step is its head.
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
  "attended",
  "by",
  "model",
  "criteria",
  "hand_back",
  "deadline",
  "nudges",
  "retries",
  "timeout",
  "exits",
  "on",
] as const;

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

export interface StepKindDefinition<S extends TSchema = TSchema> {
  /** the head key, the same as the key the plugin provides it under */
  name: string;
  /** the step's extra keys beside the head key */
  configSchema: S;
  /** every outcome `run` may answer; each must be routed by a step that uses the kind */
  outcomes: string[];
  mode: StepKindMode;
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
