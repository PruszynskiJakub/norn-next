import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach } from "bun:test";
import { type Receipt, type UnitState, ulid } from "@norn/schema";
import { sha256 } from "../src/index.ts";

const dirs: string[] = [];
afterEach(() => {
  while (dirs.length) rmSync(dirs.pop() as string, { recursive: true, force: true });
});

export function tmp(prefix = "norn-store-"): string {
  const d = mkdtempSync(join(tmpdir(), prefix));
  dirs.push(d);
  return d;
}

export const AT = "2026-10-23T12:00:00.000Z";

export const WORKFLOW_YAML = `name: slice
start: implement
steps:
  implement:
    type: agent
    skill: implement
    outcomes: { done: { to: test, means: "tests pass" } }
  test:
    type: check
    run: bun test
    timeout: 10m
    outcomes: { pass: $done, fail: { to: implement, counter: test_loop } }
counters: { test_loop: { max: 3 } }
`;

export function receipt(over: Record<string, unknown> = {}): Receipt {
  const kind = (over.kind as string | undefined) ?? "done";
  const base = { kind, receipt_id: ulid(), run_id: ulid(), step: "implement", attempt: 1, at: AT, by: "agent" };
  const extra = kind === "done" ? { outcome: "done", handoff: "ok" } : {};
  return { ...base, ...extra, ...over } as Receipt;
}

export function state(over: Partial<UnitState> = {}): UnitState {
  return {
    version: 1,
    story: "gh-12",
    slice: "gh-12/01",
    unit_dir: "01-add-form",
    workflow: "slice",
    workflow_hash: sha256(WORKFLOW_YAML),
    step: "implement",
    attempt: 1,
    visits: { implement: 1 },
    step_entered_at: AT,
    status: "ready",
    park: null,
    counters: {},
    nudges_used: 0,
    retries_used: 0,
    applied_through: 0,
    run: null,
    last_outcome: null,
    created_at: AT,
    updated_at: AT,
    last_tick_id: null,
    ...over,
  };
}
