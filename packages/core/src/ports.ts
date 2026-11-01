/**
 * Adapter contracts (X2). @norn/core defines them; @norn/adapters implements them;
 * @norn/cli wires them. Everything here is types only — no IO, no implementation.
 *
 * Conventions for every port:
 * - Methods are async and throw `PortError` for failures the caller can act on.
 * - Paths are absolute. Times are ISO-8601 strings unless typed `number` (ms epoch).
 * - Ports never decide anything; they report facts and perform one effect.
 */
import type {
  HookEventKind,
  HookFact,
  NotifierConfig,
  ProcessIdentity,
  PromptChoice,
  RemoteProvider,
  ResolvedConfig,
  RunnerConfig,
} from "@norn/schema";

/** Error thrown by ports; `code` is stable for callers, `retryable` hints at transient failures. */
export interface PortError extends Error {
  code: string;
  retryable: boolean;
}

// ============================================================= Clock

export interface Clock {
  /** ms since epoch */
  now(): number;
  /** ISO-8601 of now() */
  iso(): string;
}

// ============================================================= Process

/** Liveness of an OS process by PID + start time (K3, MO3). */
export interface ProcessPort {
  /** Identity of a live pid, or null if gone. */
  identify(pid: number): Promise<ProcessIdentity | null>;
  /** true iff a process with this pid exists AND has the same start time. */
  isAlive(proc: ProcessIdentity): Promise<boolean>;
  self(): ProcessIdentity;
  /**
   * R5.1: live processes whose environment holds `name=value` (e.g. `NORN_RUN=<run_id>`), where the
   * OS lets this user read it; [] when it does not. Optional: ports without it never find any.
   */
  findByEnv?(name: string, value: string): Promise<ProcessIdentity[]>;
}

// ============================================================= Git

export interface WorktreeStatus {
  path: string;
  branch: string | null; // null = detached
  head: string | null; // null = unborn
  clean: boolean;
  staged: string[];
  unstaged: string[];
  untracked: string[];
  /** commits ahead/behind the upstream, if any */
  ahead: number;
  behind: number;
  upstream: string | null;
  rebase_in_progress: boolean;
}

export interface WorktreeInfo {
  path: string;
  branch: string | null;
  head: string | null;
  locked: boolean;
  prunable: boolean;
}

export interface CommitSpec {
  message: string;
  /** git trailers (S4): Norn-Story, Norn-Slice, Norn-Step, Norn-Tick */
  trailers: Record<string, string>;
  /** paths to stage (relative to cwd); omitted = all changes (`git add -A`) */
  paths?: string[];
  allowEmpty?: boolean;
}

export interface RefUpdate {
  ref: string;
  /** new value; null deletes the ref */
  sha: string | null;
  /** compare-and-swap expectation: sha, or null = ref must not exist; undefined = no check */
  expected?: string | null;
}

export type PushResult =
  | { ok: true }
  | { ok: false; reason: "stale" | "rejected" | "network" | "auth" | "other"; message: string };

export type RebaseResult = { ok: true; head: string } | { ok: false; conflict: true; files: string[] };

/** BS3: a merge commit made, or a conflicting merge aborted with the conflicting paths. */
export type MergeResult = { ok: true; head: string } | { ok: false; conflict: true; files: string[] };

/**
 * H1 (S1, BS5): an operation git is in the middle of in a worktree — a merge (`MERGE_HEAD`), a
 * rebase, a cherry-pick or a revert — and the unmerged paths. `operation: null` and `unmerged: []`
 * = none: a commit there would not conclude anyone's merge.
 */
export interface GitInProgress {
  operation: "merge" | "rebase" | "cherry-pick" | "revert" | null;
  unmerged: string[];
}

/** H1: a line that looks like a conflict marker (`<<<<<<< `, `>>>>>>> `, `||||||| `). */
export interface ConflictMarker {
  path: string;
  line: number;
}

