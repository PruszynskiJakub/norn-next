import { type Static, type TProperties, Type } from "@sinclair/typebox";
import {
  Actor,
  CounterName,
  GitSha,
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
  TaggedUnion,
  Target,
  Ulid,
} from "./common.ts";
import { CriterionVerdict, Note, NoteId } from "./criteria.ts";

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
  /**
   * gh-71 AC12 (T9): the story round whose cursor a person's receipt for the story unit was made at
   * (absent = not recorded); a mailbox receipt for another round than the story's is stale.
   */
  round: Type.Optional(PosInt),
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
  /** QV2: the `--criteria` report, one verdict per criterion */
  criteria: Type.Optional(Type.Array(CriterionVerdict, { minItems: 1 })),
  /** NT1: notes for a person; never block, never change the route */
  notes: Type.Optional(Type.Array(Note, { minItems: 1 })),
  /**
   * BS5 (verified at `norn done` of a base-mode step): the base merged, the merge commit that brought
   * it in (null = reached without a merge commit) and the story head reported.
   */
  base_merge: Type.Optional(
    Type.Object(
      {
        sha: GitSha,
        merge: Type.Union([GitSha, Type.Null()]),
        head: GitSha,
      },
      { additionalProperties: false },
    ),
  ),
});
export const AskReceipt = receipt("ask", {
  question: NonEmpty,
  options: Type.Optional(Type.Array(NonEmpty)),
  /** true when classified from pane/hook facts rather than reported by `norn ask` */
  implicit: Type.Optional(Type.Boolean()),
  /** Permission prompt command shown in inbox (implicit asks). */
  command: Type.Optional(Type.String()),
  /** R6.2: implicit asks from a pane prompt — how a choice is made (option number, or arrows from the cursor) */
  choice: Type.Optional(PromptChoice),
  /** L1 (A7): implicit asks — the full pane text; `question` holds only the question block */
  screen: Type.Optional(NonEmpty),
});
export const StuckReceipt = receipt("stuck", { reason: NonEmpty });
export const AnswerReceipt = receipt("answer", {
  answer: NonEmpty,
  /** receipt_id of the ask being answered */
  ask_receipt_id: Type.Optional(Ulid),
  /**
   * R6.2/R6.3: `norn story answer` already typed the keystrokes into the agent's pane before writing this
   * receipt, so the tick does not deliver it again. (`by: "agent"` answers, R6.1, are never delivered.)
   */
  delivered: Type.Optional(Type.Boolean()),
});
export const ApproveReceipt = receipt("approve", {
  comment: Type.Optional(Type.String()),
  /** The unit's branch head at the moment of `approve` (story unit: observe's `ready_head_sha`); the ruling's head (C2). */
  head_sha: Type.Optional(GitSha),
  /** NT3: open notes of the story listed at this story-level gate at `approve`; they leave the inbox */
  acknowledged_notes: Type.Optional(Type.Array(NoteId, { uniqueItems: true })),
});
export const RejectReceipt = receipt("reject", {
  comment: Type.Optional(Type.String()),
  /** C2: the unit's branch head the person judged — a ruling is tied to it */
  head_sha: Type.Optional(GitSha),
});
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
    /** R6.3, R9.1: the command a person runs to reach the session (the runner's, e.g. `herdr agent attach <pane>`) */
    reach: Type.Optional(NonEmpty),
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
  /** R7.1 (M4): `user@host` that launched the run; process liveness is judged only there (R7.2) */
  machine: Type.Optional(NonEmpty),
  /** R7.1: heartbeat that launched the run */
  heartbeat_id: Type.Optional(Ulid),
});
/** Tick classification (§10): the outcome decided from facts and the route taken. */
export const ClassifyReceipt = receipt("classify", {
  outcome: OutcomeName,
  rule: NonEmpty,
  detail: Type.Optional(Type.String()),
  /** Route taken: a step, a reserved target, or `nudge` / `retry` / `park` for in-step routes. */
  route: Type.Union([Target, Type.Literal("nudge"), Type.Literal("retry"), Type.Literal("park")]),
  counter: Type.Optional(Type.Object({ name: NonEmpty, value: NonNegInt, max: PosInt }, { additionalProperties: false })),
  /**
   * BS3/BS8: the base the story was measured against — `git: update` conflicts and gate `stale`.
   * Structured so the `resolve` brief carries the base sha and paths without parsing `detail` (P8).
   */
  base: Type.Optional(
    Type.Object(
      {
        ref: NonEmpty,
        sha: GitSha,
        behind: Type.Optional(NonNegInt),
        conflicts: Type.Array(NonEmpty),
        /** BS3: the story head after a `done` update — the `Norn-Tick` merge commit when one was made */
        head: Type.Optional(GitSha),
        /** BS3: a `done` update made a merge commit (false = already up to date) */
        merged: Type.Optional(Type.Boolean()),
      },
      { additionalProperties: false },
    ),
  ),
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
 * R10.1 (M8): a `norn story checkout` of the story, forced or not, recorded on the story unit. Informational:
 * applied at any cursor (like `mode`), it moves nothing; `norn run list` / `why` show it.
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
/**
 * BS9: `norn story update-branch <story>` — a person sends the story unit back to its base-update step (from a
 * gate, from stuck, or from `$done` while the PR is unmerged). Written before the state change (P6).
 */
export const UpdateReceipt = receipt("update", {
  /** the step left, or `$done` */
  from: Type.Union([StepName, Type.Literal("$done"), Type.Literal("$stuck")]),
  /** the step entered (the workflow's `base.step`) */
  to: StepName,
  reason: Type.Literal("person"),
});
/** Journaled workflow switch (`norn story edit <unit> --workflow <name> --at <step>`, S7). */
export const WorkflowReceipt = receipt("workflow", {
  name: NonEmpty,
  from_hash: Type.Union([NonEmpty, Type.Null()]),
  to_hash: NonEmpty,
  to: StepName,
});

/**
 * gh-71 D1 (B1, B6, B9): `norn story edit <story> --workflow <name> [--at <step>]` on a story whose round is
 * finished — written into the current round, applied by the next tick (rule `round.start`), which ends
 * that round and starts round N+1 of `workflow` at `to`. Rejected when the workflow file changed since.
 */
export const RoundReceipt = receipt("round", {
  workflow: NonEmpty,
  /** sha256 of `.agents/workflows/<workflow>.yaml` when the edit ran */
  workflow_hash: Type.String({ pattern: "^[0-9a-f]{64}$" }),
  /** the step the new round starts at: `--at`, else the workflow's start step */
  to: StepName,
  /** `--force` on an unfinished round: the old round is ended by the person at `left_at` (gh-71 B11, RD3); false on a finished one (B14) */
  forced: Type.Boolean(),
  /** the step the old round is left at */
  left_at: Type.Union([StepName, Type.Literal("$done"), Type.Literal("$stuck")]),
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
    UpdateReceipt,
    RoundReceipt,
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
export type UpdateReceipt = ReceiptOf<"update">;
export type RoundReceipt = ReceiptOf<"round">;

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
  "update",
  "round",
] as const satisfies readonly ReceiptKind[];
// RECEIPT_KINDS lists every kind: a kind added to `Receipt` but not here fails typecheck.
const _allReceiptKinds: [Exclude<ReceiptKind, (typeof RECEIPT_KINDS)[number]>] extends [never] ? true : never = true;

/** Receipts a non-holder may push through the mailbox (T9). */
export const MAILBOX_KINDS = ["answer", "approve", "reject", "unstick"] as const satisfies readonly ReceiptKind[];
