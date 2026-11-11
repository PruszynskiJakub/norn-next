import { type Static, type TSchema, Type } from "@sinclair/typebox";
import {
  CounterName,
  IsoTime,
  Mode,
  NonEmpty,
  NonNegInt,
  OutcomeName,
  PosInt,
  ProcessIdentity,
  PromptChoice,
  SliceKey,
  StepName,
  StoryKey,
  TaggedUnion,
  Ulid,
  UnitDir,
} from "./common.ts";
import { SessionInfo } from "./receipt.ts";

/**
 * Unit lifecycle in state.json.
 * - ready: cursor step can start (manual: waits for `norn brief`; auto: tick launches; check/git: tick runs)
 * - running: a live run exists for the cursor step
 * - parked: waiting for a human in the normal flow (ask, gate, merge step, attended step)
 * - stuck: needs `norn run rerun` ($stuck, exhausted, remote change, missing step)
 * - done: reached `$done`
 * - corrupt: a file of this unit failed validation; never guessed past
 */
export const UnitStatus = Type.Union([
  Type.Literal("ready"),
  Type.Literal("running"),
  Type.Literal("parked"),
  Type.Literal("stuck"),
  Type.Literal("done"),
  Type.Literal("corrupt"),
]);
export type UnitStatus = Static<typeof UnitStatus>;

export const ParkKind = Type.Union([
  Type.Literal("ask"),
  Type.Literal("gate"),
  Type.Literal("merge"),
  Type.Literal("attended"),
  Type.Literal("stuck"),
  Type.Literal("exhausted"),
  Type.Literal("remote"),
  Type.Literal("workflow"),
  Type.Literal("corrupt"),
]);
export type ParkKind = Static<typeof ParkKind>;

/** The park kinds a `parked` unit holds: it waits for a person in the normal flow. */
export const ParkedKind = Type.Union([Type.Literal("ask"), Type.Literal("gate"), Type.Literal("merge"), Type.Literal("attended")]);
export type ParkedKind = Static<typeof ParkedKind>;

/** The park kinds a `stuck` unit holds: it waits for `norn run rerun`. */
export const StuckKind = Type.Union([Type.Literal("stuck"), Type.Literal("exhausted"), Type.Literal("remote"), Type.Literal("workflow")]);
export type StuckKind = Static<typeof StuckKind>;

const parkFields = {
    /** Human-readable reason, e.g. "review_loop 3/3 at review.changes_requested", "remote: issue closed". */
    reason: NonEmpty,
    since: IsoTime,
    /** receipt that caused the park (ask, stuck, classify) */
    receipt_id: Type.Optional(Ulid),
    /**
     * ask park from a permission prompt: the pending command, e.g. `Bash(rm -rf build)`;
     * a `workflow` park of a rejected round receipt: the edit to run again
     */
    command: Type.Optional(NonEmpty),
    /**
     * An implicit ask (classified from facts, not `norn ask`) and the fact that raised it:
     * the pane (`waiting_input`) or a hook. A later fact showing the agent moved on resolves it, and
     * agent reports are accepted while parked on it.
     */
    implicit: Type.Optional(Type.Union([Type.Literal("pane"), Type.Literal("hook")])),
    /** The prompt's choices as the runner parsed them from the pane, in display order */
    options: Type.Optional(Type.Array(NonEmpty)),
    /** How a choice is made: by its number, or by arrow keys from the `cursor` option */
    choice: Type.Optional(PromptChoice),
    /** The full pane text of the prompt — shown by `inbox --details` and `why`, not in titles */
    screen: Type.Optional(NonEmpty),
    /**
     * An `exhausted` park from a counted edge: the counter that ran out, the outcome whose
     * edge it guards and that edge's target — so the way out (`run rerun --step <to> --reset <counter>`)
     * is read from state, never parsed from `reason`
     */
    counter: Type.Optional(
      Type.Object({ name: CounterName, max: NonNegInt, outcome: OutcomeName, to: NonEmpty }, { additionalProperties: false }),
    ),
};

