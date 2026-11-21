import { expect } from "bun:test";
import {
  type AgentStepSpec,
  type CompiledStep,
  DEFAULT_KERNEL_CONFIG,
  type Decision,
  decideContext,
  decideUnit,
  type ExecutorCapabilities,
  type KernelConfig,
  type KernelFacts,
  type KernelReceipt,
  type LoadedWorkflow,
  newRunState,
  type RunInfo,
  type RunState,
  type SessionFacts,
  type StoryFacts,
  type UnitFacts,
  validateDecision,
  validateRunState,
  type WorkflowGraph,
} from "../../src/index.ts";

export const TICK = "01JD0000000000000000000000";
export const NOW = "2026-11-17T10:00:00.000Z";
export const HASH = "b".repeat(64);
export const minutesAgo = (m: number): string => new Date(Date.parse(NOW) - m * 60_000).toISOString();
export const minutesAhead = (m: number): string => new Date(Date.parse(NOW) + m * 60_000).toISOString();

export function agentSpec(over: Partial<AgentStepSpec> = {}): AgentStepSpec {
  return {
    instructions: "Build it.",
    skills: ["norn-implement"],
    inputs: ["spec"],
    executor: null,
    attended: "none",
    criteria: false,
    hand_back: {},
    writes: "worktree",
    means: {},
    verdict: {},
    deadline_ms: 60 * 60_000,
    nudges: 2,
    retries: 1,
    ...over,
  };
}

/**
 * A workflow with one step of each kind the unit rules know: build (agent) → test (check) → ship
 * (effect plugin) → merged (wait plugin) → approve (gate) → $done.
 */
export function graph(over: Partial<Record<string, Partial<CompiledStep>>> = {}): WorkflowGraph {
  const steps: Record<string, CompiledStep> = {
    build: { name: "build", kind: "agent", runner: { type: "builtin" }, outcomes: ["done"], routes: { done: { to: "test" } }, agent: agentSpec() },
    test: {
      name: "test",
      kind: "check",
      runner: { type: "builtin" },
      outcomes: ["pass", "fail", "flaky"],
      routes: { pass: { to: "ship" }, fail: { to: "build", counter: "test.fail" }, flaky: { to: "test", counter: "test.fail" } },
      check: { command: "bun run test", timeout_ms: 600_000, exits: { "3": "flaky" } },
    },
    ship: { name: "ship", kind: "open-pr", runner: { type: "plugin", mode: "effect" }, outcomes: ["opened"], routes: { opened: { to: "merged" } }, config: { draft: true } },
    merged: {
      name: "merged",
      kind: "await-merge",
      runner: { type: "plugin", mode: "wait" },
      outcomes: ["merged"],
      routes: { merged: { to: "approve" }, stale: { to: "build", counter: "merged.stale" } },
      signals: [{ name: "stale" }],
      config: {},
    },
    approve: {
      name: "approve",
      kind: "gate",
      runner: { type: "builtin" },
      outcomes: ["approve", "reject"],
      routes: { approve: { to: "$done" }, reject: { to: "build", counter: "approve.reject" }, stale: { to: "build", counter: "approve.stale" } },
      signals: [{ name: "stale" }],
      gate: { prompt: "Ship it?" },
    },
  };
  for (const [name, patch] of Object.entries(over)) steps[name] = { ...(steps[name] as CompiledStep), ...patch } as CompiledStep;
  return {
    name: "story",
    hash: HASH,
    start: "build",
    stalled_ms: null,
    steps,
    counters: {
      "test.fail": { max: 5, reset_on: [] },
      "merged.stale": { max: 10, reset_on: [] },
      "approve.reject": { max: 2, reset_on: [] },
      "approve.stale": { max: 10, reset_on: [] },
    },
  };
}

export function loaded(g: WorkflowGraph = graph()): LoadedWorkflow {
  return { pinned: { name: g.name, hash: g.hash, doc: { name: g.name, start: g.start, steps: { build: { agent: "Build it.", outcomes: { done: "$done" } } } } }, graph: g };
}

export function caps(over: Partial<ExecutorCapabilities> = {}): ExecutorCapabilities {
  return { blockStop: true, denyTool: true, injectContext: true, subagents: true, limits: true, paneInput: false, headless: true, attended: true, ...over };
}

