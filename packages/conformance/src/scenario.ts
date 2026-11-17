/**
 * A recorded session as a harness's native hook calls, with the activity a host must read at given
 * instants. The format names no harness, so every harness proves itself against the one kernel.
 */
import type { HarnessEvent } from "@norn/plugin-api";

/** An event before a host stamps the envelope on it. */
export type EventBody = HarnessEvent extends infer E ? (E extends HarnessEvent ? Omit<E, "run_id" | "seq" | "at"> : never) : never;

/** One native hook call as the agent makes it. */
export interface HookStep {
  hook: string;
  payload: unknown;
  env?: Record<string, string>;
  at: string;
}

/**
 * An event the host records itself rather than translating a hook: norn's own report verbs, and a
 * crash or kill, for which an agent sends no hook.
 */
export interface HostStep {
  host: EventBody;
  at: string;
}

export type Step = HookStep | HostStep;

export interface Check {
  /** how many steps have happened */
  after: number;
  now: string;
  /** the facts and view fields to compare; an object compares only the keys it names */
  expect: Record<string, unknown>;
  why?: string;
}

export interface Scenario {
  scenario: string;
  description: string;
  run_id: string;
  steps: Step[];
  checks: Check[];
}

export const isHostStep = (s: Step): s is HostStep => "host" in s;
