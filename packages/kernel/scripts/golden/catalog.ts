/**
 * What every golden scenario starts from: the shipped workflows as pinned documents, the step kinds
 * their plugins declare, the capabilities of a typical setup (an issue tracker, a forge, a local
 * store, one harness that runs headless and attended), and helpers to put a story at a given step.
 */
import type { ClaimRecord, TrackerItem } from "@norn/plugin-api";
import { DEFAULT_KERNEL_CONFIG, type KernelCapabilities, type KernelConfig, newRunState, type RunInfo, type RunState, type ExecutorCapabilities } from "../../src/index.ts";
import { caseWorkflows, type GoldenCase, type GoldenStepKind, type GoldenWorkflows } from "../../test/golden.ts";
import { loadShipped, STEP_KINDS } from "../../test/shipped.ts";
import { type SimStory, type SimUnit, type Tick, World } from "./world.ts";

export const START = "2026-11-17T09:00:00.000Z";
export const HOLDER = "machine-a";

export const GOLDEN_STEP_KINDS: Record<string, GoldenStepKind> = Object.fromEntries(
  Object.entries(STEP_KINDS).map(([name, k]) => [name, { outcomes: [...k.outcomes], mode: k.mode, configSchema: JSON.parse(JSON.stringify(k.configSchema)) }]),
);

/** The shipped workflows a story or slice takes, as flat pinned documents. */
export function shippedFiles(...names: string[]): Record<string, unknown> {
  return Object.fromEntries(names.map((n) => [n, loadShipped(n).pinned.doc]));
}

/** A small workflow whose agent step routes the outcomes norn classifies, so their `route` rules fire. */
export const ROUTED_DOC = {
  name: "routed",
  description: "An agent step that routes every outcome norn classifies to a person.",
  start: "work",
  steps: {
    work: {
      agent: "Do the work.",
      skills: ["norn-implement"],
      outcomes: { done: "$done", silent: "triage", died: "triage", timeout: "triage", ask: "triage" },
      means: { done: "the work is done" },
    },
    triage: { gate: "The agent stopped. Approve to end the round, or reject to leave it stuck.", outcomes: { approve: "$done", reject: "$stuck" } },
  },
};

/** A workflow whose design step reads a source the workflow gives no path, which a machine binds in its config. */
export const SOURCED_DOC = {
  name: "sourced",
  description: "A design step that reads the brand assets, a source each machine binds.",
  start: "design",
  sources: { brand: { type: "folder" } },
  steps: {
    design: { agent: "Design the page from the brand assets.", inputs: ["spec", "brand"], outcomes: { done: "$done" } },
  },
};

/** A workflow whose step names a step kind no configured plugin provides. */
export const DEPLOY_DOC = {
  name: "deploy",
  start: "build",
  steps: {
    build: { agent: "Build it.", outcomes: { done: "ship" } },
    ship: { deploy: null, outcomes: { done: "$done" } },
  },
};

export function executor(over: Partial<ExecutorCapabilities> = {}): ExecutorCapabilities {
  return { blockStop: true, denyTool: true, injectContext: true, subagents: true, limits: true, paneInput: false, headless: true, attended: true, ...over };
}

export function capabilities(over: { store?: Partial<KernelCapabilities["store"]>; executors?: KernelCapabilities["executors"]; tracker?: boolean } = {}): KernelCapabilities {
  return {
    tracker: over.tracker === false ? null : { assign: true, labels: true, comment: true, create: true, close: true },
    forge: { draft: true, checks: true, raw_urls: true },
    store: { shared: false, claims: "local", mailbox: true, artifacts: true, ...over.store },
    executors: over.executors ?? { claude: executor() },
  };
}

export function config(over: Partial<KernelConfig> = {}): KernelConfig {
  return { ...DEFAULT_KERNEL_CONFIG, mode: "auto", ...over };
}

export function item(id: number, title: string, over: Partial<TrackerItem> = {}): TrackerItem {
  return { id, key: `gh-${id}`, title, body: "", open: true, assignees: [], labels: ["norn"], updated_at: START, ...over };
}

