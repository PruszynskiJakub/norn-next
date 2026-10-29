/**
 * Actions: what the pure `decide` returns (H3) and `act` performs (H4).
 *
 * Contract between decide and act:
 * - At most one Action per unit per tick; repo-level actions have `unit: null`.
 * - Side action (R1.1): a story's `claim` renew (`op: "renew"`) does not occupy its unit's one
 *   action. Decide emits it before every other action of the story; act performs it first and, if
 *   its CAS loses (the claim is gone or held by another heartbeat), skips every other action of
 *   that story this tick, reporting each as `skipped: claim lost` (R1.2). See decide's `isSideAction`.
 * - Decide is pure and replayable: it uses `facts.now` for every timestamp and
 *   `deriveUlid(facts.tick_id, i)` (from @norn/schema) for every new id (receipt_id, run_id).
 * - Every action is a plain JSON value (it is written to the trace verbatim).
 * - Act performs a `Transition` in this order (P6, S5, S6, S8):
 *     1. write `receipts` (numbered by decide; O_EXCL; an existing file with the same
 *        receipt_id counts as written — replay after a crash),
 *     2. perform the action's external effect (launch, send, command, git, remote),
 *     3. write `state` (atomic, last),
 *     4. `commit` and push if set.
 *   If step 2 fails, act still writes nothing past the receipts; the next tick re-decides.
 * - Exception: `run_check` and `run_git` carry no `Transition`: they produce their result receipt
 *   (`check` / `classify`) after the effect; act numbers it as the next free receipt number and the
 *   next tick applies it. Re-running an interrupted check/git step is safe. `start_slices` carries
 *   its transitions in its `starts`.
 * - Traces written by an older norn carry `receipts: []`, `state: null`, `commit: null` on those three
 *   kinds and a `park` copy of `state.park` on `park`; `legacyAction` drops them so `norn run view --why` still
 *   compares an old recorded decision with its replay.
 */
import type {
  ClaimBlob,
  GitAction,
  Receipt,
  StoryFrontmatter,
  UnitState,
} from "@norn/schema";
import type { Rejection } from "./apply.ts";
import type { FileError, UnitRef } from "./facts.ts";
import type { InboxItem, PromptKey, RemoteIssue, SessionRef } from "./ports.ts";

/** A receipt decide wants written, with its number (S6). */
export interface NewReceipt {
  n: number;
  receipt: Receipt;
}

/** Commit + push at a step boundary (S4, S8). */
export interface BoundaryCommit {
  /** worktree to commit in */
  cwd: string;
  branch: string;
  message: string;
  /** Norn-Story, Norn-Slice?, Norn-Step, Norn-Tick */
  trailers: Record<string, string>;
  /** push the branch after committing (only the claim holder, T7) */
  push: boolean;
}

/** State change carried by unit actions. */
export interface Transition {
  receipts: NewReceipt[];
  /** next runs/<unit>/state.json; null = unchanged */
  state: UnitState | null;
  commit: BoundaryCommit | null;
}

interface UnitBase {
  unit: UnitRef;
  /** id of the decide rule that fired (O5), e.g. `agent.silent.nudge` */
  rule: string;
}
interface RepoBase {
  unit: null;
  rule: string;
}

/** Everything needed to start an agent session via the runner (auto mode, B5, A6). */
export interface AgentLaunch {
  run_id: string;
  agent: string;
  model?: string;
  cwd: string;
  prompt: string;
  /** NORN_HOME, NORN_STORY, NORN_SLICE, NORN_RUN, plus .env.norn */
  env: Record<string, string>;
  /** agent-tool session to resume (B2); absent = fresh session */
  resume?: string;
  title: string;
}

/** Text to type into an existing session after the state write (answers, B2). */
export interface SessionInput {
  run_id: string;
  session: SessionRef;
  text: string;
  /**
   * R6.2: an answer to an implicit pane prompt goes in as these keystrokes (option number + enter,
   * arrows + enter, or text + enter), never as a pasted prompt. Act delivers them before writing
   * state: a failed delivery leaves the unit parked (R6.3).
   */
  keys?: PromptKey[];
}

export interface WorktreeSpec {
  path: string;
  branch: string;
  /** create the branch from this ref if missing */
  from: string;
  /** contents of `.env.norn` (K4) */
  env: Record<string, string>;
  slot: number | null;
}

