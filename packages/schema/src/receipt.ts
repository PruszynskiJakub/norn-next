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
  VerifyPair,
} from "./common.ts";
import { CriterionVerdict, Note, NoteId } from "./criteria.ts";

/**
 * Receipts are immutable inputs at `runs/<unit>/receipts/NNNN-<kind>.json`, also the payload
 * of mailbox refs. `step` + `attempt` must match the unit's cursor when applied, else the
 * receipt is rejected into the trace.
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
  /** Unit the receipt is for: a slice key, or null for the story unit. Mailbox receipts set it so the holder routes them by unit, not by step/attempt alone. */
  slice: Type.Optional(Type.Union([SliceKey, Type.Null()])),
  /**
   * The story round whose cursor a person's receipt for the story unit was made at
   * (absent = not recorded); a mailbox receipt for another round than the story's is stale.
   */
  round: Type.Optional(PosInt),
  /**
   * A supervisor sent this on the person's behalf (`--delegated`). The cli writes it only on a
   * human receipt and keeps `by` human, so decide reads it as the person's; the schema does not
   * check `by`. Absent = the person's own.
   */
  delegated: Type.Optional(Type.Literal(true)),
};

function receipt<K extends string, P extends TProperties>(kind: K, props: P) {
  return Type.Object({ kind: Type.Literal(kind), ...header, ...props }, { additionalProperties: false });
}

/**
 * A receipt a person may send through the mailbox (answer, approve, reject, unstick).
 * `attempt` is absent only when a non-holder made it for a `local` story: stamped with the step its last
 * boundary led to (`Norn-Next`), the holder matches it by step alone.
 */
