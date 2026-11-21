import { expect } from "bun:test";
import type { ChangeRequest, ClaimRecord, StoredMessage, TrackerItem } from "@norn/plugin-api";
import {
  type CompiledStep,
  DEFAULT_KERNEL_CONFIG,
  type Decision,
  decide,
  decideContext,
  decideStory,
  decideStoryTail,
  type KernelCapabilities,
  type KernelConfig,
  type KernelFacts,
  type KernelReceipt,
  type KernelWorkflows,
  type LoadedWorkflow,
  newRunState,
  type RunState,
  type StoryFacts,
  type UnitFacts,
  validateDecision,
  type WorkflowGraph,
  type WorkflowLoad,
} from "../../src/index.ts";

export const TICK = "01JD0000000000000000000000";
export const NOW = "2026-11-17T10:00:00.000Z";
export const HOLDER = "machine-a";
export const STORY_HASH = "a".repeat(64);
export const SLICE_HASH = "c".repeat(64);
export const NEXT_HASH = "d".repeat(64);
export const minutesAgo = (m: number): string => new Date(Date.parse(NOW) - m * 60_000).toISOString();
export const minutesAhead = (m: number): string => new Date(Date.parse(NOW) + m * 60_000).toISOString();

const agent = (name: string, done: string): CompiledStep => ({
  name,
  kind: "agent",
  runner: { type: "builtin" },
  outcomes: ["done"],
  routes: { done: { to: done } },
  agent: {
    instructions: "Do it.",
    skills: [],
    inputs: [],
    executor: null,
    attended: false,
    criteria: false,
    hand_back: {},
    writes: "worktree",
    means: {},
    verdict: {},
    deadline_ms: null,
    nudges: 2,
    retries: 1,
  },
});

function workflow(name: string, hash: string, steps: Record<string, CompiledStep>, start: string): LoadedWorkflow {
  const graph: WorkflowGraph = { name, hash, start, stalled_ms: null, steps, counters: {} };
  const doc = { name, start, steps: Object.fromEntries(Object.keys(steps).map((s) => [s, { agent: "Do it.", outcomes: { done: "$done" } }])) };
  return { pinned: { name, hash, doc }, graph };
}

/** The story workflow: plan (agent) → split (slices: done → $done, stuck → $stuck). */
export const STORY_WF = workflow(
  "story",
  STORY_HASH,
  {
    plan: agent("plan", "split"),
    split: { name: "split", kind: "slices", runner: { type: "builtin" }, outcomes: ["done", "stuck"], routes: { done: { to: "$done" }, stuck: { to: "$stuck" } } },
  },
  "plan",
);
export const SLICE_WF = workflow("slice", SLICE_HASH, { build: agent("build", "$done") }, "build");
/** What a person's new round pins. */
export const NEXT_WF = workflow("polish", NEXT_HASH, { polish: agent("polish", "$done") }, "polish");

export function workflows(over: Partial<Record<string, WorkflowLoad>> = {}): KernelWorkflows {
  const byName: Record<string, WorkflowLoad> = { story: { ok: true, workflow: STORY_WF }, slice: { ok: true, workflow: SLICE_WF }, polish: { ok: true, workflow: NEXT_WF } };
  for (const [k, v] of Object.entries(over)) {
    if (v === undefined) delete byName[k];
    else byName[k] = v;
  }
  const byHash: Record<string, LoadedWorkflow> = {};
  for (const w of [STORY_WF, SLICE_WF, NEXT_WF]) byHash[w.pinned.hash] = w;
  return { byName, byHash };
}

export function state(unit: string, step: string, over: Partial<RunState> = {}, wf: LoadedWorkflow = unit.includes("/") ? SLICE_WF : STORY_WF): RunState {
  return { ...newRunState({ unit, story: unit.split("/")[0] as string, workflow: wf }), step, ...over };
}

export function unit(id: string, st: RunState | null, over: Partial<UnitFacts> = {}): UnitFacts {
  return { id, state: st, receipts: [], session: null, version: st ? 3 : null, ...over };
}

export function receipt(seq: number, data: KernelReceipt["data"]): KernelReceipt {
  return { seq, id: `r-${seq}`, at: minutesAgo(1), data };
}

export function claim(over: Partial<ClaimRecord> = {}): ClaimRecord {
  return { story: "gh-1", holder: HOLDER, acquired_at: minutesAgo(60), expires_at: minutesAhead(9), version: 7, ...over };
}

export function item(id: number, over: Partial<TrackerItem> = {}): TrackerItem {
  return { id, key: `gh-${id}`, title: `Item ${id}`, body: "", open: true, assignees: [], labels: [], updated_at: minutesAgo(30), ...over };
}

export function change(over: Partial<ChangeRequest> = {}): ChangeRequest {
  return { id: 5, state: "open", draft: false, head_branch: "gh-1-x", base_branch: "main", head_sha: "abc", title: "X", ...over };
}

export function letter(id: string, data: unknown): StoredMessage {
  return { id, from: "machine-b", at: minutesAgo(2), data };
}

/** A story held by this machine, at plan with nothing to do, unless overridden. */
export function story(over: Partial<StoryFacts> = {}): StoryFacts {
  return { key: "gh-1", item: item(1), change: null, claim: claim(), units: [unit("gh-1", state("gh-1", "plan"))], mailbox: [], ...over };
}

export function caps(over: Partial<KernelCapabilities["store"]> = {}, tracker = true): KernelCapabilities {
  return {
    tracker: tracker ? { assign: true, labels: true, comment: true, create: true, close: true } : null,
    forge: { draft: true, checks: true, raw_urls: true },
    store: { shared: false, claims: "local", mailbox: true, artifacts: true, ...over },
    executors: { claude: { blockStop: true, denyTool: true, injectContext: true, subagents: true, limits: true, paneInput: false, headless: true, attended: true } },
  };
}

export function facts(stories: StoryFacts[], over: Partial<KernelFacts> = {}): KernelFacts {
  return { tick_id: TICK, now: NOW, holder: HOLDER, capabilities: caps(), stories, intake: [], ...over };
}

export const CONFIG: KernelConfig = DEFAULT_KERNEL_CONFIG;

/** The story rules alone (head and tail), every decision checked against the Decision schema. */
export function storyDecisions(s: StoryFacts, f: Partial<KernelFacts> = {}, wfs: KernelWorkflows = workflows(), config: KernelConfig = CONFIG): Decision[] {
  const ctx = decideContext(facts([s], f), wfs, config);
  const out = [...decideStory(s, ctx), ...decideStoryTail(s, ctx)];
  for (const d of out) expect(validateDecision(d).ok).toBe(true);
  return out;
}

/** The whole of decide, every decision checked against the Decision schema. */
export function decideAll(f: KernelFacts, wfs: KernelWorkflows = workflows(), config: KernelConfig = CONFIG): Decision[] {
  const out = decide(f, wfs, config);
  for (const d of out) {
    const v = validateDecision(d);
    if (!v.ok) throw new Error(`invalid decision ${d.rule}: ${JSON.stringify(v.errors)}`);
  }
  return out;
}

export const forUnit = (ds: readonly Decision[], id: string): Decision | undefined => ds.find((d) => d.unit === id);
export const rules = (ds: readonly Decision[]): string[] => ds.map((d) => d.rule);
