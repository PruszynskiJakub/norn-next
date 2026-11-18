import { classifySession, reduceSession, type SessionFacts, type SessionView } from "@norn/kernel";
import type { Harness, HarnessEvent } from "@norn/plugin-api";
import { isHostStep, type Scenario } from "./scenario.ts";

/** The events of each step, seq numbered across the run as a host appending to one log would. */
export function eventsByStep(harness: Harness, s: Scenario): HarnessEvent[][] {
  let seq = 0;
  return s.steps.map((step) => {
    const events = isHostStep(step)
      ? [{ ...step.host, run_id: s.run_id, seq, at: step.at } as HarnessEvent]
      : harness.normalize({ hook: step.hook, payload: step.payload, env: step.env ?? {}, at: step.at, run_id: s.run_id, seq });
    seq += events.length;
    return events;
  });
}

export interface Reading {
  view: SessionView;
  facts: SessionFacts;
}

/** The session as a host reads it after the first `after` steps, at `now`. */
export function readAt(byStep: HarnessEvent[][], after: number, now: string, silentAfterMs: number): Reading {
  const view = reduceSession(byStep.slice(0, after).flat());
  return { view, facts: classifySession(view, now, { silentAfterMs }) };
}

/** The fields a check names, read from the facts, else from the view. */
export function project(reading: Reading, want: Record<string, unknown>): Record<string, unknown> {
  const source = { ...reading.view, ...reading.facts } as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  for (const [key, expected] of Object.entries(want)) {
    const actual = source[key];
    const partial = expected !== null && typeof expected === "object" && !Array.isArray(expected);
    out[key] = partial && actual !== null && typeof actual === "object" ? Object.fromEntries(Object.keys(expected).map((k) => [k, (actual as Record<string, unknown>)[k]])) : actual;
  }
  return out;
}
