import { type Static, type TOptional, Type } from "@sinclair/typebox";
import {
  CounterName,
  Duration,
  NonEmpty,
  OutcomeName,
  PosInt,
  StepName,
  TaggedUnion,
  Target,
} from "./common.ts";
import { Verdict } from "./criteria.ts";

/** Full outcome edge: `{ to, counter?, means? }` (W3, W4). */
export const OutcomeEdge = Type.Object(
  {
    to: Target,
    counter: Type.Optional(CounterName),
    means: Type.Optional(Type.String({ minLength: 1, description: "Shown to the agent in the brief (B3)" })),
    /** QV5: reportable only when the worst verdict of the `--criteria` report is this one (agent steps) */
    verdict: Type.Optional(Verdict),
  },
  { additionalProperties: false },
);
export type OutcomeEdge = Static<typeof OutcomeEdge>;

/** An outcome maps to a bare target string or a full edge. */
export const OutcomeSpec = Type.Union([Target, OutcomeEdge]);
export type OutcomeSpec = Static<typeof OutcomeSpec>;

/** Open outcome map (agent steps): any outcome name → spec. */
function openOutcomes() {
  return Type.Record(OutcomeName, OutcomeSpec, { minProperties: 1, additionalProperties: false });
}

/** Closed outcome map: only the step type's fixed outcomes; at least one declared. Undeclared ones route to `$stuck`. */
function fixedOutcomes<const K extends string>(keys: readonly K[]) {
  const props = Object.fromEntries(keys.map((k) => [k, Type.Optional(OutcomeSpec)])) as {
    [P in K]: TOptional<typeof OutcomeSpec>;
  };
  return Type.Object(props, { minProperties: 1, additionalProperties: false });
}

/** Named input kinds of an agent step (B3, B6). `{ file }` is relative to the spec folder. */
export const InputKind = Type.Union([
  Type.Literal("spec"),
  Type.Literal("slice"),
  Type.Literal("slices"),
  Type.Literal("diff"),
  Type.Literal("handoff"),
  Type.Literal("last_check"),
  Type.Literal("last_findings"),
]);
export type InputKind = Static<typeof InputKind>;
export const StepInput = Type.Union([
  InputKind,
  Type.Object({ file: NonEmpty, label: Type.Optional(NonEmpty) }, { additionalProperties: false }),
]);
export type StepInput = Static<typeof StepInput>;

const common = {
  description: Type.Optional(Type.String()),
};

export const AgentStep = Type.Object(
  {
    type: Type.Literal("agent"),
    ...common,
    skill: NonEmpty,
    instructions: Type.Optional(Type.String()),
    inputs: Type.Optional(Type.Array(StepInput, { uniqueItems: true })),
    agent: Type.Optional(Type.String({ minLength: 1, description: "Name from config.agents; default config.default_agent" })),
    model: Type.Optional(NonEmpty),
    attended: Type.Optional(Type.Boolean({ description: "Worked with a person; always started by a person (MO4)" })),
    deadline: Type.Optional(Duration),
    nudges: Type.Optional(Type.Integer({ minimum: 0, description: "Max nudges in the same session (C1)" })),
    retries: Type.Optional(Type.Integer({ minimum: 0, description: "Max fresh-session retries after died (C1)" })),
    /** QV3: `required` makes `norn done --criteria <file>` mandatory */
    criteria: Type.Optional(Type.Literal("required")),
    /**
     * Declared outcomes. May also override classified routes by naming
     * `silent`, `died`, `timeout`, `stalled`, `ask`, `stuck` (C1).
     */
    outcomes: openOutcomes(),
  },
  { additionalProperties: false },
);
export type AgentStep = Static<typeof AgentStep>;

export const CheckStep = Type.Object(
  {
    type: Type.Literal("check"),
    ...common,
    run: NonEmpty,
    timeout: Duration,
    outcomes: fixedOutcomes(["pass", "fail"] as const),
  },
  { additionalProperties: false },
);
export type CheckStep = Static<typeof CheckStep>;

