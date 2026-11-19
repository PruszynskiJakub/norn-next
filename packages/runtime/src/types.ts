/**
 * The runtime's contract: the config it is built from, the two ports it drives agents and reads
 * sessions through, and what one tick reports. The ports are interfaces here so the tick host is
 * tested with fakes; the runners and the hook ingestion that fill them live outside this package.
 */
import type { BriefInputs, Decision, KernelConfig, SessionFacts } from "@norn/kernel";
import type { HostContext, IntakeQuery, NornPlugin, PluginResult } from "@norn/plugin-api";
import type { RepoWorkflows } from "./repo-workflows.ts";

/** One slot as the config selects it: the provider's name and the config its factory validates. */
export interface SlotChoice {
  name: string;
  config?: unknown;
}

/** An executor: the harness its choice names, and the runner its agent runs in (plugin API 1.5). */
export interface ExecutorChoice extends SlotChoice {
  /** absent: the launcher's default runner */
  runner?: SlotChoice;
  /** the model its agents launch on when the step names none; absent: the harness's default */
  model?: string;
  /** the agent's extra arguments, replacing the harness's defaults whole; absent: the harness's defaults */
  args?: string[];
}

export interface RuntimeConfig {
  tracker: SlotChoice;
  forge: SlotChoice;
  store: SlotChoice;
  vcs: SlotChoice;
  /** executors (harnesses an agent step runs on) by the name a step's `by:` selects */
  executors: Record<string, ExecutorChoice>;
  /** the runner an executor runs in when its choice names none */
  runner?: SlotChoice;
  /** the pack whose workflows the runtime loads */
  pack: string;
  kernel: KernelConfig;
  intake: IntakeQuery;
  /** the branch a story branch is cut from and a merged change lands on */
  base: string;
  /**
   * the ref the base is measured at for `base_stale` and `unpushed`, such as a remote-tracking
   * `origin/main`; absent: `base` itself
   */
  baseRef?: string;
  /** who this machine claims as */
  holder: string;
  /** how long a tick lock may sit before another tick takes it over as left by a crash */
  lockStaleMs?: number;
  /** how old a tick trace may grow before a tick removes it; null keeps every trace; absent: DEFAULT_TRACE_RETAIN_MS */
  traceRetainMs?: number | null;
  /** the commands a check step names as `{checks.<name>}`, over DEFAULT_CHECKS */
  checks?: Record<string, string>;
}

/** What the launcher needs to start one agent run; the brief is the kernel's inputs, rendered by the launcher. */
export interface AgentRunRequest {
  unit: string;
  run_id: string;
  step: string;
  executor: string;
  attended: boolean;
  worktree: string;
  brief: BriefInputs;
  /** the harness session to resume rather than start fresh */
  resume?: string;
}

/** How this launcher can run an agent: with nobody watching (auto mode needs it), or where a person works beside it. */
export interface LauncherModes {
  headless: boolean;
  attended: boolean;
}

/** What one executor can do once its harness runs in its runner: the modes, and whether a pane takes typed input. */
export interface ExecutorModes extends LauncherModes {
  /** the harness reads typed prompts and the runner has a pane to type them into */
  paneInput: boolean;
  /** a dialog in the agent's pane (a permission or trust prompt) can be answered: the harness names its keys and the runner presses them */
  dialogKeys: boolean;
}

export interface AnswerOptions {
  /** the answer chooses an option in a dialog the agent's pane shows, so it goes in as keys */
  dialog?: boolean;
}

/**
 * Starts and steers agent runs. Every call is idempotent by the run id (or input id) it names,
 * because the act protocol may replay a start after a crash between the effect and its receipt, and
 * an answer is delivered before the state that applies it is committed.
 */
export interface AgentLauncher {
  readonly modes: LauncherModes;
  /**
   * The executor's own modes, when they differ by executor (a herdr executor beside a headless one);
   * absent: `modes` for every executor, with the harness's own `paneInput`.
   */
  modesOf?(executor: string): ExecutorModes | null;
  start(run: AgentRunRequest): Promise<PluginResult<{ handle: string }>>;
  /** `promptId` is derived from the nudge's decision, so a replayed nudge is the same prompt and sent once */
  nudge(handle: string, text: string, promptId: string): Promise<PluginResult<void>>;
  answer(handle: string, inputId: string, text: string, opts?: AnswerOptions): Promise<PluginResult<void>>;
  stop(handle: string): Promise<PluginResult<void>>;
  /**
   * Close what the handle's run left open on this machine once it ended (a herdr pane and, with its
   * last one, the story's workspace); true when something closed. A run launched on another machine,
   * or a runner that leaves nothing open, closes nothing.
   */
  close?(handle: string): Promise<PluginResult<boolean>>;
  /** whether the handle's process still runs; null when it cannot tell, which is never read as dead */
  alive?(handle: string): Promise<boolean | null>;
  /** the dialog the handle's pane shows, as its runner reads it; null when none shows or it cannot tell */
  dialog?(handle: string): Promise<string | null>;
  /**
   * Whether the dialog as the handle's pane shows it takes the answer, with the dialog's text and an
   * answer it does take; null when the pane cannot be read here, which leaves the answer for the tick
   * that presses it.
   */
  dialogTakes?(handle: string, answer: string): Promise<{ takes: boolean; dialog: string; instead: string } | null>;
  /**
   * The head of the log the handle's process wrote, where an agent nobody watches leaves why it
   * ended; null when it left none, or the launcher cannot read it.
   */
  output?(handle: string): Promise<string | null>;
}

/**
 * Classified sessions, read once per tick; null when the run has no session on record. `session` is
 * the launcher's handle the run's record holds, for a source that asks the runner whether it lives.
 */
export interface SessionSource {
  facts(unit: string, runId: string, session?: string): SessionFacts | null | Promise<SessionFacts | null>;
}

export interface RuntimeDeps {
  ctx: HostContext;
  plugins: readonly NornPlugin[];
  config: RuntimeConfig;
  /** absent: a HarnessLauncher over the config's executors, each a harness in its runner */
  launcher?: AgentLauncher;
  /** the session source, or how to make it from the launcher (whose handles it asks the runner about) */
  sessions: SessionSource | ((launcher: AgentLauncher) => SessionSource);
  /** the built launcher's hook command prefix; default `["norn", "hook"]` */
  hookCommand?: readonly string[];
  /** the host's PATH, which the built launcher hands its agents with its own `norn` first (agent-bin.ts) */
  hostPath?: string;
  /** env every launched agent gets, and so its hooks: what a call back into this CLI needs to find the same home */
  agentEnv?: Readonly<Record<string, string>>;
  /** mints each tick's id; a test passes a fixed sequence so its traces and ids repeat */
  tickId?: () => string;
  /** the repo's own workflow files, laid over the pack's (repo-workflows.ts); absent: the pack's alone */
  repoWorkflows?: RepoWorkflows;
}

/** How carrying out one decision went. A failure is recorded and the tick goes on with the next unit. */
export type ActionOutcome = { decision: Decision; ok: true; detail?: unknown } | { decision: Decision; ok: false; error: string; retryable: boolean };

export interface TickReport {
  tick_id: string;
  /** set when the tick did nothing: another tick held the lock */
  skipped?: "locked";
  /** what kept facts from being whole (a story left out, a provider that failed) or decide from running */
  problems: string[];
  decisions: Decision[];
  outcomes: ActionOutcome[];
}

export interface Runtime {
  tick(): Promise<TickReport>;
}
