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

/** Git, run in a given repo or worktree directory (`cwd`). */
export interface GitPort {
  /** Top-level of the repo containing cwd (main checkout, not the worktree). */
  repoRoot(cwd: string): Promise<string>;
  /** Top-level of the worktree containing cwd. */
  worktreeRoot(cwd: string): Promise<string>;
  status(cwd: string): Promise<WorktreeStatus>;
  revParse(cwd: string, rev: string): Promise<string | null>;
  defaultBranch(cwd: string, remote: string): Promise<string>;
  /** Most recent commit time (ms) on HEAD of cwd, null if none. */
  lastCommitTime(cwd: string): Promise<number | null>;
  /** `git diff --stat <range>` text */
  diffStat(cwd: string, range: string): Promise<string>;
  /** commits in range, newest first */
  log(cwd: string, range: string, limit?: number): Promise<Array<{ sha: string; subject: string; at: number; trailers: Record<string, string> }>>;

  branchExists(cwd: string, branch: string, where?: "local" | "remote", remote?: string): Promise<boolean>;
  createBranch(cwd: string, branch: string, from: string): Promise<void>;
  deleteBranch(cwd: string, branch: string, opts?: { force?: boolean }): Promise<void>;
  deleteRemoteBranch(cwd: string, remote: string, branch: string): Promise<PushResult>;

  worktreeList(cwd: string): Promise<WorktreeInfo[]>;
  /** Add a worktree at path on branch; create the branch from `from` if given. */
  worktreeAdd(cwd: string, path: string, branch: string, opts?: { from?: string }): Promise<void>;
  worktreeRemove(cwd: string, path: string, opts?: { force?: boolean }): Promise<void>;

  /** Commit; returns the new sha, or null when nothing to commit. */
  commit(cwd: string, spec: CommitSpec): Promise<string | null>;
  /** Push a branch (`refspec` like `HEAD:refs/heads/x`), optional force-with-lease. */
  push(cwd: string, remote: string, refspec: string, opts?: { forceWithLease?: string; setUpstream?: boolean }): Promise<PushResult>;
  fetch(cwd: string, remote: string, refspecs: string[]): Promise<void>;
  /** `git pull --ff-only` equivalent for the current branch. */
  fastForward(cwd: string, onto: string): Promise<{ ok: boolean }>;
  /** Rebase current branch of cwd onto `onto`; aborts and reports files on conflict. */
  rebase(cwd: string, onto: string): Promise<RebaseResult>;
  /** Is `ancestor` an ancestor of `descendant`? */
  isAncestor(cwd: string, ancestor: string, descendant: string): Promise<boolean>;

  // --- refs and blobs (claims T2, mailbox T9)
  readRef(cwd: string, ref: string): Promise<string | null>;
  listRefs(cwd: string, prefix: string): Promise<Array<{ ref: string; sha: string }>>;
  /** Remote refs under prefix (`git ls-remote`). */
  listRemoteRefs(cwd: string, remote: string, prefix: string): Promise<Array<{ ref: string; sha: string }>>;
  readBlob(cwd: string, sha: string): Promise<string>;
  writeBlob(cwd: string, content: string): Promise<string>;
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
 * StoryFacts.pr contract; `draft`, `head` (branch name), `base` are the older names, still filled
 * by the adapters. `merged_at` is null/absent until merged.
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
  /** @deprecated alias of is_draft */
  draft?: boolean;
  /** head branch name */
  head?: string;
  /** base branch name */
  base?: string;
}

/** `gh` / `glab` for one repository. */
export interface RemotePort {
  readonly provider: RemoteProvider;
  /** login of the authenticated user */
  whoami(): Promise<string>;
  /** open issues assigned to the user carrying `label` (GR1) */
  listAssignedIssues(opts: { label: string }): Promise<RemoteIssue[]>;
  /** null if not found */
  getIssue(number: number): Promise<RemoteIssue | null>;
  /** latest PR/MR whose head is `branch`, any state; null if none */
  findPullRequest(branch: string): Promise<RemotePullRequest | null>;
  openDraftPullRequest(opts: { head: string; base: string; title: string; body: string }): Promise<RemotePullRequest>;
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
  /** e.g. visible permission prompt text */
  detail?: string;
}

export interface RunnerPort {
  readonly name: string;
  /** Usable on this machine now (binary present, server reachable). */
  available(): Promise<boolean>;
  launch(spec: LaunchSpec): Promise<SessionRef>;
  /** Type text into the session; `submit` presses enter. */
  send(session: SessionRef, text: string, opts?: { submit?: boolean }): Promise<void>;
  paneState(session: SessionRef): Promise<PaneState>;
  isAlive(session: SessionRef): Promise<boolean>;
  kill(session: SessionRef): Promise<void>;
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
  /** Encode a decision in the agent tool's hook protocol. */
  hookResponse(fact: HookFact, decision: HookDecision): HookResponse;
  /** Native hook event names → normalized kinds this adapter emits. */
  readonly hookEvents: Readonly<Record<string, HookEventKind>>;
  /** SK1: where skills go; `repo` for repo-local install, `user` for global. */
  skillDir(scope: "repo" | "user", repoRoot: string, home: string): string;
  /** argv + extra env to start (or resume) an agent session. */
  launchCommand(req: AgentLaunchRequest): { argv: string[]; env: Record<string, string> };
  /** C4: last assistant message from a transcript file; null if unreadable/none. */
  lastAssistantMessage(transcriptPath: string): Promise<string | null>;
}

// ============================================================= Notifier

export type InboxGroup = "your_turn" | "answer" | "approve" | "unblock" | "check" | "unclaimed" | "running" | "recently_done";

export interface InboxItem {
  /** stable id: one notification per id ever (O3) — receipt_id or a derived key */
  id: string;
  group: InboxGroup;
  story: string;
  slice: string | null;
  step: string | null;
  /** question, reason or gate prompt */
  title: string;
  detail?: string;
  /** exact command that resolves it, e.g. `norn answer gh-123/03 "..."` */
  command: string;
  since: string;
  url?: string;
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
