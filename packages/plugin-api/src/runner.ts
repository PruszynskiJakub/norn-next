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
  /** end the process; stopping one already gone is not an error */
  stop(handle: string): Promise<PluginResult<void>>;
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
