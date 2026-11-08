/**
 * Actions: what the pure `decide` returns and `act` performs.
 *
 * Contract between decide and act:
 * - At most one Action per unit per tick; repo-level actions have `unit: null`.
 * - Side action: a story's `claim` renew (`op: "renew"`) does not occupy its unit's one
 *   action. Decide emits it before every other action of the story; act performs it first and, if
 *   its CAS loses (the claim is gone or held by another heartbeat), skips every other action of
 *   that story this tick, reporting each as `skipped: claim lost`. See decide's `isSideAction`.
 * - Side action: a story's `push_record` does not occupy its unit's one action either;
 *   act performs it after every other action of the tick (after the branch push).
 * - Side action: a story's `retitle_pr` touches only the remote PR, so it does not occupy
 *   its unit's one action either; act performs it after every other action of the tick.
 * - Decide is pure and replayable: it uses `facts.now` for every timestamp and
 *   `deriveUlid(facts.tick_id, i)` (from @norn/schema) for every new id (receipt_id, run_id).
 * - Every action is a plain JSON value (it is written to the trace verbatim).
 * - Act performs a `Transition` in this order:
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
 * - Traces written by an older norn differ in a few fields; `legacyAction` normalises them so
 *   `norn run view --why` still compares an old recorded decision with its replay.
 */
import type {
  ClaimBlob,
  GitAction,
  Receipt,
  RejectedMailboxReceipt,
  StoryFrontmatter,
  UnitState,
} from "@norn/schema";
import { recordRunStatePath } from "@norn/schema";
import type { Rejection } from "./apply.ts";
import type { FileError, UnitRef, UnmarkedWorktree } from "./facts.ts";
import type { InboxItem, PromptKey, RemoteIssue, SessionRef } from "./ports.ts";

/** A receipt decide wants written, with its number. */
export interface NewReceipt {
  n: number;
  receipt: Receipt;
}

/** Commit + push at a step boundary. */
export interface BoundaryCommit {
  /** worktree to commit in */
  cwd: string;
  branch: string;
  message: string;
  /** Norn-Story, Norn-Slice?, Norn-Step, Norn-Tick */
  trailers: Record<string, string>;
  /** push the branch after committing (only the claim holder) */
  push: boolean;
  /**
   * Commit even when nothing changed — a story unit's boundary, so the story branch
   * always carries the last boundary (`Norn-Outcome`, `Norn-Next`) a non-holder reads the step from.
   * Absent = no commit without changes (a slice's boundary: no reader needs it).
   */
  allow_empty?: true;
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
  /** id of the decide rule that fired, e.g. `agent.silent.nudge` */
  rule: string;
}
interface RepoBase {
  unit: null;
  rule: string;
}

/** Everything needed to start an agent session via the runner (auto mode). */
export interface AgentLaunch {
  run_id: string;
  agent: string;
  model?: string;
  cwd: string;
  prompt: string;
  /** NORN_HOME, NORN_STORY, NORN_SLICE, NORN_RUN, plus .env.norn */
  env: Record<string, string>;
  /** agent-tool session to resume; absent = fresh session */
  resume?: string;
  title: string;
}

/** Text to type into an existing session after the state write (answers). */
export interface SessionInput {
  run_id: string;
  session: SessionRef;
  text: string;
  /**
   * An answer to an implicit pane prompt goes in as these keystrokes (option number + enter,
   * arrows + enter, or text + enter), never as a pasted prompt. Act delivers them before writing
   * state: a failed delivery leaves the unit parked.
   */
  keys?: PromptKey[];
}

export interface WorktreeSpec {
  path: string;
  branch: string;
  /** create the branch from this ref if missing */
  from: string;
  /** contents of `.env.norn` */
  env: Record<string, string>;
  slot: number | null;
}

/**
 * How an action reaches an agent session: type `input` into the live session, or
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

/**
 * Apply receipts above applied_through and move the cursor/park/resume. Delivery: `input` types an
 * answer into the live session; `launch` (the session cannot take typed input, but the agent session
 * can be resumed) relaunches `--resume <agent_session_id>` with the answer as the prompt, `receipts`
 * then holding a `started` receipt for the same run; `kill` (a `workflow` / `unstick` receipt moved
 * the cursor off a live run) is killed (runner kill + lease release).
 */
