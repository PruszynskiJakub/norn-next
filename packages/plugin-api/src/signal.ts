/**
 * The signal source slot (plugin API 1.19): a reader of one signal, a fact about the world outside a
 * waiting step (`ci-failed`, `changes-requested`). The host asks a source only for a story waiting at
 * a step that routes its signal under `on:`, and puts the answer in the tick's facts; the workflow
 * says where it leads. A source reports and never decides, and remembers nothing it reported: it only
 * gives the same occurrence the same id, on every tick and on every machine.
 */
import { CLASSIFIED_OUTCOMES, Duration, OUTCOME_NAME_PATTERN, type Signal } from "@norn/schema";
import { type Static, type TSchema, Type } from "@sinclair/typebox";
import type { ChangeRequest } from "./forge.ts";
import type { HostContext } from "./host.ts";
import type { PluginResult } from "./result.ts";
import { type StepKindBase, type StepKindSlots, WAITING_OUTCOME } from "./step-kind.ts";

/** The story a source is asked about, waiting at a step that routes the source's signal. */
export interface SignalReadInput {
  story: string;
  /** the waiting step */
  step: string;
  /** this visit to the step (`ready#3`): coming back to the step is a new visit */
  visit: string;
  /** when this visit began waiting: a gate's park, a wait step's run */
  since: string;
  /** the story's branch, as the host made it */
  branch?: string;
  base?: StepKindBase;
  /** the story's change on the forge, any state; null when none */
  change?: ChangeRequest | null;
  /** the repo's configured slots; a slot the repo has none of is absent */
  slots?: StepKindSlots;
}

export interface SignalSourceDefinition<P extends TSchema = TSchema> {
  /** what an `on:` entry for the signal may carry beside its route; none when absent */
  params?: P;
  /**
   * The signal as it stands now: a signal, `null` when nothing happened, or a failure when the source
   * could not tell, which the host leaves out of the facts so decide reads it as nothing happened.
   * Never performs an effect.
   */
  read(story: SignalReadInput, params: Static<P>, ctx: HostContext): Promise<PluginResult<Signal | null>>;
}

/** What the workflow loader reads of a signal: its name and the parameters an `on:` entry may give it. */
export interface SignalDeclaration {
  name: string;
  /** who reports it: `vcs`, `clock`, or the plugin's name */
  source: string;
  params?: TSchema;
}

/**
 * The signals the host reports itself, with no plugin: `stale` and `unpushed` from the vcs (whether a
 * base move is stale is the workflow's `base.stale`, which no plugin knows), and `timeout` from the
 * clock once the visit is older than its `after:`. A plugin may not provide a signal by these names.
 */
export const BUILTIN_SIGNALS: Readonly<Record<string, SignalDeclaration>> = Object.freeze({
  stale: { name: "stale", source: "vcs" },
  unpushed: { name: "unpushed", source: "vcs" },
  timeout: { name: "timeout", source: "clock", params: Type.Object({ after: Duration }, { additionalProperties: false }) },
});

const NAME_RE = new RegExp(OUTCOME_NAME_PATTERN);

/**
 * Outcomes the kernel classifies itself or a wait kind implies: a signal fires as its name's outcome, so
 * one named like these would be read as that outcome, never as the signal.
 */
const RESERVED_OUTCOMES: ReadonlySet<string> = new Set([WAITING_OUTCOME, ...Object.values(CLASSIFIED_OUTCOMES).flat()]);

/** What is wrong with a value offered as the signal source `key`; empty when it fits the contract. */
export function signalSourceProblems(key: string, value: unknown): string[] {
  if (value === null || typeof value !== "object") return ["is not an object"];
  const v = value as Record<string, unknown>;
  const out: string[] = [];
  if (!NAME_RE.test(key)) out.push(`name must match ${OUTCOME_NAME_PATTERN}`);
  else if (Object.hasOwn(BUILTIN_SIGNALS, key)) out.push("is a signal the host reports itself");
  else if (RESERVED_OUTCOMES.has(key)) out.push("is an outcome the kernel reserves");
  if (typeof v.read !== "function") out.push("lacks read");
  if (v.params !== undefined && (v.params === null || typeof v.params !== "object")) out.push("params must be a schema");
  return out;
}
