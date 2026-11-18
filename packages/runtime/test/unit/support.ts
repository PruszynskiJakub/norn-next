/**
 * A tick host over in-memory parts: the real local store on memory files, and fakes for the tracker,
 * forge, vcs, harness, launcher and session source that record every call and answer from what a test
 * sets. Ticks run with a fixed id sequence and a clock the test moves, so a test reads as the moments
 * of a story.
 */
import { type ExecScript, manualClock, memoryFiles, memoryHost, scriptedExec } from "@norn/conformance";
import { DEFAULT_KERNEL_CONFIG, decide, type KernelConfig, type SessionFacts } from "@norn/kernel";
import {
  type ChangeRequest,
  defineNornPlugin,
  fail,
  type Forge,
  type Harness,
  type HostContext,
  type NornPlugin,
  ok,
  type PluginResult,
  type StepKindDefinition,
  type StepKindOutcome,
  type Tracker,
  type TrackerItem,
  type Vcs,
  type VcsUnfinished,
} from "@norn/plugin-api";
import { deriveUlid } from "@norn/schema";
import { localStorePlugin } from "@norn/store-local";
import { Type } from "@sinclair/typebox";
import {
  type AgentLauncher,
  type AgentRunRequest,
  createRuntimeEnv,
  gatherFacts,
  type Runtime,
  type RuntimeConfig,
  type RuntimeEnv,
  type SessionSource,
  type TickContext,
  tick,
} from "../../src/index.ts";

export const START = "2026-11-17T09:00:00.000Z";
export const MINUTE = 60_000;
const SEED = "01JD5G00000000000000000000";

export function trackerItem(id: number, over: Partial<TrackerItem> = {}): TrackerItem {
  return { id, key: `lt-${id}`, title: `Story ${id}`, body: "", open: true, assignees: ["me"], labels: ["norn"], updated_at: START, ...over };
}

/** A tracker over a list the test edits; it closes an item and performs nothing else. */
export function fakeTracker(items: TrackerItem[]): Tracker {
  return {
    name: "fake",
    keyPrefix: "lt",
    capabilities: { assign: true, labels: true, comment: true, create: true, close: true },
    whoami: async () => ok("me"),
    intake: async (q) => ok(items.filter((i) => i.open && i.labels.includes(q.label))),
    get: async (id) => ok(items.find((i) => i.id === id) ?? null),
    perform: async (effect) => {
      if (effect.kind !== "close") return fail("invalid", `the fake tracker performs no ${effect.kind}`);
      const i = items.findIndex((x) => x.id === effect.id);
      if (i < 0) return fail("not_found", `no item ${effect.id}`);
      items[i] = { ...(items[i] as TrackerItem), open: false };
      return ok({ kind: "close", id: effect.id, replayed: false });
    },
  };
}

/** A forge whose changes are a map by branch the test edits. */
export function fakeForge(changes: Record<string, ChangeRequest>): Forge {
  return {
    name: "fake",
    capabilities: { draft: true, checks: true, raw_urls: false },
    findChanges: async (branches) => ok(Object.fromEntries(branches.map((b) => [b, changes[b] ?? null]))),
    checks: async () => ok("none"),
    perform: async () => fail("invalid", "the fake forge performs nothing"),
  };
}

export interface VcsCall {
  op: string;
  args: unknown[];
}

/**
 * A vcs with worktrees under the data dir, heads from a map, and every call recorded but `unfinished`
 * and `uncommitted`, which answer from `stopped` and `dirty` by checkout path.
 */
export function fakeVcs(ctx: HostContext, heads: Record<string, string>, calls: VcsCall[], stopped: Record<string, VcsUnfinished> = {}, dirty: Record<string, string[]> = {}): Vcs {
  const path = (unit: string) => `${ctx.repo.dataDir}/worktrees/${unit.replace("/", "-")}`;
  const call = <T>(op: string, args: unknown[], value: T): Promise<PluginResult<T>> => {
    calls.push({ op, args });
    return Promise.resolve(ok(value));
  };
  return {
    name: "fake",
    capabilities: { worktrees: true, merge: true, push: false },
    worktree: {
      path,
      ensure: (unit, branch, base) => call("ensure", [unit, branch, base], { path: path(unit) }),
      remove: (unit) => call("remove", [unit], undefined),
    },
    head: (ref) => call("head", [ref], heads[ref] ?? null),
    isAncestor: (a, b) => call("isAncestor", [a, b], a === b),
    mergeBase: (a, b) => call("mergeBase", [a, b], null),
    merge: (branch, from) => call("merge", [branch, from], { head: `${branch}+${from}` }),
    unfinished: (path) => Promise.resolve(ok(stopped[path] ?? null)),
    uncommitted: (path) => Promise.resolve(ok(dirty[path] ?? [])),
    push: (branch) => call("push", [branch], undefined),
    fetch: () => call("fetch", [], undefined),
  };
}