export interface ApplyReceiptsAction extends UnitBase, Transition, Delivery {
  kind: "apply_receipts";
  /** receipt numbers applied (ascending); state.applied_through = last applied or rejected */
  applied: number[];
  /** receipts refused (stale step/attempt, wrong kind for the step); act writes each to the trace as a `reject` event */
  rejected: Rejection[];
  /** edge taken, if the cursor moved */
  advance: {
    from: string;
    outcome: string;
    to: string;
    counter?: { name: string; value: number; max: number };
    reset?: string[];
    /** A person's receipt moved the cursor (workflow, unstick, update; `Advance.moved`): no step ended */
    moved?: true;
  } | null;
  /**
   * A receipt number already taken means the agent's own report got there first (an
   * implicit ask resolved by the tick): act writes nothing more and the action has not failed.
   * Absent = a taken number fails the action.
   */
  yields_to_report?: true;
}

/** Start a unit: pin its workflow, create the worktree, write the first state. */
export interface StartUnitAction extends UnitBase, Transition {
  kind: "start_unit";
  workflow: string;
  /** exact text copied to runs/<unit>/workflow.yaml */
  workflow_source: string;
  /** null = the story unit working in the existing story worktree */
  worktree: WorktreeSpec | null;
  /** frontmatter status change for a slice (planned → active) */
  slice_status: "active" | null;
  /** the story's spec.md status to write (new → active); null for a slice, or when spec.md already says active */
  story_status: "active" | null;
}

/**
 * Auto mode: launch an agent for the cursor step. Requires an agent slot.
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
 * Same-session nudge after silent/timeout/stalled; counted in state.nudges_used. Delivered
 * by `send` into the live session when the runner can type (`input`), else by resuming the agent
 * session with the nudge text (`launch` with `resume`; `receipts` then also holds a `started`
 * receipt for the same run, filled with the new session as for start_run) after killing `kill`.
 */
export interface NudgeAction extends UnitBase, Transition, Delivery {
  kind: "nudge";
  /** snapshot request on silent (see ClassifyAction) */
  snapshot: { transcript: string | null; cwd: string } | null;
}

/**
 * Fresh session for the same step after died; counted in state.retries_used. `kill`: the previous
 * session, if still around. `launch` is null in manual mode or when no agent slot is free: the step
 * is just marked ready again. When set, `receipts` holds the classify receipt then the new run's
 * `started` receipt (act fills the session as for start_run).
 */
export interface RetryFreshAction extends UnitBase, Transition, Pick<Delivery, "kill" | "launch"> {
  kind: "retry_fresh";
}

/** Run a check step command. Act writes the `check` receipt with the result. */
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

/** Run a git step. Act writes a `classify` receipt with `done` or `conflict`. */
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
   * open-pr: act reads `body_file` (worktree-relative, prose decide never reads) and puts
   * `body` (the issue link) under it; no file → `body` alone. An open PR gets the new body.
   */
  pr: { base: string; title: string; body: string; body_file?: string } | null;
  /**
   * update: merge `sha` (the tip of `ref`) into the story branch with `message` and `trailers`
   * (`Norn-Tick`, so it is never reported as foreign). Absent on older traces.
   */
  update?: { ref: string; sha: string; branch: string; message: string; trailers: Record<string, string> } | null;
}

/** Story-level `slices` step: start every slice whose depends_on are done, within caps. */
export interface StartSlicesAction extends UnitBase {
  kind: "start_slices";
  starts: StartUnitAction[];
}

/**
 * Tick classification from facts: silent, died, timeout, stalled, implicit ask,
 * exhausted, slices done/stuck. The classify receipt is in `receipts`; the route is in `state`.
 */
export interface ClassifyAction extends UnitBase, Transition {
  kind: "classify";
  outcome: string;
  /** session to kill (timeout beyond nudges, run rerun --step) */
  kill: SessionRef | null;
  /** snapshot request: act fills last message / diff into the trace + handoff */
  snapshot: { transcript: string | null; cwd: string } | null;
}

