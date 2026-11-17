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

export interface RuntimeConfig {
  tracker: SlotChoice;
  forge: SlotChoice;
  store: SlotChoice;
  vcs: SlotChoice;
  /** executors (harnesses an agent step runs on) by the name a step's `by:` selects */
  executors: Record<string, SlotChoice>;
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

/**
 * Starts and steers agent runs. Every call is idempotent by the run id (or input id) it names,
 * because the act protocol may replay a start after a crash between the effect and its receipt, and
 * an answer is delivered before the state that applies it is committed.
 */
export interface AgentLauncher {
  readonly modes: LauncherModes;
  start(run: AgentRunRequest): Promise<PluginResult<{ handle: string }>>;
  nudge(handle: string, text: string): Promise<PluginResult<void>>;
  answer(handle: string, inputId: string, text: string): Promise<PluginResult<void>>;
  stop(handle: string): Promise<PluginResult<void>>;
}

/** Classified sessions, read once per tick; null when the run has no session on record. */
export interface SessionSource {
  facts(unit: string, runId: string): SessionFacts | null;
}

export interface RuntimeDeps {
  ctx: HostContext;
  plugins: readonly NornPlugin[];
  config: RuntimeConfig;
  launcher: AgentLauncher;
  sessions: SessionSource;
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
