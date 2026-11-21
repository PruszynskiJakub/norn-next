/**
 * A loaded workflow: the flat document pinned by hash (what a unit records it runs), and the graph
 * compiled from it that applyReceipts and decide walk. The graph holds no `use` or `like` step and no
 * `max:`; every bounded edge names its counter, and every counter is declared.
 */
import { Attendance, Mode, NonEmpty, NonNegInt, OutcomeName, PosInt, StepName, StepWrites, Target, Verdict } from "@norn/schema";
import { type Static, Type } from "@sinclair/typebox";
import { CapabilitySchema } from "../model/grant.ts";
import { BaseDoc, DocCounterName, HandBack, SourcesDoc, StepInputDoc, WorkflowDocument } from "./document.ts";

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
  gate: ["approve", "reject"],
  slices: ["done", "stuck"],
} as const;

/** How a step ends: `builtin` steps the kernel runs, `plugin` steps a step kind runs, as `effect` or `wait`. */
export const StepRunner = Type.Union([
  Type.Object({ type: Type.Literal("builtin") }, closed),
  Type.Object({ type: Type.Literal("plugin"), mode: Type.Union([Type.Literal("effect"), Type.Literal("wait")]) }, closed),
]);
export type StepRunner = Static<typeof StepRunner>;

/** A file an agent step produces, and the outcomes it is due on, resolved from the step's `produces:`. */
export const ProducedFile = Type.Object({ file: NonEmpty, on: Type.Array(OutcomeName) }, closed);
export type ProducedFile = Static<typeof ProducedFile>;

/** What an agent step's report must come with and may say, read by the brief builder and applyReceipts. */
export const AgentStepSpec = Type.Object(
  {
    instructions: NonEmpty,
    skills: Type.Array(NonEmpty),
    inputs: Type.Array(StepInputDoc),
    /** the sources the step reads without a `?`: one nothing binds holds the step before it starts */
    sources: Type.Optional(Type.Array(OutcomeName)),
    /** the executor named by `by:`; null takes the config's */
    executor: Type.Union([NonEmpty, Type.Null()]),
    model: Type.Optional(NonEmpty),
    /** the agent role the step names, which the config's `bind:` maps to executors; absent for a step in the older form */
    role: Type.Optional(NonEmpty),
    /** the capabilities the step's `allow:` asks of its role; absent, all of the role's */
    allow: Type.Optional(Type.Array(CapabilitySchema)),
    /** who stays beside the agent, which picks the runner: the person, a supervisor, or nobody */
    attended: Attendance,
    criteria: Type.Boolean(),
    hand_back: Type.Record(OutcomeName, HandBack),
    /** produced name → its file and outcomes; absent when the step produces nothing */
    produces: Type.Optional(Type.Record(Type.String(), ProducedFile)),
    /** what the agent may write, as the hook guard holds it: `worktree` unless the step says `docs` */
    writes: StepWrites,
    means: Type.Record(OutcomeName, Type.String()),
    verdict: Type.Record(OutcomeName, Verdict),
    /** limits resolved from the step, then the workflow's `defaults`, then the kernel config */
    deadline_ms: Type.Union([PosInt, Type.Null()]),
    nudges: NonNegInt,
    retries: NonNegInt,
    /** the questions its supervisor answers in one visit (`limits.asks`); absent: `DEFAULT_SUPERVISOR_ASKS` */
    asks: Type.Optional(NonNegInt),
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

/** A signal a step routes, by name, with the parameters its `on:` entry gives the source (`after:` for `timeout`). */
export const CompiledSignal = Type.Object({ name: OutcomeName, params: Type.Optional(Type.Record(Type.String(), Type.Unknown())) }, closed);
export type CompiledSignal = Static<typeof CompiledSignal>;

export const GateStepSpec = Type.Object({ prompt: NonEmpty }, closed);
export type GateStepSpec = Static<typeof GateStepSpec>;

export const CompiledStep = Type.Object(
  {
    name: StepName,
    /** the head key: `agent`, `check`, `gate`, `slices`, or a plugin step kind's name */
    kind: NonEmpty,
    runner: StepRunner,
    description: Type.Optional(Type.String()),
    /** every outcome the step can end with; a plugin kind's are its declared ones */
    outcomes: Type.Array(OutcomeName),
    /** outcome or signal → route; every outcome in `outcomes` and every signal in `signals` has one, plus any built-in route the step overrides */
    routes: Type.Record(OutcomeName, CompiledRoute),
    /** the signals that may interrupt the step while it waits, first weighed first; only on a gate or a wait step */
    signals: Type.Optional(Type.Array(CompiledSignal)),
    agent: Type.Optional(AgentStepSpec),
    check: Type.Optional(CheckStepSpec),
    gate: Type.Optional(GateStepSpec),
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
    sources: Type.Optional(SourcesDoc),
  },
  { ...closed, title: "WorkflowGraph" },
);
export type WorkflowGraph = Static<typeof WorkflowGraph>;

export interface LoadedWorkflow {
  pinned: PinnedWorkflow;
  graph: WorkflowGraph;
}

/**
 * One refusal at a JSON pointer into the document; `missing_kind` names an unregistered step kind so a
 * host can say which plugin to add; `granted` names the gates a policy grant delegates when the grant
 * alone breaks the floor, so a host sends the person to their policy rather than to the file.
 */
export const WorkflowError = Type.Object(
  { path: Type.String(), message: NonEmpty, missing_kind: Type.Optional(NonEmpty), shared: Type.Optional(NonEmpty), granted: Type.Optional(Type.Array(NonEmpty, { minItems: 1 })) },
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