/**
 * Park or mark stuck (ask, gate, attended, stuck, exhausted, remote) and notify once. The park
 * is `state.park`; an implicit ask whose workflow takes an `ask` edge leaves it null (the cursor moved).
 */
export interface ParkAction extends UnitBase, Transition {
  kind: "park";
  state: UnitState;
  notify: InboxItem | null;
}

/** Unit reached `$done`: slice → release slot, remove worktree after integration. */
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

/** Stale or invalid receipt / mailbox item rejected into the trace. */
export interface RejectReceiptAction extends UnitBase {
  kind: "reject_receipt";
  /** receipt number, or the mailbox ref */
  source: { n: number } | { ref: string; sha: string };
  reason: string;
  /** state with applied_through moved past a rejected numbered receipt */
  state: UnitState | null;
  /**
   * A rejected mailbox receipt to keep machine-local for its Check item, kept before the
   * ref is deleted. Absent = none (a numbered receipt, or a mailbox blob that could not be read).
   */
  keep?: RejectedMailboxReceipt;
}

/** A unit file failed validation: mark corrupt and surface it; never guess. */
export interface MarkCorruptAction extends UnitBase {
  kind: "mark_corrupt";
  errors: FileError[];
  /**
   * The `status: corrupt` state act writes into the unit's state.json — only when the failing files
   * are the unit's own runs/ files and its state.json reads; null = written nowhere. A broken spec.md
   * (or state.json) is surfaced, never written into state.
   */
  state: UnitState | null;
  notify: InboxItem | null;
}

/** Holder copies mailbox refs into receipts, commits, pushes, deletes refs. */
export interface ImportMailboxAction extends UnitBase, Transition {
  kind: "import_mailbox";
  /** refs to delete (local + remote) after the commit is pushed */
  refs: Array<{ ref: string; sha: string }>;
}

/** Claim ref CAS. `expected` null = ref must not exist. `renew` is a side action. */
export interface ClaimAction extends UnitBase {
  kind: "claim";
  op: "acquire" | "renew" | "release";
  expected: string | null;
  /** null for release (delete ref) */
  blob: ClaimBlob | null;
  /**
   * An intake's acquire (`claim.acquire.intake`) — what act does when it is lost: `drop` the
   * story worktree (when there) and local branch (they hold nothing beyond the intake, `intake_only`),
   * or `keep` them, with why (also when there is no `intake_only` fact). Absent = not an intake: a lost
   * acquire touches nothing.
   */
  lost_intake?: { drop: { worktree: string | null; branch: string } } | { keep: string };
}

/** Inbox notification for an item that has no other action this tick. */
export interface NotifyAction extends UnitBase {
  kind: "notify";
  item: InboxItem;
}

/** Mirror remote issue fields into spec.md frontmatter; body change → inbox item. */
export interface UpdateStoryMirrorAction extends UnitBase {
  kind: "update_story_mirror";
  fields: Partial<Pick<StoryFrontmatter, "title" | "assignee" | "url" | "labels" | "body_hash" | "refined_body_hash">>;
  notify: InboxItem | null;
  commit: BoundaryCommit | null;
}

/** An open story PR whose title is not the issue's gets the issue's title; the squash commit takes it. */
export interface RetitlePrAction extends UnitBase {
  kind: "retitle_pr";
  number: number;
  title: string;
}

/** PR merged → story done; remove worktrees, branches, claim and mailbox refs. */
export interface CleanupMergedStoryAction extends UnitBase {
  kind: "cleanup_merged_story";
  worktrees: string[];
  local_branches: string[];
  remote_branches: string[];
  refs: string[];
  /** spec.md status → done (committed on the base branch record) */
  story_status: "done";
  /**
   * Each unit not yet done, with its state recorded `done` (park and run cleared). Act writes
   * them before the archive push, so the final record carries them ([] = every unit is done).
   */
  finish: Array<{ unit: UnitRef; state: UnitState }>;
}

