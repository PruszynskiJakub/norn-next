import type { HarnessEvent } from "@norn/plugin-api";

export type Body = HarnessEvent extends infer E ? (E extends HarnessEvent ? Omit<E, "run_id" | "seq" | "at"> : never) : never;

export const T0 = Date.parse("2026-11-17T10:00:00.000Z");
export const iso = (secs: number): string => new Date(T0 + secs * 1000).toISOString();

/** Events one second apart, seq from 0, as a harness would number them. */
export function stream(...bodies: Body[]): HarnessEvent[] {
  return bodies.map((b, i) => ({ ...b, run_id: "run-1", seq: i, at: iso(i) }) as HarnessEvent);
}

export const START: Body = { type: "session.started", harness_session: "s-1" };
export const BRIEF: Body = { type: "turn.started", source: "brief" };