/**
 * BS5.2 (dogfood D5): a file the outgoing commits of a branch changed whose content at the pushed
 * head still holds both an opening (`<<<<<<< `) and a closing (`>>>>>>> `) conflict marker, and the
 * newest outgoing commit that changed it.
 */
export interface OutgoingMarkers {
  path: string;
  commit: string | null;
}

/** PortError codes of `GitPort.commit` (H1): nothing is committed in either case. */
export const GIT_IN_PROGRESS = "git_operation_in_progress";
export const GIT_CONFLICT_MARKERS = "git_conflict_markers";

/** BS1: how two commits relate — `ahead` = commits only in `a`, `behind` = commits only in `b`. */
export interface Divergence {
  merge_base: string | null;
  ahead: number;
  behind: number;
}

/** A commit of `GitPort.firstParentLog`; dates are ISO 8601 as git prints them. */
export interface FirstParentCommit {
  sha: string;
  subject: string;
  author: string;
  authored_at: string;
  committed_at: string;
  /** value of the requested trailer, "" when the commit has none */
  trailer: string;
}

/** Git, run in a given repo or worktree directory (`cwd`). */
export interface GitPort {
  /** Top-level of the repo containing cwd (main checkout, not the worktree). */
  repoRoot(cwd: string): Promise<string>;
  /** Absolute path of the git directory shared by every worktree of the repo (`git rev-parse --git-common-dir`). */
  commonDir(cwd: string): Promise<string>;
  /** Names of the repo's remotes (`git remote`). */
  remotes(cwd: string): Promise<string[]>;
  /** The `git --version` line (`git version 2.50.1`); null when git cannot be run. */
  version(cwd: string): Promise<string | null>;
  status(cwd: string): Promise<WorktreeStatus>;
  revParse(cwd: string, rev: string): Promise<string | null>;
  defaultBranch(cwd: string, remote: string): Promise<string>;
  /** Most recent commit time (ms) on HEAD of cwd, null if none. */
  lastCommitTime(cwd: string): Promise<number | null>;
  /** `git diff --stat <range>` text */
  diffStat(cwd: string, range: string): Promise<string>;
  /** commits in range, newest first */
  log(cwd: string, range: string, limit?: number): Promise<Array<{ sha: string; subject: string; at: number; trailers: Record<string, string> }>>;
  /**
   * Q6/C4: the first-parent line of `rev` (not reachable from `exclude`), newest first, at most
   * `limit` commits, each with its author, ISO author and committer dates and the value of the
   * `trailer` trailer ("" when absent).
   */
  firstParentLog(cwd: string, rev: string, opts: { exclude?: string; limit: number; trailer: string }): Promise<FirstParentCommit[]>;
  /** `git rev-list` of `range`: shas, newest first unless `reverse`. */
  revList(cwd: string, range: string, opts?: { ancestryPath?: boolean; firstParent?: boolean; limit?: number; reverse?: boolean }): Promise<string[]>;
  /** The file at `path` in `rev` (`git show <rev>:<path>`); null when there is none. */
  show(cwd: string, rev: string, path: string): Promise<string | null>;
  /** Does `rev` hold `path` (`git cat-file -e <rev>:<path>`)? */
  hasPath(cwd: string, rev: string, path: string): Promise<boolean>;
  /** Entry names of the directory `path` in `rev` (`git ls-tree --name-only`); null when it is not a directory there. */
  lsTree(cwd: string, rev: string, path: string): Promise<string[] | null>;
  /** Paths that differ between `from` and `to` (`git diff --name-only -z <from> <to> --`). */
  changedPaths(cwd: string, from: string, to: string): Promise<string[]>;
  /** Put `paths` in the work tree and index back to their version in `rev` (`git checkout <rev> -- <paths>`). */
  checkoutPaths(cwd: string, rev: string, paths: string[]): Promise<void>;
  /** Stop tracking `paths`, leaving the files (`git rm -q --cached --ignore-unmatch -- <paths>`). */
  untrack(cwd: string, paths: string[]): Promise<void>;
  /**
   * `git mv -- <from> <to>` when `from` is in the index: the rename is staged (true). An untracked
   * `from` is left where it is (false), for the caller to move plainly. The folder of `to` must exist.
   */
  move(cwd: string, from: string, to: string): Promise<boolean>;
  /** Stage `paths` (`git add -- <paths>`). */
  stage(cwd: string, paths: string[]): Promise<void>;

