/**
 * A workflow as its file is written (`WorkflowFile`) and as a unit pins it (`WorkflowDocument`, the
 * flat form every step written with `by:` and every outcome object is lowered to, so a pin's hash never
 * depends on the spelling). A file writes a step with `by:` (an agent role, `person`, `shell`, or a
 * step kind as `<namespace>.<kind>`), or, in the older form a pinned step keeps, with exactly one head
 * key: a kernel built-in (`agent`, `check`, `gate`, `slices`) or a step kind's bare name (`open-pr:`),
 * whose extra keys its `configSchema` checks. `use` brings in a shared file's steps and `like` copies a
 * sibling. The schema checks the keys it knows and lets the rest through; `loadWorkflow` decides which
 * key is the head and refuses a step whose head is unknown.
 */
import { Duration, Mode, NonEmpty, OUTCOME_NAME_PATTERN, OutcomeName, PosInt, StepName, StepWrites, StoredCounterName, Target, Verdict } from "@norn/schema";
import { type Static, type TSchema, Type } from "@sinclair/typebox";
import { CapabilitySchema } from "../model/grant.ts";

const closed = { additionalProperties: false } as const;

/**
 * A counter name: one a file declares, or `<step>.<outcome>` derived from the edge it counts. A file
 * may write only the first kind (the loader refuses a dotted name it writes); a pinned document holds
 * both, so its hash covers the counters the unit runs with.
 */
export const DocCounterName = StoredCounterName;

/** A route that names a counter (`counter:`) or bounds the one derived from its edge (`max:`). */
export const RouteEdge = Type.Object({ to: Target, counter: Type.Optional(DocCounterName), max: Type.Optional(PosInt) }, closed);
export type RouteEdge = Static<typeof RouteEdge>;

/** A route in a workflow file: a bare target (`review`, `$done`, `$stuck`) or an edge. */
export const Route = Type.Union([Target, RouteEdge]);
export type Route = Static<typeof Route>;

/** A route in a shared file may also leave it through an exit, which the `use` step routes by name. */
export const ExitRoute = Type.Object({ exit: OutcomeName }, closed);
export type ExitRoute = Static<typeof ExitRoute>;
export const SharedRoute = Type.Union([Target, RouteEdge, ExitRoute]);
export type SharedRoute = Static<typeof SharedRoute>;

/**
 * A route under `on:`: the shape of a route under `outcomes:`, whose edge may also carry the signal's
 * parameters (`timeout`'s `after:`). The loader checks those against the signal's declaration, as it
 * checks a plugin step's keys against its kind, so the schema lets them through.
 */
const ROUTE_KEYS = { to: Target, counter: Type.Optional(DocCounterName), max: Type.Optional(PosInt) };
export const OnRoute = Type.Union([Target, Type.Object(ROUTE_KEYS, { additionalProperties: true })]);
export type OnRoute = Static<typeof OnRoute>;
export const SharedOnRoute = Type.Union([Target, Type.Object(ROUTE_KEYS, { additionalProperties: true }), Type.Object({ exit: OutcomeName }, { additionalProperties: true })]);
export type SharedOnRoute = Static<typeof SharedOnRoute>;

/** The keys of an `on:` entry that are its route; the rest are the signal's parameters. */
export const ON_ROUTE_KEYS: readonly string[] = ["to", "counter", "max", "exit"];

/** What an agent's report of an outcome must come with. */
export const HandBack = Type.Union([Type.Literal("findings"), Type.Literal("evidence")]);
export type HandBack = Static<typeof HandBack>;

/**
 * An input the brief gives the agent: a named kind (`spec`, `diff`, `last_findings`, ...) the host's
 * brief builder resolves (the loader, given the host's names, refuses any other), a name an earlier
 * step produces, a source the workflow names, or a file. A trailing `?` marks a produced name or a
 * source as optional: no producer need come first, and an unbound source does not hold the step.
 * Decide passes them through and never opens them.
 */
export const StepInputDoc = Type.Union([
  Type.String({ pattern: `${OUTCOME_NAME_PATTERN.slice(0, -1)}\\??$` }),
  Type.Object({ file: NonEmpty, label: Type.Optional(NonEmpty) }, closed),
]);
export type StepInputDoc = Static<typeof StepInputDoc>;

/**
 * A file an agent step writes for the steps after it, relative to the story's spec folder, and the
 * outcomes whose report needs it (default: every outcome the step reports but one that hands findings
 * back). The loader keeps the path inside the folder; the host refuses a report without the file.
 */
