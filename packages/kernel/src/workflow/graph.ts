/**
 * A loaded workflow: the flat document pinned by hash (what a unit records it runs), and the graph
 * compiled from it that applyReceipts and decide walk. The graph holds no `use` or `like` step and no
 * `max:`; every bounded edge names its counter, and every counter is declared.
 */
import { Mode, NonEmpty, NonNegInt, OutcomeName, PosInt, StepName, Target, Verdict } from "@norn/schema";
import { type Static, Type } from "@sinclair/typebox";
import { BaseDoc, DocCounterName, HandBack, StepInputDoc, WorkflowDocument } from "./document.ts";

const closed = { additionalProperties: false } as const;
const Sha256 = Type.String({ pattern: "^[0-9a-f]{64}$" });
export const GraphCounterName = DocCounterName;

/**
 * The workflow a unit runs, as it was when the round started: the flat document (shared steps
 * brought in, `like` copies filled, derived counters written) and the sha256 of its canonical JSON.
 * A unit keeps running its pinned workflow when the file changes; only a new round takes the new one.
 */
export const PinnedWorkflow = Type.Object({ name: NonEmpty, hash: Sha256, doc: WorkflowDocument }, { ...closed, title: "PinnedWorkflow" });
export type PinnedWorkflow = Static<typeof PinnedWorkflow>;

/** Where an outcome goes, and the counter taking it bumps; exhausting the counter routes to `$stuck`. */
export const CompiledRoute = Type.Object({ to: Target, counter: Type.Optional(GraphCounterName) }, closed);
export type CompiledRoute = Static<typeof CompiledRoute>;

export const CompiledCounter = Type.Object(
  {
    max: PosInt,
    /** edges `<step>.<outcome>` whose taking resets the counter to 0 */
    reset_on: Type.Array(Type.String({ minLength: 3 })),
  },
  closed,
);
export type CompiledCounter = Static<typeof CompiledCounter>;

/**
 * Outcomes the kernel classifies on any agent step; a step may route each in `outcomes:` to override
 * the built-in handling (nudge, retry, park, `$stuck`), and needs no route for them otherwise.
 */
export const OVERRIDABLE_OUTCOMES = ["silent", "died", "timeout", "stalled", "ask", "stuck"] as const;

/** The outcomes each built-in step kind ends with; a check adds the outcomes its `exits` name, an agent declares its own. */
export const BUILTIN_STEP_OUTCOMES = {
  check: ["pass", "fail"],
  gate: ["approve", "reject", "stale", "unpushed"],
  slices: ["done", "stuck"],
} as const;

/** How a step ends: `builtin` steps the kernel runs, `plugin` steps a step kind runs, as `effect` or `wait`. */
export const StepRunner = Type.Union([
  Type.Object({ type: Type.Literal("builtin") }, closed),
  Type.Object({ type: Type.Literal("plugin"), mode: Type.Union([Type.Literal("effect"), Type.Literal("wait")]) }, closed),
]);
export type StepRunner = Static<typeof StepRunner>;

/** What an agent step's report must come with and may say, read by the brief builder and applyReceipts. */
export const AgentStepSpec = Type.Object(
  {
    instructions: NonEmpty,
    skills: Type.Array(NonEmpty),
    inputs: Type.Array(StepInputDoc),
    /** the executor named by `by:`; null takes the config's */
    executor: Type.Union([NonEmpty, Type.Null()]),
    model: Type.Optional(NonEmpty),
    attended: Type.Boolean(),
    criteria: Type.Boolean(),
    hand_back: Type.Record(OutcomeName, HandBack),
    means: Type.Record(OutcomeName, Type.String()),
    verdict: Type.Record(OutcomeName, Verdict),
    /** limits resolved from the step, then the workflow's `defaults`, then the kernel config */
    deadline_ms: Type.Union([PosInt, Type.Null()]),
    nudges: NonNegInt,
    retries: NonNegInt,
  },
  closed,
);
export type AgentStepSpec = Static<typeof AgentStepSpec>;