export function stateAt(step: string, over: Partial<RunState> = {}, wf: LoadedWorkflow = loaded()): RunState {
  return { ...newRunState({ unit: "gh-1", story: "gh-1", workflow: wf }), step, ...over };
}

export function run(over: Partial<RunInfo> = {}): RunInfo {
  return { id: "run-1", step: "build", attempt: 1, started_at: minutesAgo(5), executor: "claude", attended: false, nudges: 0, ...over };
}

export function session(activity: SessionFacts["activity"], over: Partial<SessionFacts> = {}): SessionFacts {
  return { activity, silent: false, pending_tools: 0, subagents: 0, pane_answers: 0, errors: [], ...over };
}

export function receipt(seq: number, data: KernelReceipt["data"]): KernelReceipt {
  return { seq, id: `r-${seq}`, at: minutesAgo(1), data };
}

export interface Case {
  state: RunState | null;
  session?: SessionFacts | null;
  receipts?: KernelReceipt[];
  step_run?: UnitFacts["step_run"];
  corrupt?: string;
  corrupt_marked?: boolean;
  /** whether the run's process still runs, as probed while its session has sent no event */
  run_alive?: boolean;
  /** the dialog the run's pane shows, as its runner read it */
  run_dialog?: string;
  /** why the kernel refused the run's report the session shows */
  report_rejected?: string;
  unitId?: string;
  story?: Partial<StoryFacts>;
  executors?: Record<string, ExecutorCapabilities>;
  config?: Partial<KernelConfig>;
  workflows?: LoadedWorkflow[];
  /** other units on the record (for capacity) */
  others?: UnitFacts[];
}

export function factsOf(c: Case): KernelFacts {
  const unit: UnitFacts = { id: c.unitId ?? "gh-1", state: c.state, receipts: c.receipts ?? [], session: c.session ?? null, version: 4 };
  if (c.step_run) unit.step_run = c.step_run;
  if (c.corrupt) unit.corrupt = c.corrupt;
  if (c.corrupt_marked) unit.corrupt_marked = true;
  if (c.run_alive !== undefined) unit.run_alive = c.run_alive;
  if (c.run_dialog !== undefined) unit.run_dialog = c.run_dialog;
  if (c.report_rejected !== undefined) unit.report_rejected = c.report_rejected;
  const story: StoryFacts = { key: "gh-1", item: null, change: null, claim: null, units: [unit], mailbox: [], ...c.story };
  const others: StoryFacts[] = (c.others ?? []).map((u, i) => ({ key: `gh-${i + 10}`, item: null, change: null, claim: null, units: [u], mailbox: [] }));
  return {
    tick_id: TICK,
    now: NOW,
    holder: "machine-a",
    capabilities: {
      tracker: null,
      forge: null,
      store: { shared: false, claims: "local", mailbox: true, artifacts: true },
      executors: c.executors ?? { claude: caps() },
    },
    stories: [story, ...others],
    intake: [],
  };
}

/** Run the unit rules on the case's unit; every decision must validate against the Decision schema. */
export function decideCase(c: Case): Decision | null {
  const facts = factsOf(c);
  const wfs = c.workflows ?? [loaded()];
  const workflows = { byName: {}, byHash: Object.fromEntries(wfs.map((w) => [w.pinned.hash, w])) };
  const config: KernelConfig = { ...DEFAULT_KERNEL_CONFIG, mode: "auto", ...c.config };
  const ctx = decideContext(facts, workflows, config);
  const story = facts.stories[0] as StoryFacts;
  const d = decideUnit(story, story.units[0] as UnitFacts, ctx);
  if (d) {
    const v = validateDecision(d);
    expect(v.ok ? [] : v.errors).toEqual([]);
    if (d.kind === "apply_receipts") {
      const s = validateRunState(d.state);
      expect(s.ok ? [] : s.errors).toEqual([]);
    }
  }
  return d;
}

export function kindOf<K extends Decision["kind"]>(d: Decision | null, kind: K): Extract<Decision, { kind: K }> {
  expect(d?.kind).toBe(kind);
  return d as Extract<Decision, { kind: K }>;
}
