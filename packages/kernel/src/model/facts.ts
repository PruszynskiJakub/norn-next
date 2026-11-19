/**
 * KernelFacts: everything decide reads about one tick, normalized and free of any provider's shape.
 * The host gathers them from the configured plugins and validates them here before decide runs, so
 * decide never sees a half-understood answer. Decide reads no prose: an item's body or a handoff never
 * appears here as something to branch on.
 */
import { ChangeRequest, ClaimRecord, StoredMessage, TrackerItem } from "@norn/plugin-api";
import { IsoTime, NonEmpty, OutcomeName, PosInt, Ulid } from "@norn/schema";
import { type Static, Type } from "@sinclair/typebox";
import { KernelCapabilities } from "./capabilities.ts";
import { KernelReceipt } from "./receipts.ts";
import { RunState } from "./run-state.ts";
import { SessionFactsSchema } from "./session.ts";

const closed = { additionalProperties: false } as const;

/** A check or plugin step the host is running or has run for the unit's current step and attempt. */
export const StepRunFacts = Type.Object(
  {
    /** `check` or the plugin step kind's name */
    kind: NonEmpty,
    running: Type.Boolean(),
    /** the outcome it answered, once it did and before its receipt is applied */
    outcome: Type.Optional(OutcomeName),
    /** why the last run failed without an outcome (the plugin's failure, a check that could not start), shown to a person */
    error: Type.Optional(Type.String()),
    /** what the step kind recorded with its outcome (a conflict's base commit and paths); carried into the receipt, never routed on */
    detail: Type.Optional(Type.Unknown()),
  },
  { ...closed, title: "StepRunFacts" },
);
export type StepRunFacts = Static<typeof StepRunFacts>;

export const UnitFacts = Type.Object(
  {
    /** `gh-12` or `gh-12/03` */
    id: NonEmpty,
    /** null: nothing committed yet (a unit not started) */
    state: Type.Union([RunState, Type.Null()]),
    /** the store's version of the committed state, the compare-and-swap a commit expects; null or absent: none committed */
    version: Type.Optional(Type.Union([PosInt, Type.Null()])),
    /** receipts above the state's `applied_through`, ascending by seq */
    receipts: Type.Array(KernelReceipt),
    /** why the unit's record failed validation; a corrupt unit is never guessed at */
    corrupt: Type.Optional(NonEmpty),
    /**
     * The corrupt record already holds the mark decide asked for (a `unit.marked` corrupt receipt,
     * appended beside what failed), so the unit is held rather than marked again every tick.
     */
    corrupt_marked: Type.Optional(Type.Boolean()),
    /** the classified session of the unit's current agent run, when there is one */
    session: Type.Union([SessionFactsSchema, Type.Null()]),
    /**
     * Whether the run's process still runs, probed only while its session has sent no event: an
     * agent whose hooks never loaded (a trust dialog in its pane) sends none, and is not dead.
     * Absent: not probed, or the runner could not tell.
     */
    run_alive: Type.Optional(Type.Boolean()),
    /**
     * The dialog the run's pane shows, as its runner read it, probed only while the process runs and
     * its session has sent no event: a prompt there (a trust dialog) holds the agent before any hook,
     * so the pane is the only place it can be seen. Absent: none, not probed, or the runner cannot read one.
     */
    run_dialog: Type.Optional(NonEmpty),
    step_run: Type.Optional(StepRunFacts),
  },
  { ...closed, title: "UnitFacts" },
);
export type UnitFacts = Static<typeof UnitFacts>;

/**
 * The story's slices as its slice files declare them, parsed by the host from their frontmatter;
 * decide reads only this structure, never a slice file's text.
 */
export const SlicePlan = Type.Object(
  {
    slices: Type.Array(
      Type.Object(
        {
          /** `gh-12/03` */
          unit: NonEmpty,
          /** units that must end done before this one starts */
          depends_on: Type.Array(NonEmpty),
          /** the workflow the slice runs, when its file names one; else the config's */
          workflow: Type.Optional(NonEmpty),
        },
        closed,
      ),
    ),
    /** why the slice files failed to parse or validate; decide then starts none */
    invalid: Type.Optional(NonEmpty),
  },
  { ...closed, title: "SlicePlan" },
);
export type SlicePlan = Static<typeof SlicePlan>;

export const StoryFacts = Type.Object(
  {
    key: NonEmpty,
    /** the tracker's item; null when the tracker no longer has it or none is configured */
    item: Type.Union([TrackerItem, Type.Null()]),
    /** the story's change request on the forge, any state; null when none */
    change: Type.Union([ChangeRequest, Type.Null()]),
    /** the claim as stored, expired or not; null when nobody holds it */
    claim: Type.Union([ClaimRecord, Type.Null()]),
    /** the story's own unit first, then its slices by number */
    units: Type.Array(UnitFacts),
    /** messages not yet acknowledged; empty when the store has no mailbox */
    mailbox: Type.Array(StoredMessage),
    /**
     * The base moved under the story the way the workflow's `base.stale` names. Reported by the host's
     * repository plugin, so a waiting gate can take its `stale` route without decide reading git.
     */
    base_stale: Type.Optional(Type.Boolean()),
    /**
     * The story's branch holds commits its open change lacks, beyond the spec folder. Reported by the
     * host's repository plugin, so a gate or wait step that routes `unpushed` sends the story back to
     * push them without decide reading git.
     */
    unpushed: Type.Optional(Type.Boolean()),
    /**
     * This clone's run data of the story and the remote's each hold writes the other lacks, so a
     * flush can publish neither. Reported by a shared store; absent or false otherwise.
     */
    unsynced: Type.Optional(Type.Boolean()),
    /** present once the story has slice files */
    plan: Type.Optional(SlicePlan),
  },
  { ...closed, title: "StoryFacts" },
);
export type StoryFacts = Static<typeof StoryFacts>;

export const KernelFacts = Type.Object(
  {
    /** a ULID; decide derives every id of the tick from it, so one set of facts decides alike twice */
    tick_id: Ulid,
    now: IsoTime,
    /** who this machine claims as */
    holder: NonEmpty,
    capabilities: KernelCapabilities,
    stories: Type.Array(StoryFacts),
    /** open items matching the intake query that are not stories yet */
    intake: Type.Array(TrackerItem),
  },
  { ...closed, title: "KernelFacts" },
);
export type KernelFacts = Static<typeof KernelFacts>;