export const ProducesDoc = Type.Object(
  {
    file: Type.String({ minLength: 1, pattern: "\\S", description: "The file, relative to the story's spec folder (`pr.md`)" }),
    on: Type.Optional(Type.Array(OutcomeName, { minItems: 1, uniqueItems: true })),
  },
  closed,
);
export type ProducesDoc = Static<typeof ProducesDoc>;

/**
 * What an agent's report of an outcome comes with: a report norn takes with it (`findings`,
 * `evidence`, `criteria`), bare, or a file in the spec folder, given once in the step as
 * `{name, file}` and named bare elsewhere in it.
 */
export const ProducesEntry = Type.Union([
  Type.String({ pattern: OUTCOME_NAME_PATTERN }),
  Type.Object({ name: Type.String({ pattern: OUTCOME_NAME_PATTERN }), file: ProducesDoc.properties.file }, closed),
]);
export type ProducesEntry = Static<typeof ProducesEntry>;
export const ProducesList = Type.Array(ProducesEntry, { uniqueItems: true });
export type ProducesList = Static<typeof ProducesList>;

/** What an outcome object says of the outcome beside its route; lowered into the step's maps. */
const OUTCOME_FIELDS = {
  means: Type.Optional(Type.String({ minLength: 1 })),
  verdict: Type.Optional(Verdict),
  produces: Type.Optional(ProducesList),
};

/**
 * An outcome as a file writes it: a bare target, or everything about the outcome in one place. `to`
 * is optional to the schema only so that the loader can say which outcome lacks it.
 */
export const OutcomeDoc = Type.Union([
  Target,
  Type.Object({ to: Type.Optional(Target), counter: Type.Optional(DocCounterName), max: Type.Optional(PosInt), ...OUTCOME_FIELDS }, closed),
]);
export type OutcomeDoc = Static<typeof OutcomeDoc>;
/** An outcome in a shared file may leave it through an exit instead of going `to` a step. */
export const SharedOutcomeDoc = Type.Union([
  Target,
  Type.Object({ to: Type.Optional(Target), exit: Type.Optional(OutcomeName), counter: Type.Optional(DocCounterName), max: Type.Optional(PosInt), ...OUTCOME_FIELDS }, closed),
]);
export type SharedOutcomeDoc = Static<typeof SharedOutcomeDoc>;

const ProducesMap = Type.Record(Type.String({ pattern: OUTCOME_NAME_PATTERN }), ProducesDoc, { ...closed, minProperties: 1 });
/** A file's step-level `produces:`: the older map of files, or the list every outcome produces unless it lists its own. */
const FileProduces = Type.Union([ProducesMap, ProducesList]);

const EXIT_CODE_PATTERN = "^(?:[1-9]|[1-9][0-9]|1[0-9]{2}|2[0-4][0-9]|25[0-5])$";

/** An agent step's skills, and a check step's exit codes each named as an outcome; `with:` lowers to these, so it is checked by them. */
export const SkillsDoc = Type.Array(NonEmpty, { uniqueItems: true });
export const ExitsDoc = Type.Record(Type.String({ pattern: EXIT_CODE_PATTERN }), OutcomeName, { ...closed, minProperties: 1 });

const SharedName = Type.String({ pattern: "^[a-z][a-z0-9_-]*$", description: "A shared file's name, without `.yaml`" });

/**
 * A signal as an `on:` block of a file names it: `<namespace>.<signal>` (`vcs.stale`), or bare in the
 * older form; the loader resolves it to the bare name the pinned document keeps.
 */
const SignalSurfaceName = Type.String({ pattern: "^(?:[^.\\s]+\\.)?[a-z][a-z0-9_-]*$" });

/** What bounds a step written with `by:`; the loader says which actor takes which. */
const LimitsDoc = Type.Object(
  { timeout: Type.Optional(Duration), deadline: Type.Optional(Duration), retries: Type.Optional(Type.Integer({ minimum: 0 })), nudges: Type.Optional(Type.Integer({ minimum: 0 })), asks: Type.Optional(Type.Integer({ minimum: 0 })) },
  closed,
);

/** The keys only a step written with `by:` holds; the loader lowers them to the pinned document's. */
const ACTOR_KEYS = {
  do: Type.Optional(Type.String({ minLength: 1, pattern: "\\S", description: "An agent's instruction, a person's decision, or a shell command" })),
  /** how the actor works: an agent's skills, a shell step's exits, a step kind's settings */
  with: Type.Optional(Type.Record(Type.String(), Type.Unknown())),
  reads: Type.Optional(Type.Array(StepInputDoc, { uniqueItems: true })),
  allow: Type.Optional(Type.Array(Type.String({ minLength: 1 }), { minItems: 1, uniqueItems: true })),
  limits: Type.Optional(LimitsDoc),
};