const HARNESS: Harness = {
  name: "fake",
  capabilities: { blockStop: true, denyTool: true, injectContext: true, subagents: true, limits: true, paneInput: false },
  install: async () => ({ changed: [] }),
  uninstall: async () => ({ changed: [] }),
  launch: () => {
    throw new Error("the fake harness launches nothing");
  },
  normalize: () => [],
  respond: () => ({ stdout: "", exit_code: 0 }),
};

export interface LauncherCall {
  op: "start" | "nudge" | "answer" | "stop";
  args: unknown[];
}

/** A launcher that records every call; `failStart` makes the next starts for a unit fail or throw, `failAnswers` every answer fail. */
export class FakeLauncher implements AgentLauncher {
  readonly modes = { headless: true, attended: true };
  readonly calls: LauncherCall[] = [];
  readonly failStart = new Map<string, "fail" | "throw">();
  failAnswers = false;

  async start(run: AgentRunRequest) {
    this.calls.push({ op: "start", args: [run] });
    const failing = this.failStart.get(run.unit);
    if (failing === "throw") throw new Error(`launch of ${run.unit} crashed`);
    if (failing === "fail") return fail<{ handle: string }>("unavailable", `launch of ${run.unit} failed`);
    return ok({ handle: `h-${run.run_id}` });
  }
  async nudge(handle: string, text: string, promptId: string) {
    this.calls.push({ op: "nudge", args: [handle, text, promptId] });
    return ok(undefined);
  }
  async answer(handle: string, inputId: string, text: string) {
    this.calls.push({ op: "answer", args: [handle, inputId, text] });
    if (this.failAnswers) return fail<void>("unavailable", `session ${handle} is gone`);
    return ok(undefined);
  }
  async stop(handle: string) {
    this.calls.push({ op: "stop", args: [handle] });
    return ok(undefined);
  }
  of(op: LauncherCall["op"]): unknown[][] {
    return this.calls.filter((c) => c.op === op).map((c) => c.args);
  }
}

/** Sessions by unit, answered for whatever run is current: a test sets what the agent is doing. */
export class FakeSessions implements SessionSource {
  readonly byUnit = new Map<string, SessionFacts>();
  facts(unit: string): SessionFacts | null {
    return this.byUnit.get(unit) ?? null;
  }
}

export const session = (activity: SessionFacts["activity"], over: Partial<SessionFacts> = {}): SessionFacts => ({
  activity,
  silent: false,
  pending_tools: 0,
  subagents: 0,
  pane_answers: 0,
  errors: [],
  ...over,
});

export interface StepCall {
  kind: string;
  input: unknown;
}

/** A queued step answer: an outcome, `!fail`, or an outcome with the detail the kind records with it. */
export type StepAnswer = string | StepKindOutcome;

/** Step kinds that answer from a queue per kind (the last answer repeats), recording each input. */
export function fakeStepKinds(answers: Record<string, StepAnswer[]>, calls: StepCall[]): Record<string, StepKindDefinition> {
  const kind = (name: string, mode: "effect" | "wait", outcomes: string[]): StepKindDefinition => ({
    name,
    configSchema: Type.Object({ note: Type.Optional(Type.String()) }, { additionalProperties: false }),
    outcomes,
    mode,
    run: async (input) => {
      calls.push({ kind: name, input });
      const queue = answers[name] ?? [];
      const answer = queue.length > 1 ? (queue.shift() as StepAnswer) : (queue[0] ?? (outcomes[0] as string));
      if (answer === "!fail") return fail("unavailable", `${name} failed`);
      return ok(typeof answer === "string" ? { outcome: answer } : answer);
    },
  });
  return {
    probe: kind("probe", "effect", ["done", "conflict"]),
    "await-thing": kind("await-thing", "wait", ["ready"]),
    // named as the vcs plugin's kind, so the inputs that read the base update's receipts find it
    "update-branch": kind("update-branch", "effect", ["done", "conflict"]),
  };
}

