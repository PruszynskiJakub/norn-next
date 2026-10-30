/**
 * Machine-local files of one checkout, kept in the gitignored trace dir (§7.1): caches and
 * bookkeeping norn writes for itself, never committed. Every read is validated against these
 * (S2); a file that is unreadable or of the wrong shape reads as its empty fallback and leaves a
 * `local_file` trace event (store `readLocalJson`). Unknown properties are allowed so a file
 * written by a newer norn still reads; the properties norn uses must have the right type.
 */
import { type Static, Type } from "@sinclair/typebox";
import { NonNegInt, ProcessIdentity } from "./common.ts";
import { StoryMerge } from "./frontmatter.ts";

const id = (name: string, title: string) => ({ $id: `https://norn.dev/schema/${name}.json`, title });
const Nullable = <T extends import("@sinclair/typebox").TSchema>(t: T) => Type.Union([t, Type.Null()]);

/** `remote.json`: remote sync cache (H5 throttle); times are ms epoch. */
export const LocalRemoteFile = Type.Object(
  {
    synced_at: Type.Optional(Nullable(Type.Number())),
    attempted_at: Type.Optional(Nullable(Type.Number())),
    last_error: Type.Optional(Nullable(Type.String())),
    default_branch: Type.Optional(Nullable(Type.String())),
  },
  id("local-remote", "norn remote sync cache (trace/remote.json)"),
);
export type LocalRemoteFile = Static<typeof LocalRemoteFile>;

/** `notified.json`: inbox item ids already notified (O3). */
export const LocalNotifiedFile = Type.Object({ ids: Type.Optional(Type.Array(Type.String())) }, id("local-notified", "norn notified inbox ids (trace/notified.json)"));
export type LocalNotifiedFile = Static<typeof LocalNotifiedFile>;

/** One GR6 base-branch record still owed. */
export const PendingRecordEntry = Type.Object({
  story: Type.String(),
  spec_dir: Type.String(),
  status: Type.Literal("done"),
  /** ms epoch of the last attempt (throttle) */
  attempted_at: Type.Number(),
  attempts: NonNegInt,
  reason: Type.String(),
  merge: Type.Optional(StoryMerge),
});
export type PendingRecordEntry = Static<typeof PendingRecordEntry>;

/** `records.json`: GR6 records still owed. */
export const LocalRecordsFile = Type.Object({ records: Type.Optional(Type.Array(PendingRecordEntry)) }, id("local-records", "norn owed base-branch records (trace/records.json)"));
export type LocalRecordsFile = Static<typeof LocalRecordsFile>;

/** `foreign.json`: commit shas already traced as `foreign_commits` (Q6). */
export const LocalForeignFile = Type.Object({ shas: Type.Optional(Type.Array(Type.String())) }, id("local-foreign", "norn traced foreign commits (trace/foreign.json)"));
export type LocalForeignFile = Static<typeof LocalForeignFile>;

const InboxGroupSchema = Type.Union([
  Type.Literal("your_turn"),
  Type.Literal("answer"),
  Type.Literal("approve"),
  Type.Literal("unblock"),
  Type.Literal("check"),
  Type.Literal("unclaimed"),
  Type.Literal("running"),
  Type.Literal("notes"),
  Type.Literal("recently_done"),
]);

/** An inbox item as the open set keeps it (core `InboxItem`). */
export const InboxItemEntry = Type.Object({
  id: Type.String(),
  group: InboxGroupSchema,
  story: Type.String(),
  slice: Nullable(Type.String()),
  step: Nullable(Type.String()),
  title: Type.String(),
  detail: Type.Optional(Type.String()),
  command: Type.String(),
  full: Type.Optional(Type.String()),
  since: Type.String(),
  url: Type.Optional(Type.String()),
  reach: Type.Optional(Type.Object({ worktree: Nullable(Type.String()), agent_session_id: Nullable(Type.String()), pane_id: Nullable(Type.String()) })),
  cleared_by: Type.Optional(Type.String()),
});

/** `inbox.json`: the inbox items open after the last tick (O1, O4). */
export const LocalInboxFile = Type.Object({ open: Type.Optional(Type.Record(Type.String(), InboxItemEntry)) }, id("local-inbox", "norn open inbox items (trace/inbox.json)"));
export type LocalInboxFile = Static<typeof LocalInboxFile>;

/** `heartbeat.json`: this checkout's heartbeat_id (ID2) and `last_tick_at` (R5.5). */
export const LocalHeartbeatFile = Type.Object(
  {
    heartbeat_id: Type.Optional(Type.String()),
    created_at: Type.Optional(Type.String()),
    /** R5.5: ISO time the last tick on this checkout finished */
    last_tick_at: Type.Optional(Type.String()),
  },
  id("local-heartbeat", "norn checkout heartbeat (trace/heartbeat.json)"),
);
export type LocalHeartbeatFile = Static<typeof LocalHeartbeatFile>;