function stepProps<R extends TSchema, O extends TSchema, P extends TSchema>(route: R, onRoute: O, produces: P) {
  return {
    // the built-in head keys; exactly one head per step is the loader's check, not the schema's
    agent: Type.Optional(Type.String({ minLength: 1, pattern: "\\S", description: "The orientation: what the step is for" })),
    check: Type.Optional(NonEmpty),
    gate: Type.Optional(Type.String({ minLength: 1, pattern: "\\S", description: "What the person decides; shown in the inbox" })),
    slices: Type.Optional(Type.Null({ description: "Takes no value" })),
    use: Type.Optional(SharedName),
    like: Type.Optional(StepName),
    description: Type.Optional(Type.String()),
    outcomes: Type.Optional(Type.Record(OutcomeName, route, closed)),
    /** what may interrupt a waiting step from outside: signal name → route, in the order a tick weighs them */
    on: Type.Optional(Type.Record(OutcomeName, onRoute, { ...closed, minProperties: 1 })),
    means: Type.Optional(Type.Record(OutcomeName, Type.String({ minLength: 1 }), closed)),
    verdict: Type.Optional(Type.Record(OutcomeName, Verdict, closed)),
    skills: Type.Optional(SkillsDoc),
    inputs: Type.Optional(Type.Array(StepInputDoc, { uniqueItems: true })),
    /** what an agent step writes for later steps, by the name their `inputs:` (or a step kind's `reads`) use */
    produces: Type.Optional(produces),
    attended: Type.Optional(
      Type.Union([Type.Boolean({ description: "Worked with a person; always started by a person" }), Type.Literal("agent", { description: "A supervisor stays beside the agent" })]),
    ),
    /** the agent role a step written with `by:` names, which the config's `bind:` maps to an executor */
    role: Type.Optional(Type.String({ pattern: "^[a-z][a-z0-9_-]*$" })),
    /** what a step written with `by:` asks of its role's capabilities, which decide narrows its grant by */
    allow: Type.Optional(Type.Array(CapabilitySchema, { minItems: 1, uniqueItems: true })),
    by: Type.Optional(Type.String({ minLength: 1, description: "The executor that runs the agent; default the config's" })),
    model: Type.Optional(NonEmpty),
    criteria: Type.Optional(Type.Literal("required")),
    hand_back: Type.Optional(Type.Record(OutcomeName, HandBack, { ...closed, minProperties: 1 })),
    writes: Type.Optional(StepWrites),
    deadline: Type.Optional(Duration),
    nudges: Type.Optional(Type.Integer({ minimum: 0 })),
    retries: Type.Optional(Type.Integer({ minimum: 0 })),
    /** the questions a supervisor answers for an `attended: agent` step in one visit (`limits.asks`) */
    asks: Type.Optional(Type.Integer({ minimum: 0 })),
    timeout: Type.Optional(Duration),
    exits: Type.Optional(ExitsDoc),
  };
}

// a plugin step kind's head and config keys are checked by the loader against the kind's configSchema
const open = { additionalProperties: true } as const;

/** A step as a file writes it: the pinned keys, the step form's, a signal by its surface name, and who stays alongside an agent. */
function fileStepDoc<R extends TSchema, O extends TSchema>(route: R, onRoute: O) {
  return Type.Object(
    {
      ...stepProps(route, onRoute, FileProduces),
      ...ACTOR_KEYS,
      on: Type.Optional(Type.Record(SignalSurfaceName, onRoute, { ...closed, minProperties: 1 })),
      attended: Type.Optional(
        Type.Union([Type.Boolean(), Type.Literal("person"), Type.Literal("agent"), Type.Literal("none")], { description: "Who stays alongside the agent; the older form's true is person" }),
      ),
    },
    open,
  );
}

export const WorkflowStepDoc = Type.Object(stepProps(Route, OnRoute, ProducesMap), open);
export type WorkflowStepDoc = Static<typeof WorkflowStepDoc>;
export const WorkflowFileStepDoc = fileStepDoc(OutcomeDoc, OnRoute);
export type WorkflowFileStepDoc = Static<typeof WorkflowFileStepDoc>;
export const SharedStepDoc = fileStepDoc(SharedOutcomeDoc, SharedOnRoute);
export type SharedStepDoc = Static<typeof SharedStepDoc>;

