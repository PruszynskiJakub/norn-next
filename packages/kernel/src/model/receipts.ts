/**
 * Receipt data: what the kernel keeps inside a store's receipt envelope (`StoredReceipt.data`).
 * Receipts are immutable and numbered by the store; one is written before the effect it records, and
 * applyReceipts turns them into the next run state. A receipt names the step and attempt it was
 * written for, so one written for an earlier visit is refused rather than routing the current one.
 */
import { EndReason, ReportVerb } from "@norn/plugin-api";
import { IsoTime, Mode, NonEmpty, OutcomeName, PosInt, StepName, TaggedUnion } from "@norn/schema";
import { type Static, type TProperties, Type } from "@sinclair/typebox";
import { PinnedWorkflow } from "../workflow/graph.ts";
import { Ended } from "./run-state.ts";

const closed = { additionalProperties: false } as const;
const Id = Type.String({ minLength: 1 });

/** Every receipt may name the step and attempt it was written for; applyReceipts refuses a stale one. */
const HEADER = { step: Type.Optional(StepName), attempt: Type.Optional(PosInt) };

function kind<K extends string, P extends TProperties>(name: K, props: P) {
  return Type.Object({ kind: Type.Literal(name), ...HEADER, ...props }, closed);
}

/** How a run is carried out: an agent session, a check command, or a plugin step kind. */
export const RunKind = Type.Union([Type.Literal("agent"), Type.Literal("check"), Type.Literal("step")]);
export type RunKind = Static<typeof RunKind>;

/** How a run ended without a report: the harness's reasons, plus norn stopping it or its deadline passing. */
export const RunEndReason = Type.Union([EndReason, Type.Literal("stopped"), Type.Literal("timeout")]);
export type RunEndReason = Static<typeof RunEndReason>;

/** Outcomes the kernel classifies from a session rather than an agent reporting them; a step may route each. */
export const ClassifiedOutcome = Type.Union([
  Type.Literal("silent"),
  Type.Literal("died"),
  Type.Literal("timeout"),
  Type.Literal("stalled"),
  Type.Literal("ask"),
  Type.Literal("stuck"),
]);
export type ClassifiedOutcome = Static<typeof ClassifiedOutcome>;

export const GateOutcome = Type.Union([Type.Literal("approve"), Type.Literal("reject")]);
export type GateOutcome = Static<typeof GateOutcome>;

const KINDS = [
  kind("run.started", {
    run_id: Id,
    run_kind: RunKind,
    /** the executor (agents), `check`, or the step kind's name */
    executor: NonEmpty,
    attended: Type.Boolean(),
    /** the run this one replaces in a fresh session; counts against the step's retries */
    retry_of: Type.Optional(Id),
    /** the harness session, once the host knows it */
    session: Type.Optional(NonEmpty),
  }),
  kind("run.reported", { run_id: Id, verb: ReportVerb, outcome: Type.Optional(OutcomeName), text: Type.Optional(Type.String()) }),
  kind("run.ended", { run_id: Id, reason: RunEndReason }),
  /** an outcome the kernel read off the session (silent, died, ...), routed like a reported one */
  kind("run.classified", { run_id: Id, outcome: ClassifiedOutcome, rule: NonEmpty }),
  kind("check.finished", { run_id: Id, exit: Type.Integer({ minimum: 0, maximum: 255 }), outcome: OutcomeName }),
  kind("step.finished", { run_id: Type.Optional(Id), step_kind: NonEmpty, outcome: OutcomeName, detail: Type.Optional(Type.Unknown()) }),
  kind("gate.decided", {
    outcome: GateOutcome,
    by: NonEmpty,
    /** decided by someone acting for a person (a supervising agent), not the person themselves */
    delegated: Type.Optional(Type.Boolean()),
    reason: Type.Optional(Type.String()),
    /** set when the decision came through a run: a unit's own step agent may never decide its gate */
    run_id: Type.Optional(Id),
  }),
  kind("answer.sent", { input_id: Id, text: Type.String(), by: NonEmpty }),
  kind("nudge.sent", { run_id: Id, reason: NonEmpty }),
  /** a check or effect step run again under its run, after it was cut short or its plugin failed; counted against the retries */
  kind("run.resumed", { run_id: Id, reason: Type.Optional(Type.String()) }),
  /** norn ordered the run stopped (its deadline passed); the run is judged dead if its session outlives the order */
  kind("stop.sent", { run_id: Id, reason: NonEmpty }),
  /** the session hit a usage limit that resets at `resets_at`; the run's deadline counts from the reset */
  kind("run.limited", { run_id: Id, resets_at: IsoTime }),
  kind("round.started", { workflow: PinnedWorkflow, by: Type.Optional(NonEmpty) }),
  kind("unit.marked", { ended: Ended, reason: Type.Optional(NonEmpty) }),
  /** the unit waits for a person; `reason` names the rule that parked it, or why, and becomes the state's park */
  kind("unit.parked", { reason: NonEmpty }),
  kind("mode.changed", { mode: Mode, by: NonEmpty }),
  /** applyReceipts refused receipt `seq`; written so the refusal is on the record, never silent */
  kind("receipt.rejected", { seq: PosInt, reason: NonEmpty }),
];

export const ReceiptData = TaggedUnion("kind", KINDS, { title: "ReceiptData", description: "What one kernel receipt records" });
export type ReceiptData = Static<typeof ReceiptData>;
export type ReceiptKind = ReceiptData["kind"];
export type ReceiptDataOf<K extends ReceiptKind> = Extract<ReceiptData, { kind: K }>;
export const RECEIPT_KINDS = KINDS.map((k) => k.properties.kind.const) as ReceiptKind[];

/** A receipt as the journal hands it on: the store's envelope with the data validated. */
export const KernelReceipt = Type.Object({ seq: PosInt, id: Id, at: IsoTime, data: ReceiptData }, { ...closed, title: "KernelReceipt" });
export type KernelReceipt = Static<typeof KernelReceipt>;

/** A receipt the host is to write: a deterministic id (so a replay writes nothing twice) and its data. */
export const ReceiptIntent = Type.Object({ id: Id, data: ReceiptData }, { ...closed, title: "ReceiptIntent" });
export type ReceiptIntent = Static<typeof ReceiptIntent>;

/**
 * What a story's mailbox carries (`StoredMessage.data`): a receipt meant for one unit, sent from
 * another machine (an answer, a gate decision). Importing it records it as a receipt of that unit.
 */
export const MailboxLetter = Type.Object({ unit: NonEmpty, receipt: ReceiptData }, { ...closed, title: "MailboxLetter" });
export type MailboxLetter = Static<typeof MailboxLetter>;

/** A receipt applyReceipts refused, and why; the receipt stays, and `receipt.rejected` records the refusal. */
export const RejectedReceipt = Type.Object({ seq: PosInt, reason: NonEmpty }, closed);
export type RejectedReceipt = Static<typeof RejectedReceipt>;