function mailboxReceipt<K extends string, P extends TProperties>(kind: K, props: P) {
  return Type.Object({ kind: Type.Literal(kind), ...header, attempt: Type.Optional(PosInt), ...props }, { additionalProperties: false });
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
  /** The `--criteria` report, one verdict per criterion */
  criteria: Type.Optional(Type.Array(CriterionVerdict, { minItems: 1 })),
  /** Notes for a person; never block, never change the route */
  notes: Type.Optional(Type.Array(Note, { minItems: 1 })),
  /** The unit worktree's HEAD at `norn done`; an `approve` from it anchors the light path of a later base update */
  head_sha: Type.Optional(GitSha),
  /**
   * Verified at `norn done` of a base-mode step: the base merged, the merge commit that brought
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
  /** Implicit asks from a pane prompt — how a choice is made (option number, or arrows from the cursor) */
  choice: Type.Optional(PromptChoice),
  /** Implicit asks — the full pane text; `question` holds only the question block */
  screen: Type.Optional(NonEmpty),
});
export const StuckReceipt = receipt("stuck", { reason: NonEmpty });
export const AnswerReceipt = mailboxReceipt("answer", {
  answer: NonEmpty,
  /** receipt_id of the ask being answered */
  ask_receipt_id: Type.Optional(Ulid),
  /**
   * `norn story answer` already typed the keystrokes into the agent's pane before writing this
   * receipt, so the tick does not deliver it again. (`by: "agent"` answers are never delivered.)
   */
  delivered: Type.Optional(Type.Boolean()),
  /** Why (`--reason`); the cli refuses `--delegated` without it (reason_required), the schema does not require it */
  comment: Type.Optional(Type.String()),
});
export const ApproveReceipt = mailboxReceipt("approve", {
  comment: Type.Optional(Type.String()),
  /** The unit's branch head at the moment of `approve` (story unit: observe's `ready_head_sha`); the ruling's head. */
  head_sha: Type.Optional(GitSha),
  /** Open notes of the story listed at this story-level gate at `approve`; they leave the inbox */
  acknowledged_notes: Type.Optional(Type.Array(NoteId, { uniqueItems: true })),
  /** Set when norn gave this `approve` on its own, carrying the person's earlier ready approval over: why (e.g. "clean base merge") */
  carried: Type.Optional(NonEmpty),
});
export const RejectReceipt = mailboxReceipt("reject", {
  comment: Type.Optional(Type.String()),
  /** The unit's branch head the person judged — a ruling is tied to it */
  head_sha: Type.Optional(GitSha),
});
export const UnstickReceipt = mailboxReceipt("unstick", {
  to: Type.Optional(StepName),
  reset: Type.Optional(Type.Array(CounterName, { uniqueItems: true })),
  comment: Type.Optional(Type.String()),
});
export const ModeReceipt = receipt("mode", { mode: Mode, previous: Mode });
export const CheckReceipt = receipt("check", {
  /** `pass` (exit 0), the outcome the step's `exits` names for the exit code, else `fail` */
  outcome: OutcomeName,
  command: NonEmpty,
  /** null when killed by timeout */
  exit_code: Type.Union([Type.Integer(), Type.Null()]),
  duration_ms: NonNegInt,
  reason: Type.Optional(Type.Literal("timeout")),
  /** last ~200 lines */
  output_tail: Type.String(),
  /** `logs/<run_id>.log`, present unless it passed */
  log: Type.Optional(NonEmpty),
  /**
   * A re-verify run of the workflow's `base.verify` check on the merge of `base` into `head`, made
   * while the story waits (its step is the waiting step): red takes that step's `stale` edge, green leaves it waiting
   */
  verify: Type.Optional(VerifyPair),
});
export const SessionInfo = Type.Object(
  {
    runner: NonEmpty,
    session_id: NonEmpty,
    pane_id: Type.Optional(NonEmpty),
    /** The command a person runs to reach the session (the runner's, e.g. `herdr agent attach <pane>`) */
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
  /** true when this is a fresh-session retry of the same step */
  retry: Type.Optional(Type.Boolean()),
  /** `user@host` that launched the run; process liveness is judged only there */
  machine: Type.Optional(NonEmpty),
  heartbeat_id: Type.Optional(Ulid),
});
/** Tick classification: the outcome decided from facts and the route taken. */
export const ClassifyReceipt = receipt("classify", {
  outcome: OutcomeName,
  rule: NonEmpty,
  detail: Type.Optional(Type.String()),
  /** Route taken: a step, a reserved target, or `nudge` / `retry` / `park` for in-step routes. */
  route: Type.Union([Target, Type.Literal("nudge"), Type.Literal("retry"), Type.Literal("park")]),
  counter: Type.Optional(Type.Object({ name: NonEmpty, value: NonNegInt, max: PosInt }, { additionalProperties: false })),
  /**
   * The base the story was measured against — `git: update` conflicts and gate `stale`.
   * Structured so the `resolve` brief carries the base sha and paths without parsing `detail`.
   */
  base: Type.Optional(
    Type.Object(
      {
        ref: NonEmpty,
        sha: GitSha,
        behind: Type.Optional(NonNegInt),
        conflicts: Type.Array(NonEmpty),
        /** The story head after a `done` update — the `Norn-Tick` merge commit when one was made */
        head: Type.Optional(GitSha),
        /** A `done` update made a merge commit (false = already up to date) */
        merged: Type.Optional(Type.Boolean()),
      },
      { additionalProperties: false },
    ),
  ),
  /**
   * The git summary a routed `git: update` chose its outcome from: the story's first-parent commits
   * from the head at the round's latest `approve` to the head after the merge, newest first.
   */
  history: Type.Optional(
    Type.Object(
      {
        anchor: GitSha,
        spec_dir: NonEmpty,
        commits: Type.Array(
          Type.Object(
            {
              sha: GitSha,
              parents: Type.Array(GitSha),
              paths: Type.Array(NonEmpty),
              trailers: Type.Record(Type.String(), Type.String()),
              /** a merge whose other parents are in the base's history */
              from_base: Type.Optional(Type.Boolean()),
              /** a merge's remerge-diff paths; null = git could not tell */
              remerge: Type.Optional(Type.Union([Type.Array(NonEmpty), Type.Null()])),
            },
            { additionalProperties: false },
          ),
        ),
      },
      { additionalProperties: false },
    ),
  ),
  /** Taken when the agent went silent: last assistant message, head commit, diff stat. */
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
 * A `norn story checkout` of the story, forced or not, recorded on the story unit. Informational:
 * applied at any cursor (like `mode`), it moves nothing, unless it says the branch was `rewritten`;
 * `norn run list` / `why` show it.
 */
export const TakeReceipt = receipt("take", {
  /** `user@machine` of the claim taken over; null when the claim was free */
  previous_holder: Type.Union([NonEmpty, Type.Null()]),
  previous_heartbeat_id: Type.Union([Ulid, Type.Null()]),
  /** the previous claim had expired (false when it was free or taken with --force) */
  expired: Type.Boolean(),
  /** `take --force` over an unexpired or corrupt claim */
  forced: Type.Optional(Type.Boolean()),
  /**
   * The story branch was rewritten since the record (`gone`, its `Norn-Branch-Commit`,
   * is not an ancestor of `head`): applied at the cursor it names, the step restarts as a new attempt
   */
  rewritten: Type.Optional(Type.Object({ gone: GitSha, head: GitSha }, { additionalProperties: false })),
  /**
   * No record to take over (no `refs/norn/runs/<story>`, none here): the take is the first
   * receipt of a new round started from the branch, fresh counters; false on a takeover from a
   * record. Absent = not recorded.
   */
  record_lost: Type.Optional(Type.Boolean()),
});
/**
 * `norn story update-branch <story>` — a person sends the story unit back to its base-update step
 * (from a gate, from stuck, from `$done` while the PR is unmerged, or from an agent step held by
 * drifted skills). Written before the state change.
 */
export const UpdateReceipt = receipt("update", {
  /** the step left, or `$done` */
  from: Type.Union([StepName, Type.Literal("$done"), Type.Literal("$stuck")]),
  /** the step entered (the workflow's `base.step`) */
  to: StepName,
  reason: Type.Literal("person"),
  /** The bundled skills that differed when the unit was held at an agent step; the base brings them in */
  skills_drift: Type.Optional(Type.Array(NonEmpty, { minItems: 1 })),
});
/** Journaled workflow switch (`norn story edit <unit> --workflow <name> --at <step>`). */
export const WorkflowReceipt = receipt("workflow", {
  name: NonEmpty,
  from_hash: Type.Union([NonEmpty, Type.Null()]),
  to_hash: NonEmpty,
  to: StepName,
});

/**
 * `norn story edit <story> --workflow <name> [--at <step>]` on a story whose round is
 * finished — written into the current round, applied by the next tick (rule `round.start`), which ends
 * that round and starts round N+1 of `workflow` at `to`. Rejected when the workflow file changed since.
 */
export const RoundReceipt = receipt("round", {
  workflow: NonEmpty,
  /** sha256 of `.agents/workflows/<workflow>.yaml` when the edit ran */
  workflow_hash: Type.String({ pattern: "^[0-9a-f]{64}$" }),
  /** the step the new round starts at: `--at`, else the workflow's start step */
  to: StepName,
  /** `--force` on an unfinished round: the old round is ended by the person at `left_at`; false on a finished one */
  forced: Type.Boolean(),
  /** the step the old round is left at */
  left_at: Type.Union([StepName, Type.Literal("$done"), Type.Literal("$stuck")]),
  /** Why this workflow (`--reason`); the cli refuses `--delegated` without it, the schema does not require it */
  comment: Type.Optional(Type.String()),
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

/** Receipts a non-holder may push through the mailbox. */
export const MAILBOX_KINDS = ["answer", "approve", "reject", "unstick"] as const satisfies readonly ReceiptKind[];
