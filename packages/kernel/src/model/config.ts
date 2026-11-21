/**
 * The settings decide and the workflow loader read. Every retry, nudge and route back is bounded by a
 * number here or in the workflow, so nothing loops without a counter that ends in a visible stuck.
 */
import { Mode, NonEmpty, PosInt } from "@norn/schema";
import { type Static, Type } from "@sinclair/typebox";

const closed = { additionalProperties: false } as const;
const Count = Type.Integer({ minimum: 0 });

/**
 * The bound a route back gets from the kind of its edge when the author writes none: a check's
 * `fail`, a gate's `reject`, a `conflict` (reset whenever its step ends another way), a `stale`, and
 * any other route back from an agent step. A named counter shared by several edges keeps its own `max`.
 */
export const CounterDefaults = Type.Object(
  { checkFail: PosInt, gateReject: PosInt, conflict: PosInt, stale: PosInt, agentBack: PosInt },
  { ...closed, title: "CounterDefaults" },
);
export type CounterDefaults = Static<typeof CounterDefaults>;

export const KernelConfig = Type.Object(
  {
    counterDefaults: CounterDefaults,
    /** a working session with no event for this long is silent */
    silentAfterMs: PosInt,
    /** nudges per session when a step sets none (workflow `nudges:`) */
    maxNudges: Count,
    /** fresh-session retries per step visit when a step sets none (workflow `retries:`) */
    maxRetries: Count,
    /** an agent step's deadline when neither the step nor the workflow's defaults set one; null: none */
    deadlineMs: Type.Union([PosInt, Type.Null()]),
    /** how stories run when neither the story nor its workflow says */
    mode: Mode,
    /** the executor an agent step runs on when it names none with `by:` and `bind` binds neither its step nor its role */
    executor: NonEmpty,
    /**
     * A step (`<workflow>.<step>`) or an agent role → the executors it runs on, first match first: the
     * first one configured, with presence when a person stays beside the step, and a harness that denies
     * a tool when the step writes only docs. A step's binding outranks its role's. Absent: none.
     */
    bind: Type.Optional(Type.Record(NonEmpty, Type.Array(NonEmpty, { minItems: 1 }))),
    /** the workflow a story takes at intake when its item names none */
    workflow: NonEmpty,
    /**
     * The label prefix by which an item names its workflow at intake (`norn:wf:quick`); read once, as
     * the person's choice, never again as state. Absent: `norn:wf:`.
     */
    intakeWorkflowLabelPrefix: Type.Optional(NonEmpty),
    /** the workflow each slice runs */
    sliceWorkflow: NonEmpty,
    /**
     * The branch a story's change is for, as the forge names it: a change merged into any other
     * branch did not land the story. Absent: a change merged into any branch lands it.
     */
    base: Type.Optional(NonEmpty),
    /**
     * Each workflow source this machine binds → its path, which wins over the workflow's own `path:`;
     * a step reading a source neither binds parks `source.unbound`. Absent: none.
     */
    sources: Type.Optional(Type.Record(NonEmpty, NonEmpty)),
    /** how long a claim holds, and how long before it expires the holder renews it */
    claimTtlMs: PosInt,
    claimRenewBeforeMs: PosInt,
  },
  { ...closed, title: "KernelConfig" },
);
export type KernelConfig = Static<typeof KernelConfig>;

/** The old engine's bounds, kept so a workflow loads to the same counters it did. */
export const DEFAULT_COUNTER_DEFAULTS: CounterDefaults = { checkFail: 5, gateReject: 2, conflict: 2, stale: 10, agentBack: 3 };

/** The intake label prefix when the config names none, the one `norn new --workflow` writes. */
export const DEFAULT_WORKFLOW_LABEL_PREFIX = "norn:wf:";

export const DEFAULT_KERNEL_CONFIG: KernelConfig = {
  counterDefaults: DEFAULT_COUNTER_DEFAULTS,
  silentAfterMs: 15 * 60_000,
  maxNudges: 2,
  maxRetries: 1,
  deadlineMs: 60 * 60_000,
  mode: "manual",
  executor: "claude",
  workflow: "story",
  intakeWorkflowLabelPrefix: DEFAULT_WORKFLOW_LABEL_PREFIX,
  sliceWorkflow: "slice",
  base: "main",
  claimTtlMs: 10 * 60_000,
  claimRenewBeforeMs: 400_000,
};