/** The workflows the tests run: a check, an agent step, a plugin effect and wait, a gate, a slices step. */
export const WORKFLOWS: Record<string, string> = {
  "checked.yaml": "name: checked\nstart: test\nsteps:\n  test:\n    check: bun test\n    timeout: 5m\n    exits: { 3: flaky }\n    outcomes: { pass: $done, fail: $stuck, flaky: $stuck }\n",
  "agented.yaml": [
    "name: agented",
    "start: build",
    "steps:",
    "  build:",
    "    agent: Build the thing.",
    "    skills: [norn-implement]",
    "    outcomes: { done: $done }",
    "    means: { done: the thing is built }",
    "",
  ].join("\n"),
  "handed.yaml": [
    "name: handed",
    "start: build",
    "steps:",
    "  build:",
    "    agent: Build the thing.",
    "    inputs: [spec, handoff, last_check]",
    "    outcomes: { done: review }",
    "  review:",
    "    agent: Review the thing.",
    "    inputs: [spec, handoff, last_findings, diff, mystery]",
    "    outcomes: { done: $done }",
    "",
  ].join("\n"),
  "stepped.yaml": [
    "name: stepped",
    "start: poke",
    "steps:",
    "  poke:",
    "    probe: null",
    "    note: hi",
    "    outcomes: { done: wait, conflict: $stuck }",
    "  wait:",
    "    await-thing: null",
    "    outcomes: { ready: approve }",
    "  approve:",
    "    gate: Approve it.",
    "    outcomes: { approve: $done, reject: $stuck }",
    "",
  ].join("\n"),
  "gated.yaml": [
    "name: gated",
    "start: ready",
    "steps:",
    "  ready:",
    "    gate: Ready?",
    "    outcomes: { approve: $done, reject: build }",
    "  build:",
    "    agent: Build the thing.",
    "    outcomes: { done: ready }",
    "",
  ].join("\n"),
  "resolving.yaml": [
    "name: resolving",
    "start: update",
    "steps:",
    "  update:",
    "    update-branch: null",
    "    outcomes: { done: $done, conflict: resolve }",
    "  resolve:",
    "    agent: Merge the base commit the base_side input names.",
    "    inputs: [base_side]",
    "    outcomes: { done: update }",
    "",
  ].join("\n"),
  "sliced.yaml": "name: sliced\nstart: split\nsteps:\n  split:\n    slices:\n    outcomes: { done: $done, stuck: $stuck }\n",
  "based.yaml": [
    "name: based",
    "start: ready",
    "steps:",
    "  ready:",
    "    gate: Ready?",
    "    outcomes: { approve: $done, reject: $stuck, stale: test }",
    "  test:",
    "    check: bun test",
    "    timeout: 5m",
    "    outcomes: { pass: ready, fail: $stuck }",
    "base: { stale: conflict, verify: test }",
    "",
  ].join("\n"),
};

export interface Harnessed {
  ctx: HostContext;
  files: ReturnType<typeof memoryFiles>;
  clock: ReturnType<typeof manualClock>;
  exec: ReturnType<typeof scriptedExec>;
  items: TrackerItem[];
  changes: Record<string, ChangeRequest>;
  heads: Record<string, string>;
  vcsCalls: VcsCall[];
  /** operations stopped half-way, by checkout path, as the fake vcs reports them */
  stopped: Record<string, VcsUnfinished>;
  /** paths holding uncommitted changes, by checkout path, as the fake vcs reports them */
  dirty: Record<string, string[]>;
  stepCalls: StepCall[];
  stepAnswers: Record<string, StepAnswer[]>;
  launcher: FakeLauncher;
  sessions: FakeSessions;
  plugins: NornPlugin[];
  config: RuntimeConfig;
  env: RuntimeEnv;
  runtime: Runtime;
  /** the ids the ticks so far ran under */
  tickIds: string[];
}

/**
 * A host's detached processes, faked: a spawn starts nothing and records its argv; a test ends a
 * process by writing its exit (as the check wrapper would) or by marking it dead.
 */
export class FakeProcesses {
  readonly spawned: { pid: number; argv: string[]; cwd: string; logPath: string }[] = [];
  readonly dead = new Set<number>();
  /** each pid signalled, once */
  readonly killed: number[] = [];
  /** every signal sent, in order */
  readonly signals: [number, string][] = [];
  failSpawn = false;
  private next = 100;

  readonly host = {
    spawn: async (argv: string[], opts: { cwd: string; logPath: string }) => {
      if (this.failSpawn) throw new Error("spawn sh ENOENT");
      const pid = this.next++;
      this.spawned.push({ pid, argv, cwd: opts.cwd, logPath: opts.logPath });
      return { pid, started: `start-${pid}` };
    },
    alive: async (pid: number, started?: string) => !this.dead.has(pid) && this.spawned.some((p) => p.pid === pid) && (started === undefined || started === `start-${pid}`),
    kill: async (pid: number, signal?: string) => {
      this.signals.push([pid, signal ?? "TERM"]);
      if (!this.killed.includes(pid)) this.killed.push(pid);
      this.dead.add(pid);
    },
  };
}

export interface HarnessOptions {
  workflow?: string;
  kernel?: Partial<KernelConfig>;
  exec?: ExecScript;
  /** give the host detached processes, so checks run outside the tick */
  processes?: FakeProcesses;
}