/**
 * How an action reaches an agent session (B2, R4.2): type `input` into the live session, or
 * `launch` a resumed (or fresh) one, after killing `kill` when it is still around.
 */
export interface Delivery {
  /** `send` delivery into the live session after state is written */
  input: SessionInput | null;
  /** relaunch: `--resume <agent_session_id>` (or a fresh session) with the text as the prompt */
  launch: AgentLaunch | null;
  /** session to terminate first, if still present */
  kill: SessionRef | null;
}

// ------------------------------------------------------------------ unit actions

/** Apply receipts above applied_through and move the cursor/park/resume (S6, W3, W4). */
/**
 * Delivery: `input` types an answer into the live session; `launch` (B2: the session cannot take
 * typed input — headless, or gone — but the agent session can be resumed) relaunches
 * `--resume <agent_session_id>` with the answer as the prompt, `receipts` then holding a `started`
 * receipt for the same run (act fills the session as for start_run); `kill` (S7/O2: a `workflow` /
 * `unstick` receipt moved the cursor off a live run) is killed (runner kill + lease release).
 */
export interface ApplyReceiptsAction extends UnitBase, Transition, Delivery {
  kind: "apply_receipts";
  /** receipt numbers applied (ascending); state.applied_through = last applied or rejected */
  applied: number[];
  /** receipts refused (stale step/attempt T9, wrong kind for the step); act writes each to the trace as a `reject` event */
  rejected: Rejection[];
  /** edge taken, if the cursor moved */
  advance: { from: string; outcome: string; to: string; counter?: { name: string; value: number; max: number }; reset?: string[] } | null;
}

/** Start a unit: pin its workflow (S7), create the worktree, write the first state. */
export interface StartUnitAction extends UnitBase, Transition {
  kind: "start_unit";
  workflow: string;
  /** exact text copied to runs/<unit>/workflow.yaml */
  workflow_source: string;
  /** null = the story unit working in the existing story worktree */
  worktree: WorktreeSpec | null;
  /** frontmatter status change for a slice (planned → active) */
  slice_status: "active" | null;
}

/**
 * Auto mode: launch an agent for the cursor step (MO3). Requires an agent slot (K1).
 * `receipts` holds the `started` receipt (how: auto) and `state` has the run applied;
 * act fills `state.run.session` / `process` / `agent_session_id` from the launch result
 * before writing state.
 */
export interface StartRunAction extends UnitBase, Transition {
  kind: "start_run";
  step: string;
  launch: AgentLaunch;
}

/**
 * Same-session nudge after silent/timeout/stalled (C1); counted in state.nudges_used. R4.2: delivered
 * by `send` into the live session when the runner can type (`input`), else by resuming the agent
 * session with the nudge text (`launch` with `resume`; `receipts` then also holds a `started`
 * receipt for the same run, filled with the new session as for start_run) after killing `kill`.
 */
export interface NudgeAction extends UnitBase, Transition, Delivery {
  kind: "nudge";
  /** C4 snapshot request on silent (see ClassifyAction) */
  snapshot: { transcript: string | null; cwd: string } | null;
}

/** Fresh session for the same step after died (C1, B2); counted in state.retries_used. */
/**
 * `kill`: the previous session, if still around. `launch` is null in manual mode or when no agent
 * slot is free: the step is just marked ready again. When set, `receipts` holds the classify receipt
 * then the new run's `started` receipt (act fills the session as for start_run).
 */
export interface RetryFreshAction extends UnitBase, Transition, Pick<Delivery, "kill" | "launch"> {
  kind: "retry_fresh";
}

/** Run a check step command (W2). Act writes the `check` receipt with the result (C5). */
export interface RunCheckAction extends UnitBase {
  kind: "run_check";
  step: string;
  run_id: string;
  command: string;
  cwd: string;
  timeout_ms: number;
  /** extra env (.env.norn) */
  env: Record<string, string>;
  /** where act writes the full log on fail: runs/<unit>/logs/<run_id>.log */
  log_path: string;
}

