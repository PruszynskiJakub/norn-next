/**
 * Where a tick spends its time. observe times its phases and counts its remote calls on
 * a `PhaseTimer`; `runTick` times observe, decide, act and what follows, and `tickTiming` turns that
 * into the tick record's `timing` with its slowest phase. Diagnostic only: never in `facts` or an
 * `action`, so decide never reads it and `--why` replays ignore it.
 */
import type { TickSlowest, TickTiming } from "@norn/schema";

export class PhaseTimer {
  /** phase → ms, summed over every time the phase ran */
  readonly phases: Record<string, number> = {};
  /** remote call → how many were made */
  readonly calls: Record<string, number> = {};

  constructor(private readonly clock: () => number = () => performance.now()) {}

  /** Runs `fn` and adds its time to `phase`, whether it returns or throws. */
  time<T>(phase: string, fn: () => T): T {
    const t0 = this.clock();
    const done = () => this.add(phase, this.clock() - t0);
    let out: T;
    try {
      out = fn();
    } catch (e) {
      done();
      throw e;
    }
    if (out instanceof Promise) return out.finally(done) as T;
    done();
    return out;
  }

  add(phase: string, ms: number): void {
    this.phases[phase] = (this.phases[phase] ?? 0) + ms;
  }

  count(call: string): void {
    this.calls[call] = (this.calls[call] ?? 0) + 1;
  }
}

export interface TimingInput {
  observe_ms: number;
  decide_ms: number;
  act_ms: number;
  after_ms: number;
  observe: Record<string, number>;
  calls: Record<string, number>;
}

const ms = (n: number) => Math.max(0, Math.round(n));

/**
 * The tick record's `timing`, rounded to whole ms, with the slowest of: each observe phase
 * (`observe.<phase>`), the rest of observe no phase covers (`observe`), `decide`, each action
 * (`act <kind> <unit>`) and `after`. Claim renewals pushed in one batch (`batched`) each carry the
 * batch's time, so they are one candidate (`act claim renew (N claims)`), not one per claim.
 */
export function tickTiming(t: TimingInput, actions: ReadonlyArray<{ unit: string; kind: string; ms: number; batched?: boolean }>): TickTiming {
  const observe = Object.fromEntries(Object.entries(t.observe).map(([k, v]) => [k, ms(v)]));
  const covered = Object.values(observe).reduce((a, b) => a + b, 0);
  const batch = actions.filter((a) => a.batched);
  const single = batch.length > 1 ? actions.filter((a) => !a.batched) : actions;
  const candidates: TickSlowest[] = [
    ...Object.entries(observe).map(([k, v]) => ({ phase: `observe.${k}`, ms: v })),
    { phase: "observe", ms: Math.max(0, ms(t.observe_ms) - covered) },
    { phase: "decide", ms: ms(t.decide_ms) },
    ...single.map((a) => ({ phase: `act ${a.kind} ${a.unit}`, ms: ms(a.ms) })),
    ...(batch.length > 1 ? [{ phase: `act claim renew (${batch.length} claims)`, ms: ms(Math.max(...batch.map((a) => a.ms))) }] : []),
    { phase: "after", ms: ms(t.after_ms) },
  ];
  const slowest = candidates.reduce((a, b) => (b.ms > a.ms ? b : a));
  return {
    observe_ms: ms(t.observe_ms),
    decide_ms: ms(t.decide_ms),
    act_ms: ms(t.act_ms),
    after_ms: ms(t.after_ms),
    observe,
    ...(Object.keys(t.calls).length ? { calls: { ...t.calls } } : {}),
    slowest,
  };
}