export function harness(opts: HarnessOptions = {}): Harnessed {
  const files = memoryFiles();
  const clock = manualClock(START);
  const exec = scriptedExec(opts.exec ?? ((argv) => (argv[0] === "sh" ? { code: 0, stdout: "ok" } : undefined)));
  const base = memoryHost({ files, exec, now: clock.now, repo: { root: "/repo", dataDir: "/machine/repo" } });
  const ctx: HostContext = opts.processes ? { ...base, ...opts.processes.host } : base;
  const items: TrackerItem[] = [];
  const changes: Record<string, ChangeRequest> = {};
  const heads: Record<string, string> = {};
  const vcsCalls: VcsCall[] = [];
  const stopped: Record<string, VcsUnfinished> = {};
  const dirty: Record<string, string[]> = {};
  const stepCalls: StepCall[] = [];
  const stepAnswers: Record<string, StepAnswer[]> = {};
  const launcher = new FakeLauncher();
  const sessions = new FakeSessions();
  const providers = defineNornPlugin({
    name: "fakes",
    api: "^1.4",
    provides: {
      tracker: { fake: { configSchema: Type.Object({}), create: () => fakeTracker(items) } },
      forge: { fake: { configSchema: Type.Object({}), create: () => fakeForge(changes) } },
      vcs: { fake: { configSchema: Type.Object({}), create: (c: HostContext) => fakeVcs(c, heads, vcsCalls, stopped, dirty) } },
      harness: { fake: HARNESS },
      stepKinds: fakeStepKinds(stepAnswers, stepCalls),
      packs: { test: { workflows: WORKFLOWS, shared: {}, skills: {} } },
    },
  });
  const plugins: NornPlugin[] = [providers, localStorePlugin];
  const config: RuntimeConfig = {
    tracker: { name: "fake" },
    forge: { name: "fake" },
    store: { name: "local" },
    vcs: { name: "fake" },
    executors: { claude: { name: "fake" } },
    pack: "test",
    kernel: { ...DEFAULT_KERNEL_CONFIG, mode: "auto", workflow: opts.workflow ?? "checked", ...opts.kernel },
    intake: { label: "norn", assignee: "me" },
    base: "main",
    holder: "machine-a",
  };
  const tickIds: string[] = [];
  const built = createRuntimeEnv({ ctx, plugins, config, launcher, sessions });
  if (!built.ok) throw new Error(built.failure.message);
  const env = built.value;
  const nextId = () => {
    const id = deriveUlid(SEED, tickIds.length);
    tickIds.push(id);
    return id;
  };
  const runtime: Runtime = { tick: () => tick(env, nextId()) };
  return { ctx, files, clock, exec, items, changes, heads, vcsCalls, stopped, dirty, stepCalls, stepAnswers, launcher, sessions, plugins, config, env, runtime, tickIds };
}

export type Report = Awaited<ReturnType<Runtime["tick"]>>;

/** Each outcome as `unit rule` with `!error` when it failed: what a test reads a tick by. */
export const rulesOf = (r: Report): string[] => r.outcomes.map((o) => `${o.decision.unit ?? "-"} ${o.decision.rule}${o.ok ? "" : ` !${o.error}`}`);

/** Tick (a minute apart) until `done` holds, or throw after `max` ticks with the last tick's rules. */
export async function tickUntil(h: Harnessed, done: (r: Report) => boolean | Promise<boolean>, max = 20): Promise<Report[]> {
  const reports: Report[] = [];
  for (let i = 0; i < max; i++) {
    const r = await h.runtime.tick();
    reports.push(r);
    h.clock.advance(MINUTE);
    if (await done(r)) return reports;
  }
  throw new Error(`no convergence after ${max} ticks; last: ${JSON.stringify(rulesOf(reports.at(-1) as Report))}`);
}

/** A unit's record as the journal reads it. */
export async function record(h: Harnessed, unit: string) {
  const read = await h.env.journal.readUnit(unit);
  if (!read.ok) throw new Error(read.failure.message);
  return read.value;
}

export const has = (rule: string) => (r: Report) => r.outcomes.some((o) => o.decision.rule === rule);

/** The facts and decisions a tick would act on now, without acting: for replaying one decision by hand. */
export async function decided(h: Harnessed, n = 900) {
  const tickId = deriveUlid(SEED, n);
  const gathered = await gatherFacts(h.env, tickId);
  if (!gathered.ok) throw new Error(gathered.failure.message);
  const t: TickContext = { env: h.env, tickId, facts: gathered.value.facts, workflows: gathered.value.workflows };
  return { t, decisions: decide(structuredClone(t.facts), t.workflows, h.env.config.kernel) };
}

/** The one decision of `rule` decide would make now. */
export async function decisionOf(h: Harnessed, rule: string, n = 900) {
  const { t, decisions } = await decided(h, n);
  const d = decisions.find((x) => x.rule === rule);
  if (!d) throw new Error(`no ${rule} decision; decide made ${decisions.map((x) => `${x.unit}:${x.rule}`).join(", ")}`);
  return { t, d, index: decisions.indexOf(d) };
}
