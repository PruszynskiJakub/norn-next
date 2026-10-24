import { type Static, type TProperties, Type } from "@sinclair/typebox";
import {
  Actor,
  CounterName,
  IsoTime,
  Mode,
  NonEmpty,
  NonNegInt,
  OutcomeName,
  PosInt,
  ProcessIdentity,
  SliceKey,
  StepName,
  TaggedUnion,
  Target,
  Ulid,
} from "./common.ts";

/**
 * Receipts are immutable inputs at `runs/<unit>/receipts/NNNN-<kind>.json` (S6),
 * also the payload of mailbox refs (T9). Every receipt carries the common header;
 * `step` + `attempt` must match the unit's cursor when applied, else it is rejected
 * into the trace.
 */
const header = {
  receipt_id: Ulid,
  /** Run the receipt belongs to; null only when the unit has no current run (e.g. `mode` on an idle story). */
  run_id: Type.Union([Ulid, Type.Null()]),
  step: Type.Union([StepName, Type.Literal("$done"), Type.Literal("$stuck")]),
  attempt: PosInt,
  at: IsoTime,
  by: Actor,
  /** `user@machine` for human/norn receipts; agent name for agent receipts. */
  who: Type.Optional(NonEmpty),
  /** tick that wrote it (norn receipts) */
  tick_id: Type.Optional(Ulid),
  /**
   * Unit the receipt is for: a slice key, or null for the story unit. Optional (additive);
   * set on mailbox receipts (T9) so the holder routes them by unit, not by step/attempt alone.
   */
  slice: Type.Optional(Type.Union([SliceKey, Type.Null()])),
};

function receipt<K extends string, P extends TProperties>(kind: K, props: P) {
  return Type.Object({ kind: Type.Literal(kind), ...header, ...props }, { additionalProperties: false });
}

export const Finding = Type.Object(
  {
    id: Type.Optional(NonEmpty),
    severity: Type.Union([Type.Literal("blocking"), Type.Literal("major"), Type.Literal("minor"), Type.Literal("nit")]),
    title: NonEmpty,
    detail: Type.Optional(Type.String()),
    file: Type.Optional(NonEmpty),
    line: Type.Optional(PosInt),
    /** Behaviour / acceptance criterion number the finding cites. */
    criterion: Type.Optional(NonEmpty),
    repro: Type.Optional(Type.String()),
  },
  { additionalProperties: false },
);
export type Finding = Static<typeof Finding>;

export const DoneReceipt = receipt("done", {
  outcome: OutcomeName,
  handoff: Type.String(),
  findings: Type.Optional(Type.Array(Finding)),
  /** Evidence folder relative to the unit's runs dir, e.g. `evidence/<run_id>`. */
  evidence: Type.Optional(NonEmpty),
});
export const AskReceipt = receipt("ask", {
  question: NonEmpty,
  options: Type.Optional(Type.Array(NonEmpty)),
  /** true when classified from pane/hook facts rather than reported by `norn ask` */
  implicit: Type.Optional(Type.Boolean()),
  /** Permission prompt command shown in inbox (implicit asks). */
  command: Type.Optional(Type.String()),
});
export const StuckReceipt = receipt("stuck", { reason: NonEmpty });
export const AnswerReceipt = receipt("answer", {
  answer: NonEmpty,
  /** receipt_id of the ask being answered */
  ask_receipt_id: Type.Optional(Ulid),
});
export const ApproveReceipt = receipt("approve", {
  comment: Type.Optional(Type.String()),
  /** Story branch head at the moment of `approve` (story unit gates); observe's `ready_head_sha`. */
  head_sha: Type.Optional(Type.String({ pattern: "^[0-9a-f]{40,64}$" })),
});
export const RejectReceipt = receipt("reject", { comment: Type.Optional(Type.String()) });
export const UnstickReceipt = receipt("unstick", {
  to: Type.Optional(StepName),
  reset: Type.Optional(Type.Array(CounterName, { uniqueItems: true })),
  comment: Type.Optional(Type.String()),
});
export const ModeReceipt = receipt("mode", { mode: Mode, previous: Mode });
export const CheckReceipt = receipt("check", {
  outcome: Type.Union([Type.Literal("pass"), Type.Literal("fail")]),
  command: NonEmpty,
  /** null when killed by timeout */
  exit_code: Type.Union([Type.Integer(), Type.Null()]),
  duration_ms: NonNegInt,
  reason: Type.Optional(Type.Literal("timeout")),
  /** last ~200 lines (C5) */
  output_tail: Type.String(),
  /** `logs/<run_id>.log`, present on fail */
  log: Type.Optional(NonEmpty),
});
export const SessionInfo = Type.Object(
  {
    runner: NonEmpty,
    session_id: NonEmpty,
    pane_id: Type.Optional(NonEmpty),
  },
  { additionalProperties: false },
);
export type SessionInfo = Static<typeof SessionInfo>;
export const StartedReceipt = receipt("started", {
  how: Type.Union([Type.Literal("manual"), Type.Literal("auto")]),
  agent: Type.Optional(NonEmpty),
  model: Type.Optional(NonEmpty),
  session: Type.Optional(SessionInfo),
  /** Agent-tool session id (e.g. Claude Code session) for `--resume`. */
  agent_session_id: Type.Optional(NonEmpty),
  process: Type.Optional(ProcessIdentity),
  worktree: NonEmpty,
  /** true when this is a fresh-session retry of the same step (B2, C1) */
  retry: Type.Optional(Type.Boolean()),
});
/** Tick classification (§10): the outcome decided from facts and the route taken. */
export const ClassifyReceipt = receipt("classify", {
  outcome: OutcomeName,
  rule: NonEmpty,
  detail: Type.Optional(Type.String()),
  /** Route taken: a step, a reserved target, or `nudge` / `retry` / `park` for in-step routes. */
  route: Type.Union([Target, Type.Literal("nudge"), Type.Literal("retry"), Type.Literal("park")]),
  counter: Type.Optional(Type.Object({ name: NonEmpty, value: NonNegInt, max: PosInt }, { additionalProperties: false })),
  /** C4 snapshot on silent: last assistant message, head commit, diff stat. */
  snapshot: Type.Optional(
    Type.Object(
      {
        last_message: Type.Optional(Type.String()),
        head: Type.Optional(NonEmpty),
        diff_stat: Type.Optional(Type.String()),
        transcript: Type.Optional(NonEmpty),
      },
      { additionalProperties: false },
    ),
  ),
});
/**
 * R10.1 (M8): a `norn take` of the story, forced or not, recorded on the story unit. Informational:
 * applied at any cursor (like `mode`), it moves nothing; `norn trace` / `why` show it.
 */
