/**
 * Every workflow reader names the read it stands for: the main checkout's own files (`checkout`) or a
 * text norn kept or found elsewhere (`copy`). Both load the same workflow from the same text.
 */
import { describe, expect, test } from "bun:test";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { ResolvedConfig, TickTrace } from "@norn/schema";
import {
  loadWorkflow,
  loadWorkflowText,
  loadWorkflows,
  pinnedWorkflowPath,
  pinWorkflow,
  readPinnedWorkflow,
  readTickInputs,
  recordErrors,
  setWorkflowReadObserver,
  type WorkflowTextRead,
  workflowsDir,
  writeState,
  writeTraceFile,
} from "../../src/index.ts";
import { AT, state, tmp, WORKFLOW_YAML } from "../helpers.ts";

function observed<T>(fn: () => T): { value: T; reads: WorkflowTextRead[] } {
  const reads: WorkflowTextRead[] = [];
  const prev = setWorkflowReadObserver((r) => reads.push(r));
  try {
    return { value: fn(), reads };
  } finally {
    setWorkflowReadObserver(prev);
  }
}

const kinds = (reads: WorkflowTextRead[]) => [...new Set(reads.map((r) => r.read))];

function repoWithSlice(): string {
  const repo = tmp();
  mkdirSync(workflowsDir(repo), { recursive: true });
  writeFileSync(join(workflowsDir(repo), "slice.yaml"), WORKFLOW_YAML);
  return repo;
}

const expected = () => {
  const r = loadWorkflow(repoWithSlice(), "slice");
  if (!r.ok) throw new Error("slice does not load");
  return r.value.workflow;
};

describe("workflow reads", () => {
  test("the listing and the single-workflow load read the main checkout", () => {
    const repo = repoWithSlice();
    const listing = observed(() => loadWorkflows(repo));
    expect(listing.value.errors).toEqual([]);
    expect(kinds(listing.reads)).toEqual(["checkout"]);
    const one = observed(() => loadWorkflow(repo, "slice"));
    expect(one.value.ok && one.value.value.workflow).toEqual(listing.value.workflows.slice?.workflow as never);
    expect(kinds(one.reads)).toEqual(["checkout"]);
  });

  test("a text loaded as a workflow file keeps the read its caller names (a story branch's file at a restart is a copy)", () => {
    const r = observed(() => loadWorkflowText("slice", WORKFLOW_YAML, ".agents/workflows/slice.yaml", "copy"));
    expect(r.value.ok && r.value.value.workflow).toEqual(expected());
    expect(r.reads).toEqual([{ path: ".agents/workflows/slice.yaml", read: "copy" }]);
  });

  test("pinning and reading a unit's pin are copy reads", () => {
    const unit = tmp();
    const pin = observed(() => pinWorkflow(unit, WORKFLOW_YAML));
    expect(pin.value.ok).toBe(true);
    expect(pin.reads).toEqual([{ path: pinnedWorkflowPath(unit), read: "copy" }]);
    const read = observed(() => readPinnedWorkflow(unit));
    expect(read.value.ok && read.value.value.workflow).toEqual(expected());
    expect(read.reads).toEqual([{ path: pinnedWorkflowPath(unit), read: "copy" }]);
  });

  test("a past round's pin read for the record's errors is a copy read", () => {
    const dir = tmp();
    writeState(dir, state());
    pinWorkflow(dir, WORKFLOW_YAML);
    const r = observed(() => recordErrors(dir));
    expect(r.value).toEqual([]);
    expect(kinds(r.reads)).toEqual(["copy"]);
  });

  test("the trace reader reads a tick's workflows as copies", () => {
    const repo = tmp();
    const hash = "a".repeat(64);
    writeTraceFile(repo, `workflows/${hash}.yaml`, WORKFLOW_YAML);
    const t = {
      type: "tick",
      tick_id: "T",
      at: AT,
      heartbeat_id: null,
      duration_ms: 3,
      facts: { now: Date.parse(AT), tick_id: "T", replay: { workflows: { slice: { hash, issues: [] } }, config: { max_agents: 2 } as unknown as ResolvedConfig } },
      decisions: [],
    } as unknown as TickTrace;
    const r = observed(() => readTickInputs(repo, t));
    expect(r.value.ok && r.value.inputs.workflows.slice?.workflow).toEqual(expected());
    expect(r.reads).toEqual([{ path: `trace/workflows/${hash}.yaml`, read: "copy" }]);
  });

  test("an observer that throws changes nothing; null turns it off", () => {
    const prev = setWorkflowReadObserver(() => {
      throw new Error("boom");
    });
    try {
      expect(loadWorkflow(repoWithSlice(), "slice").ok).toBe(true);
    } finally {
      setWorkflowReadObserver(prev);
    }
    expect(setWorkflowReadObserver(null)).toBeNull();
  });
});
