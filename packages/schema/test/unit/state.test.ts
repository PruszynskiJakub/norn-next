import { describe, expect, test } from "bun:test";
import { validate } from "../../src/index.ts";

const ID = "01JBQ6ZK3E8Y4V5W6X7Y8Z9ABC";
const AT = "2026-10-23T12:00:00.000Z";
const RUN = { run_id: ID, step: "review", attempt: 2, started_at: AT, how: "auto" };
const ask = { kind: "ask", reason: "Which DB?", since: AT };
const ended = { by: "person", at: "review", receipt_id: ID };
const flat = {
  version: 1,
  story: "gh-123",
  slice: "gh-123/03",
  unit_dir: "03-add-form",
  workflow: "slice",
  workflow_hash: "a".repeat(64),
  step: "review",
  attempt: 2,
  visits: { review: 2 },
  step_entered_at: AT,
  status: "ready",
  park: null,
  counters: {},
  nudges_used: 0,
  retries_used: 0,
  applied_through: 7,
  run: null,
  last_outcome: null,
  created_at: AT,
  updated_at: AT,
  last_tick_id: ID,
};

describe("state.json: one variant per status", () => {
  test.each([
    ["ready", flat],
    ["running", { ...flat, status: "running", run: RUN }],
    ["parked on an ask, keeping its run", { ...flat, status: "parked", park: ask, run: RUN }],
    ["parked at a gate", { ...flat, status: "parked", park: { kind: "gate", reason: "approve?", since: AT } }],
    ["stuck, exhausted", { ...flat, status: "stuck", park: { kind: "exhausted", reason: "review_loop 3/3", since: AT } }],
    ["stuck at $done on a remote park", { ...flat, step: "$done", status: "stuck", park: { kind: "remote", reason: "remote: PR closed", since: AT } }],
    ["done", { ...flat, step: "$done", status: "done" }],
    ["done holding a workflow park", { ...flat, step: "$done", status: "done", park: { kind: "workflow", reason: "workflow x changed", since: AT, command: "norn story edit gh-1 --workflow x" } }],
    ["done, ended by the person", { ...flat, step: "$done", status: "done", ended }],
    ["corrupt", { ...flat, status: "corrupt", park: { kind: "corrupt", reason: "corrupt: x failed validation", since: AT }, run: RUN }],
  ])("accepts %s", (_n, s) => {
    expect(validate("state", s).ok).toBe(true);
    expect(validate("state-record", s).ok).toBe(true);
  });

  const contradictions: Array<[string, unknown]> = [
    ["running with run null", { ...flat, status: "running" }],
    ["parked with park null", { ...flat, status: "parked" }],
    ["parked with a stuck kind", { ...flat, status: "parked", park: { ...ask, kind: "stuck" } }],
    ["done at a step", { ...flat, status: "done" }],
    ["done with an ask park", { ...flat, step: "$done", status: "done", park: ask }],
    ["ready with a park", { ...flat, park: ask }],
    ["ready at $done", { ...flat, step: "$done" }],
    ["a corrupt kind outside corrupt", { ...flat, status: "stuck", park: { ...ask, kind: "corrupt" } }],
    ["ended on running", { ...flat, status: "running", run: RUN, ended }],
  ];
  test.each(contradictions)("rejects %s, which the read shape accepts", (_n, s) => {
    expect(validate("state", s).ok).toBe(false);
    expect(validate("state-record", s).ok).toBe(true);
  });

  test("the error for a bad running state points at the running branch", () => {
    const r = validate("state", { ...flat, status: "running" });
    if (r.ok) throw new Error("expected a rejection");
    expect(r.errors.map((e) => e.path)).toEqual(["/run"]);
  });
});
