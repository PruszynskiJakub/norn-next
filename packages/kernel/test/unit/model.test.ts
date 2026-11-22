import { describe, expect, test } from "bun:test";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { parse } from "yaml";
import {
  ACTION_KINDS,
  DEFAULT_KERNEL_CONFIG,
  type Decision,
  Decisions,
  decide,
  decideContext,
  type KernelFacts,
  type KernelWorkflows,
  type LoadedWorkflow,
  newRunState,
  RECEIPT_KINDS,
  type ReceiptData,
  validateDecision,
  validateKernelConfig,
  validateKernelFacts,
  validateReceiptData,
  validateRunState,
  validateSharedWorkflowDocument,
  validateWorkflowDocument,
  validateWorkflowFile,
  validateWorkflowGraph,
} from "../../src/index.ts";

const ROOT = join(import.meta.dir, "..", "..", "..", "..");
const TICK = "01JD0000000000000000000000";
const NOW = "2026-11-17T10:00:00.000Z";
const HASH = "a".repeat(64);

const WORKFLOW: LoadedWorkflow = {
  pinned: { name: "tiny", hash: HASH, doc: { name: "tiny", start: "work", steps: { work: { agent: "Do it.", outcomes: { done: "$done" } } } } },
  graph: {
    name: "tiny",
    hash: HASH,
    start: "work",
    stalled_ms: null,
    steps: {
      work: {
        name: "work",
        kind: "agent",
        runner: { type: "builtin" },
        outcomes: ["done"],
        routes: { done: { to: "$done" } },
        agent: {
          instructions: "Do it.",
          skills: [],
          inputs: [],
          executor: null,
          attended: "none",
          criteria: false,
          hand_back: {},
          writes: "worktree",
          means: {},
          verdict: {},
          deadline_ms: null,
          nudges: 2,
          retries: 1,
        },
      },
    },
    counters: { "work.back": { max: 3, reset_on: [] } },
  },
};

function facts(over: Partial<KernelFacts> = {}): KernelFacts {
  const caps = { blockStop: true, denyTool: true, injectContext: true, subagents: true, limits: true, paneInput: false };
  return {
    tick_id: TICK,
    now: NOW,
    holder: "machine-a",
    capabilities: {
      tracker: { assign: true, labels: true, comment: true, create: true, close: true },
      forge: null,
      store: { shared: false, claims: "local", mailbox: true, artifacts: true },
      executors: { claude: { ...caps, headless: true, attended: true } },
    },
    stories: [],
    intake: [],
    ...over,
  };
}

const errorsOf = (r: { ok: boolean; errors?: Array<{ path: string; message: string }> }) => (r.ok ? [] : r.errors);