export const CheckStepSpec = Type.Object(
  {
    command: NonEmpty,
    timeout_ms: PosInt,
    /** exit code (as written) → outcome; exit 0 is `pass`, any other undeclared exit `fail` */
    exits: Type.Record(Type.String(), OutcomeName),
  },
  closed,
);
export type CheckStepSpec = Static<typeof CheckStepSpec>;

export const GateStepSpec = Type.Object({ prompt: NonEmpty }, closed);
export type GateStepSpec = Static<typeof GateStepSpec>;

/** What an await step waits on: the signal kinds it routes, in the order it takes them, and its clocks from its visit's run. */
export const AwaitStepSpec = Type.Object(
  {
    on: Type.Array(OutcomeName),
    /** passing it ends the step `timeout`; null: the step waits for as long as it takes */
    deadline_ms: Type.Union([PosInt, Type.Null()]),
    /** how long no check on the change reads as pending rather than `ci.none`; null when the step does not wait on `ci.none` */
    grace_ms: Type.Union([PosInt, Type.Null()]),
  },
  closed,
);
export type AwaitStepSpec = Static<typeof AwaitStepSpec>;

export const CompiledStep = Type.Object(
  {
    name: StepName,
    /** the head key: `agent`, `check`, `gate`, `slices`, `await`, or a plugin step kind's name */
    kind: NonEmpty,
    runner: StepRunner,
    description: Type.Optional(Type.String()),
    /** every outcome the step can end with; a plugin kind's are its declared ones */
    outcomes: Type.Array(OutcomeName),
    /** outcome → route; every outcome in `outcomes` has one, plus any built-in route the step overrides */
    routes: Type.Record(OutcomeName, CompiledRoute),
    agent: Type.Optional(AgentStepSpec),
    check: Type.Optional(CheckStepSpec),
    gate: Type.Optional(GateStepSpec),
    await: Type.Optional(AwaitStepSpec),
    /** a plugin step's extra keys, validated against its kind's configSchema */
    config: Type.Optional(Type.Record(Type.String(), Type.Unknown())),
  },
  { ...closed, title: "CompiledStep" },
);
export type CompiledStep = Static<typeof CompiledStep>;

export const WorkflowGraph = Type.Object(
  {
    name: NonEmpty,
    hash: Sha256,
    start: StepName,
    mode: Type.Optional(Mode),
    stalled_ms: Type.Union([PosInt, Type.Null()]),
    steps: Type.Record(StepName, CompiledStep),
    counters: Type.Record(GraphCounterName, CompiledCounter),
    base: Type.Optional(BaseDoc),
  },
  { ...closed, title: "WorkflowGraph" },
);
export type WorkflowGraph = Static<typeof WorkflowGraph>;

export interface LoadedWorkflow {
  pinned: PinnedWorkflow;
  graph: WorkflowGraph;
}

/** One refusal at a JSON pointer into the document; `missing_kind` names an unregistered step kind so a host can say which plugin to add. */
export const WorkflowError = Type.Object(
  { path: Type.String(), message: NonEmpty, missing_kind: Type.Optional(NonEmpty), shared: Type.Optional(NonEmpty) },
  { ...closed, title: "WorkflowError" },
);
export type WorkflowError = Static<typeof WorkflowError>;

export type WorkflowLoad = { ok: true; workflow: LoadedWorkflow } | { ok: false; errors: WorkflowError[] };

/**
 * The workflows decide can see. `byName` is what each workflow file loads to now (a new round or an
 * intake takes it); `byHash` holds every workflow some unit has pinned, so a unit keeps running the
 * workflow it started under even after its file changes or fails to load.
 */
export interface KernelWorkflows {
  byName: Readonly<Record<string, WorkflowLoad>>;
  byHash: Readonly<Record<string, LoadedWorkflow>>;
}