/** A park whose kind is one of `kind`; `kind` comes first, as every writer builds it. */
const parkOf = <K extends TSchema>(kind: K) => Type.Object({ kind, ...parkFields }, { additionalProperties: false });

export const ParkInfo = parkOf(ParkKind);
export type ParkInfo = Static<typeof ParkInfo>;

/** The live (or last) run of the cursor step. */
export const RunInfo = Type.Object(
  {
    run_id: Ulid,
    step: StepName,
    attempt: PosInt,
    started_at: IsoTime,
    how: Type.Union([Type.Literal("manual"), Type.Literal("auto"), Type.Literal("tick")]),
    agent: Type.Optional(NonEmpty),
    model: Type.Optional(NonEmpty),
    session: Type.Optional(SessionInfo),
    agent_session_id: Type.Optional(NonEmpty),
    process: Type.Optional(ProcessIdentity),
    transcript: Type.Optional(NonEmpty),
    /** `user@host` that launched the run (from its `started` receipt); absent = this machine (older runs) */
    machine: Type.Optional(NonEmpty),
    heartbeat_id: Type.Optional(Ulid),
    /** When the launch prompt was re-sent (once per run) after a SessionStart with no turn start */
    prompt_resent_at: Type.Optional(IsoTime),
  },
  { additionalProperties: false },
);
export type RunInfo = Static<typeof RunInfo>;

export const LastOutcome = Type.Object(
  {
    step: StepName,
    outcome: OutcomeName,
    source: Type.Union([Type.Literal("reported"), Type.Literal("classified"), Type.Literal("human")]),
    at: IsoTime,
    receipt_id: Ulid,
  },
  { additionalProperties: false },
);
export type LastOutcome = Static<typeof LastOutcome>;

const Ended = Type.Object({ by: Type.Literal("person"), at: StepName, receipt_id: Ulid }, { additionalProperties: false });
const Cursor = Type.Union([StepName, Type.Literal("$done")]);

/**
 * The fields of state.json in their written order. `status`, `step`, `park` and `run` are
 * the ones a variant narrows; `ended` is legal only where a variant keeps it.
 */
const stateFields = <S extends TSchema, C extends TSchema, P extends TSchema, R extends TSchema>(status: S, step: C, park: P, run: R) => ({
  version: Type.Literal(1),
  story: StoryKey,
  /** null for the story unit (`_story`) */
  slice: Type.Union([SliceKey, Type.Null()]),
  unit_dir: UnitDir,
  workflow: NonEmpty,
  /** sha256 of the pinned runs/<unit>/workflow.yaml */
  workflow_hash: Type.String({ pattern: "^[0-9a-f]{64}$" }),
  /** The cursor: a step name, or `$done` once finished. */
  step,
  /** Entries into the cursor step (1 on first entry, +1 on every re-entry). */
  attempt: PosInt,
  /** Entry count per step, so re-entry knows the next attempt. */
  visits: Type.Record(StepName, PosInt),
  step_entered_at: IsoTime,
  status,
  park,
  /** Workflow counters: name → times its edge was taken. Live only here. */
  counters: Type.Record(CounterName, NonNegInt),
  /** Within-step limits used since step entry; reset on entry. */
  nudges_used: NonNegInt,
  retries_used: NonNegInt,
  /** Number of the last applied receipt; 0 = none. */
  applied_through: NonNegInt,
  run,
  last_outcome: Type.Union([LastOutcome, Type.Null()]),
  /**
   * The story's round — on the story unit, the round this record is; on a slice, the
   * story round that started it. Absent = 1.
   */
  round: Type.Optional(PosInt),
  /**
   * A round the person ended unfinished with `norn story edit --force` — the step it
   * was left at and the `round` receipt that ended it. Absent = the round finished at `$done` (or runs).
   */
  ended: Type.Optional(Ended),
  /** Story unit only: who starts unattended agent steps. */
  mode: Type.Optional(Mode),
  created_at: IsoTime,
  updated_at: IsoTime,
  last_tick_id: Type.Union([Ulid, Type.Null()]),
});