/** Run a git step (W2, K6). Act writes a `classify` receipt with `done` or `conflict`. */
export interface RunGitAction extends UnitBase {
  kind: "run_git";
  step: string;
  run_id: string;
  action: GitAction;
  cwd: string;
  branch: string;
  /** integrate: the story branch to rebase onto and fast-forward */
  onto: string | null;
  /**
   * open-pr. GR9: act reads `body_file` (worktree-relative, prose decide never reads, P8) and puts
   * `body` (the issue link) under it; no file → `body` alone. An open PR gets the new body.
   */
  pr: { base: string; title: string; body: string; body_file?: string } | null;
  /**
   * update (BS3): merge `sha` (the tip of `ref`, BS0) into the story branch with `message` and
   * `trailers` (`Norn-Tick`: Q6 never reports it as foreign). Absent on older traces.
   */
  update?: { ref: string; sha: string; branch: string; message: string; trailers: Record<string, string> } | null;
}

/** Story-level `slices` step: start every slice whose depends_on are done, within caps (W2). */
export interface StartSlicesAction extends UnitBase {
  kind: "start_slices";
  starts: StartUnitAction[];
}

/**
 * Tick classification from facts (§10): silent, died, timeout, stalled, implicit ask,
 * exhausted, slices done/stuck. The classify receipt is in `receipts`; the route is in `state`.
 */
export interface ClassifyAction extends UnitBase, Transition {
  kind: "classify";
  outcome: string;
  /** session to kill (timeout beyond nudges, unstick --to) */
  kill: SessionRef | null;
  /** C4 snapshot request: act fills last message / diff into the trace + handoff */
  snapshot: { transcript: string | null; cwd: string } | null;
}

/**
 * Park or mark stuck (ask, gate, attended, stuck, exhausted, remote) and notify once (O3). The park
 * is `state.park`; an implicit ask whose workflow takes an `ask` edge leaves it null (the cursor moved).
 */
export interface ParkAction extends UnitBase, Transition {
  kind: "park";
  state: UnitState;
  notify: InboxItem | null;
}

/** Unit reached `$done`: slice → release slot, remove worktree after integration (K5). */
export interface MarkDoneAction extends UnitBase, Transition {
  kind: "mark_done";
  /**
   * `branch_local`: the slice branch act deletes — only one decide knows is in the story branch
   * (`branch_in_story`, or the worktree act integrates first is on it); null = keep it, with
   * `branch_kept` saying why when there is one.
   */
  cleanup: { worktree: string | null; branch_local: string | null; branch_kept?: string; release_slot: boolean };
  slice_status: "integrated" | null;
}

/** Recovery: state/receipts were written but not committed (crash between 3 and 4). */
export interface CommitPushAction extends UnitBase {
  kind: "commit_push";
  commit: BoundaryCommit;
}

/** Stale or invalid receipt / mailbox item rejected into the trace (T9). */
export interface RejectReceiptAction extends UnitBase {
  kind: "reject_receipt";
  /** receipt number, or the mailbox ref */
  source: { n: number } | { ref: string; sha: string };
  reason: string;
  /** state with applied_through moved past a rejected numbered receipt */
  state: UnitState | null;
}

/** A unit file failed validation (S2): mark corrupt and surface it; never guess. */
export interface MarkCorruptAction extends UnitBase {
  kind: "mark_corrupt";
  errors: FileError[];
  /**
   * S2: write `status: corrupt` into the unit's state.json — only when the failing files are the
   * unit's own runs/ files and its state.json reads. A broken story.md (or state.json) is surfaced,
   * never written into state.
   */
  mark_state: boolean;
  notify: InboxItem | null;
}

/** Holder copies mailbox refs into receipts, commits, pushes, deletes refs (T9). */
export interface ImportMailboxAction extends UnitBase, Transition {
  kind: "import_mailbox";
  /** refs to delete (local + remote) after the commit is pushed */
  refs: Array<{ ref: string; sha: string }>;
}

/** Claim ref CAS (T3, T4, T6). `expected` null = ref must not exist. `renew` is a side action (R1.1). */
export interface ClaimAction extends UnitBase {
  kind: "claim";
  op: "acquire" | "renew" | "release";
  expected: string | null;
  /** null for release (delete ref) */
  blob: ClaimBlob | null;
  /**
   * R3.1 (H6): for `claim.acquire.intake`, what act does when the acquire is lost — `drop` the story
   * worktree (when there) and local branch (they hold nothing beyond the intake, `intake_only`), or
   * `keep` them, with why. Absent = not decided (no `intake_only` fact): act keeps everything.
   */
  lost_intake?: { drop: { worktree: string | null; branch: string } } | { keep: string };
}

