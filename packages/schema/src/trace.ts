import { type Static, Type } from "@sinclair/typebox";
import { IsoTime, NonEmpty, NonNegInt, SliceKey, StoryKey, TaggedUnion, Ulid } from "./common.ts";

/** Normalized agent lifecycle facts reported by hooks (A2). */
export const HookEventKind = Type.Union([
  Type.Literal("session_start"),
  Type.Literal("turn_start"),
  Type.Literal("tool_use"),
  Type.Literal("waiting_input"),
  Type.Literal("permission_prompt"),
  Type.Literal("turn_end"),
  Type.Literal("session_end"),
]);
export type HookEventKind = Static<typeof HookEventKind>;

/** One normalized hook fact; the CLI's `norn hook` appends these to the trace. */
export const HookFact = Type.Object(
  {
    event: HookEventKind,
    at: IsoTime,
    agent: NonEmpty,
    /** native event name, e.g. Claude Code `Stop` */
    native: NonEmpty,
    cwd: NonEmpty,
    story: Type.Optional(StoryKey),
    slice: Type.Optional(SliceKey),
    run_id: Type.Optional(Ulid),
    agent_session_id: Type.Optional(NonEmpty),
    transcript: Type.Optional(NonEmpty),
    tool: Type.Optional(NonEmpty),
    /** permission prompt / tool command */
    command: Type.Optional(Type.String()),
    message: Type.Optional(Type.String()),
  },
  { additionalProperties: false },
);
export type HookFact = Static<typeof HookFact>;

/** Free-form action/result payloads; their shapes are `Action` / `ActionResult` in @norn/core. */
const Payload = Type.Object({ kind: NonEmpty }, { additionalProperties: true });

export const TickUnitRecord = Type.Object(
  {
    /** unit key: story key or slice key; `*` for repo-level actions (intake, sync) */
    unit: NonEmpty,
    rule: NonEmpty,
    action: Payload,
    result: Type.Object(
      { ok: Type.Boolean(), error: Type.Optional(Type.String()), detail: Type.Optional(Type.Unknown()) },
      { additionalProperties: false },
    ),
    /** trace-relative path of the stored briefing (B4) */
    briefing: Type.Optional(NonEmpty),
    /** trace-relative path of a transcript snapshot (C4) */
    transcript: Type.Optional(NonEmpty),
  },
  { additionalProperties: false },
);
export type TickUnitRecord = Static<typeof TickUnitRecord>;

/**
 * O1/O4 inbox history: an inbox item (needing a person) appeared in, or left, the inbox after this
 * tick's act. `norn inbox --history` pairs them into appeared_at / resolved_at / resolved_by.
 */
export const InboxChange = Type.Object(
  {
    event: Type.Union([Type.Literal("appeared"), Type.Literal("resolved")]),
    /** inbox item id (stable per item, O3) */
    id: NonEmpty,
    group: NonEmpty,
    story: NonEmpty,
    slice: Type.Union([NonEmpty, Type.Null()]),
    step: Type.Union([NonEmpty, Type.Null()]),
    title: NonEmpty,
    command: Type.Optional(Type.String()),
    detail: Type.Optional(Type.String()),
    url: Type.Optional(Type.String()),
    /** appeared: the item's own `since`; resolved: when (the resolving receipt's time, else the tick's) */
    at: IsoTime,
    /** resolved: what resolved it, e.g. `approve by jakub@mac (0008-approve.json)` or a decide rule */
    resolved_by: Type.Optional(NonEmpty),
  },
  { additionalProperties: false },
);
export type InboxChange = Static<typeof InboxChange>;

export const TickTrace = Type.Object(
  {
    type: Type.Literal("tick"),
    tick_id: Ulid,
    at: IsoTime,
    heartbeat_id: Type.Union([Ulid, Type.Null()]),
    /** the norn that recorded this tick (`@norn/cli` version); `norn why` labels a replay by another version (O5). Absent on older traces. */
    norn_version: Type.Optional(NonEmpty),
    duration_ms: NonNegInt,
    /** Facts snapshot (the `Facts` type of @norn/core); replayed by `norn why` (O5). */
    facts: Type.Record(Type.String(), Type.Unknown()),
    decisions: Type.Array(TickUnitRecord),
    /** inbox items that appeared or were resolved by this tick (O1 history); absent = none */
    inbox: Type.Optional(Type.Array(InboxChange)),
  },
  { additionalProperties: false },
);
export type TickTrace = Static<typeof TickTrace>;

export const HookTrace = Type.Object(
  {
    type: Type.Literal("hook"),
    id: Ulid,
    fact: HookFact,
    /** Whether `norn hook` blocked the event (A4) and why. */
    blocked: Type.Optional(Type.Boolean()),
    reason: Type.Optional(Type.String()),
  },
  { additionalProperties: false },
);
export type HookTrace = Static<typeof HookTrace>;

/** Receipts refused at apply time (stale step/attempt, T9) or files failing validation. */
export const RejectTrace = Type.Object(
  {
    type: Type.Literal("reject"),
    id: Ulid,
    at: IsoTime,
    tick_id: Type.Optional(Ulid),
    unit: NonEmpty,
    source: NonEmpty,
    reason: NonEmpty,
    payload: Type.Optional(Type.Unknown()),
  },
  { additionalProperties: false },
);
export type RejectTrace = Static<typeof RejectTrace>;

