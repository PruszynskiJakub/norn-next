/**
 * Facts: everything `observe` collects in one tick (H2). Decide is a pure function
 * of `Facts` + config (H3), so a Facts value must be JSON-serializable: it is stored
 * in the tick trace and replayed by `norn why` (O5). No functions, Dates or Maps.
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
import type { PaneState, RemoteIssue, RemotePullRequest, SessionRef, WorktreeStatus } from "./ports.ts";

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
  /** `.norn-unit` marker present (A3) */
  marker: boolean;
  status: WorktreeStatus | null;
  /** ms epoch; null if no commits */
  last_commit_at: number | null;
  /** newest mtime of tracked/untracked files, for `stalled` (ms epoch) */
  last_file_change_at: number | null;
  /** slot from `.env.norn` (K4) */
  slot: number | null;
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
   * `head_sha`, `merge_commit_sha?`, `merged_by?`, `merged_at?` (plus the older `draft`/`head`/`base`).
   */
  pr?: RemotePullRequest | null;
  /**
   * P2 (pull, don't trust): the story branch head is an ancestor of the fetched `<remote>/<base>`
   * while the PR does not say merged (e.g. a remote glitch left it open). Decide treats it as
   * merged (GR6). Absent = not observed or not merged by ancestry.
   */
  merged_by_ancestry?: boolean;
  /**
   * Commits on the story branch or a slice branch not created by norn (no `Norn-Tick` trailer)
   * since the last norn commit on that branch, newest first; only for units without a live run
   * (an agent's own commits mid-run are not foreign). Absent = none / not observed.
   */
  foreign_commits?: ForeignCommit[];
  /** story branch head when the person gave `approve` at the `ready` gate (the approve receipt's `head_sha`) */
  ready_head_sha?: string;
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
  /** all live leases on this machine across repos (K1, K3), dead ones excluded */
  leases: LeaseFile[];
  /** leases whose holder process is dead (to reclaim) */
  dead_leases: LeaseFile[];
  /** file names (in ~/.norn/leases/) of `dead_leases` plus unreadable lease files, for ReclaimLeasesAction */
  dead_lease_files?: string[];
}

export interface Facts {
  tick_id: string;
  /** ms epoch at observe start; decide uses only this as "now" */
  now: number;
  repo: { root: string; default_branch: string; remote: string };
  machine: MachineFacts;
  remote: {
    /** ms epoch of last successful sync, null = never */
    synced_at: number | null;
    /** issues from the last sync (GR1); undefined = not fetched this tick */
    issues: RemoteIssue[] | undefined;
  };
  stories: StoryFacts[];
  /** worktrees/branches with no matching unit (K5) */
  orphans: { worktrees: string[]; branches: string[] };
}

/**
 * Pure decide signature (H3). Pinned unit workflows are inside Facts; `workflows` are the
 * repo workflows (for starting units, S7), recorded with the facts so `why` can replay (O5).
 */
export type DecideFn = (
  facts: Facts,
  workflows: import("./decide.ts").RepoWorkflows,
  config: ResolvedConfig,
) => import("./actions.ts").Decision[];
