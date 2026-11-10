/**
 * Facts: everything `observe` collects in one tick. Decide is a pure function
 * of `Facts` + config, so a Facts value must be JSON-serializable: it is stored
 * in the tick trace and replayed by `norn run view --why`. No functions, Dates or Maps.
 *
 * Absence conventions:
 * - `null`       = observed, and nothing is there
 * - `undefined`  = not observed this tick (e.g. remote throttled) — decide must not act on it
 */
import type {
  ClaimBlob,
  HookFact,
  LeaseFile,
  Mode,
  Receipt,
  RejectedMailboxReceipt,
  ResolvedConfig,
  SchemaError,
  SliceFrontmatter,
  StoryFrontmatter,
  UnitState,
  Workflow,
} from "@norn/schema";
import type { GitInProgress, PaneState, PullRequestCi, RemoteIssue, RemotePullRequest, RunnerCapabilities, SessionRef, WorktreeStatus } from "./ports.ts";

/** A file that failed to read or validate. */
export interface FileError {
  /** repo-relative path */
  file: string;
  errors: SchemaError[];
  /** Set when the file failed only because criteria still carry the removed `needs`; the person deletes it */
  code?: "needs_removed";
}

/** Identifies a unit everywhere (actions, trace, view). */
export interface UnitRef {
  story: string;
  /** null = the story unit */
  slice: string | null;
  /** `_story` or `<nn>-<slug>` */
  dir: string;
  /** story key or slice key */
  key: string;
}

export interface WorktreeFacts {
  path: string;
  exists: boolean;
  status: WorktreeStatus | null;
  /** ms epoch; null if no commits */
  last_commit_at: number | null;
  /** newest mtime of tracked/untracked files, for `stalled` (ms epoch) */
  last_file_change_at: number | null;
  /** slot from `.env.norn` */
  slot: number | null;
  /**
   * The git operation in progress in the worktree (an agent's merge, a rebase, …) and its
   * unmerged paths; absent = not observed. While one is, norn commits nothing there.
   */
  in_progress?: GitInProgress;
}

export interface NumberedReceipt {
  /** NNNN of `receipts/NNNN-<kind>.json` */
  n: number;
  file: string;
  receipt: Receipt;
}

/** Facts about the live (or last) run of a unit. */
export interface RunFacts {
  run_id: string;
  session: SessionRef | null;
  /** process liveness by PID + start time; null when unknown/no pid */
  process_alive: boolean | null;
  /** runner pane state; null when no runner / no session */
  pane: PaneState | null;
  /** hook facts for this run, oldest first */
  hooks: HookFact[];
  last_hook_at: number | null;
  /** max(last hook, last commit, last file change) — ms epoch */
  last_activity_at: number | null;
  transcript: string | null;
  /** The first lines the session printed, read only once its process is gone (RunnerPort.output) */
  output?: string;
  /**
   * The run's `started` receipt is not applied (a crash between the receipt and
   * `state.json`), so norn does not know whether, or where, it was launched. `session` is then what
   * observe found for it (runner session or process; null = nothing found), `hooks` its hook facts.
   */
  launch_unknown?: {
    /** number of the unapplied `started` receipt */
    n: number;
    /** that receipt's time (ms epoch): the launch-unknown grace runs from it */
    at: number;
    /** agent-tool session id seen for the run (hooks or the runner), for `--resume` */
    agent_session_id: string | null;
  };
}

/** A run of the unit's cursor step/attempt (from its `started` receipts) and its hook activity. */
export interface StepRunFacts {
  run_id: string;
  /** newest hook fact for the run (ms epoch), null = none in the window */
  last_hook_at: number | null;
  /** its newest hook is `session_end` — the agent process is gone */
  ended: boolean;
}

/**
 * The last failed effect of an action for this unit on this checkout (send, resume, launch,
 * push) — kept machine-local until an action of the same effect succeeds for the unit.
 */
export interface ActFailure {
  /** effect that failed: `nudge`, `answer`, `launch`, `resume`, `push`, … */
  effect: string;
  rule: string;
  reason: string;
  /** ISO time of the failing tick */
  at: string;
  tick_id: string;
  /** cursor when it failed: the item goes away when the cursor moves */
  step: string;
  attempt: number;
  /** the session a failed delivery targeted, so the inbox can say how to reach it */
  session?: { runner: string; session_id: string; pane_id?: string };
  /** a record push refused as stale (`StoryFacts.record.refused`): the sha it leased on (null = none) */
  lease?: string | null;
}