export const TakeReceipt = receipt("take", {
  /** `user@machine` of the claim taken over; null when the claim was free */
  previous_holder: Type.Union([NonEmpty, Type.Null()]),
  previous_heartbeat_id: Type.Union([Ulid, Type.Null()]),
  /** the previous claim had expired (false when it was free or taken with --force) */
  expired: Type.Boolean(),
  /** `take --force` over an unexpired or corrupt claim (T5) */
  forced: Type.Optional(Type.Boolean()),
});
/** Journaled workflow switch (`norn workflow <unit> <name> --to <step>`, S7). */
export const WorkflowReceipt = receipt("workflow", {
  name: NonEmpty,
  from_hash: Type.Union([NonEmpty, Type.Null()]),
  to_hash: NonEmpty,
  to: StepName,
});

export const Receipt = TaggedUnion(
  "kind",
  [
    DoneReceipt,
    AskReceipt,
    StuckReceipt,
    AnswerReceipt,
    ApproveReceipt,
    RejectReceipt,
    UnstickReceipt,
    ModeReceipt,
    CheckReceipt,
    StartedReceipt,
    ClassifyReceipt,
    WorkflowReceipt,
    TakeReceipt,
  ],
  { $id: "https://norn.dev/schema/receipt.json", title: "norn receipt" },
);
export type Receipt = Static<typeof Receipt>;
export type ReceiptKind = Receipt["kind"];
export type ReceiptOf<K extends ReceiptKind> = Extract<Receipt, { kind: K }>;
export type DoneReceipt = ReceiptOf<"done">;
export type AskReceipt = ReceiptOf<"ask">;
export type StuckReceipt = ReceiptOf<"stuck">;
export type AnswerReceipt = ReceiptOf<"answer">;
export type ApproveReceipt = ReceiptOf<"approve">;
export type RejectReceipt = ReceiptOf<"reject">;
export type UnstickReceipt = ReceiptOf<"unstick">;
export type ModeReceipt = ReceiptOf<"mode">;
export type CheckReceipt = ReceiptOf<"check">;
export type StartedReceipt = ReceiptOf<"started">;
export type ClassifyReceipt = ReceiptOf<"classify">;
export type WorkflowReceipt = ReceiptOf<"workflow">;
export type TakeReceipt = ReceiptOf<"take">;

export const RECEIPT_KINDS = [
  "done",
  "ask",
  "stuck",
  "answer",
  "approve",
  "reject",
  "unstick",
  "mode",
  "check",
  "started",
  "classify",
  "workflow",
  "take",
] as const satisfies readonly ReceiptKind[];

/** Receipts a non-holder may push through the mailbox (T9). */
export const MAILBOX_KINDS = ["answer", "approve", "reject", "unstick"] as const satisfies readonly ReceiptKind[];