  branchExists(cwd: string, branch: string, where?: "local" | "remote", remote?: string): Promise<boolean>;
  createBranch(cwd: string, branch: string, from: string): Promise<void>;
  deleteBranch(cwd: string, branch: string, opts?: { force?: boolean }): Promise<void>;
  deleteRemoteBranch(cwd: string, remote: string, branch: string): Promise<PushResult>;

  worktreeList(cwd: string): Promise<WorktreeInfo[]>;
  /** Add a worktree at path on branch; create the branch from `from` if given. */
  worktreeAdd(cwd: string, path: string, branch: string, opts?: { from?: string }): Promise<void>;
  worktreeRemove(cwd: string, path: string, opts?: { force?: boolean }): Promise<void>;
  /** Add a worktree at path with a detached HEAD at `rev` (GR6: the throwaway record worktree). */
  worktreeAddDetached(cwd: string, path: string, rev: string): Promise<void>;
  /** Forget worktrees whose directory is gone (`git worktree prune`). */
  worktreePrune(cwd: string): Promise<void>;

  /**
   * Commit; returns the new sha, or null when nothing to commit. H1: never concludes an operation in
   * progress — throws PortError `git_operation_in_progress` (nothing staged) while `inProgress` reports
   * one, since git cannot commit some paths without concluding a merge; throws `git_conflict_markers`
   * (nothing committed) when a staged file gains both `<<<<<<< ` and `>>>>>>> ` lines.
   */
  commit(cwd: string, spec: CommitSpec): Promise<string | null>;
  /** H1: the operation git is in the middle of in cwd's worktree, and its unmerged paths. */
  inProgress(cwd: string): Promise<GitInProgress>;
  /**
   * H1/BS5: conflict-marker lines in tracked files — of the work tree, or of `rev` — limited to
   * `paths` when given ([] = none checked).
   */
  conflictMarkers(cwd: string, opts?: { paths?: string[]; rev?: string }): Promise<ConflictMarker[]>;
  /**
   * BS5.2: files changed by the commits of `rev` that are on no `remote` ref yet (merge commits
   * against their first parent) which still hold conflict markers at `rev`; [] = safe to push.
   */
  outgoingConflictMarkers(cwd: string, remote: string, rev: string): Promise<OutgoingMarkers[]>;
  /**
   * BS5: the merge commit that brought `base` into `head` — the oldest merge on the ancestry path
   * `base..head` — or null when there is none (`base` not merged, or reached without a merge).
   */
  baseMergeCommit(cwd: string, base: string, head: string): Promise<string | null>;
  /** Push a branch (`refspec` like `HEAD:refs/heads/x`), optional force-with-lease. */
  push(cwd: string, remote: string, refspec: string, opts?: { forceWithLease?: string; setUpstream?: boolean }): Promise<PushResult>;
  /** Fetch `refspecs` (none: the remote's configured ones), no tags; `quiet` drops progress output. */
  fetch(cwd: string, remote: string, refspecs: string[], opts?: { quiet?: boolean }): Promise<void>;
  /** `git pull --ff-only` equivalent for the current branch. */
  fastForward(cwd: string, onto: string): Promise<{ ok: boolean }>;
  /** Rebase current branch of cwd onto `onto`; aborts and reports files on conflict. */
  rebase(cwd: string, onto: string): Promise<RebaseResult>;
  /** Is `ancestor` an ancestor of `descendant`? */
  isAncestor(cwd: string, ancestor: string, descendant: string): Promise<boolean>;
  /** BS1: merge base of `a` and `b`, and the commits only in each (`rev-list --left-right --count a...b`). */
  divergence(cwd: string, a: string, b: string): Promise<Divergence>;
  /**
   * BS1: paths a merge of `theirs` into `ours` would conflict in, without touching any worktree
   * (`git merge-tree --write-tree --name-only --no-messages`, git ≥ 2.38); [] = a clean merge.
   */
  mergeTree(cwd: string, ours: string, theirs: string): Promise<string[]>;
  /**
   * BS3: `git merge --no-ff <rev>` in cwd, committed with `spec.message` and its trailers (S4). On a
   * conflict the merge is aborted (`git merge --abort`) and the conflicting paths are reported.
   */
  merge(cwd: string, rev: string, spec: Pick<CommitSpec, "message" | "trailers">): Promise<MergeResult>;