describe("kernel schemas", () => {
  test("the default config and a full set of facts validate", () => {
    expect(errorsOf(validateKernelConfig(DEFAULT_KERNEL_CONFIG))).toEqual([]);
    const state = newRunState({ unit: "gh-1", story: "gh-1", workflow: WORKFLOW });
    const withUnit = facts({
      stories: [
        {
          key: "gh-1",
          item: null,
          change: null,
          claim: { story: "gh-1", holder: "machine-a", acquired_at: NOW, expires_at: NOW, version: 1 },
          units: [
            {
              id: "gh-1",
              state,
              receipts: [{ seq: 1, id: "r1", at: NOW, data: { kind: "run.reported", run_id: "run-1", verb: "done", outcome: "done" } }],
              session: { activity: "reported", silent: false, report: { verb: "done", outcome: "done" }, pending_tools: 0, subagents: 0, pane_answers: 0, errors: [] },
              step_run: { kind: "check", running: false, outcome: "pass" },
            },
          ],
          mailbox: [],
          signals: [{ type: "stale", source: "vcs", id: "b1", at: NOW, detail: { base: "origin/main" } }],
        },
      ],
    });
    expect(errorsOf(validateKernelFacts(withUnit))).toEqual([]);
    expect(errorsOf(validateWorkflowGraph(WORKFLOW.graph))).toEqual([]);
  });

  test("facts that break the contract are refused at the field", () => {
    const bad = { ...facts(), tick_id: "not-a-ulid" };
    expect(validateKernelFacts(bad).ok).toBe(false);
    const extra = { ...facts(), provider: "gh" };
    expect(validateKernelFacts(extra).ok).toBe(false);
  });

  test("newRunState starts at the start step with every counter at 0, and validates", () => {
    const state = newRunState({ unit: "gh-1/02", story: "gh-1", workflow: WORKFLOW, mode: "auto" });
    expect(state).toMatchObject({ format: 1, step: "work", attempt: 1, run: null, counters: { "work.back": 0 }, applied_through: 0, mode: "auto" });
    expect(errorsOf(validateRunState(state))).toEqual([]);
    expect(validateRunState({ ...state, format: 2 }).ok).toBe(false);
  });

  test("every receipt kind validates in its minimal form, and an unknown kind does not", () => {
    const pinned = WORKFLOW.pinned;
    const samples: ReceiptData[] = [
      { kind: "run.started", run_id: "r", run_kind: "agent", executor: "claude", attended: false, step: "work", attempt: 1 },
      { kind: "run.reported", run_id: "r", verb: "ask", text: "which?" },
      { kind: "run.ended", run_id: "r", reason: "crash" },
      { kind: "run.classified", run_id: "r", outcome: "silent", rule: "agent.silent.nudge" },
      { kind: "check.finished", run_id: "r", exit: 3, outcome: "stale" },
      { kind: "step.finished", step_kind: "open-pr", outcome: "done", detail: { id: 4 } },
      { kind: "gate.decided", outcome: "approve", by: "a-person" },
      { kind: "answer.sent", input_id: "q1", text: "yes", by: "a-person" },
      { kind: "supervisor.started", run_id: "s", executor: "claude", subject: "gate", step: "ready", attempt: 1 },
      { kind: "supervisor.escalated", run_id: "s", reason: "the question names a merge" },
      { kind: "nudge.sent", run_id: "r", reason: "silent" },
      { kind: "run.resumed", run_id: "r" },
      { kind: "stop.sent", run_id: "r", reason: "timeout" },
      { kind: "run.limited", run_id: "r", resets_at: "2026-11-17T10:00:00.000Z" },
      { kind: "run.snapshot", run_id: "r", failed: "no vcs snapshot" },
      { kind: "run.checking", run_id: "r" },
      { kind: "run.checked", run_id: "r", verdict: "clean" },
      { kind: "round.started", workflow: pinned },
      { kind: "step.moved", to: "work", by: "a-person" },
      { kind: "claim.taken", from: "machine-a", from_expires_at: "2026-11-17T10:00:00.000Z", to: "machine-b", version: 4, by: "machine-b", reason: "a is off" },
      { kind: "branch.update", base: "origin/main", base_sha: "b".repeat(40), from: "a".repeat(40), took: "d".repeat(40), merge: true, by: "a-person", reason: "the base moved" },
      { kind: "branch.updated", base: "origin/main", base_sha: "b".repeat(40), merged: true, from: "a".repeat(40), head: "c".repeat(40), pushed: true, by: "a-person" },
      { kind: "unit.marked", ended: "stuck", reason: "counter qa_loop ran out" },
      { kind: "unit.parked", reason: "gate.park" },
      { kind: "mode.changed", mode: "auto", by: "a-person" },
      { kind: "run.requested", by: "a-person", step: "work", attempt: 1 },
      { kind: "receipt.rejected", seq: 3, reason: "outcome nope is not declared by work" },
    ];
    expect(samples.map((s) => s.kind).sort()).toEqual([...RECEIPT_KINDS].sort());
    for (const s of samples) expect({ kind: s.kind, errors: errorsOf(validateReceiptData(s)) }).toEqual({ kind: s.kind, errors: [] });
    expect(validateReceiptData({ kind: "run.guessed", run_id: "r" }).ok).toBe(false);
    expect(validateReceiptData({ kind: "gate.decided", outcome: "approved", by: "p" }).ok).toBe(false);
    expect(validateReceiptData({ kind: "step.moved", to: "work", by: "p", reset: ["work.back", "work.back"] }).ok).toBe(false);
    expect(validateReceiptData({ kind: "claim.taken", to: "machine-b", by: "machine-b" }).ok).toBe(false);
    expect(validateReceiptData({ kind: "branch.updated", base: "main", base_sha: "b", from: "a", head: "c", by: "p" }).ok).toBe(false);
    expect(validateReceiptData({ kind: "branch.update", base: "main", base_sha: "b", from: "a", by: "p" }).ok).toBe(false);
  });

  test("a done may name the commit its evidence was kept in, each file by the name QA wrote and the path it was kept at; a malformed one does not validate", () => {
    const done = { kind: "run.reported", run_id: "r", verb: "done", outcome: "done" } as const;
    const evidence = { commit: "a".repeat(40), files: [{ name: "AC1.png", kept: "AC1.webp" }, { name: "AC2.png", kept: "AC2.png.webp" }, { name: "AC3.log", kept: "AC3.log" }] };
    expect(errorsOf(validateReceiptData(done))).toEqual([]);
    expect(errorsOf(validateReceiptData({ ...done, evidence }))).toEqual([]);
    const malformed: unknown[] = [
      { commit: "a".repeat(40) },
      { commit: "a".repeat(40), files: [] },
      { commit: "not-a-sha", files: evidence.files },
      { commit: "a".repeat(40), files: [{ name: "AC1.png" }] },
      { commit: "a".repeat(40), files: [{ name: "AC1.png", kept: "" }] },
      { commit: "a".repeat(40), files: [{ name: "AC1.png", kept: "shots/AC1.webp" }] },
      { commit: "a".repeat(40), files: [{ name: "AC1.png", kept: "AC1.webp", size: 3 }] },
      { commit: "a".repeat(40), files: evidence.files, pushed: true },
    ];
    for (const e of malformed) expect({ e, ok: validateReceiptData({ ...done, evidence: e }).ok }).toEqual({ e, ok: false });
  });

  test("a decision carries its unit and rule, and names one of the known action kinds", () => {
    const d: Decision = { kind: "noop", unit: "gh-1", rule: "gate.wait", reason: "waiting for approve or reject" };
    expect(errorsOf(validateDecision(d))).toEqual([]);
    expect(validateDecision({ kind: "noop", unit: "gh-1", reason: "no rule" }).ok).toBe(false);
    expect(ACTION_KINDS).toContain("run_step");
    expect(ACTION_KINDS).not.toContain("run_git");
  });
});