export interface UnitFacts {
  unit: UnitRef;
  /**
   * The unit's record folder relative to its spec folder, as the store resolver found it:
   * `runs/_story/rounds/NN-<wf>` for the story's current round, `runs/<nn>-<slug>` for a slice, `runs/_story`
   * for a flat story record. Absent = `unitRecordPath(unit.dir)` (facts an older norn recorded).
   */
  record?: string;
  /** null = unit not started (no runs/<unit>/state.json) */
  state: UnitState | null;
  /** pinned runs/<unit>/workflow.yaml, parsed + schema-valid; null if not started */
  workflow: Workflow | null;
  /** sha256 of the pinned workflow file as read */
  workflow_hash: string | null;
  /** files of this unit failing validation → unit is corrupt */
  errors: FileError[];
  /** receipts with n > state.applied_through, ascending by n */
  unapplied: NumberedReceipt[];
  /**
   * The done/check receipt of `state.last_outcome` (the report that moved the cursor here), e.g. the
   * qa report a gate shows with its evidence. Absent/null = not read or none.
   */
  last_outcome_receipt?: NumberedReceipt | null;
  worktree: WorktreeFacts | null;
  run: RunFacts | null;
  /** this machine's lease for the unit's run, if any */
  lease: LeaseFile | null;
  /**
   * The unit's handoff has uncommitted changes (a crash between write and commit).
   * Run state is in the machine dir, never in git; the agent's own files are not counted, since
   * they are dirty all through a live session.
   */
  uncommitted: boolean;
  /** Runs of the cursor step/attempt with their hook activity; absent = not observed */
  step_runs?: StepRunFacts[];
  /** Last failed act effect for the unit on this checkout; absent = none */
  act_failure?: ActFailure;
  /**
   * A done slice: its local branch is in the story branch (its head an ancestor of the story
   * branch head), so the slice cleanup may delete it. Absent = not observed (no local branch, not a
   * done slice) — decide then keeps the branch unless the cleanup integrates its worktree first.
   */
  branch_in_story?: boolean;
  /**
   * The bundled skills in the unit's worktree that differ from the running
   * norn's, by name; empty = none differ. Absent = not observed (no worktree, no bundled skills given,
   * or the worktree's own team file records a newer `norn_version`). decide starts no agent step
   * while it is non-empty.
   */
  skills_drift?: string[];
}

export interface SliceFileFacts {
  key: string;
  /** repo-relative path of slices/<nn>-<slug>.md */
  file: string;
  nn: string;
  slug: string;
  frontmatter: SliceFrontmatter | null;
  error: FileError | null;
}

export type ClaimState =
  /** no claim ref */
  | { state: "none" }
  /** held by this checkout's heartbeat, not expired */
  | { state: "mine"; blob: ClaimBlob; sha: string }
  /** held by someone else, not expired */
  | { state: "other"; blob: ClaimBlob; sha: string }
  /** a blob exists but expires_at < now */
  | { state: "expired"; blob: ClaimBlob; sha: string }
  | { state: "corrupt"; sha: string; error: FileError };

export interface MailboxItem {
  ref: string;
  sha: string;
  /** ULID in the ref name */
  id: string;
  receipt: Receipt | null;
  error: FileError | null;
}

/** A commit on a story/slice branch that norn did not make (out-of-band). */
export interface ForeignCommit {
  sha: string;
  subject: string;
  author: string;
  /** author date, ISO */
  at: string;
  /** branch name it was found on */
  branch: string;
}

/**
 * This checkout's own record of a story another heartbeat holds, still in its
 * machine dir's `runs/<story>/`.
 */
export interface LocalRecord {
  /** its newest receipt, `NNNN-<kind>` (the story unit's, else a slice's); null = none */
  last_receipt: string | null;
  /**
   * its tree is the tree of a record commit this machine pushed (`Norn-Holder`) in the history of the
   * story's record ref here: everything in it is on the ref, as after a clean release
   */
  on_ref: boolean;
}

/** A merged story's base-branch done record norn stopped retrying (`records.json`), because the base kept refusing it. */
export interface OwedRecord {
  story: string;
  spec_dir: string;
  /** attempts the base refused */
  refusals: number;
  /** why the last attempt failed */
  reason: string;
  /** ISO time of the last attempt */
  attempted_at: string;
  /** ISO time norn stopped retrying */
  stopped_at: string;
}

/** A record this checkout set aside as superseded, `<machine dir>/superseded/<name>/`. */
export interface SupersededRecord {
  /** `<story>-<ulid>` */
  name: string;
  story: string;
  /** who held the claim when it was set aside; null = not recorded */
  holder: string | null;
  last_receipt: string | null;
  /** ISO time it was set aside */
  at: string;
  /** absolute folder */
  dir: string;
}

/**
 * The story branch against its base this tick. `conflicts` comes from `git merge-tree`
 * (computed only when `behind > 0` and the pair (story head, base sha) changed, cached per checkout).
 */
