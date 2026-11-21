/**
 * A workflow as its file is written, in the wording the shipped workflows use, so they carry over
 * with at most mechanical edits. A step holds exactly one head key: a kernel built-in (`agent`,
 * `check`, `gate`, `slices`), `use` (a shared file's steps) or `like` (a copy of a sibling), or a step
 * kind a plugin provides (`open-pr:`, `await-merge:`), whose extra keys its `configSchema` checks.
 * The schema checks the keys it knows and lets the rest through; `loadWorkflow` decides which key is
 * the head and refuses a step whose head is unknown.
 */
import { Duration, Mode, NonEmpty, OUTCOME_NAME_PATTERN, OutcomeName, PosInt, StepName, StepWrites, StoredCounterName, Target, Verdict } from "@norn/schema";
import { type Static, type TSchema, Type } from "@sinclair/typebox";

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
 * brief builder resolves, or a file. Decide passes them through and never opens them.
 */
export const StepInputDoc = Type.Union([
  Type.String({ pattern: OUTCOME_NAME_PATTERN }),
  Type.Object({ file: NonEmpty, label: Type.Optional(NonEmpty) }, closed),
]);
export type StepInputDoc = Static<typeof StepInputDoc>;

const EXIT_CODE_PATTERN = "^(?:[1-9]|[1-9][0-9]|1[0-9]{2}|2[0-4][0-9]|25[0-5])$";
const SharedName = Type.String({ pattern: "^[a-z][a-z0-9_-]*$", description: "A shared file's name, without `.yaml`" });

function stepDoc<R extends TSchema, O extends TSchema>(route: R, onRoute: O) {
  return Type.Object(
    {
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
      skills: Type.Optional(Type.Array(NonEmpty, { uniqueItems: true })),
      inputs: Type.Optional(Type.Array(StepInputDoc, { uniqueItems: true })),
      attended: Type.Optional(Type.Boolean({ description: "Worked with a person; always started by a person" })),
      by: Type.Optional(Type.String({ minLength: 1, description: "The executor that runs the agent; default the config's" })),
      model: Type.Optional(NonEmpty),
      criteria: Type.Optional(Type.Literal("required")),
      hand_back: Type.Optional(Type.Record(OutcomeName, HandBack, { ...closed, minProperties: 1 })),
      writes: Type.Optional(StepWrites),
      deadline: Type.Optional(Duration),
      nudges: Type.Optional(Type.Integer({ minimum: 0 })),
      retries: Type.Optional(Type.Integer({ minimum: 0 })),
      timeout: Type.Optional(Duration),
      exits: Type.Optional(Type.Record(Type.String({ pattern: EXIT_CODE_PATTERN }), OutcomeName, { ...closed, minProperties: 1 })),
    },
    // a plugin step kind's head and config keys are checked by the loader against the kind's configSchema
    { additionalProperties: true },
  );
}

export const WorkflowStepDoc = stepDoc(Route, OnRoute);
export type WorkflowStepDoc = Static<typeof WorkflowStepDoc>;
export const SharedStepDoc = stepDoc(SharedRoute, SharedOnRoute);
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

export const WorkflowDocument = Type.Object(
  {
    $schema: Type.Optional(Type.String()),
    name: Type.String({ pattern: "^[a-z][a-z0-9_-]*$" }),
    description: Type.Optional(Type.String()),
    mode: Type.Optional(Mode),
    defaults: Type.Optional(StepDefaultsDoc),
    start: StepName,
    steps: Type.Record(StepName, WorkflowStepDoc, { ...closed, minProperties: 1 }),
    counters: Type.Optional(Type.Record(DocCounterName, CounterDoc, closed)),
    base: Type.Optional(BaseDoc),
  },
  { ...closed, title: "WorkflowDocument" },
);
export type WorkflowDocument = Static<typeof WorkflowDocument>;

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