/** Inbox notification for an item that has no other action this tick. */
export interface NotifyAction extends UnitBase {
  kind: "notify";
  item: InboxItem;
}

/** GR8: mirror remote issue fields into story.md frontmatter; body change → inbox item. */
export interface UpdateStoryMirrorAction extends UnitBase {
  kind: "update_story_mirror";
  fields: Partial<Pick<StoryFrontmatter, "title" | "assignee" | "url" | "labels" | "body_hash" | "refined_body_hash">>;
  notify: InboxItem | null;
  commit: BoundaryCommit | null;
}

/** GR6: PR merged → story done; remove worktrees, branches, claim and mailbox refs. */
export interface CleanupMergedStoryAction extends UnitBase {
  kind: "cleanup_merged_story";
  worktrees: string[];
  local_branches: string[];
  remote_branches: string[];
  refs: string[];
  /** story.md status → done (committed on the base branch record) */
  story_status: "done";
}

/** Nothing to do; recorded so `why` explains idleness. */
export interface NoopAction extends UnitBase {
  kind: "noop";
  reason: string;
}

// ------------------------------------------------------------------ repo-level actions

/** GR2: new assigned + labelled issue → story branch, worktree, story.md, start story unit. */
export interface IntakeStoryAction extends RepoBase {
  kind: "intake_story";
  issue: RemoteIssue;
  key: string;
  slug: string;
  worktree: WorktreeSpec;
  /** repo-relative path of story.md inside the story worktree */
  story_file: string;
  frontmatter: StoryFrontmatter;
  /** initial spec body (issue body) */
  body: string;
  commit: BoundaryCommit;
}

/** Reclaim leases whose holder process is dead (K3). */
export interface ReclaimLeasesAction extends RepoBase {
  kind: "reclaim_leases";
  /** lease file names in ~/.norn/leases/ */
  files: string[];
}

export type UnitAction =
  | ApplyReceiptsAction
  | StartUnitAction
  | StartRunAction
  | NudgeAction
  | RetryFreshAction
  | RunCheckAction
  | RunGitAction
  | StartSlicesAction
  | ClassifyAction
  | ParkAction
  | MarkDoneAction
  | CommitPushAction
  | RejectReceiptAction
  | MarkCorruptAction
  | ImportMailboxAction
  | ClaimAction
  | NotifyAction
  | UpdateStoryMirrorAction
  | CleanupMergedStoryAction
  | NoopAction;

export type RepoAction = IntakeStoryAction | ReclaimLeasesAction;

export type Action = UnitAction | RepoAction;

/** One decide output: the rule that fired and its action (trace `decisions[]`). */
export interface Decision {
  /** unit key, or `*` for repo-level */
  unit: string;
  rule: string;
  action: Action;
}

const NO_TRANSITION: ReadonlySet<string> = new Set(["run_check", "run_git", "start_slices"]);

/**
 * A decision's action as this norn writes it, from one a trace recorded (O5): an older norn gave
 * `run_check` / `run_git` / `start_slices` an empty `Transition` (`receipts: []`, `state: null`,
 * `commit: null`) and `park` a `park` copy of its state's park. The empty transition is dropped
 * only when it is exactly that, so a real difference still shows in a replay diff.
 */
export function legacyAction(action: unknown): unknown {
  if (!action || typeof action !== "object") return action;
  const a = action as Record<string, unknown>;
  if (typeof a.kind === "string" && NO_TRANSITION.has(a.kind)) {
    const empty = Array.isArray(a.receipts) && a.receipts.length === 0 && a.state === null && a.commit === null;
    if (!empty) return action;
    const { receipts: _r, state: _s, commit: _c, ...rest } = a;
    return rest;
  }
  if (a.kind === "park" && "park" in a) {
    const { park: _p, ...rest } = a;
    return rest;
  }
  return action;
}

/** What act reports per action (trace `result`). */
export interface ActionResult {
  /** R4.3: false whenever the action's effect failed (send, resume, launch, push), never "ok with a note" */
  ok: boolean;
  error?: string;
  detail?: unknown;
  /** trace-relative paths written by act */
  briefing?: string;
  transcript?: string;
}