export interface WorldSetup {
  files: Record<string, unknown>;
  pinned?: unknown[];
  capabilities?: KernelCapabilities;
  config?: KernelConfig;
  holder?: string;
}

/** A world and the catalog its cases record, loaded exactly as a replay loads it. */
export function world(setup: WorldSetup): World {
  const cat = catalogOf(setup);
  const w = new World(setup.holder ?? HOLDER, setup.capabilities ?? capabilities(), caseWorkflows(cat), cat.config, START);
  catalogs.set(w, cat);
  return w;
}

type Catalog = Pick<GoldenCase, "step_kinds" | "workflows" | "config">;
const catalogs = new WeakMap<World, Catalog>();

function catalogOf(setup: WorldSetup): Catalog {
  const workflows: GoldenWorkflows = { files: structuredClone(setup.files), pinned: structuredClone(setup.pinned ?? []) };
  return { step_kinds: GOLDEN_STEP_KINDS, workflows, config: setup.config ?? config() };
}

/** A golden case from one of a world's ticks. */
export function caseOf(w: World, t: Tick, name: string, description: string): GoldenCase {
  const cat = catalogs.get(w);
  if (!cat) throw new Error("a world not made by world()");
  return { name, description, step_kinds: cat.step_kinds, workflows: cat.workflows, config: cat.config, facts: t.facts, decisions: t.decisions };
}

export function claim(w: World, key: string, over: Partial<ClaimRecord> = {}): ClaimRecord {
  return { story: key, holder: w.holder, acquired_at: w.iso(w.now - 60_000), expires_at: w.iso(w.now + 9 * 60_000), version: 3, ...over };
}

export interface Seed {
  /** the workflow the unit pinned, by file name; default `story` */
  workflow?: string;
  step: string;
  /** a run on the record at the step (started minutes ago); absent: no run */
  run?: Partial<RunInfo> & { minutesAgo?: number };
  state?: Partial<RunState>;
  claim?: ClaimRecord | null;
  item?: TrackerItem | null;
  unit?: string;
}

/**
 * A story already under way: its unit at `step` of its pinned workflow, the run (if any) on the
 * record through its `run.started` receipt, applied. Facts then read as a host finds them mid-round.
 */
export function seed(w: World, key: string, s: Seed): SimUnit {
  const id = s.unit ?? key;
  let story = w.stories.find((x) => x.key === key);
  if (!story) {
    const n = Number(key.split("-")[1]);
    story = { key, item: s.item === undefined ? item(n, `Story ${n}`) : s.item, change: null, claim: s.claim === undefined ? claim(w, key) : s.claim, units: [], mailbox: [] } satisfies SimStory;
    w.stories.push(story);
  }
  const load = w.workflows.byName[s.workflow ?? "story"];
  if (!load?.ok) throw new Error(`workflow ${s.workflow} is not loaded`);
  const base = newRunState({ unit: id, story: key, workflow: load.workflow });
  const u: SimUnit = { id, state: null, version: 1, receipts: [], session: null };
  let state: RunState = { ...base, step: s.step, attempt: 1, visits: { [s.step]: 1 }, ...s.state };
  if (s.run) {
    const { minutesAgo = 5, ...run } = s.run;
    const info: RunInfo = { id: `run-${id.replace("/", "-")}-1`, step: s.step, attempt: state.attempt, started_at: w.iso(w.now - minutesAgo * 60_000), executor: "claude", attended: false, nudges: 0, ...run };
    const kind = load.workflow.graph.steps[s.step]?.kind;
    const runKind = kind === "agent" ? "agent" : kind === "check" ? "check" : "step";
    u.receipts.push({ seq: 1, id: `${info.id}-started`, at: info.started_at, data: { kind: "run.started", run_id: info.id, run_kind: runKind, executor: info.executor, attended: info.attended, step: s.step, attempt: state.attempt } });
    state = { ...state, run: info, applied_through: 1 };
    u.version = 2;
  }
  u.state = state;
  story.units.push(u);
  return u;
}