  // --- refs and blobs (claims T2, mailbox T9)
  readRef(cwd: string, ref: string): Promise<string | null>;
  /** Does `ref` (or any revision) resolve here (`git rev-parse --verify --quiet`)? */
  hasRef(cwd: string, ref: string): Promise<boolean>;
  /** Refs under any of the prefixes (one `git for-each-ref`). */
  listRefs(cwd: string, prefix: string | readonly string[]): Promise<Array<{ ref: string; sha: string }>>;
  /** Names of the branches on `remote` whose ref matches `pattern` (`git ls-remote --heads <remote> <pattern>`, e.g. `refs/heads/gh-7-*`). */
  remoteBranches(cwd: string, remote: string, pattern: string): Promise<string[]>;
  updateRef(cwd: string, update: RefUpdate): Promise<boolean>;
  /** Push one ref with CAS (`--force-with-lease=<ref>:<expected>`, T3); sha null deletes. */
  pushRef(cwd: string, remote: string, update: RefUpdate): Promise<PushResult>;
}

// ============================================================= Remote (issue provider)

export interface RemoteIssue {
  provider: RemoteProvider;
  number: number;
  url: string;
  title: string;
  body: string;
  state: "open" | "closed";
  assignees: string[];
  labels: string[];
  updated_at: string;
}

/**
 * The story PR/MR as the remote reports it (GR6). `is_draft`/`head_sha`/merge fields are the
 * StoryFacts.pr contract. `merged_at` is null/absent until merged.
 */
export interface RemotePullRequest {
  number: number;
  url: string;
  state: "open" | "closed" | "merged";
  is_draft: boolean;
  /** commit the PR head points at ("" when the remote did not say) */
  head_sha: string;
  /** commit the merge produced on the base (merge, squash or rebase head) */
  merge_commit_sha?: string;
  /** login of whoever merged it */
  merged_by?: string;
  merged_at?: string | null;
  /** head branch name */
  head?: string;
  /**
   * @deprecated older name of `base_branch`; no adapter writes it any more, but a PR cached
   * (`pr.json`) by an older norn may carry only this. Read through `prBaseBranch`; dropped in 0.11.0.
   */
  base?: string;
  /** BS11: the branch the PR targets (merges into); GR6 cleanup only when it is the story's base branch */
  base_branch?: string;
}

