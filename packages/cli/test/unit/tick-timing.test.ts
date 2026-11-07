/** A tick record says where the tick spent its time. */
import { describe, expect, test } from "bun:test";
import type { Decision, Facts } from "@norn/core";
import { validate } from "@norn/schema";
import { traceRecord } from "../../src/runtime/tick.ts";
import { PhaseTimer, tickTiming } from "../../src/runtime/timing.ts";
import type { Observed } from "../../src/runtime/observe/index.ts";

const TICK = "01JZ0000000000000000000000";

describe("PhaseTimer", () => {
  test("adds up the time of each phase and counts calls", async () => {
    let t = 0;
    const timer = new PhaseTimer(() => t);
    await timer.time("sync.stories", async () => void (t += 120));
    await timer.time("sync.stories", async () => void (t += 30));
    expect(timer.time("local", () => ((t += 5), "x"))).toBe("x");
    timer.count("get_issue");
    timer.count("get_issue");
    timer.count("find_pr");
    expect(timer.phases).toEqual({ "sync.stories": 150, local: 5 });
    expect(timer.calls).toEqual({ get_issue: 2, find_pr: 1 });
  });

  test("a phase that throws is still timed", async () => {
    let t = 0;
    const timer = new PhaseTimer(() => t);
    await expect(timer.time("base_fetch", async () => ((t += 7), Promise.reject(new Error("no remote"))))).rejects.toThrow("no remote");
    expect(timer.phases).toEqual({ base_fetch: 7 });
  });
});

describe("tickTiming", () => {
  test("names the slowest of observe's phases, decide, each action and after", () => {
    const records = [
      { unit: "gh-1", kind: "claim", ms: 1200.4 },
      { unit: "gh-2", kind: "run_check", ms: 4000 },
    ];
    const t = tickTiming({ observe_ms: 9000.6, decide_ms: 2, act_ms: 5200, after_ms: 30, observe: { base_fetch: 2100, "sync.issues": 3000.2 }, calls: { list_issues: 1 } }, records);
    expect(t).toEqual({
      observe_ms: 9001,
      decide_ms: 2,
      act_ms: 5200,
      after_ms: 30,
      observe: { base_fetch: 2100, "sync.issues": 3000 },
      calls: { list_issues: 1 },
      slowest: { phase: "act run_check gh-2", ms: 4000 },
    });
    expect(tickTiming({ observe_ms: 10, decide_ms: 1, act_ms: 0, after_ms: 0, observe: {}, calls: {} }, []).slowest).toEqual({ phase: "observe", ms: 10 });
    // a batched claim renewal is one candidate with the batch's time, not one per claim
    const renewals = [
      { unit: "gh-1", kind: "claim", ms: 900, batched: true },
      { unit: "gh-2", kind: "claim", ms: 900, batched: true },
      { unit: "gh-3", kind: "run_check", ms: 400 },
    ];
    expect(tickTiming({ observe_ms: 0, decide_ms: 0, act_ms: 1300, after_ms: 0, observe: {}, calls: {} }, renewals).slowest).toEqual({ phase: "act claim renew (2 claims)", ms: 900 });
    expect(tickTiming({ observe_ms: 0, decide_ms: 0, act_ms: 900, after_ms: 0, observe: {}, calls: {} }, renewals.slice(0, 1)).slowest).toEqual({ phase: "act claim gh-1", ms: 900 });
    // no calls made: the field stays out
    expect("calls" in tickTiming({ observe_ms: 1, decide_ms: 1, act_ms: 0, after_ms: 0, observe: {}, calls: {} }, [])).toBe(false);
  });
});

describe("traceRecord", () => {
  test("records the sync report, each action's time and the timing, and validates", () => {
    const obs = { facts: { tick_id: TICK } as Facts, heartbeat_id: null, sync: { ran: true, ok: false, error: "gh issue list failed" } } as unknown as Observed;
    const decision: Decision = { unit: "gh-1", rule: "claim.renew", action: { kind: "noop" } } as unknown as Decision;
    const timing = tickTiming({ observe_ms: 50, decide_ms: 1, act_ms: 12, after_ms: 0, observe: { local: 20 }, calls: {} }, [{ unit: "gh-1", kind: "noop", ms: 12 }]);
    const rec = traceRecord(obs, [{ decision, result: { ok: true }, ms: 11.6 }], Date.parse("2026-11-06T09:00:00.000Z"), 63, "0.21.1", timing);
    expect(rec.decisions[0]?.result).toEqual({ ok: true, ms: 12 });
    expect(rec.sync).toEqual({ ran: true, ok: false, error: "gh issue list failed" });
    expect(rec.timing).toEqual(timing);
    expect(validate("trace", { type: "tick", ...rec, facts: {} }).ok).toBe(true);
  });
});