/**
 * The issue was seen `closed` on a finished round with no PR and no unfinished
 * slice — close the story exactly as `norn story close` does (push first, then remove worktrees, local
 * branches, leases and the claim; spec.md `dropped`, so `story reopen` brings it back), then remove
 * the mailbox `refs`.
 */
export interface CloseStoryAction extends UnitBase {
  kind: "close_story";
  /** the story's mailbox refs, deleted (local + remote) after the close effects */
  refs: Array<{ ref: string; sha: string }>;
}

/**
 * Move a flat story record (`_story/state.json` …) into its round 1 folder — everything
 * under `from` but `rounds/` — inside the machine dir: nothing to commit.
 */
export interface RoundMigrateAction extends UnitBase {
  kind: "round_migrate";
  /** machine-dir-relative `runs/<story>/_story` */
  from: string;
  /** machine-dir-relative `runs/<story>/_story/rounds/01-<workflow>` */
  to: string;
}

/**
 * Apply a `round` receipt — the old round's state (the receipt applied,
 * `$done`) in its own folder, then round `round.n`'s folder with the pinned workflow and its first
 * state (counters 0, mode carried over, cursor at the receipt's step), the story's `workflow:` set,
 * one commit. State is written last in each folder.
 */
export interface RoundStartAction extends UnitBase {
  kind: "round_start";
  /** the round receipt's number in the old round */
  receipt_n: number;
  /** the old round's state with the receipt applied and applied_through past the receipts after it */
  ended: UnitState;
  /** the receipts after the round receipt, made for the round it ends; act writes each to the trace as a `reject` event */
  rejected: Rejection[];
  /** the new round: its number, workflow and worktree-relative folder `runs/_story/rounds/NN-<wf>` */
  round: { n: number; workflow: string; dir: string };
  /** exact text pinned as the new round's workflow.yaml */
  workflow_source: string;
  /** the new round's first state */
  state: UnitState;
  commit: BoundaryCommit | null;
  /**
   * The issue's `norn:wf:<old>` label swapped for `norn:wf:<new>` after the commit, for
   * visibility only; null when the workflow is the same. A failed swap is a warning, never a failed action.
   */
  label: { number: number; remove: string; add: string } | null;
}

/** Nothing to do; recorded so `--why` explains idleness. */
export interface NoopAction extends UnitBase {
  kind: "noop";
  reason: string;
}

/** New assigned + labelled issue → story branch, worktree, spec.md, start story unit. */
export interface IntakeStoryAction extends RepoBase {
  kind: "intake_story";
  issue: RemoteIssue;
  key: string;
  slug: string;
  worktree: WorktreeSpec;
  /** repo-relative path of spec.md inside the story worktree */
  story_file: string;
  frontmatter: StoryFrontmatter;
  /** initial spec body (issue body) */
  body: string;
  commit: BoundaryCommit;
}

/**
 * Move the run state an older norn left on the unit's branch into the machine dir:
 * copy each record in `copy` (`from` relative to the worktree, `to` to the machine dir; a flat record
 * goes to the story's round 1), validated and put in place atomically, skipping one the
 * machine dir already holds; then remove `path` but the handoffs from the worktree and commit that
 * removal alone in `commit`, pushed.
 */
export interface MoveRecordAction extends UnitBase {
  kind: "move_record";
  /** `<spec folder>/runs`, relative to the worktree (`commit.cwd`) */
  path: string;
  /** each unit's folder (`_story`, `<nn>-<slug>`), where it is on the branch and where it goes */
  copy: Array<{ unit: string; from: string; to: string }>;
  commit: BoundaryCommit;
}

/**
 * Pack the story's record and push it to `refs/norn/runs/<story>` with a
 * lease on `expected` (the sha observe saw; null = none yet). A side action of the story unit that act
 * performs after every other action of the tick, so after the branch push; a tree unchanged from
 * `expected`'s pushes nothing, and a failed push leaves the record owed for the next tick.
 */
export interface PushRecordAction extends UnitBase {
  kind: "push_record";
  /** the story branch; its pushed head is the commit's `Norn-Branch-Commit` */
  branch: string;
  expected: string | null;
  /** `Norn-Holder`: the claim holder (`user@host`) */
  holder: string;
}