export interface StoryBase {
  /** `refs/remotes/<remote>/<base>`, or `refs/heads/<base>` without a git remote */
  ref: string;
  /** tip of the base ref this tick */
  sha: string;
  /** the story branch head measured (local `refs/heads/<story branch>`) */
  head: string;
  merge_base: string;
  /** commits in the base not in the story */
  behind: number;
  /** commits in the story not in the base */
  ahead: number;
  /** paths a merge of the base would conflict in; [] = clean */
  conflicts: string[];
}

/** A story PR observation (`null` = the remote said there is none) and its time (ms epoch). */
export interface StoryPrSeen {
  pr: RemotePullRequest | null;
  observed_at: number;
  /** The CI state of the PR's head, observed only for a story another heartbeat holds; absent = not observed */
  ci?: PullRequestCi;
}

/** A story issue observation (`null` = not visible to this checkout) and its time (ms epoch). */
export interface StoryIssueSeen {
  issue: RemoteIssue | null;
  observed_at: number;
}

export interface StoryFacts {
  key: string;
  slug: string;
  /** repo-relative spec folder `.agents/specs/<id>-<slug>` (inside the story worktree) */
  spec_dir: string;
  branch: string;
  frontmatter: StoryFrontmatter | null;
  frontmatter_error: FileError | null;
  worktree: WorktreeFacts | null;
  claim: ClaimState;
  /** pending mailbox receipts; undefined if not fetched this tick */
  mailbox: MailboxItem[] | undefined;
  /** the remote issue as seen now; null = not visible (closed/unassigned/unlabelled), undefined = not fetched */
  issue: RemoteIssue | null | undefined;
  /**
   * The story issue as the last successful sync of this checkout saw it, with when (ms epoch).
   * The finished-round Check item (label removed, unassigned, unseen) uses it when `issue` was not
   * fetched this tick, so it stays between syncs and shows in the read model. Decide never acts on
   * it. Absent = never seen here.
   */
  issue_seen?: StoryIssueSeen;
  /**
   * The story PR; null = none, undefined = not fetched. `number`, `url`, `state`, `is_draft`,
   * `head_sha`, `merge_commit_sha?`, `merged_by?`, `merged_at?`, `head?`, `base_branch?`.
   */
  pr?: RemotePullRequest | null;
  /**
   * The story PR as the last successful sync of this checkout saw it, with when (ms epoch).
   * Inbox items about the PR (merge, retarget, head changed) use it when `pr` was not fetched this
   * tick, so they stay put between syncs and show in the read model. Decide never acts on it (its
   * effects need a fresh `pr`). Absent = never seen here.
   */
  pr_seen?: StoryPrSeen;
  /**
   * Pull, don't trust: the story branch head is an ancestor of the fetched `<remote>/<base>`
   * while the PR does not say merged (e.g. a remote glitch left it open). Decide treats it as
   * merged. Absent = not observed or not merged by ancestry.
   */
  merged_by_ancestry?: boolean;
  /**
   * Commits on the story branch or a slice branch not created by norn (no `Norn-Tick` trailer)
   * since the last norn commit on that branch, newest first; only for units without a live run
   * (an agent's own commits mid-run are not foreign), and never one committed during a run of that
   * unit — an agent's commit while its unit is parked on an ask. Absent = none / not observed.
   */
  foreign_commits?: ForeignCommit[];
  /** story branch head when the person gave `approve` at the `ready` gate (the approve receipt's `head_sha`) */
  ready_head_sha?: string;
  /** When that approval was given (the approve receipt's `at`); PRs seen before it are not compared */
  ready_approved_at?: string;
  /**
   * The known PR head, when every commit after `ready_head_sha` up to it is norn's own for this
   * story (`Norn-Tick` + `Norn-Story` trailers — the `ready.approve → $done` commit and later state
   * commits); the head-changed item ignores that head. Absent = moved by someone else, or unknown.
   */
  ready_head_norn?: string;
  /**
   * The story's `status` in its record on the fetched base ref (`<remote>/<base>`); null = the
   * base has no record of it; absent = no base ref (solo) or not observed. The base record wins over
   * any local spec when deciding to acquire a claim.
   */
  base_status?: StoryFrontmatter["status"] | null;
  /**
   * On a checkout whose story another heartbeat holds, its own record of the
   * story still in its machine dir. Absent = none, held here, or not observed.
   */
  local_record?: LocalRecord;
  /**
   * An unclaimed new story — its local branch holds nothing beyond the intake commit: no
   * commit past the base ref, or one whose trailers are the story's intake (`isIntakeCommit`, never
   * its subject). Absent = not observed (claimed, not new, or the branch could not be listed).
   */
  intake_only?: boolean;
  /** The story branch against its base; absent = not observed (no story branch or base ref) */
  base?: StoryBase;
  /**
   * Under `record.policy: remote`, on the checkout that holds the claim, the
   * tree a pack of the story's run-state folder would write (`tree`, null = no file yet) and the record
   * ref as this checkout last saw it (`pushed`: its commit and tree; null = none). Machine-local.
   * Absent = not observed (another holder, or the policy is local).
   */
  record?: { tree: string | null; pushed: { sha: string; tree: string } | null };
  /**
   * The last record push of this holder refused as stale (another checkout
   * pushed the ref), kept machine-local in the story's own slot of `failures.json` apart from the story
   * unit's act failure (`lease`: the sha it leased on, null = none); dropped by the tick once the claim
   * is not here or the policy is `local`. While `record` is observed, decide pushes again only once the
   * record ref here is another one; the inbox shows one Check item meanwhile. Absent = none.
   */
  record_refused?: ActFailure;
  /**
   * This checkout has the story's record ref (`refs/norn/runs/<story>`, this commit)
   * but its story unit has no run state: the record was not put in place (a checkout cut short). decide
   * starts nothing over then. Absent = no such ref, or the story unit has run state.
   */
  record_unplaced?: string;
  /** Held here, read from its record in the machine dir alone — no branch, no spec in any tree */
  record_only?: boolean;
  /**
   * Notes for a person from `done` receipts of any unit of the story that no story-level
   * gate `approve` acknowledged yet, oldest first. Absent = none (or not observed).
   */
  notes?: import("./criteria.ts").StoryNote[];
  /**
   * Mailbox receipts this checkout's ticks rejected that no later accepted answer or
   * approval of the story cleared, oldest first. Absent = none.
   */
  rejected_mailbox?: RejectedMailboxReceipt[];
  /** units: the story unit first, then slices ascending by nn */
  units: UnitFacts[];
  slices: SliceFileFacts[];
  /** story mode from runs/_story/state.json, or config default */
  mode: Mode;
}