const withoutEnded = <T extends { ended: unknown }>(fields: T): Omit<T, "ended"> => {
  const { ended: _, ...rest } = fields;
  return rest;
};

/**
 * `runs/<unit>/state.json` as read: the flat shape older norns and older branches wrote,
 * which admits contradictions (running without a run, done at a step). Store reads this and core
 * `normalizeUnitState` turns it into a `UnitState`; a write is checked against it too, so a writer
 * bug that slips past the types is written as it is and read back normalised, never thrown between
 * the receipts and state.json.
 */
export const UnitStateRecord = Type.Object(
  stateFields(UnitStatus, Cursor, Type.Union([ParkInfo, Type.Null()]), Type.Union([RunInfo, Type.Null()])),
  { $id: "https://norn.dev/schema/state-record.json", title: "norn unit state as read (older shapes included)", additionalProperties: false },
);
export type UnitStateRecord = Static<typeof UnitStateRecord>;

const closed = { additionalProperties: false } as const;

/** The cursor step can start: nothing runs and nothing waits. */
export const ReadyState = Type.Object(withoutEnded(stateFields(Type.Literal("ready"), StepName, Type.Null(), Type.Null())), closed);
/** A live run exists for the cursor step. */
export const RunningState = Type.Object(withoutEnded(stateFields(Type.Literal("running"), StepName, Type.Null(), RunInfo)), closed);
/** Waits for a person in the normal flow; an ask keeps the run it interrupted. */
export const ParkedState = Type.Object(
  withoutEnded(stateFields(Type.Literal("parked"), StepName, parkOf(ParkedKind), Type.Union([RunInfo, Type.Null()]))),
  closed,
);
/**
 * Waits for `norn run rerun`. At `$done` only with a `remote` park (a finished round held
 * for a problem with its PR, still finished) or a `workflow` park (a round receipt rejected
 * because its workflow file changed, not finished). The schema cannot say this, since the
 * discriminator needs each status in exactly one branch; the writers keep it. A state.json
 * an older norn wrote can still sit at `$done` on another stuck kind; it reads as stuck, for
 * a person to rerun.
 */
export const StuckState = Type.Object(
  withoutEnded(stateFields(Type.Literal("stuck"), Cursor, parkOf(StuckKind), Type.Union([RunInfo, Type.Null()]))),
  closed,
);
/** Reached `$done`. Its park is only a `workflow` one: a round receipt rejected because its workflow file changed. */
export const DoneState = Type.Object(
  stateFields(Type.Literal("done"), Type.Literal("$done"), Type.Union([Type.Null(), parkOf(Type.Literal("workflow"))]), Type.Null()),
  closed,
);
/** A file of this unit failed validation; never guessed past. */
export const CorruptState = Type.Object(
  stateFields(Type.Literal("corrupt"), Cursor, parkOf(Type.Literal("corrupt")), Type.Union([RunInfo, Type.Null()])),
  closed,
);
export type ReadyState = Static<typeof ReadyState>;
export type RunningState = Static<typeof RunningState>;
export type ParkedState = Static<typeof ParkedState>;
export type StuckState = Static<typeof StuckState>;
export type DoneState = Static<typeof DoneState>;
export type CorruptState = Static<typeof CorruptState>;

/**
 * `runs/<unit>/state.json` — the commit point, written last. One variant per status, each
 * carrying only the fields legal in it.
 */
export const UnitState = TaggedUnion("status", [ReadyState, RunningState, ParkedState, StuckState, DoneState, CorruptState], {
  $id: "https://norn.dev/schema/state.json",
  title: "norn unit state",
});
export type UnitState = Static<typeof UnitState>;