/**
 * This checkout's own record of a story another heartbeat holds leaves its
 * machine dir's `runs/<story>/`. `superseded`: taken over without a release — moved whole to
 * `superseded/<name>/` (never pushed, never merged), shown as one Check item until `norn tidy` deletes it
 * after `trace.retain`. null: released cleanly, the record already on the ref — removed quietly.
 */
export interface SetAsideRecordAction extends UnitBase {
  kind: "set_aside_record";
  superseded: { name: string; holder: string; last_receipt: string | null } | null;
}

/** Write back the `.norn-unit` of unit worktrees `git clean -fdx` took it from. */
export interface RestoreMarkersAction extends RepoBase {
  kind: "restore_markers";
  worktrees: UnmarkedWorktree[];
}

/** Reclaim leases whose holder process is dead. */
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
  | RetitlePrAction
  | CleanupMergedStoryAction
  | CloseStoryAction
  | RoundMigrateAction
  | RoundStartAction
  | MoveRecordAction
  | SetAsideRecordAction
  | PushRecordAction
  | NoopAction;

export type RepoAction = IntakeStoryAction | ReclaimLeasesAction | RestoreMarkersAction;

export type Action = UnitAction | RepoAction;

/** One decide output: the rule that fired and its action (trace `decisions[]`). */
export interface Decision {
  /** unit key, or `*` for repo-level */
  unit: string;
  rule: string;
  action: Action;
}

/** Why a lost intake keeps everything when observe could not tell what the intake holds. */
export const NOT_OBSERVED = "not decided: the intake branch was not observed";

const NO_TRANSITION: ReadonlySet<string> = new Set(["run_check", "run_git", "start_slices"]);

/**
 * A decision's action as this norn writes it, from one a trace recorded: an older norn gave
 * `run_check` / `run_git` / `start_slices` an empty `Transition` (`receipts: []`, `state: null`,
 * `commit: null`) and `park` a `park` copy of its state's park. The empty transition is dropped
 * only when it is exactly that, so a real difference still shows in a replay diff. It also gives an
 * older intake acquire without `lost_intake` the `keep` act fell back to, a resolved implicit ask its
 * `yields_to_report`, and an unmarked `mark_corrupt` `state: null`; a marked one keeps
 * `mark_state: true`, since the state act built is not in the trace.
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
  if (a.kind === "round_migrate" && "commit" in a) {
    const { commit: _c, ...rest } = a;
    const story = (a.unit as { story?: unknown } | undefined)?.story;
    // an older norn named the record from the spec folder (`<spec>/runs/_story…`); decide names it from the machine dir
    const moved = (p: unknown) => {
      const m = typeof p === "string" && typeof story === "string" ? /^(.*)\/runs\/(_story(?:\/.*)?)$/.exec(p) : null;
      return m ? recordRunStatePath({ key: story as string, spec_dir: m[1] as string }, m[2] as string) : p;
    };
    return { ...rest, from: moved(a.from), to: moved(a.to) };
  }
  if (a.kind === "claim" && a.rule === "claim.acquire.intake" && !("lost_intake" in a)) return { ...a, lost_intake: { keep: NOT_OBSERVED } };
  if (a.kind === "apply_receipts" && a.rule === "agent.ask.implicit.resolved" && !("yields_to_report" in a)) return { ...a, yields_to_report: true };
  if (a.kind === "mark_corrupt" && a.mark_state === false) {
    const { mark_state: _m, ...rest } = a;
    return { ...rest, state: null };
  }
  if (a.kind === "park" && "park" in a) {
    const { park: _p, ...rest } = a;
    return rest;
  }
  return action;
}

/** What act reports per action (trace `result`). */
export interface ActionResult {
  /** False whenever the action's effect failed (send, resume, launch, push), never "ok with a note" */
  ok: boolean;
  error?: string;
  detail?: unknown;
  /** An effect that failed without failing the action (a label not updated); carried to the trace and the tick's output */
  warnings?: string[];
  /** trace-relative paths written by act */
  briefing?: string;
  transcript?: string;
}