const ResetEdge = Type.String({ pattern: "^[a-z][a-z0-9_-]*\\.[a-z][a-z0-9_-]*$", description: "<step>.<outcome> whose edge resets the counter" });

export const CounterDoc = Type.Object(
  { max: PosInt, reset_on: Type.Optional(Type.Union([ResetEdge, Type.Array(ResetEdge, { minItems: 1 })])) },
  closed,
);
export type CounterDoc = Static<typeof CounterDoc>;

/** Limits for every step that sets none of its own; `stalled` only here. */
export const StepDefaultsDoc = Type.Object(
  { deadline: Type.Optional(Duration), nudges: Type.Optional(Type.Integer({ minimum: 0 })), retries: Type.Optional(Type.Integer({ minimum: 0 })), stalled: Type.Optional(Duration) },
  closed,
);
export type StepDefaultsDoc = Static<typeof StepDefaultsDoc>;

/** When a waiting story counts as stale, the step a branch update re-enters, and the check that re-verifies it. */
export const BaseDoc = Type.Object(
  { stale: Type.Optional(Type.Union([Type.Literal("conflict"), Type.Literal("behind")])), step: Type.Optional(StepName), verify: Type.Optional(StepName) },
  closed,
);
export type BaseDoc = Static<typeof BaseDoc>;

/** A signal's settings for the whole workflow: when `vcs.stale` fires, and the check that re-verifies a base move without a conflict. */
const SignalSettingsDoc = Type.Object({ when: Type.Optional(BaseDoc.properties.stale), verify: Type.Optional(StepName) }, closed);

/**
 * A place a workflow's steps read that is neither norn's nor the repo's code: named portably in the
 * workflow, and bound to a path by `path:` (relative to the repo's root) or by the machine's config,
 * which wins. A step reads it by name; one nothing binds holds the step for a person.
 */
export const SourceDoc = Type.Object(
  {
    type: Type.Union([Type.Literal("folder"), Type.Literal("file")]),
    path: Type.Optional(Type.String({ minLength: 1, pattern: "\\S", description: "Relative to the repo's root; the config's binding wins" })),
    description: Type.Optional(Type.String()),
  },
  closed,
);
export type SourceDoc = Static<typeof SourceDoc>;
export const SourcesDoc = Type.Record(Type.String({ pattern: OUTCOME_NAME_PATTERN }), SourceDoc, closed);

/** What only a workflow file holds: `signals:` and `entries:`, lowered into the pinned document's `base:`. */
const FILE_KEYS = {
  signals: Type.Optional(Type.Record(SignalSurfaceName, SignalSettingsDoc, closed)),
  /** a way back into the workflow by name (`update-branch`) → the step it enters */
  entries: Type.Optional(Type.Record(Type.String({ pattern: "^[a-z][a-z0-9_-]*$" }), StepName, closed)),
};

function workflowProps<S extends TSchema>(step: S) {
  return {
    $schema: Type.Optional(Type.String()),
    name: Type.String({ pattern: "^[a-z][a-z0-9_-]*$" }),
    description: Type.Optional(Type.String()),
    mode: Type.Optional(Mode),
    defaults: Type.Optional(StepDefaultsDoc),
    start: StepName,
    steps: Type.Record(StepName, step, { ...closed, minProperties: 1 }),
    counters: Type.Optional(Type.Record(DocCounterName, CounterDoc, closed)),
    base: Type.Optional(BaseDoc),
    sources: Type.Optional(SourcesDoc),
  };
}

/** The flat document a unit pins: routes only under `outcomes:`, what each outcome means and needs in the step's maps. */
export const WorkflowDocument = Type.Object(workflowProps(WorkflowStepDoc), { ...closed, title: "WorkflowDocument" });
export type WorkflowDocument = Static<typeof WorkflowDocument>;
/** A workflow file: a pinned document's form, or outcomes written as objects. */
export const WorkflowFile = Type.Object({ ...workflowProps(WorkflowFileStepDoc), ...FILE_KEYS }, { ...closed, title: "WorkflowFile" });
export type WorkflowFile = Static<typeof WorkflowFile>;

/** A file of shared steps a workflow brings in with `use:`, entered at `start` and left through its exits. */
export const SharedWorkflowDocument = Type.Object(
  {
    $schema: Type.Optional(Type.String()),
    description: Type.Optional(Type.String()),
    start: StepName,
    steps: Type.Record(StepName, SharedStepDoc, { ...closed, minProperties: 1 }),
  },
  { ...closed, title: "SharedWorkflowDocument" },
);
export type SharedWorkflowDocument = Static<typeof SharedWorkflowDocument>;