export interface MachineFacts {
  /** `user@machine` */
  holder: string;
  heartbeat_id: string | null;
  /** runner configured and available */
  runner: string | null;
  /** What that runner can do with a session; absent = unknown (treated as send only) */
  runner_capabilities?: RunnerCapabilities;
  /** all live leases on this machine across repos, dead ones excluded */
  leases: LeaseFile[];
  /** file names (in ~/.norn/leases/) of leases whose holder process is dead, plus unreadable lease files, for ReclaimLeasesAction */
  dead_lease_files?: string[];
}

export interface Facts {
  tick_id: string;
  /** ms epoch at observe start; decide uses only this as "now" */
  now: number;
  /**
   * `default_branch` is the **base branch**: config `base_branch` when set, else the remote's
   * default branch as discovered. Stories are cut from it, updated from it and PR'd into it.
   */
  repo: { root: string; default_branch: string; remote: string };
  machine: MachineFacts;
  remote: {
    /** issues from the last sync; undefined = not fetched this tick */
    issues: RemoteIssue[] | undefined;
  };
  stories: StoryFacts[];
  /**
   * This checkout's heartbeat — when a tick last ran here (ms epoch; null = never).
   * A tick observes its own start; views read `heartbeat.json`. Absent = not observed.
   */
  heartbeat?: { last_tick_at: number | null };
  /**
   * The running binary's version and the one the main checkout's team config records
   * (`norn_version`, null = not recorded). Absent = not observed (no running version given, or
   * the config failed to load). A mismatch never reaches decide (the tick is refused first);
   * the inbox shows it. `skills_drift`: the main checkout's bundled skills that differ from
   * the running norn's; absent = not observed.
   */
  norn?: { running: string; repo: string | null; skills_drift?: string[] };
  /** Records this checkout set aside as superseded, by name. Absent = none. */
  superseded?: SupersededRecord[];
  /** Merged stories whose base-branch done record norn stopped retrying (records.json). Absent = none. */
  owed_records?: OwedRecord[];
  /** worktrees/branches with no matching unit */
  orphans: { worktrees: string[]; branches: string[] };
  /**
   * Unit worktrees whose `.norn-unit` is gone (`git clean -fdx`), each with the
   * marker observe inferred from its folder and branch and read the unit by; act writes it back
   * (`restore_markers`). Observe writes nothing. Absent = none.
   */
  unmarked?: UnmarkedWorktree[];
}

/** A unit worktree without its `.norn-unit`, and the marker its folder and branch name. */
export interface UnmarkedWorktree {
  path: string;
  marker: { repo: string; story: string; slice: string | null; unit: string; spec_dir: string };
}