/** `gh` / `glab` for one repository. */
export interface RemotePort {
  readonly provider: RemoteProvider;
  /** login of the authenticated user */
  whoami(): Promise<string>;
  /** open issues assigned to the user carrying `label` (GR1) */
  listAssignedIssues(opts: { label: string }): Promise<RemoteIssue[]>;
  /** CP2: open issues carrying `label`, whoever they are assigned to (none, the user, others) — the backlog */
  listLabelledIssues(opts: { label: string }): Promise<RemoteIssue[]>;
  /** GR1: add `assignee` (a login) to issue `number`'s assignees; the next intake lists it */
  assignIssue(number: number, assignee: string): Promise<void>;
  /** null if not found */
  getIssue(number: number): Promise<RemoteIssue | null>;
  /** latest PR/MR whose head is `branch`, any state; null if none */
  findPullRequest(branch: string): Promise<RemotePullRequest | null>;
  openDraftPullRequest(opts: { head: string; base: string; title: string; body: string }): Promise<RemotePullRequest>;
  /** GR9: replace the body of an open PR/MR */
  editPullRequestBody(number: number, body: string): Promise<void>;
  /** B18 (D3): open an issue with these labels, assigned to `assignee` (a login) */
  createIssue(opts: { title: string; body: string; labels: string[]; assignee: string }): Promise<RemoteIssue>;
  /** B23 (D3): the remote's new-issue page in the browser with `labels` filled in; creates nothing */
  newIssueUrl(opts: { labels: string[] }): Promise<string>;
  /**
   * B19: replace label `remove` on issue `number` with `add`; when `remove` is not on the issue,
   * `add` is still added. Throws PortError when the provider fails (B20: the caller warns).
   */
  replaceIssueLabel(number: number, labels: { remove: string; add: string }): Promise<void>;
}

// ============================================================= Runner

/** Where a run's agent lives (pane, headless process). Stored in state.json as SessionInfo. */
export interface SessionRef {
  runner: string;
  session_id: string;
  pane_id?: string;
  process?: ProcessIdentity;
}

export interface LaunchSpec {
  cwd: string;
  /** argv from AgentAdapter.launchCommand */
  argv: string[];
  env: Record<string, string>;
  /** pane/tab title, e.g. `gh-123/03 implement` */
  title: string;
  run_id: string;
}

/**
 * Pane state as the runner sees it. One fact among several (P4, C2):
 * `idle`/`done` never completes a step by itself.
 */
export interface PaneState {
  alive: boolean;
  state: "working" | "idle" | "waiting_input" | "done" | "unknown";
  /** ms epoch of the last state change, if known */
  since: number | null;
  /** e.g. visible permission prompt text (the full screen) */
  detail?: string;
  /** R6.2 / L1: the prompt the agent waits on, as the runner parsed it from `detail`; absent = not recognized */
  prompt?: PanePrompt;
}

/**
 * R6.2, L1 (A4, A7): a prompt read off the pane — a permission or trust dialog. `question` is the
 * question block alone (no code, no footer); `command` the first line of the pending command, if
 * shown; `options` the choices in display order; `choice` how one is picked (number or arrows).
 */
export interface PanePrompt {
  question: string;
  command?: string;
  options: string[];
  choice: PromptChoice | null;
}

/** R6.2: keystrokes for a prompt: literal text, or a named key (`enter`, `down`, `up`, `esc`). */
export type PromptKey = { text: string } | { key: "enter" | "down" | "up" | "esc" };

/**
 * R4.1: what a runner can do with a session besides launching it. `send`: type into a live session
 * (pane runners). `resume`: continue a finished agent session by its id (`--resume`, B2) — a new
 * launch through this runner. Decide picks the nudge/answer delivery from these (R4.2).
 */
export interface RunnerCapabilities {
  send: boolean;
  resume: boolean;
  /** MO5: `openForPerson` opens a terminal a person works in; absent = false */
  open?: boolean;
}

/** MO5: a terminal for a person in `cwd`, running `command` (the start command a person would type). */
export interface PersonOpenSpec {
  cwd: string;
  /** tab or window label */
  title: string;
  command: string;
  /** the caller's environment (e.g. `HERDR_WORKSPACE_ID`: open next to the caller) */
  env: Record<string, string | undefined>;
}

/** R5.1: a session the runner sees in a unit worktree (a candidate for an unrecorded run). */
export interface RunnerSessionInfo {
  session: SessionRef;
  /** agent-tool session id the runner reports for it (herdr `agent_session`), if any */
  agent_session_id?: string;
}