/** R4.3: the last act effect that failed for a unit (core `ActFailure`). */
export const ActFailureEntry = Type.Object({
  effect: Type.String(),
  rule: Type.String(),
  reason: Type.String(),
  at: Type.String(),
  tick_id: Type.String(),
  step: Type.String(),
  attempt: Type.Number(),
  session: Type.Optional(Type.Object({ runner: Type.String(), session_id: Type.String(), pane_id: Type.Optional(Type.String()) })),
});

/** `failures.json`: unit key → last failed act effect (R4.3). */
export const LocalFailuresFile = Type.Object({ units: Type.Optional(Type.Record(Type.String(), ActFailureEntry)) }, id("local-failures", "norn failed act effects (trace/failures.json)"));
export type LocalFailuresFile = Static<typeof LocalFailuresFile>;

/** BS1: the last `story.base` measured (core `StoryBase`). */
export const StoryBaseEntry = Type.Object({
  ref: Type.String(),
  sha: Type.String(),
  head: Type.String(),
  merge_base: Type.String(),
  behind: Type.Number(),
  ahead: Type.Number(),
  conflicts: Type.Array(Type.String()),
});

/** `base.json`: story key → the last `story.base` measured (BS1). */
export const LocalBaseFile = Type.Object({ stories: Type.Optional(Type.Record(Type.String(), StoryBaseEntry)) }, id("local-base", "norn measured story bases (trace/base.json)"));
export type LocalBaseFile = Static<typeof LocalBaseFile>;

/** A story PR as a sync saw it (core `RemotePullRequest`). */
export const PullRequestEntry = Type.Object({
  number: Type.Number(),
  url: Type.String(),
  state: Type.Union([Type.Literal("open"), Type.Literal("closed"), Type.Literal("merged")]),
  is_draft: Type.Boolean(),
  head_sha: Type.String(),
  merge_commit_sha: Type.Optional(Type.String()),
  merged_by: Type.Optional(Type.String()),
  merged_at: Type.Optional(Nullable(Type.String())),
  head: Type.Optional(Type.String()),
  /** older name of `base_branch`, read from a cache an older norn wrote; nothing writes it (dropped in 0.11.0) */
  base: Type.Optional(Type.String()),
  base_branch: Type.Optional(Type.String()),
});

/** `pr.json`: story key → the story PR the last sync saw, with when (C1). */
export const LocalPrFile = Type.Object(
  { stories: Type.Optional(Type.Record(Type.String(), Type.Object({ pr: Nullable(PullRequestEntry), observed_at: Type.Number() }))) },
  id("local-pr", "norn story PRs seen (trace/pr.json)"),
);
export type LocalPrFile = Static<typeof LocalPrFile>;

/** `<norn home>/cockpit.json`: CP13 `last_repo`, the main checkout the last cockpit ran in. */
export const LocalCockpitFile = Type.Object({ last_repo: Type.Optional(Type.String()) }, id("local-cockpit", "norn cockpit memory (<norn home>/cockpit.json)"));
export type LocalCockpitFile = Static<typeof LocalCockpitFile>;

/** `hooks/backfill.json` (B11, B12, D5): when the first tick of the per-unit hook files ran, and the units whose live runs' hook lines it has copied from the day files. Never pruned. */
export const LocalHookBackfillFile = Type.Object(
  { since: Type.String(), done: Type.Array(Type.String()) },
  id("local-hook-backfill", "norn hook file backfill (trace/hooks/backfill.json)"),
);
export type LocalHookBackfillFile = Static<typeof LocalHookBackfillFile>;

/** A lock file (H1 tick lock, K6 integrate lock): the holder process and when it took the lock. */
export const LocalLockFile = Type.Object(
  {
    holder: ProcessIdentity,
    acquired_at: Type.String(),
    /** free text: command, heartbeat id */
    note: Type.Optional(Type.String()),
  },
  id("local-lock", "norn lock file (trace/*.lock)"),
);
export type LocalLockFile = Static<typeof LocalLockFile>;

/** The schema names of machine-local files (`readLocalJson` takes only these). */
export const LOCAL_SCHEMA_NAMES = [
  "local-remote",
  "local-notified",
  "local-records",
  "local-foreign",
  "local-inbox",
  "local-heartbeat",
  "local-failures",
  "local-base",
  "local-pr",
  "local-cockpit",
  "local-lock",
  "local-hook-backfill",
] as const;
export type LocalSchemaName = (typeof LOCAL_SCHEMA_NAMES)[number];
