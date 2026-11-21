/**
 * What decide asks the host to do, one action per unit per tick, each naming the rule that fired.
 * Actions are generic: none names a provider, and a plugin step is run through `run_step` whatever it
 * does. An action that has an effect carries the receipt the host writes before performing it
 * (`intent`), under an id derived from the tick, so a replayed tick writes and performs nothing twice.
 */
import { TrackerItem } from "@norn/plugin-api";
import { IsoTime, NonEmpty, PosInt, StepName, TaggedUnion } from "@norn/schema";
import { type Static, type TProperties, Type } from "@sinclair/typebox";
import { StepInputDoc } from "../workflow/document.ts";
import { CapabilitySchema } from "./grant.ts";
import { ReceiptIntent, RejectedReceipt } from "./receipts.ts";
import { GuardedCode, RunState, SupervisorSubject } from "./run-state.ts";

const closed = { additionalProperties: false } as const;
const Id = Type.String({ minLength: 1 });
const Sha256 = Type.String({ pattern: "^[0-9a-f]{64}$" });

/** Something a person should see: a question, a gate, a stuck unit. Text is passed through, never read by decide. */
export const InboxKind = Type.Union([
  Type.Literal("ask"),
  Type.Literal("permission"),
  Type.Literal("gate"),
  Type.Literal("attended"),
  Type.Literal("manual"),
  Type.Literal("limited"),
  Type.Literal("stuck"),
  Type.Literal("corrupt"),
  Type.Literal("workflow"),
]);
export type InboxKind = Static<typeof InboxKind>;

export const InboxItem = Type.Object(
  {
    kind: InboxKind,
    unit: NonEmpty,
    step: Type.Optional(StepName),
    /** the agent's question, the gate's prompt, or why the unit stopped */
    text: Type.Optional(Type.String()),
    options: Type.Optional(Type.Array(Type.String())),
    /** the session's input or permission id an answer goes to */
    input_id: Type.Optional(Id),
    since: IsoTime,
  },
  { ...closed, title: "InboxItem" },
);
export type InboxItem = Static<typeof InboxItem>;

/** What the host's brief builder needs to brief a run; references only, which the host resolves. */
export const BriefInputs = Type.Object(
  {
    workflow: NonEmpty,
    hash: Sha256,
    step: StepName,
    attempt: PosInt,
    skills: Type.Array(NonEmpty),
    inputs: Type.Array(StepInputDoc),
    model: Type.Optional(NonEmpty),
    /** the receipt whose findings or failure the run reworks (a red check, a reject), when there is one */
    rework_from: Type.Optional(PosInt),
    /** the step's effective grant, which the launcher guards, detection checks and the brief's Rules state; absent: nothing narrows it */
    grant: Type.Optional(Type.Array(CapabilitySchema)),
  },
  { ...closed, title: "BriefInputs" },
);
export type BriefInputs = Static<typeof BriefInputs>;

/** A slice decide starts: its unit and the workflow it pins. */
export const SliceStart = Type.Object({ unit: NonEmpty, workflow: NonEmpty, hash: Sha256 }, closed);
export type SliceStart = Static<typeof SliceStart>;

/** `unit`: the unit acted on, or null for a story-wide or tick-wide action; `rule`: the stable id of the rule that fired. */
const BASE = { unit: Type.Union([NonEmpty, Type.Null()]), rule: NonEmpty };

function action<K extends string, P extends TProperties>(kind: K, props: P) {
  return Type.Object({ kind: Type.Literal(kind), ...BASE, ...props }, closed);
}

