/**
 * The runner slot (plugin API 1.5): where an agent's process lives — a herdr pane a person can
 * watch, or a detached process nobody sees. A runner starts the argv a harness built and keeps it
 * reachable by an opaque handle; it never reads what the agent does, which comes through hooks.
 */
import type { Static, TSchema } from "@sinclair/typebox";
import type { HostContext } from "./host.ts";
import type { PluginResult } from "./result.ts";

export interface RunnerCapabilities {
  /** a person can watch the agent and type into it */
  attended: boolean;
  /** the agent can run with nobody watching (auto mode needs it) */
  headless: boolean;
  /** `send` types into the agent's pane; without it an answer or nudge goes through a hook instead */
  paneInput: boolean;
  /** the agent's process runs inside an OS sandbox (plugin API 1.26), as `HarnessCapabilities.sandbox` says it */
  sandbox?: boolean;
}

export interface RunnerStartRequest {
  /**
   * The idempotency key, the run id: a start replayed with the same key finds the process the
   * first one started instead of starting a second, since the act protocol may replay a start
   * after a crash between the effect and its receipt.
   */
  key: string;
  argv: string[];
  /** added to the host's environment */
  env: Record<string, string>;
  cwd: string;
  /** what a person sees the pane or process as */
  title: string;
  /** what runs are grouped under, such as the story key: one herdr workspace per story */
  workspace?: string;
  /** where output goes when nothing shows it, and what a runner with a pane may ignore */
  logPath: string;
}

/**
 * A key a person would press in a pane: text typed as it is, or a named key. A dialog the agent shows
 * (a permission or trust prompt) takes keys, never a submitted prompt.
 */
export type RunnerKey = { text: string } | { key: "enter" | "up" | "down" | "esc" };

/** A pane opened beside the one a person works in, for something a person keeps in view (norn's cockpit). */
export interface RunnerSplitRequest {
  argv: string[];
  cwd: string;
  /** what a person sees the pane as */
  title: string;
  /** added to the pane's environment, such as the norn home the asking command ran with */
  env?: Record<string, string>;
  /**
   * The runner's own id of the pane the asking command runs in, when its environment names one; the
   * new pane opens beside it, else beside the pane the person has in front.
   */
  beside?: string;
}

export interface Runner {
  readonly name: string;
  readonly capabilities: RunnerCapabilities;
  start(req: RunnerStartRequest): Promise<PluginResult<{ handle: string }>>;
  /** whether the handle's process still runs; a probe that cannot answer is a failure, never false */
  alive(handle: string): Promise<PluginResult<boolean>>;
  /** type `text` and submit it; refused (`invalid`) when the runner has no pane input */
  send(handle: string, text: string): Promise<PluginResult<void>>;
  /**
   * Press `keys` in the handle's pane, in order (plugin API 1.12). Absent on a runner with no pane:
   * a dialog in a process nobody sees cannot be answered from outside it.
   */
  keys?(handle: string, keys: readonly RunnerKey[]): Promise<PluginResult<void>>;
  /**
   * The dialog the handle's pane shows while the agent waits on it (a trust or permission prompt), as
   * the lines a person reads there, a blank line between its blocks; null when none shows or the pane
   * is gone (plugin API 1.15). A runner that reads the pane only while it sees the agent held by a
   * dialog reads it whatever it sees with `anyStatus`: keys chosen for an answer must follow what
   * the pane shows, even when the runner's own reading of the agent missed the dialog. Absent
   * on a runner with no pane: nobody could read or answer a dialog in a process nobody sees.
   */
  dialog?(handle: string, opts?: { anyStatus?: boolean }): Promise<PluginResult<string | null>>;
  /** end the process; stopping one already gone is not an error */
  stop(handle: string): Promise<PluginResult<void>>;
  /**
   * Close what the start under `key` opened for a run that has ended: its pane, and with it a tab or
   * group left empty (plugin API 1.17). True when something closed. Never closes what that start did
   * not open (a pane id reused, a person's own pane); one already gone closes nothing. Absent on a
   * runner that leaves nothing open once its process ends.
   */
  close?(handle: string, key: string): Promise<PluginResult<boolean>>;
  /**
   * Bring the handle's pane in front of a person, with the tab and workspace it sits in (plugin API
   * 1.18). False when the pane is gone. Absent on a runner with no pane.
   */
  focus?(handle: string): Promise<PluginResult<boolean>>;
  /**
   * Open a pane below the one a person works in and run `argv` there, leaving the person's focus where
   * it was (plugin API 1.18). Absent on a runner with no pane a person sees.
   */
  split?(req: RunnerSplitRequest): Promise<PluginResult<{ handle: string }>>;
  /**
   * Show `text` beside the group of runs started under `workspace`, where a person looks for them, until
   * `ttlMs` passes unless shown again (plugin API 1.18). False when no such group is open. Presentation
   * only: nothing reads it back.
   */
  label?(workspace: string, text: string, ttlMs: number): Promise<PluginResult<boolean>>;
}

export interface RunnerFactory<S extends TSchema = TSchema> {
  configSchema: S;
  /**
   * The runner starts processes through the host's `spawn`, `alive` and `kill`; `createRunner`
   * refuses it on a host that lacks them, before anything is started.
   */
  needsProcesses?: boolean;
  create(ctx: HostContext, config: Static<S>): Runner;
}