/** Links a run to the exact briefing `norn brief` stored for it (B4, O4); one per brief call. */
export const BriefingTrace = Type.Object(
  {
    type: Type.Literal("briefing"),
    id: Ulid,
    at: IsoTime,
    /** unit key: story key or slice key */
    unit: NonEmpty,
    run_id: Ulid,
    step: NonEmpty,
    attempt: NonNegInt,
    /** trace-relative path of the stored briefing */
    briefing: NonEmpty,
  },
  { additionalProperties: false },
);
export type BriefingTrace = Static<typeof BriefingTrace>;

/** Commits on a story/slice branch that norn did not make (Q6); one event per newly seen sha. */
export const ForeignCommitsTrace = Type.Object(
  {
    type: Type.Literal("foreign_commits"),
    id: Ulid,
    at: IsoTime,
    tick_id: Type.Optional(Ulid),
    /** story key */
    unit: NonEmpty,
    commits: Type.Array(
      Type.Object(
        { sha: NonEmpty, subject: Type.String(), author: Type.String(), at: Type.String(), branch: NonEmpty },
        { additionalProperties: false },
      ),
    ),
  },
  { additionalProperties: false },
);
export type ForeignCommitsTrace = Static<typeof ForeignCommitsTrace>;

/** R10.1 (M8): a `norn take` of a story, forced or not, with the claim it replaced. */
export const TakeTrace = Type.Object(
  {
    type: Type.Literal("take"),
    id: Ulid,
    at: IsoTime,
    /** story key */
    unit: StoryKey,
    holder: NonEmpty,
    heartbeat_id: Ulid,
    previous_holder: Type.Union([NonEmpty, Type.Null()]),
    previous_heartbeat_id: Type.Union([Ulid, Type.Null()]),
    expired: Type.Boolean(),
    forced: Type.Boolean(),
  },
  { additionalProperties: false },
);
export type TakeTrace = Static<typeof TakeTrace>;

/**
 * R5.4 (N2): written after decide, before act — so a tick that dies during act still leaves its
 * decisions (and the receipts they number) in the trace. `norn why` reports a `tick.start` with no
 * `tick.end` as "tick crashed during act". No facts snapshot: the full `tick` record carries those.
 */
export const TickStartTrace = Type.Object(
  {
    type: Type.Literal("tick.start"),
    tick_id: Ulid,
    at: IsoTime,
    heartbeat_id: Type.Union([Ulid, Type.Null()]),
    /** decide's output: unit, rule and action (no results yet) */
    decisions: Type.Array(Type.Object({ unit: NonEmpty, rule: NonEmpty, action: Payload }, { additionalProperties: false })),
  },
  { additionalProperties: false },
);
export type TickStartTrace = Static<typeof TickStartTrace>;

/** R5.4: written after the tick's `tick` record — the tick finished act. */
export const TickEndTrace = Type.Object(
  {
    type: Type.Literal("tick.end"),
    tick_id: Ulid,
    at: IsoTime,
    duration_ms: NonNegInt,
    /** actions that ended `ok: false` */
    failed: NonNegInt,
  },
  { additionalProperties: false },
);
export type TickEndTrace = Static<typeof TickEndTrace>;

/**
 * QV2–QV4, QV8: a `norn done --criteria` report, counted — so "we keep failing to verify browser
 * criteria" shows up as data (`norn trace` sums `unverified_needs`). `rule` is
 * `criteria.unchecked_coverage` when the unit's frontmatter had no `criteria` to check coverage
 * against (QV4), else `criteria.checked`.
 */
export const CriteriaTrace = Type.Object(
  {
    type: Type.Literal("criteria"),
    id: Ulid,
    at: IsoTime,
    /** unit key: story key or slice key */
    unit: NonEmpty,
    run_id: Ulid,
    step: NonEmpty,
    attempt: NonNegInt,
    receipt_id: Ulid,
    outcome: NonEmpty,
    rule: Type.Union([Type.Literal("criteria.checked"), Type.Literal("criteria.unchecked_coverage")]),
    /** count per verdict */
    verdicts: Type.Object({ pass: NonNegInt, fail: NonNegInt, person: NonNegInt, unverified: NonNegInt }, { additionalProperties: false }),
    /** `unverified` criteria per capability in their frontmatter `needs` (QV8); `none` = no needs declared */
    unverified_needs: Type.Record(Type.String(), NonNegInt),
  },
  { additionalProperties: false },
);
export type CriteriaTrace = Static<typeof CriteriaTrace>;

/**
 * S2 (BUG-4): a machine-local file (a cache in the trace dir) was unreadable or of the wrong shape
 * and read as empty. Logged once per process per file content; the next write replaces the file.
 */
export const LocalFileTrace = Type.Object(
  {
    type: Type.Literal("local_file"),
    id: Ulid,
    at: IsoTime,
    /** path relative to the repo root, e.g. `.agents/norn/trace/remote.json` */
    file: NonEmpty,
    /** the local schema it failed, e.g. `local-remote` */
    schema: NonEmpty,
    reason: Type.Union([Type.Literal("unreadable"), Type.Literal("invalid_json"), Type.Literal("wrong_shape")]),
    errors: Type.Array(Type.Object({ path: Type.String(), message: Type.String() }, { additionalProperties: false })),
  },
  { additionalProperties: false },
);
export type LocalFileTrace = Static<typeof LocalFileTrace>;

export const TraceEvent = TaggedUnion("type", [TickTrace, HookTrace, RejectTrace, BriefingTrace, ForeignCommitsTrace, TakeTrace, TickStartTrace, TickEndTrace, CriteriaTrace, LocalFileTrace], {
  $id: "https://norn.dev/schema/trace.json",
  title: "norn trace event (one JSONL line)",
});
export type TraceEvent = Static<typeof TraceEvent>;
