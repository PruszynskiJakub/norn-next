import { describe, expect, test } from "bun:test";
import {
  type Receipt,
  RECEIPT_KINDS,
  type UnitState,
  assertValid,
  SchemaValidationError,
  validate,
} from "../../src/index.ts";

const ID = "01JBQ6ZK3E8Y4V5W6X7Y8Z9ABC";
const ID2 = "01JBQ6ZK3E8Y4V5W6X7Y8Z9ABD";
const AT = "2026-10-23T12:00:00.000Z";
const H = "a".repeat(64);
const head = { receipt_id: ID, run_id: ID2, step: "implement", attempt: 1, at: AT, by: "agent" as const };

const receipts: Record<(typeof RECEIPT_KINDS)[number], Receipt> = {
  done: {
    kind: "done",
    ...head,
    outcome: "changes_requested",
    handoff: "two blocking findings",
    findings: [{ severity: "blocking", title: "missing test", file: "src/a.ts", line: 3, criterion: "B2" }],
    evidence: `evidence/${ID2}`,
  },
  ask: { kind: "ask", ...head, question: "Which DB?", options: ["pg", "sqlite"] },
  stuck: { kind: "stuck", ...head, reason: "spec contradicts itself" },
  answer: { kind: "answer", ...head, by: "human", who: "jakub@mac", answer: "pg", ask_receipt_id: ID },
  approve: { kind: "approve", ...head, step: "human-qa", by: "human", comment: "ok" },
  take: { kind: "take", ...head, by: "human", who: "bob@pc", previous_holder: "ann@mac", previous_heartbeat_id: ID, expired: true },
  reject: { kind: "reject", ...head, step: "human-qa", by: "human" },
  unstick: { kind: "unstick", ...head, by: "human", to: "implement", reset: ["review_loop"] },
  mode: { kind: "mode", ...head, run_id: null, step: "$done", by: "human", mode: "auto", previous: "manual" },
  check: {
    kind: "check",
    ...head,
    step: "test",
    by: "norn",
    outcome: "fail",
    command: "bun test",
    exit_code: null,
    reason: "timeout",
    duration_ms: 600000,
    output_tail: "…",
    log: `logs/${ID2}.log`,
  },
  started: {
    kind: "started",
    ...head,
    by: "norn",
    how: "auto",
    agent: "claude",
    session: { runner: "herdr", session_id: "s1", pane_id: "p2" },
    process: { pid: 4242, pid_start: "Thu Oct 23 12:00:00 2026" },
    worktree: "/repo/.worktrees/gh-123-03",
  },
  classify: {
    kind: "classify",
    ...head,
    by: "norn",
    tick_id: ID,
    outcome: "silent",
    rule: "agent.silent.nudge",
    route: "nudge",
    counter: { name: "nudges", value: 1, max: 2 },
    snapshot: { last_message: "I think I'm done", head: "abc123" },
  },
  workflow: { kind: "workflow", ...head, by: "human", name: "bug", from_hash: H, to_hash: "b".repeat(64), to: "implement" },
  update: { kind: "update", ...head, run_id: null, step: "$done", by: "human", who: "jakub@mac", from: "$done", to: "update", reason: "person" },
};

describe("receipt schema", () => {
  test.each(Object.entries(receipts))("valid %s receipt", (_k, r) => {
    const res = validate("receipt", r);
    if (!res.ok) console.error(res.errors);
    expect(res.ok).toBe(true);
  });

  test("covers every receipt kind", () => {
    expect(Object.keys(receipts).sort()).toEqual([...RECEIPT_KINDS].sort());
  });

  test.each([
    ["unknown kind", { ...receipts.stuck, kind: "approved" }],
    ["missing receipt_id", (({ receipt_id: _, ...r }) => r)(receipts.done)],
    ["bad ulid", { ...receipts.stuck, receipt_id: "not-a-ulid" }],
    ["attempt 0", { ...receipts.stuck, attempt: 0 }],
    ["bad timestamp", { ...receipts.stuck, at: "yesterday" }],
    ["field of another kind", { ...receipts.stuck, outcome: "done" }],
    ["done without outcome", (({ outcome: _, ...r }) => r)(receipts.done as Extract<Receipt, { kind: "done" }>)],
    ["check with bad outcome", { ...receipts.check, outcome: "timeout" }],
    ["mode with bad value", { ...receipts.mode, mode: "semi" }],
    ["finding with bad severity", { ...receipts.done, findings: [{ severity: "huge", title: "x" }] }],
    ["unknown actor", { ...receipts.stuck, by: "robot" }],
  ])("rejects %s", (_name, r) => {
    expect(validate("receipt", r).ok).toBe(false);
  });
});

export const STATE: UnitState = {
  version: 1,
  story: "gh-123",
  slice: "gh-123/03",
  unit_dir: "03-add-form",
  workflow: "slice",
  workflow_hash: H,
  step: "review",
  attempt: 2,
  visits: { implement: 2, test: 2, review: 2 },
  step_entered_at: AT,
  status: "parked",
  park: { kind: "ask", reason: "Which DB?", since: AT, receipt_id: ID },
  counters: { test_loop: 1, review_loop: 1 },
  nudges_used: 0,
  retries_used: 0,
  applied_through: 7,
  run: { run_id: ID2, step: "review", attempt: 2, started_at: AT, how: "auto", agent: "claude", session: { runner: "herdr", session_id: "s1" } },
  last_outcome: { step: "test", outcome: "pass", source: "classified", at: AT, receipt_id: ID },
  created_at: AT,
  updated_at: AT,
  last_tick_id: ID,
};