const ACTIONS = [
  action("intake_story", { item: TrackerItem, workflow: NonEmpty }),
  action("claim", { story: NonEmpty, expect_version: Type.Union([PosInt, Type.Null()]) }),
  action("renew_claim", { story: NonEmpty }),
  action("release_claim", { story: NonEmpty }),
  /**
   * write `receipts` (if any), then commit `state` against `expect_version`; the commit point of every
   * routed outcome. `rejected` lists the refusals for a reader: each is already among `receipts` as a
   * `receipt.rejected`, and `state` applies those too when nothing else is left unapplied before them,
   * so a refusal costs no tick of its own. The `answer.sent` receipts it applies go to the run's session
   * first, except those `undelivered` names: no session can take them (it ended and its executor cannot
   * resume one, or none of its events are on this machine), so they are applied undelivered and the run's retry carries them in its brief.
   */
  action("apply_receipts", {
    receipts: Type.Array(ReceiptIntent),
    state: RunState,
    expect_version: Type.Union([PosInt, Type.Null()]),
    rejected: Type.Array(RejectedReceipt),
    /** ids of the `answer.sent` receipts the host applies without delivering */
    undelivered: Type.Optional(Type.Array(Id, { minItems: 1 })),
  }),
  action("start_run", {
    run_id: Id,
    executor: NonEmpty,
    attended: Type.Boolean(),
    brief: BriefInputs,
    /** the harness session to resume rather than start fresh */
    resume: Type.Optional(NonEmpty),
    intent: ReceiptIntent,
  }),
  /**
   * write `intent` (`supervisor.started`), then launch the supervisor on `executor` beside the step's
   * own run, briefed with the question `input_id` names or the gate, and record it again with its session
   */
  action("start_supervisor", { run_id: Id, executor: NonEmpty, subject: SupervisorSubject, input_id: Type.Optional(Id), intent: ReceiptIntent }),
  action("nudge", { run_id: Id, reason: NonEmpty, intent: ReceiptIntent }),
  /**
   * check a reported run that may not keep code before its report applies: write `intent` (`run.checking`),
   * kill the run's processes, compare what changed since the visit's snapshot by `code` and whether the
   * outcome `passes` the step, reset what may be reset, and record `run.checked`
   */
  action("check_run", { run_id: Id, code: GuardedCode, passes: Type.Boolean(), intent: ReceiptIntent }),
  /** the intent records the order, so it is sent once; absent on a stop no rule needs to remember */
  action("stop_run", { run_id: Id, reason: NonEmpty, intent: Type.Optional(ReceiptIntent) }),
  action("retry_run", {
    run_id: Id,
    previous_run_id: Id,
    executor: NonEmpty,
    attended: Type.Boolean(),
    brief: BriefInputs,
    intent: ReceiptIntent,
  }),
  action("run_check", {
    run_id: Id,
    step: StepName,
    attempt: PosInt,
    command: NonEmpty,
    timeout_ms: PosInt,
    /** `run.started`, or `run.resumed` when the check runs again under the run already on the record */
    intent: Type.Optional(ReceiptIntent),
  }),
  action("run_step", {
    run_id: Id,
    step: StepName,
    attempt: PosInt,
    step_kind: NonEmpty,
    mode: Type.Union([Type.Literal("effect"), Type.Literal("wait")]),
    config: Type.Record(Type.String(), Type.Unknown()),
    /** `run.started`, `run.resumed` for an effect run again under its run, absent on a `wait` poll after the first */
    intent: Type.Optional(ReceiptIntent),
  }),
  action("start_slices", { slices: Type.Array(SliceStart, { minItems: 1 }) }),
  action("mark_done", { intent: ReceiptIntent }),
  /**
   * write `intent` (a `unit.marked` corrupt receipt: the mark, kept even beside a record that fails
   * validation), then commit `state` when there is one; null when the record cannot be read
   */
  action("mark_corrupt", { reason: NonEmpty, intent: ReceiptIntent, state: Type.Union([RunState, Type.Null()]), expect_version: Type.Union([PosInt, Type.Null()]) }),
  /**
   * the unit waits for a person; the inbox item says what for. Write `intent` (a `unit.parked`
   * receipt), then commit `state` when there is one: a unit with no run state yet keeps the receipt
   * alone, which decide reads back so it does not park again
   */
  action("park", {
    reason: NonEmpty,
    inbox: Type.Union([InboxItem, Type.Null()]),
    intent: ReceiptIntent,
    state: Type.Union([RunState, Type.Null()]),
    expect_version: Type.Union([PosInt, Type.Null()]),
  }),
  action("notify", { item: InboxItem }),
  action("import_mailbox", { story: NonEmpty, ids: Type.Array(Id, { minItems: 1 }) }),
  /**
   * tidy a story that ended before its claim is given up: remove the worktrees of its units that
   * ended done, and close its item when the story itself ended done and the item is still open;
   * `effect_id` is the tracker's idempotence key for the close
   */
  action("finish_story", { story: NonEmpty, worktrees: Type.Array(NonEmpty), close_item: Type.Boolean(), effect_id: Id }),
  /** publish a shared store's run data for the story */
  action("flush", { story: NonEmpty }),
  action("noop", { reason: Type.String() }),
];

export const Decision = TaggedUnion("kind", ACTIONS, { title: "Decision", description: "One action decide asks for, with the unit and the rule that fired" });
export type Decision = Static<typeof Decision>;
export type ActionKind = Decision["kind"];
export type DecisionOf<K extends ActionKind> = Extract<Decision, { kind: K }>;
export const ACTION_KINDS = ACTIONS.map((a) => a.properties.kind.const) as ActionKind[];

type Without<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never;
/** An action before decide stamps the unit and rule on it. */
export type Action = Without<Decision, "unit" | "rule">;

/**
 * Actions on a whole story or the tick rather than one unit; their decisions carry `unit: null` and
 * name the story, so keeping a claim alive never takes the story unit's one action of the tick.
 */
export const STORY_ACTIONS: readonly ActionKind[] = ["intake_story", "claim", "renew_claim", "release_claim", "finish_story", "import_mailbox", "flush"];
