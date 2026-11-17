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
}

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
  /** the command the agent's hooks run, as the caller gives it; a harness appends its own arguments */
  hookCommand: string;
}

export interface UninstallTarget {
  worktree: string;
}

export interface LaunchRequest {
  cwd: string;
  prompt: string;
  run_id: string;
  model?: string;
  /** the harness session to resume */
  resume?: string;
  env: Record<string, string>;
  args?: string[];
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