describe("workflow documents", () => {
  /** Shipped workflows, both the bundled copies and this repo's own; a folder this repo does not override may be absent. */
  const dirs = [join(ROOT, "packages", "pack-sdlc", "assets", "workflows"), join(ROOT, ".agents", "workflows")];
  const yamls = (dir: string) => (existsSync(dir) ? readdirSync(dir) : []).filter((n) => n.endsWith(".yaml")).map((n) => join(dir, n));

  test.each(dirs.flatMap(yamls).map((f) => [f.slice(ROOT.length + 1), f]))("%s fits the workflow file schema", (_name, file) => {
    expect(errorsOf(validateWorkflowFile(parse(readFileSync(file, "utf8"))))).toEqual([]);
  });

  test.each(dirs.flatMap((d) => yamls(join(d, "shared"))).map((f) => [f.slice(ROOT.length + 1), f]))("%s fits the shared document schema", (_name, file) => {
    expect(errorsOf(validateSharedWorkflowDocument(parse(readFileSync(file, "utf8"))))).toEqual([]);
  });

  test("an exit route belongs to a shared file only", () => {
    const doc = { name: "w", start: "a", steps: { a: { agent: "x", outcomes: { done: { exit: "out" } } } } };
    expect(validateWorkflowDocument(doc).ok).toBe(false);
    expect(validateWorkflowFile(doc).ok).toBe(false);
    expect(validateSharedWorkflowDocument({ start: "a", steps: doc.steps }).ok).toBe(true);
  });

  test("an outcome object belongs to a file; the document a unit pins keeps routes only under outcomes", () => {
    const doc = { name: "w", start: "a", steps: { a: { agent: "x", outcomes: { done: { to: "$done", means: "finished" } } } } };
    expect(validateWorkflowFile(doc).ok).toBe(true);
    expect(validateWorkflowDocument(doc).ok).toBe(false);
  });
});

describe("decide frame", () => {
  const workflows: KernelWorkflows = { byName: {}, byHash: {} };

  test("decide over no stories and no intake decides nothing", () => {
    expect(decide(facts(), workflows, DEFAULT_KERNEL_CONFIG)).toEqual([]);
  });

  test("ids derive from the tick, so the same facts give the same ids", () => {
    const a = decideContext(facts(), workflows, DEFAULT_KERNEL_CONFIG);
    const b = decideContext(facts(), workflows, DEFAULT_KERNEL_CONFIG);
    const ids = [a.nextId(), a.nextId()];
    expect([b.nextId(), b.nextId()]).toEqual(ids);
    expect(ids[0]).not.toBe(ids[1]);
  });

  test("a second action for one unit is a defect and throws; story-wide actions do not count", () => {
    const out = new Decisions();
    out.add({ kind: "renew_claim", unit: null, rule: "claim.renew", story: "gh-1" });
    out.add({ kind: "noop", unit: "gh-1", rule: "gate.wait", reason: "" });
    expect(out.has("gh-1")).toBe(true);
    expect(() => out.add({ kind: "noop", unit: "gh-1", rule: "unit.corrupt.held", reason: "bad" })).toThrow("decide: second action for gh-1 (unit.corrupt.held)");
    expect(out.all().map((d) => d.rule)).toEqual(["claim.renew", "gate.wait"]);
  });
});
