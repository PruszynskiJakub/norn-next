import { type Static, Type } from "@sinclair/typebox";
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
  Ulid,
  UnitDir,
} from "./common.ts";
import { SessionInfo } from "./receipt.ts";

/**
 * Unit lifecycle in state.json.
 * - ready: cursor step can start (manual: waits for `norn brief`; auto: tick launches; check/git: tick runs)
 * - running: a live run exists for the cursor step
 * - parked: waiting for a human in the normal flow (ask, gate, attended step)
 * - stuck: needs `norn run rerun` ($stuck, exhausted, remote change, missing step)
 * - done: reached `$done`
 * - corrupt: a file of this unit failed validation (S2); never guessed past
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
  Type.Literal("attended"),
  Type.Literal("stuck"),
  Type.Literal("exhausted"),
  Type.Literal("remote"),
  Type.Literal("workflow"),
  Type.Literal("corrupt"),
]);
export type ParkKind = Static<typeof ParkKind>;

export const ParkInfo = Type.Object(
  {
    kind: ParkKind,
    /** Human-readable reason, e.g. "review_loop 3/3 at review.changes_requested", "remote: issue closed". */
    reason: NonEmpty,
    since: IsoTime,
    /** receipt that caused the park (ask, stuck, classify) */
    receipt_id: Type.Optional(Ulid),
    /** ask park from a permission prompt: the pending command, e.g. `Bash(rm -rf build)` (§10, O1) */
    command: Type.Optional(NonEmpty),
    /**
     * R6.1 (A14): an implicit ask (classified from facts, not `norn ask`) and the fact that raised it:
     * the pane (`waiting_input`) or a hook. A later fact showing the agent moved on resolves it, and
     * agent reports are accepted while parked on it.
     */
    implicit: Type.Optional(Type.Union([Type.Literal("pane"), Type.Literal("hook")])),
    /** R6.2: the prompt's choices as the runner parsed them from the pane, in display order */
    options: Type.Optional(Type.Array(NonEmpty)),
    /** R6.2: how a choice is made: by its number, or by arrow keys from the `cursor` option */
    choice: Type.Optional(PromptChoice),
    /** L1 (A7): the full pane text of the prompt — shown by `inbox --details` and `why`, not in titles */
    screen: Type.Optional(NonEmpty),
  },
  { additionalProperties: false },
);
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
    /** R7.1: `user@host` that launched the run (from its `started` receipt); absent = this machine (older runs) */
    machine: Type.Optional(NonEmpty),
    /** R7.1: heartbeat that launched the run */
    heartbeat_id: Type.Optional(Ulid),
    /** R9.1 (A11): when the launch prompt was re-sent (once per run) after a SessionStart with no turn start */
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

/**
 * `runs/<unit>/state.json` — the commit point, written last (S5).
 * `step` is the cursor: a step name, or `$done` once finished.
 */
export const UnitState = Type.Object(
  {
    version: Type.Literal(1),
    story: StoryKey,
    /** null for the story unit (`_story`) */
    slice: Type.Union([SliceKey, Type.Null()]),
    unit_dir: UnitDir,
    workflow: NonEmpty,
    /** sha256 of the pinned runs/<unit>/workflow.yaml */
    workflow_hash: Type.String({ pattern: "^[0-9a-f]{64}$" }),
    step: Type.Union([StepName, Type.Literal("$done")]),
    /** Entries into the cursor step (1 on first entry, +1 on every re-entry). */
    attempt: PosInt,
    /** Entry count per step, so re-entry knows the next attempt. */
    visits: Type.Record(StepName, PosInt),
    step_entered_at: IsoTime,
    status: UnitStatus,
    park: Type.Union([ParkInfo, Type.Null()]),
    /** Workflow counters (W4): name → times its edge was taken. Live only here. */
    counters: Type.Record(CounterName, NonNegInt),
    /** Within-step limits used since step entry (C1); reset on entry. */
    nudges_used: NonNegInt,
    retries_used: NonNegInt,
    /** Number of the last applied receipt; 0 = none (S6). */
    applied_through: NonNegInt,
    run: Type.Union([RunInfo, Type.Null()]),
    last_outcome: Type.Union([LastOutcome, Type.Null()]),
    /**
     * gh-71 D2 (B1, B33): the story's round — on the story unit, the round this record is; on a slice, the
     * story round that started it. Absent = 1.
     */
    round: Type.Optional(PosInt),
    /** Story unit only: who starts unattended agent steps (MO1). */
    mode: Type.Optional(Mode),
    created_at: IsoTime,
    updated_at: IsoTime,
    last_tick_id: Type.Union([Ulid, Type.Null()]),
  },
  { $id: "https://norn.dev/schema/state.json", title: "norn unit state", additionalProperties: false },
);
export type UnitState = Static<typeof UnitState>;
