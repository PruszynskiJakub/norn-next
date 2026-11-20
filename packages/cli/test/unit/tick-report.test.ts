import { describe, expect, test } from "bun:test";
import type { TickReport } from "@norn/runtime";
import { failedCount, outcomeLine, tickMarkdown } from "../../src/tick-report.ts";

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

  test("a waiting await step's line names the kinds it waits on and the signals it saw", () => {
    const waiting = { decision: { kind: "noop", unit: "gh-1", rule: "await.waiting", reason: "waiting on ci.passed, ci.failed, ci.none; seen ci.pending" }, ok: true } as unknown as Outcome;
    expect(outcomeLine(waiting)).toBe("gh-1  await.waiting → noop: waiting on ci.passed, ci.failed, ci.none; seen ci.pending");
    const other = { decision: { kind: "noop", unit: "gh-1", rule: "agent.running", reason: "run r-1 at work" }, ok: true } as unknown as Outcome;
    expect(outcomeLine(other)).toBe("gh-1  agent.running → noop");
  });
});