export interface RunnerPort {
  readonly name: string;
  readonly capabilities: RunnerCapabilities;
  /** Usable on this machine now (binary present, server reachable). */
  available(): Promise<boolean>;
  launch(spec: LaunchSpec): Promise<SessionRef>;
  /** Type text into the session; `submit` presses enter. */
  send(session: SessionRef, text: string, opts?: { submit?: boolean }): Promise<void>;
  /**
   * R6.2: press keys in the session as they are — for a prompt the agent is blocked on (a choice
   * menu takes no pasted prompt). Optional: runners without it cannot answer pane prompts.
   */
  sendKeys?(session: SessionRef, keys: PromptKey[]): Promise<void>;
  /** R6.3, R9.1: the command a person runs to reach the session (e.g. attach to the pane); absent = none */
  reach?(session: SessionRef): string;
  paneState(session: SessionRef): Promise<PaneState>;
  isAlive(session: SessionRef): Promise<boolean>;
  kill(session: SessionRef): Promise<void>;
  /**
   * R5.1: live agent sessions that could belong to run `run_id` working in `cwd` — panes whose
   * checkout path is `cwd`, processes carrying `NORN_RUN=<run_id>`. Reports candidates only; the
   * caller decides which one (if any) is the run. Optional: runners without it find nothing.
   */
  findSessions?(q: { run_id: string; cwd: string }): Promise<RunnerSessionInfo[]>;
  /**
   * B3: the first lines the session printed (headless: its run log), for a run that died before it
   * got going — the reason (bad args, a missing prompt) is usually there. Optional; null = nothing.
   */
  output?(session: SessionRef): Promise<string | null>;
  /**
   * MO5 (`norn story start`): open a focused terminal a person works in, running `spec.command`. Records
   * no session: the agent's `norn brief` starts the run (MO3). Present iff `capabilities.open`.
   */
  openForPerson?(spec: PersonOpenSpec): Promise<{ pane_id: string | null }>;
}

// ============================================================= Agent adapter

export type HookTier = "blocking" | "hooks" | "none";

export interface HookInstallResult {
  /** files created or modified, absolute */
  changed: string[];
}

export interface AgentLaunchRequest {
  cwd: string;
  /** first prompt (B5): "Use the norn skill, then run `norn brief`." */
  prompt: string;
  model?: string;
  /** agent-tool session id to resume in the same session (B2) */
  resume?: string;
  /** true = non-interactive one-shot run (headless runner, e.g. `claude -p`); default interactive pane */
  headless?: boolean;
  /** NORN_HOME, NORN_STORY, NORN_SLICE, NORN_RUN (A6) */
  env: Record<string, string>;
  config: { command?: string; args?: string[]; env?: Record<string, string> };
}

/** What `norn hook` should answer to the agent tool. */
export interface HookDecision {
  /** refuse turn end (A4); only honoured by `blocking` tier adapters */
  block: boolean;
  /** instruction shown to the agent when blocked */
  reason?: string;
}

export interface HookResponse {
  stdout: string;
  exit_code: number;
}