export const GateStep = Type.Object(
  {
    type: Type.Literal("gate"),
    ...common,
    prompt: Type.Optional(Type.String({ description: "What the person decides; shown in inbox" })),
    /** `stale` (BS6): tick-classified on a story gate when the base moved under the story (BS7) */
    outcomes: fixedOutcomes(["approve", "reject", "stale"] as const),
  },
  { additionalProperties: false },
);
export type GateStep = Static<typeof GateStep>;

/** W2: `update` (BS3) merges the base into the story branch; story units only (W8). */
export const GitAction = Type.Union([Type.Literal("integrate"), Type.Literal("push"), Type.Literal("open-pr"), Type.Literal("update")]);
export type GitAction = Static<typeof GitAction>;

export const GitStep = Type.Object(
  {
    type: Type.Literal("git"),
    ...common,
    action: GitAction,
    outcomes: fixedOutcomes(["done", "conflict"] as const),
  },
  { additionalProperties: false },
);
export type GitStep = Static<typeof GitStep>;

export const SlicesStep = Type.Object(
  {
    type: Type.Literal("slices"),
    ...common,
    outcomes: fixedOutcomes(["done", "stuck"] as const),
  },
  { additionalProperties: false },
);
export type SlicesStep = Static<typeof SlicesStep>;

export const Step = TaggedUnion("type", [AgentStep, CheckStep, GateStep, GitStep, SlicesStep]);
export type Step = Static<typeof Step>;
export type StepType = Step["type"];

export const CounterSpec = Type.Object(
  {
    max: PosInt,
    /**
     * W4 (C3): taking the edge `<step>.<outcome>` resets this counter to 0, journaled in the
     * advance (trace, handoff line) and the classify receipt. E.g. `base_conflict_loop` resets on
     * `update.done`: each base move is a fresh attempt, only repeated failures on one move count.
     */
    reset_on: Type.Optional(Type.String({ pattern: "^[a-z][a-z0-9_-]*\\.[a-z][a-z0-9_-]*$", description: "<step>.<outcome> whose edge resets the counter" })),
  },
  { additionalProperties: false },
);
export type CounterSpec = Static<typeof CounterSpec>;

/** BS7/BS9: when a waiting story counts as stale, and the step `norn update` re-enters. */
export const BaseSync = Type.Object(
  {
    /** `conflict` (default): a merge of the base would conflict; `behind`: the base has any commit the story lacks */
    stale: Type.Optional(Type.Union([Type.Literal("conflict"), Type.Literal("behind")])),
    /** step `norn update` re-enters (BS9); default: the first step with `action: update` */
    step: Type.Optional(StepName),
  },
  { additionalProperties: false },
);
export type BaseSync = Static<typeof BaseSync>;

export const Workflow = Type.Object(
  {
    $schema: Type.Optional(Type.String()),
    name: Type.String({ pattern: "^[a-z][a-z0-9_-]*$" }),
    description: Type.Optional(Type.String()),
    start: StepName,
    steps: Type.Record(StepName, Step, { minProperties: 1, additionalProperties: false }),
    counters: Type.Optional(Type.Record(CounterName, CounterSpec, { additionalProperties: false })),
    base: Type.Optional(BaseSync),
  },
  {
    $id: "https://norn.dev/schema/workflow.json",
    title: "norn workflow",
    additionalProperties: false,
  },
);
export type Workflow = Static<typeof Workflow>;

/** Classified outcomes the tick may decide per step type (§10). */
export const CLASSIFIED_OUTCOMES = {
  agent: ["silent", "died", "timeout", "stalled", "ask", "exhausted"],
  check: ["pass", "fail", "exhausted"],
  gate: ["approve", "reject", "stale", "exhausted"],
  git: ["done", "conflict", "stuck", "exhausted"],
  slices: ["done", "stuck", "exhausted"],
} as const satisfies Record<StepType, readonly string[]>;

/** Universal reports available to every agent step (§10). */
export const UNIVERSAL_REPORTS = ["ask", "stuck"] as const;

/** Normalize a bare target string to a full edge. */
export function outcomeEdge(spec: OutcomeSpec): OutcomeEdge {
  return typeof spec === "string" ? { to: spec } : spec;
}