describe("state.json schema", () => {
  test("valid slice state", () => expect(validate("state", STATE).ok).toBe(true));
  test("valid story state with mode, done cursor, no run", () => {
    const s = { ...STATE, slice: null, unit_dir: "_story", mode: "auto", step: "$done", status: "done", park: null, run: null };
    expect(validate("state", s).ok).toBe(true);
  });
  test.each([
    ["status not in enum", { ...STATE, status: "waiting" }],
    ["cursor $stuck", { ...STATE, step: "$stuck" }],
    ["negative counter", { ...STATE, counters: { test_loop: -1 } }],
    ["bad unit dir", { ...STATE, unit_dir: "03_Add" }],
    ["bad park kind", { ...STATE, park: { ...STATE.park, kind: "lunch" } }],
    ["bad workflow hash", { ...STATE, workflow_hash: "abc" }],
    ["unknown field", { ...STATE, cursor: "review" }],
    ["slice key of wrong shape", { ...STATE, slice: "gh-123-03" }],
  ])("rejects %s", (_n, s) => expect(validate("state", s).ok).toBe(false));
});

describe("frontmatter schemas", () => {
  const story = {
    id: "gh-123",
    slug: "fix-login",
    provider: "gh",
    number: 123,
    url: "https://github.com/o/r/issues/123",
    title: "Fix login",
    assignee: "jakub",
    workflow: "story",
    status: "active",
    intake_at: AT,
  };
  test("valid story", () => expect(validate("story", story).ok).toBe(true));
  test("story allows extra human fields", () => expect(validate("story", { ...story, priority: "high" }).ok).toBe(true));
  test("story key must match provider prefix shape", () => expect(validate("story", { ...story, id: "GH-123" }).ok).toBe(false));
  test("story status enum", () => expect(validate("story", { ...story, status: "approved" }).ok).toBe(false));

  const slice = { id: "gh-123/03", title: "Add form", workflow: "slice", depends_on: ["gh-123/01"], status: "planned" };
  test("valid slice", () => expect(validate("slice", slice).ok).toBe(true));
  test("slice id must be a slice key", () => expect(validate("slice", { ...slice, id: 3 }).ok).toBe(false));
  test("slice depends_on must be slice keys", () => expect(validate("slice", { ...slice, depends_on: ["01"] }).ok).toBe(false));
});

describe("claim, lease, trace, hook, cli-error", () => {
  const claim = {
    version: 1,
    story: "gh-123",
    holder: "jakub@mac",
    heartbeat_id: ID,
    acquired_at: AT,
    renewed_at: AT,
    expires_at: AT,
    last_tick_id: null,
  };
  test("claim", () => {
    expect(validate("claim", claim).ok).toBe(true);
    expect(validate("claim", { ...claim, holder: "jakub" }).ok).toBe(false);
  });

  const lease = {
    version: 1,
    kind: "agent",
    slot: 2,
    repo: "/repo",
    story: "gh-123",
    slice: "gh-123/03",
    run_id: ID,
    holder: { pid: 1, pid_start: "x" },
    created_at: AT,
  };
  test("lease", () => {
    expect(validate("lease", lease).ok).toBe(true);
    expect(validate("lease", { ...lease, kind: "port" }).ok).toBe(false);
  });

  const hook = { event: "turn_end", at: AT, agent: "claude", native: "Stop", cwd: "/w", run_id: ID, transcript: "/t.jsonl" };
  test("trace events", () => {
    const tick = {
      type: "tick",
      tick_id: ID,
      at: AT,
      heartbeat_id: null,
      duration_ms: 12,
      facts: { stories: [] },
      decisions: [{ unit: "gh-123/03", rule: "agent.silent.nudge", action: { kind: "nudge" }, result: { ok: true } }],
    };
    expect(validate("trace", tick).ok).toBe(true);
    expect(validate("trace", { type: "hook", id: ID, fact: hook, blocked: true, reason: "report first" }).ok).toBe(true);
    expect(validate("trace", { type: "reject", id: ID, at: AT, unit: "gh-123", source: "0004-answer.json", reason: "stale attempt" }).ok).toBe(true);
    expect(validate("trace", { ...tick, decisions: [{ unit: "x", rule: "r", action: {}, result: { ok: true } }] }).ok).toBe(false);
    expect(validate("trace", { type: "hook", id: ID, fact: { ...hook, event: "idle" } }).ok).toBe(false);
  });

  test("cli error", () => {
    expect(validate("cli-error", { error: "not in a norn unit", do_instead: "cd into a worktree with .norn-unit" }).ok).toBe(true);
    expect(validate("cli-error", { error: "x", do_instead: null, code: "stale_attempt" }).ok).toBe(true);
    expect(validate("cli-error", { message: "x" }).ok).toBe(false);
  });

  test("assertValid throws SchemaValidationError with paths", () => {
    expect(() => assertValid("claim", { ...claim, expires_at: "never" })).toThrow(SchemaValidationError);
    try {
      assertValid("claim", { ...claim, expires_at: "never" });
    } catch (e) {
      expect((e as SchemaValidationError).errors[0]?.path).toBe("/expires_at");
    }
  });
});
