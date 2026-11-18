/**
 * The harness slot: what a plugin wrapping one coding agent (Claude Code, Codex, ...) must provide.
 * A harness translates and renders; it never classifies a session or decides an answer, so every
 * harness gets the same classification from the kernel.
 */
import type { HarnessEvent } from "./events.ts";

/** What the agent's native hooks let norn do; the kernel never asks a harness for what it lacks. */
export interface HarnessCapabilities {
  /** a hook can keep the agent from ending its turn */
  blockStop: boolean;
  /** a hook can refuse a tool call before it runs */
  denyTool: boolean;
  /** a hook can add text to the agent's context */
  injectContext: boolean;
  /** the agent reports subagents starting and finishing */
  subagents: boolean;
  /** the agent reports usage or rate limits */
  limits: boolean;
  /** a person can type into the agent's pane, so answers may arrive there */
  paneInput: boolean;
  /**
   * `normalize` reads the prompt mark (see prompt-mark.ts) of a submitted prompt, so norn's prompts
   * are told from a person's per prompt (plugin API 1.5). Without it every prompt is read by the
   * harness's older rule, and a host treats pane prompts as unattributed.
   */
  promptMarks?: boolean;
  /**
   * `launch` honours `resume`: the agent continues that harness session with its history (plugin API
   * 1.5). A host resumes a headless session that ended to hand it an answer or a nudge; without it
   * such a delivery is refused rather than given to an agent that never saw the question.
   */
  resume?: boolean;
}

/**
 * Set by the host on every launch, so the hook command files each event under its unit and run
 * without asking anything (plugin API 1.5). A harness passes the launch env through untouched.
 */
export const RUN_ENV = Object.freeze({ unit: "NORN_UNIT", run: "NORN_RUN_ID" } as const);

/** The kernel's ruling on a tool call about to run. */
export type GuardAnswer = { kind: "allow" } | { kind: "deny"; reason: string };
/** The kernel's ruling on the agent ending its turn. */
export type StopAnswer = { kind: "block"; reason: string } | { kind: "allow" };
/** Text the kernel adds to the agent's context. */
export type ContextAnswer = { kind: "context"; text: string };
export type HarnessAnswer = GuardAnswer | StopAnswer | ContextAnswer;

/** What a hook process prints and exits with, in the agent's own protocol. */
export interface NativeReply {
  stdout: string;
  exit_code: number;
}

export interface InstallTarget {
  worktree: string;
  /**
   * the command the agent's hooks run, the harness's name already on it (`norn hook claude`); a
   * harness appends only the hook's own name, as a second copy of its name is an argument too many
   */
  hookCommand: string;
}

export interface UninstallTarget {
  worktree: string;
}

export interface LaunchRequest {
  cwd: string;
  /** the first prompt, already marked by the host (see prompt-mark.ts); a harness passes it on whole */
  prompt: string;
  run_id: string;
  model?: string;
  /** the harness session to resume */
  resume?: string;
  env: Record<string, string>;
  args?: string[];
  /**
   * No terminal will show the agent (a headless runner): launch its non-interactive mode, such as
   * `claude -p` (plugin API 1.5). Absent or false: the agent gets a pane.
   */
  headless?: boolean;
}

/** The process to start; the caller spawns it, so a harness stays free of IO here. */
export interface LaunchSpec {
  argv: string[];
  env: Record<string, string>;
}

export interface NormalizeInput {
  /** the native hook name, as the agent sends it */
  hook: string;
  payload: unknown;
  env: Record<string, string | undefined>;
  at: string;
  run_id: string;
  /** the seq of the first event returned; the rest follow as seq+1, seq+2, ... */
  seq: number;
}

export interface RespondInput {
  hook: string;
  answer: HarnessAnswer;
}

export interface Harness {
  readonly name: string;
  readonly capabilities: HarnessCapabilities;
  /**
   * The folder, relative to a worktree, the agent loads project skills from (`.claude/skills`), each
   * skill a folder holding a `SKILL.md` (plugin API 1.7). A host writes the pack's skills there before
   * a launch, so the skills a brief names are the agent's to use; without it the agent has none.
   */
  readonly skillsDir?: string;
  /**
   * The files, relative to a worktree, that install writes for that one checkout and that are never
   * committed (`.claude/settings.local.json`), plugin API 1.10. A host never reads them as work left
   * uncommitted, even where the repo's own `.gitignore` keeps the harness from ignoring them.
   */
  readonly localFiles?: readonly string[];
  /**
   * Wire the agent's hooks in one worktree; idempotent, returns the files it changed. Every write is
   * atomic (temp file, fsync, rename): a torn config file would leave the agent with no hooks.
   */
  install(target: InstallTarget): Promise<{ changed: string[] }>;
  /** Remove only what install added; returns the files it changed. */
  uninstall(target: UninstallTarget): Promise<{ changed: string[] }>;
  launch(req: LaunchRequest): LaunchSpec;
  /**
   * Pure. A malformed payload or an unknown hook yields one `hook.error` event, never a throw: a
   * throwing hook would leave the agent with no answer, which some agents read as allow.
   */
  normalize(input: NormalizeInput): HarnessEvent[];
  /** Pure: render the kernel's answer in the agent's protocol. */
  respond(input: RespondInput): NativeReply;
}
