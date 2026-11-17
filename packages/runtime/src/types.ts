/**
 * The runtime's contract: the config it is built from, the two ports it drives agents and reads
 * sessions through, and what one tick reports. The ports are interfaces here so the tick host is
 * tested with fakes; the runners and the hook ingestion that fill them live outside this package.
 */
import type { BriefInputs, Decision, KernelConfig, SessionFacts } from "@norn/kernel";
import type { HostContext, IntakeQuery, NornPlugin, PluginResult } from "@norn/plugin-api";

/** One slot as the config selects it: the provider's name and the config its factory validates. */
export interface SlotChoice {
  name: string;
  config?: unknown;
}

/** An executor: the harness its choice names, and the runner its agent runs in (plugin API 1.5). */
export interface ExecutorChoice extends SlotChoice {
  /** absent: the launcher's default runner */
  runner?: SlotChoice;
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
  nudge(handle: string, text: string): Promise<PluginResult<void>>;
  answer(handle: string, inputId: string, text: string): Promise<PluginResult<void>>;
  stop(handle: string): Promise<PluginResult<void>>;
  /** whether the handle's process still runs; null when it cannot tell, which is never read as dead */
  alive?(handle: string): Promise<boolean | null>;
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
  /** mints each tick's id; a test passes a fixed sequence so its traces and ids repeat */
  tickId?: () => string;
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
