/**
 * Step timeline (O4, X1), the pure pieces: durations, human wait, foreign commits, the base-cache note
 * and the criteria summary. The rows built from the gh-1 fixture are in test/integration/steps.test.ts.
 */
import { describe, expect, test } from "bun:test";
import { join } from "node:path";
import type { NumberedReceipt } from "@norn/core";
import type { Receipt, UnitState } from "@norn/schema";
import { baseCacheDir } from "@norn/store";
import { buildStepTimeline, criteriaSummary, formatDuration, formatStepTimeline, type TraceView } from "../../src/index.ts";

describe("pure pieces", () => {
  test("formatDuration", () => {
    expect(formatDuration(0)).toBe("0s");
    expect(formatDuration(16_680)).toBe("17s");
    expect(formatDuration(147_000)).toBe("2m27s");
    expect(formatDuration(3_725_000)).toBe("1h02m");
    expect(formatDuration(90_000_000)).toBe("1d01h");
  });

  test("ask → answer counts as human wait; an open step runs to now", () => {
    const t = (m: number) => new Date(Date.parse("2026-10-23T10:00:00.000Z") + m * 60_000).toISOString();
    const rc = (n: number, r: Record<string, unknown>): NumberedReceipt => ({
      n,
      file: `/r/receipts/000${n}-${r.kind}.json`,
      receipt: { receipt_id: `01M5MRHZK7F089C3QW0FFY79${10 + n}`, run_id: null, step: "implement", attempt: 1, ...r } as Receipt,
    });
    const state = { step: "implement", attempt: 1, status: "parked", step_entered_at: t(0), created_at: t(0), updated_at: t(10) } as UnitState;
    const v = buildStepTimeline(
      {
        key: "gh-9",
        story: "gh-9",
        slice: null,
        title: "x",
        runs_dir: "/r",
        trace_dir: "/t",
        state,
        workflow: null,
        receipts: [
          rc(1, { kind: "started", at: t(1), by: "agent", who: "claude", how: "manual", agent: "claude", worktree: "/w", run_id: "01M5MRHZK7F089C3QW0FFY796H" }),
          rc(2, { kind: "ask", at: t(5), by: "agent", question: "Which provider?" }),
          rc(3, { kind: "answer", at: t(12), by: "human", who: "ann@box", answer: "GitHub" }),
        ],
        events: [],
        intake_at: null,
      },
      { now: Date.parse(t(20)) },
    );
    expect(v.steps).toHaveLength(1);
    expect(v.steps[0]).toMatchObject({ step: "implement", open: true, left_at: null, duration_ms: 20 * 60_000, wait_ms: 7 * 60_000, type: "agent" });
    expect(v.steps[0]?.who.map((w) => w.name)).toEqual(["claude", "ann@box"]);
    expect(v.totals.human_wait_ms).toBe(7 * 60_000);
  });

  test("Q6: foreign commits are their own source, placed at commit time, shown on the row without --events", () => {
    const t = (m: number) => new Date(Date.parse("2026-10-23T10:00:00.000Z") + m * 60_000).toISOString();
    const state = { step: "ready", attempt: 1, status: "parked", step_entered_at: t(0), created_at: t(0), updated_at: t(0) } as UnitState;
    const sha = "c".repeat(40);
    const input = {
      key: "gh-9",
      story: "gh-9",
      slice: null,
      title: "x",
      runs_dir: "/r",
      trace_dir: "/t",
      state,
      workflow: null,
      receipts: [],
      events: [{ type: "foreign_commits" as const, id: "01M5MRHZK7F089C3QW0FFY7911", at: t(30), unit: "gh-9", commits: [{ sha, subject: "Merge origin/main", author: "Jakub", at: t(5), branch: "gh-9-x" }] }],
      intake_at: null,
    };
    for (const events of [false, true]) {
      const v = buildStepTimeline(input, { now: Date.parse(t(40)), events });
      expect(v.steps[0]?.events).toEqual([{ at: t(5), source: "foreign", kind: "foreign_commit", summary: "foreign commit on gh-9-x (not made by norn): cccccccccccc Merge origin/main (Jakub)", ref: sha }]);
      expect(formatStepTimeline(v)).toContain("· 10:05:00 foreign  foreign commit on gh-9-x (not made by norn): cccccccccccc Merge origin/main (Jakub)");
    }
  });

  test("F36: a trace read from the base-branch cache says so", () => {
    const v = { unit: "gh-9", title: "x", status: "done", step: "$done", intake_at: null, done_at: null, merged_at: null, totals: { wall_clock_ms: null, by_type: {}, human_wait_ms: 0, merge_wait_ms: null }, steps: [], units: [], hidden_events: 0, records: { source: "base_cache", root: join(baseCacheDir("/repo"), "abc"), ref: "refs/remotes/origin/main" } } as unknown as TraceView;
    expect(formatStepTimeline(v)).toContain(`records: no worktree — paths below are a cached copy of origin/main (${join(baseCacheDir("/repo"), "abc")}), refreshed when origin/main moves`);
  });
});

describe("criteria summary (QV8)", () => {
  const ev = (unit: string, unverified: number, needs: Record<string, number>, rule: "criteria.checked" | "criteria.unchecked_coverage" = "criteria.checked") =>
    ({ type: "criteria", id: "01JBQ6ZK3E8Y4V5W6X7Y8Z9ABC", at: "2026-10-23T12:00:00.000Z", unit, run_id: "01JBQ6ZK3E8Y4V5W6X7Y8Z9ABD", step: "qa", attempt: 1, receipt_id: "01JBQ6ZK3E8Y4V5W6X7Y8Z9ABE", outcome: "unverified", rule, verdicts: { pass: 1, fail: 0, person: 0, unverified }, unverified_needs: needs }) as const;

  test("unverified per capability summed over the units shown; other units ignored", () => {
    const events = [ev("gh-1/01", 1, { browser: 1 }), ev("gh-1", 2, { browser: 1, none: 1 }, "criteria.unchecked_coverage"), ev("gh-2", 5, { browser: 5 })];
    expect(criteriaSummary(events, new Set(["gh-1", "gh-1/01"]))).toEqual({ reports: 2, verdicts: { pass: 2, fail: 0, person: 0, unverified: 3 }, unverified_needs: { browser: 2, none: 1 }, unchecked_coverage: 1 });
    expect(criteriaSummary(events, new Set(["gh-3"]))).toBeNull();
  });
});