export interface AgentAdapter {
  /** adapter id, e.g. `claude` */
  readonly name: string;
  readonly tier: HookTier;
  /**
   * A1: add/update norn-owned hooks in the repo's agent config; each runs
   * `<hookCommand> <event> --agent <agent>` so `norn hook` never has to guess the agent (A2).
   * `agent` is the configured agent name (default: the adapter's `name`). Idempotent.
   */
  installHooks(repoRoot: string, hookCommand: string, agent?: string): Promise<HookInstallResult>;
  /** Remove only norn-owned hooks. */
  uninstallHooks(repoRoot: string): Promise<HookInstallResult>;
  hooksInstalled(repoRoot: string): Promise<boolean>;
  /**
   * Normalize one native hook invocation. `event` is the argument `norn hook <event>` received;
   * `payload` is parsed stdin JSON (or null); `env` is the hook process env. Null = ignore.
   */
  parseHookEvent(event: string, payload: unknown, env: Record<string, string | undefined>, at: string): HookFact | null;
  /**
   * Optional pure pass over one run's hook facts (trace order) that fills in what a single hook
   * payload cannot carry: Claude's permission prompt takes its pending command from the preceding
   * PreToolUse (A2, §10). Returns the same facts in the same order; only facts whose `agent` is
   * this adapter's `name` may change.
   */
  refineHooks?(hooks: readonly HookFact[]): HookFact[];
  /** Encode a decision in the agent tool's hook protocol. */
  hookResponse(fact: HookFact, decision: HookDecision): HookResponse;
  /** Native hook event names → normalized kinds this adapter emits. */
  readonly hookEvents: Readonly<Record<string, HookEventKind>>;
  /** SK1: the repo folder this agent reads skills from; `norn init` links the bundled skills there. */
  skillDir(repoRoot: string): string;
  /** argv + extra env to start (or resume) an agent session. */
  launchCommand(req: AgentLaunchRequest): { argv: string[]; env: Record<string, string> };
  /** C4: last assistant message from a transcript file; null if unreadable/none. */
  lastAssistantMessage(transcriptPath: string): Promise<string | null>;
}

// ============================================================= Notifier

export type InboxGroup = "your_turn" | "answer" | "approve" | "unblock" | "check" | "unclaimed" | "running" | "notes" | "recently_done";

export interface InboxItem {
  /** stable id: one notification per id ever (O3) — receipt_id or a derived key */
  id: string;
  group: InboxGroup;
  story: string;
  slice: string | null;
  step: string | null;
  /** gh-71 B28: the story's round and its workflow, next to the step; absent = the story has not started (or no story) */
  round?: { n: number; workflow: string };
  /** question, reason or gate prompt */
  title: string;
  detail?: string;
  /** exact command that resolves it, e.g. `norn story answer gh-123/03 "..."` */
  command: string;
  /** L1: long text behind the item (an implicit ask's full pane screen) — shown only on request (`inbox --details`) */
  full?: string;
  since: string;
  url?: string;
  /** HC3: where the unit's current run lives (nulls = unknown), for front ends that find its pane (HC6) */
  reach?: { worktree: string | null; agent_session_id: string | null; pane_id: string | null };
  /** NT5: a Notes item's clearing hint, e.g. `cleared by gh-1 human-qa approval` */
  cleared_by?: string;
}

export interface NotifierPort {
  readonly name: string;
  notify(item: InboxItem): Promise<void>;
}

// ============================================================= Factories (wiring, X2)

export interface AdapterContext {
  repoRoot: string;
  home: string;
  config: ResolvedConfig;
  clock: Clock;
  env: Record<string, string | undefined>;
}

export type GitFactory = (ctx: AdapterContext) => GitPort;
export type RemoteFactory = (ctx: AdapterContext) => RemotePort;
export type RunnerFactory = (ctx: AdapterContext, config: RunnerConfig) => RunnerPort;
export type AgentFactory = (ctx: AdapterContext) => AgentAdapter;
export type NotifierFactory = (ctx: AdapterContext, config: NotifierConfig) => NotifierPort;

/** What `@norn/adapters` exposes to the CLI, keyed by adapter id. */
export interface AdapterRegistry {
  git: GitFactory;
  process: (ctx: AdapterContext) => ProcessPort;
  remotes: Partial<Record<RemoteProvider, RemoteFactory>>;
  runners: Record<string, RunnerFactory>;
  agents: Record<string, AgentFactory>;
  notifiers: Record<string, NotifierFactory>;
}

/** Bundle the CLI hands to observe/act. */
export interface Ports {
  clock: Clock;
  process: ProcessPort;
  git: GitPort;
  remote: RemotePort | null;
  runner: RunnerPort | null;
  agents: Record<string, AgentAdapter>;
  notifiers: NotifierPort[];
}
