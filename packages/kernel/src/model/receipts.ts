/**
 * Receipt data: what the kernel keeps inside a store's receipt envelope (`StoredReceipt.data`).
 * Receipts are immutable and numbered by the store; one is written before the effect it records, and
 * applyReceipts turns them into the next run state. A receipt names the step and attempt it was
 * written for, so one written for an earlier visit is refused rather than routing the current one.
 */
import { EndReason, ReportVerb } from "@norn/plugin-api";
import { CriterionVerdict, Finding, IsoTime, Mode, NonEmpty, Note, OutcomeName, PosInt, ReportEvidence, SignalRef, StepName, TaggedUnion } from "@norn/schema";
import { type Static, type TProperties, Type } from "@sinclair/typebox";
import { GraphCounterName, PinnedWorkflow } from "../workflow/graph.ts";
import { Ended, GuardedCode, SupervisorSubject } from "./run-state.ts";

const closed = { additionalProperties: false } as const;
const Id = Type.String({ minLength: 1 });

/** Every receipt may name the step and attempt it was written for; applyReceipts refuses a stale one. */
const HEADER = { step: Type.Optional(StepName), attempt: Type.Optional(PosInt) };

function kind<K extends string, P extends TProperties>(name: K, props: P) {
  return Type.Object({ kind: Type.Literal(name), ...HEADER, ...props }, closed);
}

/**
 * What an agent could change, as the vcs noted it (`VcsSnapshot`) with the remote's copy of the unit's
 * branch: HEAD and the remote head are commits, the tree a tree object, the rest opaque digests.
 */
