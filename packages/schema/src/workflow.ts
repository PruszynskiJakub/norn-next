import { type Static, type TOptional, Type } from "@sinclair/typebox";
import {
  CounterName,
  Duration,
  Mode,
  NonEmpty,
  OutcomeName,
  PosInt,
  StepName,
  TaggedUnion,
  Target,
} from "./common.ts";
import { Verdict } from "./criteria.ts";

/** Full outcome edge: `{ to, counter?, means? }`. */
export const OutcomeEdge = Type.Object(
  {
    to: Target,
    counter: Type.Optional(CounterName),
    means: Type.Optional(Type.String({ minLength: 1, description: "Shown to the agent in the brief" })),
    /** Reportable only when the worst verdict of the `--criteria` report is this one (agent steps) */
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

/**
 * Named input kinds of an agent step. `{ file }` is relative to the spec folder. `record`:
 * each unit's receipts and evidence folders in the machine dir, and the record path to link
 * evidence by. `resolution`: one `git show --remerge-diff <sha>` per merge commit since the round's
 * latest approval, from the git summary the last routed update recorded. `base_side`: per path a base
 * update conflicts in, the base commits that touched it since the merge base, with the story that landed
 * each and where that story's spec and PR body are on the base.
 */
export const InputKind = Type.Union([
  Type.Literal("spec"),
  Type.Literal("slice"),
  Type.Literal("slices"),
  Type.Literal("diff"),
  Type.Literal("handoff"),
  Type.Literal("last_check"),
  Type.Literal("last_findings"),
  Type.Literal("record"),
  Type.Literal("resolution"),
  Type.Literal("base_side"),
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
    agent: Type.Optional(Type.String({ minLength: 1, description: "Name from config.agents; default config.agent" })),
    model: Type.Optional(NonEmpty),
    attended: Type.Optional(Type.Boolean({ description: "Worked with a person; always started by a person" })),
    deadline: Type.Optional(Duration),
    nudges: Type.Optional(Type.Integer({ minimum: 0, description: "Max nudges in the same session" })),
    retries: Type.Optional(Type.Integer({ minimum: 0, description: "Max fresh-session retries after died" })),
    /** `required` makes `norn done --criteria <file>` mandatory */
    criteria: Type.Optional(Type.Literal("required")),
    /**
     * Declared outcomes. May also override classified routes by naming
     * `silent`, `died`, `timeout`, `stalled`, `ask`, `stuck`.
     */
    outcomes: openOutcomes(),
  },
  { additionalProperties: false },
);
export type AgentStep = Static<typeof AgentStep>;

const EXIT_CODE_PATTERN = "^(?:[1-9]|[1-9][0-9]|1[0-9]{2}|2[0-4][0-9]|25[0-5])$";

export const CheckStep = Type.Object(
  {
    type: Type.Literal("check"),
    ...common,
    run: NonEmpty,
    timeout: Duration,
    /**
     * Exit code (1–255) → outcome name, for a check that ends in more than pass or fail; exit 0 is
     * always `pass` and any other exit `fail`. Each named outcome is declared in `outcomes`.
     */
    exits: Type.Optional(
      Type.Record(Type.String({ pattern: EXIT_CODE_PATTERN }), OutcomeName, {
        minProperties: 1,
        additionalProperties: false,
        description: "Exit code → outcome; exit 0 is pass, an undeclared one fail",
      }),
    ),
    /** `pass`, `fail` and the outcomes `exits` names; load-time validation refuses any other */
    outcomes: openOutcomes(),
  },
  { additionalProperties: false },
);
export type CheckStep = Static<typeof CheckStep>;

export const GateStep = Type.Object(
  {
    type: Type.Literal("gate"),
    ...common,
    prompt: Type.Optional(Type.String({ description: "What the person decides; shown in inbox" })),
    /** `stale`: tick-classified on a story gate when the base moved under the story */
    outcomes: fixedOutcomes(["approve", "reject", "stale"] as const),
  },
  { additionalProperties: false },
);
export type GateStep = Static<typeof GateStep>;

/** `update` merges the base into the story branch; story units only. */
export const GitAction = Type.Union([Type.Literal("integrate"), Type.Literal("push"), Type.Literal("open-pr"), Type.Literal("update")]);
export type GitAction = Static<typeof GitAction>;

export const GitStep = Type.Object(
  {
    type: Type.Literal("git"),
    ...common,
    action: GitAction,
    /** `clean` and `resolved` (the light path after a base update) only on `action: update` */
    outcomes: fixedOutcomes(["done", "conflict", "clean", "resolved"] as const),
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

/**
 * Waits for the story's PR to merge: entered like a gate, but a person gives no decision there. The merge (or a PR closed unmerged) ends the wait through the story's lifecycle;
 * `stale` is tick-classified when the base moved under the story.
 */
export const MergeStep = Type.Object(
  {
    type: Type.Literal("merge"),
    ...common,
    outcomes: fixedOutcomes(["stale"] as const),
  },
  { additionalProperties: false },
);
export type MergeStep = Static<typeof MergeStep>;

export const Step = TaggedUnion("type", [AgentStep, CheckStep, GateStep, GitStep, SlicesStep, MergeStep]);
export type Step = Static<typeof Step>;
export type StepType = Step["type"];

const ResetEdge = Type.String({ pattern: "^[a-z][a-z0-9_-]*\\.[a-z][a-z0-9_-]*$", description: "<step>.<outcome> whose edge resets the counter" });

export const CounterSpec = Type.Object(
  {
    max: PosInt,
    /**
     * Taking the edge `<step>.<outcome>` (or any edge of a list) resets this counter to 0,
     * journaled in the advance (trace, commit) and the classify receipt. E.g. `base_conflict_loop`
     * resets on `update.done`: each base move is a fresh attempt, only repeated failures on one move count.
     */
    reset_on: Type.Optional(Type.Union([ResetEdge, Type.Array(ResetEdge, { minItems: 1 })])),
  },
  { additionalProperties: false },
);
export type CounterSpec = Static<typeof CounterSpec>;

/** When a waiting story counts as stale, and the step `norn story update-branch` re-enters. */
export const BaseSync = Type.Object(
  {
    /** `conflict` (default): a merge of the base would conflict; `behind`: the base has any commit the story lacks */
    stale: Type.Optional(Type.Union([Type.Literal("conflict"), Type.Literal("behind")])),
    /** step `norn story update-branch` re-enters; default: the first step with `action: update` */
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
    /** How stories in this workflow run, unless `norn story edit` sets the story's own */
    mode: Type.Optional(Mode),
    /** Limits for every step that does not set its own; `stalled` only here */
    defaults: Type.Optional(
      Type.Object(
        {
          deadline: Type.Optional(Duration),
          nudges: Type.Optional(Type.Integer({ minimum: 0 })),
          retries: Type.Optional(Type.Integer({ minimum: 0 })),
          stalled: Type.Optional(Duration),
        },
        { additionalProperties: false },
      ),
    ),
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

/** Classified outcomes the tick may decide per step type. */
export const CLASSIFIED_OUTCOMES = {
  agent: ["silent", "died", "timeout", "stalled", "ask", "exhausted"],
  check: ["pass", "fail", "exhausted"],
  gate: ["approve", "reject", "stale", "exhausted"],
  git: ["done", "conflict", "clean", "resolved", "stuck", "exhausted"],
  slices: ["done", "stuck", "exhausted"],
  merge: ["stale", "exhausted"],
} as const satisfies Record<StepType, readonly string[]>;

export function outcomeEdge(spec: OutcomeSpec): OutcomeEdge {
  return typeof spec === "string" ? { to: spec } : spec;
}
