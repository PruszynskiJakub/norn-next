/**
 * Facts: everything `observe` collects in one tick (H2). Decide is a pure function
 * of `Facts` + config (H3), so a Facts value must be JSON-serializable: it is stored
 * in the tick trace and replayed by `norn run view --why` (O5). No functions, Dates or Maps.
 *
 * Absence conventions:
 * - `null`       = observed, and nothing is there
 * - `undefined`  = not observed this tick (e.g. remote throttled, H5) — decide must not act on it
 */
import type {
  ClaimBlob,
  HookFact,
  LeaseFile,
  Mode,
  Receipt,
  ResolvedConfig,
  SchemaError,
  SliceFrontmatter,
  StoryFrontmatter,
  UnitState,
  Workflow,
} from "@norn/schema";
import type { GitInProgress, PaneState, RemoteIssue, RemotePullRequest, RunnerCapabilities, SessionRef, WorktreeStatus } from "./ports.ts";

/** A file that failed to read or validate (S2). */
export interface FileError {
  /** repo-relative path */
  file: string;
  errors: SchemaError[];
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
  /** slot from `.env.norn` (K4) */
  slot: number | null;
  /**
   * H1/BS5.1: the git operation in progress in the worktree (an agent's merge, a rebase, …) and its
   * unmerged paths; absent = not observed. While one is, norn commits nothing there (H1).
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
  /** B3: the first lines the session printed, read only once its process is gone (RunnerPort.output) */
  output?: string;
  /**
   * R5.1 (H2): the run's `started` receipt is not applied (a crash between the receipt and
   * `state.json`), so norn does not know whether, or where, it was launched. `session` is then what
   * observe found for it (runner session or process; null = nothing found), `hooks` its hook facts.
   */
  launch_unknown?: {
    /** number of the unapplied `started` receipt */
    n: number;
    /** that receipt's time (ms epoch): the R5.2 grace runs from it */
    at: number;
    /** agent-tool session id seen for the run (hooks or the runner), for `--resume` */
    agent_session_id: string | null;
  };
}

/** R5.3: a run of the unit's cursor step/attempt (from its `started` receipts) and its hook activity. */
export interface StepRunFacts {
  run_id: string;
  /** newest hook fact for the run (ms epoch), null = none in the window */
  last_hook_at: number | null;
  /** its newest hook is `session_end` — the agent process is gone */
  ended: boolean;
}

/**
 * R4.3: the last failed effect of an action for this unit on this checkout (send, resume, launch,
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
}

export interface UnitFacts {
  unit: UnitRef;
  /** null = unit not started (no runs/<unit>/state.json) */
  state: UnitState | null;
  /** pinned runs/<unit>/workflow.yaml, parsed + schema-valid; null if not started */
  workflow: Workflow | null;
  /** sha256 of the pinned workflow file as read */
  workflow_hash: string | null;
  /** files of this unit failing validation → unit is corrupt (S2) */
  errors: FileError[];
  /** receipts with n > state.applied_through, ascending by n */
  unapplied: NumberedReceipt[];
  /** latest check receipt with outcome fail since the last step entry (B3 Rework, B6) */
  last_check: NumberedReceipt | null;
  /** latest done receipt carrying findings that routed back here (B3 Rework, B6) */
  last_findings: NumberedReceipt | null;
  /**
   * The done/check receipt of `state.last_outcome` (the report that moved the cursor here), e.g. the
   * qa report a gate shows with its evidence (O1, F21). Absent/null = not read or none.
   */
  last_outcome_receipt?: NumberedReceipt | null;
  worktree: WorktreeFacts | null;
  run: RunFacts | null;
  /** this machine's lease for the unit's run, if any */
  lease: LeaseFile | null;
  /** runs/<unit>/ or handoff.md have uncommitted changes (crash between write and commit) */
  uncommitted: boolean;
  /** R5.3: runs of the cursor step/attempt with their hook activity; absent = not observed */
  step_runs?: StepRunFacts[];
  /** R4.3: last failed act effect for the unit on this checkout; absent = none */
  act_failure?: ActFailure;
  /**
   * A done slice: its local branch is in the story branch (its head an ancestor of the story
   * branch head), so the slice cleanup may delete it. Absent = not observed (no local branch, not a
   * done slice) — decide then keeps the branch unless the cleanup integrates its worktree first.
   */
  branch_in_story?: boolean;
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
  /** held by this heartbeat (or this machine's heartbeat_id), not expired */
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

/** A commit on a story/slice branch that norn did not make (Q6, out-of-band). */
export interface ForeignCommit {
  sha: string;
  subject: string;
  /** author name */
  author: string;
  /** author date, ISO */
  at: string;
  /** branch name it was found on */
  branch: string;
}

/** R2.3: local runs/ work of one unit that is not in the record (the remote unit branch). */
export interface UnpushedRuns {
  /** unit key */
  unit: string;
  /** worktree-relative paths under `<spec_dir>/runs/<unit dir>/`, sorted */
  files: string[];
}

/**
 * BS1: the story branch against its base (BS0) this tick. `conflicts` comes from `git merge-tree`
 * (computed only when `behind > 0` and the pair (story head, base sha) changed, cached per checkout).
 */