export const RunSnapshot = Type.Object(
  {
    head: Type.Union([NonEmpty, Type.Null()]),
    tree: NonEmpty,
    refs: NonEmpty,
    config: NonEmpty,
    hooks: NonEmpty,
    remote: Type.Union([NonEmpty, Type.Null()]),
  },
  { ...closed, title: "RunSnapshot" },
);
export type RunSnapshot = Static<typeof RunSnapshot>;

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
    /** the agent may not keep code, so the host notes what it could change before it starts (`run.snapshot`) */
    code: Type.Optional(GuardedCode),
    /** a digest of the agent's hook config as the launch left it, which `norn done` holds the run to */
    hooks: Type.Optional(Type.String({ pattern: "^[0-9a-f]{64}$" })),
  }),
  /**
   * what the agent of a run that may not keep code could change, noted after its intent and before it
   * starts: the visit's first snapshot, which a retry is checked against too; or why it could not be
   * taken, which parks the unit stuck and never lets the run start
   */
  kind("run.snapshot", { run_id: Id, snapshot: Type.Optional(RunSnapshot), failed: Type.Optional(NonEmpty) }),
  /** the host is about to check a reported run that may not keep code: kill its processes, compare, reset; written before any of it */
  kind("run.checking", { run_id: Id }),
  /**
   * how the check went: `clean`, `reset` (the paths put back as the snapshot held them, and HEAD with
   * `head`), `refused` (the report may not stand) or `failed` (it could not be told); the last two park
   * the unit stuck and refuse the report they follow
   */
  kind("run.checked", {
    run_id: Id,
    verdict: Type.Union([Type.Literal("clean"), Type.Literal("reset"), Type.Literal("refused"), Type.Literal("failed")]),
    reset: Type.Optional(Type.Array(NonEmpty)),
    head: Type.Optional(Type.Boolean()),
    /** what the check found, for a person: why it refused or failed, and anything it only notes */
    detail: Type.Optional(NonEmpty),
  }),
  kind("run.reported", {
    run_id: Id,
    verb: ReportVerb,
    outcome: Type.Optional(OutcomeName),
    text: Type.Optional(Type.String()),
    /** a `done`'s criteria report, one verdict per criterion: what a later step, a gate and a retro read back */
    criteria: Type.Optional(Type.Array(CriterionVerdict, { minItems: 1 })),
    /** a `done`'s findings (`--findings`), what the step it sends the work back to reworks */
    findings: Type.Optional(Type.Array(Finding, { minItems: 1 })),
    /** notes for a person the report carried; they never block and never change the route */
    notes: Type.Optional(Type.Array(Note, { minItems: 1 })),
    /** the commit a QA report's evidence files were kept in, for the pull request to link; decide never reads it */
    evidence: Type.Optional(ReportEvidence),
  }),
  kind("run.ended", { run_id: Id, reason: RunEndReason }),
  /** an outcome the kernel read off the session (silent, died, ...), routed like a reported one */
  kind("run.classified", {
    run_id: Id,
    outcome: ClassifiedOutcome,
    rule: NonEmpty,
    /** the error the run's last turn stopped on, kept in the reason the unit ends stuck with */
    error: Type.Optional(Type.String({ minLength: 1 })),
  }),
  kind("check.finished", { run_id: Id, exit: Type.Integer({ minimum: 0, maximum: 255 }), outcome: OutcomeName }),
  kind("step.finished", {
    run_id: Type.Optional(Id),
    step_kind: NonEmpty,
    outcome: OutcomeName,
    detail: Type.Optional(Type.Unknown()),
    /** the signal whose firing ended the step; its outcome is the signal's name */
    signal: Type.Optional(SignalRef),
  }),
  kind("gate.decided", {
    outcome: GateOutcome,
    by: NonEmpty,
    /**
     * Decided by the supervisor on the person's behalf, under their policy's grant of this gate. It
     * stands only with `supervisor_run` naming the supervisor norn launched for this gate's visit, and
     * with the visit (`step`, `attempt`) on the receipt; any other is refused.
     */
    delegated: Type.Optional(Type.Boolean()),
    /** the supervisor run a delegated decision comes from */
    supervisor_run: Type.Optional(Id),
    reason: Type.Optional(Type.String()),
    /** set when the decision came through a run: a unit's own step agent may never decide its gate */
    run_id: Type.Optional(Id),
  }),
  /**
   * `to: dialog`: the answer chooses an option in a dialog the agent's pane shows (a permission or
   * trust prompt), so it goes in as keys, never as a prompt typed to the agent
   */
  /**
   * `supervisor_run`: the answer is the supervisor's, standing only from the supervisor norn launched
   * for this question; absent, a person's
   */
  kind("answer.sent", { input_id: Id, text: Type.String(), by: NonEmpty, to: Type.Optional(Type.Literal("dialog")), supervisor_run: Type.Optional(Id) }),
  /**
   * norn starts a supervisor for this visit's question (`input_id`) or gate, beside the step's own run:
   * written before the launch, then again naming the session the launcher answered
   */
  kind("supervisor.started", { run_id: Id, executor: NonEmpty, subject: SupervisorSubject, input_id: Type.Optional(Id), session: Type.Optional(NonEmpty) }),
  /** the supervisor handed what it stood in for back to the person, or went quiet or died, which hands it back too */
  kind("supervisor.escalated", { run_id: Id, reason: NonEmpty }),
  kind("nudge.sent", { run_id: Id, reason: NonEmpty }),
  /** a check or effect step run again under its run, after it was cut short or its plugin failed; counted against the retries */
  kind("run.resumed", { run_id: Id, reason: Type.Optional(Type.String()) }),
  /** norn ordered the run stopped (its deadline passed); the run is judged dead if its session outlives the order */
  kind("stop.sent", { run_id: Id, reason: NonEmpty }),
  /** the session hit a usage limit that resets at `resets_at`; the run's deadline counts from the reset */
  kind("run.limited", { run_id: Id, resets_at: IsoTime }),
  /**
   * a round of the pinned workflow; `at` is the step it enters (its start step when absent), and
   * `by` and `reason` say who started it and why, for a person's round
   */
  kind("round.started", { workflow: PinnedWorkflow, at: Type.Optional(StepName), by: Type.Optional(NonEmpty), reason: Type.Optional(NonEmpty) }),
  /**
   * a person sends the unit to step `to` of its pinned workflow (its own step to run it again) as a
   * fresh visit, with the counters in `reset` back to 0; a unit that ended stuck is taken up again
   */
  kind("step.moved", {
    to: StepName,
    reset: Type.Optional(Type.Array(GraphCounterName, { uniqueItems: true })),
    by: NonEmpty,
    reason: Type.Optional(NonEmpty),
  }),
  /**
   * a person moved the story's claim to `to`: from holder `from` (whose claim expired at or after
   * `from_expires_at`), or a claim nobody held when `from` is absent. Kept on the story's own unit as
   * the record of who moved the story between machines; it changes nothing in the run state
   */
  kind("claim.taken", {
    from: Type.Optional(NonEmpty),
    from_expires_at: Type.Optional(IsoTime),
    to: NonEmpty,
    /** the version of the claim the takeover wrote */
    version: PosInt,
    by: NonEmpty,
    reason: Type.Optional(NonEmpty),
  }),
  /**
   * a person is about to bring the story's branch up to date with its base: the intent written before
   * the merge, naming the branch's head `from`, the base commit `base_sha` it merges (`merge` false when
   * the branch already holds it) and the change's head `took` it takes in first. Its `branch.updated`
   * outcome follows the effect; an intent without one is an update cut short, which the next
   * `norn story update-branch` finishes under the same intent. It changes nothing in the run state
   */
  kind("branch.update", {
    base: NonEmpty,
    base_sha: NonEmpty,
    from: NonEmpty,
    took: Type.Optional(NonEmpty),
    merge: Type.Boolean(),
    by: NonEmpty,
    reason: Type.Optional(NonEmpty),
  }),
  /**
   * a person brought the story's branch up to date with its base after its round ended: `base` at
   * commit `base_sha` merged in (`merged` false when the branch already held it), the branch moved
   * from `from` to `head`, taking in the open change's head `took` first when the branch lacked it,
   * and `pushed` when the vcs pushed the result. A record of a person's one-off effect; it changes
   * nothing in the run state
   */
  kind("branch.updated", {
    base: NonEmpty,
    base_sha: NonEmpty,
    merged: Type.Boolean(),
    from: NonEmpty,
    head: NonEmpty,
    took: Type.Optional(NonEmpty),
    pushed: Type.Boolean(),
    by: NonEmpty,
    reason: Type.Optional(NonEmpty),
  }),
  kind("unit.marked", { ended: Ended, reason: Type.Optional(NonEmpty) }),
  /**
   * the unit waits for a person; `reason` names the rule that parked it, or why, and becomes the state's
   * park; `text` is what the person reads about it, shown and never decided on
   */
  kind("unit.parked", { reason: NonEmpty, text: Type.Optional(NonEmpty) }),
  kind("mode.changed", { mode: Mode, by: NonEmpty }),
  /**
   * a person starts the agent of a step manual mode holds, once: it lifts the park for this visit to
   * the step only, so manual mode still holds every later step
   */
  kind("run.requested", { by: NonEmpty }),
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
