/**
 * A unit's run state: the kernel's own document, kept by a store inside its versioned envelope. It
 * is written last, after the receipts it applies, and is the commit point: whatever a crash leaves,
 * the state names the receipts it covers (`applied_through`) and the rest are replayed.
 *
 * Readers accept `format` N and N-1: a reader one format behind upgrades by rule in the journal, never
 * by guessing; any other format, or a document that fails this schema, makes the unit corrupt.
 */
import { IsoTime, Mode, NonEmpty, NonNegInt, PosInt, StepName } from "@norn/schema";
import { type Static, Type } from "@sinclair/typebox";
import { GraphCounterName, PinnedWorkflow } from "../workflow/graph.ts";

const closed = { additionalProperties: false } as const;

export const RUN_STATE_FORMAT = 1;
/** The formats a reader of this build accepts. */
export const READABLE_RUN_STATE_FORMATS: readonly number[] = [RUN_STATE_FORMAT];

/** The code level of an agent run that may not keep code: it only reads, or changes it for the run alone. */
export const GuardedCode = Type.Union([Type.Literal("read"), Type.Literal("scratch")]);
export type GuardedCode = Static<typeof GuardedCode>;

/** The run in progress for the current step and attempt: an agent's session, a check, or a plugin step. */
export const RunInfo = Type.Object(
  {
    id: NonEmpty,
    step: StepName,
    attempt: PosInt,
    started_at: IsoTime,
    /** the executor (agents), `check`, or the plugin step kind's name */
    executor: NonEmpty,
    attended: Type.Boolean(),
    /** the harness's own session id, once known, so a retry or an answer can resume it */
    session: Type.Optional(NonEmpty),
    /** nudges sent into this session; a fresh session starts again at 0 */
    nudges: NonNegInt,
    /** when the last nudge was sent (its receipt's time), so a session not yet past it is not nudged again */
    last_nudge_at: Type.Optional(IsoTime),
    /** times a check or effect step run was run again under this run; bounded by the retries */
    resumes: Type.Optional(NonNegInt),
    /** when norn ordered the run stopped, so the order is sent once and a session that outlives it is judged dead */
    stopped_at: Type.Optional(IsoTime),
    /** the reset of the last usage limit the session hit; the run's deadline counts from it, never through the wait */
    limited_until: Type.Optional(IsoTime),
    /** the agent run may not keep code: what it changed is checked against the visit's snapshot once it reports; absent, it keeps its commits */
    code: Type.Optional(GuardedCode),
    /** a digest of the agent's hook config as its launch left it; `norn done` is refused once it differs */
    hooks: Type.Optional(Type.String({ pattern: "^[0-9a-f]{64}$" })),
  },
  { ...closed, title: "RunInfo" },
);
export type RunInfo = Static<typeof RunInfo>;

/**
 * The park of an agent waiting on a person's answer, whether it asked (`norn ask`) or its session
 * showed a question: answered with `norn story answer`, never a rerun.
 */
export const ASKED_PARK = "agent.asked";

/**
 * Why a unit waits for a person, and since when; a parked unit takes no action until a receipt moves
 * it. `reason` is a code or a short reason; `text` is what the agent asked, shown and never decided on.
 */
export const ParkInfo = Type.Object({ reason: NonEmpty, since: IsoTime, text: Type.Optional(NonEmpty) }, { ...closed, title: "ParkInfo" });
export type ParkInfo = Static<typeof ParkInfo>;

export const Ended = Type.Union([Type.Literal("done"), Type.Literal("stuck"), Type.Literal("corrupt")]);
export type Ended = Static<typeof Ended>;

export const RunState = Type.Object(
  {
    format: Type.Literal(RUN_STATE_FORMAT),
    /** `gh-12` or `gh-12/03` */
    unit: NonEmpty,
    story: NonEmpty,
    workflow: PinnedWorkflow,
    /** the step the unit is at; once ended, the step it ended from */
    step: StepName,
    /** visits to the current step since the round started, from 1 */
    attempt: PosInt,
    /**
     * visits to each step this round, which `attempt` is read from on entering a step again; absent
     * until the unit first leaves its start step, when it reads as the current step at `attempt`
     */
    visits: Type.Optional(Type.Record(StepName, PosInt)),
    counters: Type.Record(GraphCounterName, NonNegInt),
    /**
     * the receipt whose outcome sent the work back into this visit of an agent step (a red check, a
     * reject, findings handed back, a counted edge); absent when the step was entered forward, by a
     * person's move or a new round. Kept on the state because decide sees only receipts not yet applied.
     */
    rework_from: Type.Optional(PosInt),
    /**
     * the signals fired this round, each once per occurrence: a level still true at the next visit
     * (red CI on the same head) is left to the person rather than looping. Kept on the state because
     * decide sees only receipts not yet applied; a new round starts with none.
     */
    signals_fired: Type.Optional(Type.Array(Type.Object({ type: NonEmpty, id: NonEmpty }, closed))),
    /** fresh-session retries used in this visit to the step */
    retries_used: NonNegInt,
    run: Type.Union([RunInfo, Type.Null()]),
    /** the story's own mode, set by a person; absent takes the workflow's, then the config's */
    mode: Type.Optional(Mode),
    parked: Type.Optional(ParkInfo),
    /** a person asked for this visit's agent to start though manual mode holds it; entering a step drops it */
    requested: Type.Optional(Type.Object({ by: NonEmpty, at: IsoTime }, closed)),
    ended: Type.Optional(Ended),
    /** why it ended stuck or corrupt, shown to a person; names the counter when one ran out */
    ended_reason: Type.Optional(NonEmpty),
    /** the counter whose exhaustion ended it stuck */
    exhausted: Type.Optional(GraphCounterName),
    /** the highest receipt seq this state has applied; receipts above it are replayed */
    applied_through: NonNegInt,
  },
  { ...closed, title: "RunState" },
);
export type RunState = Static<typeof RunState>;