export interface StoryBase {
  /** BS0: `refs/remotes/<remote>/<base>`, or `refs/heads/<base>` without a git remote */
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

/** C1: a story PR observation (`null` = the remote said there is none) and its time (ms epoch). */
export interface StoryPrSeen {
  pr: RemotePullRequest | null;
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
  /** pending mailbox receipts (T9); undefined if not fetched this tick */
  mailbox: MailboxItem[] | undefined;
  /** the remote issue as seen now; null = not visible (closed/unassigned/unlabelled), undefined = not fetched */
  issue: RemoteIssue | null | undefined;
  /**
   * The story PR; null = none, undefined = not fetched. `number`, `url`, `state`, `is_draft`,
   * `head_sha`, `merge_commit_sha?`, `merged_by?`, `merged_at?`, `head?`, `base_branch?`.
   */
  pr?: RemotePullRequest | null;
  /**
   * C1: the story PR as the last successful sync of this checkout saw it, with when (ms epoch).
   * Inbox items about the PR (merge BS10, retarget BS11, head changed F35) use it when `pr` was not
   * fetched this tick, so they stay put between syncs and show in the read model. Decide never acts
   * on it (GR6/GR7 effects need a fresh `pr`). Absent = never seen here.
   */
  pr_seen?: StoryPrSeen;
  /**
   * P2 (pull, don't trust): the story branch head is an ancestor of the fetched `<remote>/<base>`
   * while the PR does not say merged (e.g. a remote glitch left it open). Decide treats it as
   * merged (GR6). Absent = not observed or not merged by ancestry.
   */
  merged_by_ancestry?: boolean;
  /**
   * Commits on the story branch or a slice branch not created by norn (no `Norn-Tick` trailer)
   * since the last norn commit on that branch, newest first; only for units without a live run
   * (an agent's own commits mid-run are not foreign), and never one committed during a run of that
   * unit — an agent's commit while its unit is parked on an ask (C4). Absent = none / not observed.
   */
  foreign_commits?: ForeignCommit[];
  /** story branch head when the person gave `approve` at the `ready` gate (the approve receipt's `head_sha`) */
  ready_head_sha?: string;
  /** BS10.2: when that approval was given (the approve receipt's `at`); PRs seen before it are not compared */
  ready_approved_at?: string;
  /**
   * C5: the known PR head, when every commit after `ready_head_sha` up to it is norn's own for this
   * story (`Norn-Tick` + `Norn-Story` trailers — the `ready.approve → $done` commit and later state
   * commits); the head-changed item (F35) ignores that head. Absent = moved by someone else, or unknown.
   */
  ready_head_norn?: string;
  /**
   * R3.2: the story's `status` in its record on the fetched base ref (`<remote>/<base>`); null = the
   * base has no record of it; absent = no base ref (solo) or not observed. The base record wins over
   * any local spec when deciding to acquire a claim.
   */
  base_status?: StoryFrontmatter["status"] | null;
  /**
   * R2.3: on a checkout that does not hold the claim, runs/ files (receipts, state) changed locally
   * but not on the remote unit branch, per unit; paths are relative to the unit's worktree. Absent =
   * none, held here, or not observed.
   */
  unpushed_runs?: UnpushedRuns[];
  /**
   * R3.1: an unclaimed new story — its local branch holds nothing beyond the intake commit: no
   * commit past the base ref, or one whose trailers are the story's intake (`isIntakeCommit`, never
   * its subject). Absent = not observed (claimed, not new, or the branch could not be listed).
   */
  intake_only?: boolean;
  /** BS1: the story branch against its base; absent = not observed (no story branch or base ref) */
  base?: StoryBase;
  /**
   * NT2/NT3: notes for a person from `done` receipts of any unit of the story that no story-level
   * gate `approve` acknowledged yet, oldest first. Absent = none (or not observed).
   */
  notes?: import("./criteria.ts").StoryNote[];
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
  /** runner configured and available (MO2) */
  runner: string | null;
  /** R4.1: what that runner can do with a session; absent = unknown (treated as send only, the pre-R4 behaviour) */
  runner_capabilities?: RunnerCapabilities;
  /** all live leases on this machine across repos (K1, K3), dead ones excluded */
  leases: LeaseFile[];
  /** file names (in ~/.norn/leases/) of leases whose holder process is dead, plus unreadable lease files, for ReclaimLeasesAction */
  dead_lease_files?: string[];
}

export interface Facts {
  tick_id: string;
  /** ms epoch at observe start; decide uses only this as "now" */
  now: number;
  /**
   * `default_branch` is the **base branch** (BS0): config `base_branch` when set, else the remote's
   * default branch as discovered. Stories are cut from it, updated from it and PR'd into it.
   */
  repo: { root: string; default_branch: string; remote: string };
  machine: MachineFacts;
  remote: {
    /** issues from the last sync (GR1); undefined = not fetched this tick */
    issues: RemoteIssue[] | undefined;
  };
  stories: StoryFacts[];
  /**
   * R5.5 (N3): this checkout's heartbeat — when a tick last ran here (ms epoch; null = never).
   * A tick observes its own start; views read `heartbeat.json`. Absent = not observed.
   */
  heartbeat?: { last_tick_at: number | null };
  /** worktrees/branches with no matching unit (K5) */
  orphans: { worktrees: string[]; branches: string[] };
}

