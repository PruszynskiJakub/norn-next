import { describe, expect, test } from "bun:test";
import type { TickReport } from "@norn/runtime";
import { failedCount, outcomeLine, standing, tickMarkdown, watchLine } from "../../src/tick-report.ts";

type Outcome = TickReport["outcomes"][number];
const decision = { kind: "apply_receipts", unit: "gh-1", rule: "receipts.apply" } as unknown as Outcome["decision"];
const report = (outcomes: Outcome[]): TickReport => ({ tick_id: "01JAAAAAAAAAAAAAAAAAAAAAAA", decisions: [], outcomes, problems: [] }) as unknown as TickReport;
const lost: Outcome = { decision, ok: false, retryable: true, error: "conflict: gh-1: receipt X landed at seq 11, decide numbered it 10; the record moved since facts were read" };

describe("a tick's report", () => {
  test("a write that lost a race to another writer is no failure: the tick exits 0 and says it is decided again", () => {
    expect(failedCount(report([lost]))).toBe(0);
    expect(outcomeLine(lost)).toContain("lost a race, decided again next tick");
    expect(tickMarkdown(report([lost]))).toContain("1 action, 0 failed");
  });

  test("any other failure counts, retryable or not", () => {
    const unavailable: Outcome = { decision, ok: false, retryable: true, error: "unavailable: gh timed out" };
    const conflict: Outcome = { decision, ok: false, retryable: false, error: "conflict: the claim is held elsewhere" };
    expect(failedCount(report([unavailable, conflict, lost]))).toBe(2);
    expect(outcomeLine(conflict)).toContain("FAILED");
  });
});

describe("what only keeps a story where it is", () => {
  const start = { kind: "start_run", unit: "gh-1", rule: "agent.start" } as unknown as Outcome["decision"];
  const check = { kind: "run_check", unit: "gh-1", rule: "check.run" } as unknown as Outcome["decision"];

  test("a launch or a check waiting on its worktree's setup is standing, so a watch neither prints it nor ticks again at once", () => {
    const waiting: Outcome[] = [
      { decision: start, ok: true, detail: { performed: false, waiting: "setup" } },
      { decision: check, ok: true, detail: { performed: false, waiting: "setup" } },
    ];
    expect(waiting.map(standing)).toEqual([true, true]);
    expect(watchLine(report(waiting), "09:00:00", new Set())).toBeNull();
  });

  test("a launch whose setup failed wrote the park, and one that launched moved the story: neither is standing", () => {
    const parked: Outcome = { decision: start, ok: true, detail: { performed: false, waiting: "parked" } };
    const launched: Outcome = { decision: start, ok: true, detail: { performed: true, handle: "h" } };
    expect([parked, launched].map(standing)).toEqual([false, false]);
    expect(standing({ decision: { kind: "noop", unit: "gh-1", rule: "agent.running" } as unknown as Outcome["decision"], ok: true })).toBe(true);
    expect(standing({ decision: start, ok: false, retryable: true, error: "unavailable: down" })).toBe(false);
  });
});
