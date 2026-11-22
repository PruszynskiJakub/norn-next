/**
 * The tick host over real parts: a bare repo stands in for the team's remote, each clone is a
 * machine with its own host, and the real tracker, forge, store and vcs plugins run against them.
 * Only the agent is scripted: when a run starts, a scripted agent does its step's work in the unit's
 * worktree (a commit, a file) between ticks and reports it with the receipt `norn done` writes.
 */
import { afterAll } from "bun:test";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { manualClock } from "@norn/conformance";
import { forgeNonePlugin } from "@norn/forge-none";
import { createNodeHost } from "@norn/host-node";
import { DEFAULT_KERNEL_CONFIG, Journal, type KernelConfig, type ReceiptData, type SessionFacts } from "@norn/kernel";
import { SDLC_PACK } from "@norn/pack-sdlc";
import { createStore, defineNornPlugin, fail, type Harness, type HostContext, type NornPlugin, ok, type PluginResult, type Store, type StoreFactory } from "@norn/plugin-api";
import { ulid } from "@norn/schema";
import { localStorePlugin } from "@norn/store-local";
import { refsStorePlugin } from "@norn/store-refs";
import { localTrackerPlugin } from "@norn/tracker-local";
import { vcsGitPlugin } from "@norn/vcs-git";
import { type AgentLauncher, type AgentRunRequest, createRuntimeEnv, newTickId, type RuntimeConfig, type RuntimeEnv, type SessionSource, stepsForgePlugin, type TickReport, tick } from "../../src/index.ts";

export const START = "2026-11-17T09:00:00.000Z";
export const MINUTE = 60_000;

const made: string[] = [];
afterAll(() => {
  for (const d of made.splice(0)) rmSync(d, { recursive: true, force: true });
});

export async function git(cwd: string, ...args: string[]): Promise<string> {
  const host = createNodeHost({ root: cwd, dataDir: cwd });
  const out = await host.exec(["git", ...args], { cwd });
  if (out.code !== 0) throw new Error(`git ${args.join(" ")} in ${cwd}: ${out.stderr}`);
  return out.stdout.trim();
}

/** Write `files` under `cwd` and commit them on its branch. */
export async function commit(cwd: string, message: string, files: Record<string, string>): Promise<string> {
  for (const [name, text] of Object.entries(files)) {
    mkdirSync(dirname(join(cwd, name)), { recursive: true });
    writeFileSync(join(cwd, name), text);
  }
  await git(cwd, "add", "-A");
  await git(cwd, "commit", "-q", "-m", message);
  return git(cwd, "rev-parse", "HEAD");
}

async function identify(cwd: string): Promise<void> {
  await git(cwd, "config", "user.name", "Test");
  await git(cwd, "config", "user.email", "test@example.com");
  await git(cwd, "config", "commit.gpgsign", "false");
}

/**
 * The check every test step runs: red while the tree holds a `broken` file, so a scripted agent
 * breaks or mends the build by what it commits.
 */
const CHECK_SCRIPT = 'if [ -f broken ]; then echo "broken is present"; exit 1; fi\necho ok\n';

export interface Team {
  dir: string;
  remote: string;
  /** a folder every machine's local tracker reads, so two machines see one item */
  trackerDir: string;
  /** a new clone of the remote, as one more machine's checkout */
  clone(name: string): Promise<string>;
}

export async function team(): Promise<Team> {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), "norn-runtime-")));
  made.push(dir);
  const remote = join(dir, "remote.git");
  await git(dir, "init", "-q", "--bare", "-b", "main", remote);
  const seed = join(dir, "seed");
  await git(dir, "init", "-q", "-b", "main", seed);
  await identify(seed);
  await git(seed, "remote", "add", "origin", remote);
  await commit(seed, "initial", { "README.md": "hello\n", "check.sh": CHECK_SCRIPT });
  await git(seed, "push", "-q", "-u", "origin", "main");
  return {
    dir,
    remote,
    trackerDir: join(dir, "tracker"),
    clone: async (name) => {
      const path = join(dir, name);
      await git(dir, "clone", "-q", remote, path);
      await identify(path);
      return path;
    },
  };
}

/**
 * The shipped pack as a repo would install it: on forge none the wait for the PR's checks passes at
 * once. The test command is the config's `checks.test`.
 */
function localPack(): NornPlugin {
  return defineNornPlugin({ name: "test-pack", api: "^1.4", provides: { packs: { local: { workflows: { ...SDLC_PACK.workflows, ...WORKFLOWS }, shared: { ...SDLC_PACK.shared }, skills: {} } } } });
}

/** A shorter story for what quick's length would only slow down: build, check, gate, ship. */
const WORKFLOWS: Record<string, string> = {
  "short.yaml": [
    "name: short",
    "start: build",
    "steps:",
    "  build:",
    "    agent: Build the thing.",
    "    outcomes: { done: test }",
    "    means: { done: the thing is built }",
    "  test:",
    "    check: sh check.sh",
    "    timeout: 1m",
    "    outcomes: { pass: ready, fail: build }",
    "  ready:",
    "    gate: Approve to open the change.",
    "    outcomes: { approve: open-pr, reject: build }",
    "  open-pr:",
    "    open-pr:",
    "    outcomes: { done: merge }",
    "  merge:",
    "    await-merge:",
    "    outcomes: { merged: $done, stale: build, unpushed: open-pr }",
    "",
  ].join("\n"),
};

const HARNESS: Harness = {
  name: "scripted",
  capabilities: { blockStop: true, denyTool: true, injectContext: true, subagents: true, limits: true, paneInput: false },
  install: async () => ({ changed: [] }),
  uninstall: async () => ({ changed: [] }),
  launch: () => {
    throw new Error("the scripted harness is launched through the scripted launcher");
  },
  normalize: () => [],
  respond: () => ({ stdout: "", exit_code: 0 }),
};

const harnessPlugin = defineNornPlugin({ name: "test-harness", api: "^1.4", provides: { harness: { scripted: HARNESS } } });

/** What a scripted agent does for one run: the files it commits (none: it commits nothing) and the outcome it reports. */
export interface AgentWork {
  commit?: Record<string, string>;
  outcome: string;
}

/** The agent's script: what it does in a step, by the step and how many times that step ran before. */
export type AgentScript = (step: string, visit: number, run: AgentRunRequest) => AgentWork;

/**
 * The launcher as a runner would be: `start` hands the run to an agent that works between ticks. It
 * is deliberately not idempotent, so a test sees every launch the runtime asked for.
 */
export class ScriptedAgents implements AgentLauncher, SessionSource {
  readonly modes = { headless: true, attended: true };
  readonly starts: AgentRunRequest[] = [];
  readonly stops: string[] = [];
  readonly nudges: string[] = [];
  private readonly pending: AgentRunRequest[] = [];
  private readonly reported = new Set<string>();
  private readonly visits = new Map<string, number>();

  constructor(
    private readonly script: AgentScript,
    private readonly reporter: () => Journal,
  ) {}

  async start(run: AgentRunRequest): Promise<PluginResult<{ handle: string }>> {
    this.starts.push(structuredClone(run));
    this.pending.push(run);
    return ok({ handle: `h-${run.run_id}` });
  }
  async nudge(handle: string): Promise<PluginResult<void>> {
    this.nudges.push(handle);
    return ok(undefined);
  }
  async answer(): Promise<PluginResult<void>> {
    return fail("invalid", "the scripted agents ask nothing");
  }
  async stop(handle: string): Promise<PluginResult<void>> {
    this.stops.push(handle);
    return ok(undefined);
  }

  /** A started run is working until its agent reports; the report itself goes in as a receipt. */
  facts(_unit: string, runId: string): SessionFacts | null {
    if (!this.starts.some((r) => r.run_id === runId)) return null;
    return { activity: this.reported.has(runId) ? "ended" : "working", silent: false, pending_tools: 0, subagents: 0, pane_answers: 0, errors: [] };
  }

  /** Every started run's agent does its work and reports it, as `norn done` would. */
  async work(): Promise<void> {
    for (const run of this.pending.splice(0)) {
      const key = `${run.unit}:${run.step}`;
      const visit = this.visits.get(key) ?? 0;
      this.visits.set(key, visit + 1);
      const w = this.script(run.step, visit, run);
      if (w.commit) await commit(run.worktree, `${run.step} (${run.unit})`, w.commit);
      const data: ReceiptData = { kind: "run.reported", run_id: run.run_id, verb: "done", outcome: w.outcome, step: run.step, attempt: run.brief.attempt };
      const wrote = await this.reporter().record(run.unit, { id: ulid(), data });
      if (!wrote.ok) throw new Error(`report of ${run.unit}: ${wrote.failure.message}`);
      this.reported.add(run.run_id);
    }
  }
}

export interface MachineOptions {
  name: string;
  workflow?: string;
  store?: "local" | "refs";
  kernel?: Partial<KernelConfig>;
  script: AgentScript;
  /** wrap the host this machine's plugins get, to inject a failure */
  host?: (ctx: HostContext) => HostContext;
  /** wrap the store the runtime writes through, to inject a crash */
  wrapStore?: (store: Store) => Store;
}

export interface Machine {
  repo: string;
  ctx: HostContext;
  env: RuntimeEnv;
  agents: ScriptedAgents;
  /** a second store over the same machine: what a person's or agent's `norn` command writes through */
  journal: Journal;
  advance(ms: number): void;
  tick(): Promise<TickReport>;
}

/** The store factories the runtime resolves by name, with `wrapStore` applied to what they create. */
function storePlugin(wrap: ((s: Store) => Store) | undefined): NornPlugin[] {
  if (!wrap) return [localStorePlugin, refsStorePlugin];
  const wrapped = (p: NornPlugin, name: string): NornPlugin => {
    const f = (p.provides.store as Record<string, StoreFactory>)[name] as StoreFactory;
    return defineNornPlugin({ name: p.name, api: "^1.4", provides: { store: { [name]: { configSchema: f.configSchema, create: (ctx: HostContext, c: never) => wrap(f.create(ctx, c)) } } } });
  };
  return [wrapped(localStorePlugin, "local"), wrapped(refsStorePlugin, "refs")];
}

export async function machine(t: Team, opts: MachineOptions): Promise<Machine> {
  const repo = await t.clone(opts.name);
  const clock = manualClock(START);
  const host = createNodeHost({ root: repo, dataDir: join(t.dir, `${opts.name}-machine`) });
  const base: HostContext = { ...host, now: clock.now };
  const ctx = opts.host ? opts.host(base) : base;
  const store = opts.store ?? "local";
  const plugins = [localTrackerPlugin, forgeNonePlugin, vcsGitPlugin, stepsForgePlugin, localPack(), harnessPlugin, ...storePlugin(opts.wrapStore)];
  const config: RuntimeConfig = {
    tracker: { name: "local", config: { user: "me", dir: t.trackerDir } },
    forge: { name: "none" },
    store: { name: store },
    vcs: { name: "git" },
    executors: { claude: { name: "scripted" } },
    pack: "local",
    kernel: { ...DEFAULT_KERNEL_CONFIG, mode: "auto", workflow: opts.workflow ?? "quick", ...opts.kernel },
    intake: { label: "norn", assignee: "me" },
    base: "main",
    baseRef: "origin/main",
    holder: opts.name,
    checks: { test: "sh check.sh" },
  };
  const reporterStore = createStore((store === "local" ? localStorePlugin : refsStorePlugin).provides.store?.[store] as StoreFactory, base, {});
  if (!reporterStore.ok) throw new Error(reporterStore.failure.message);
  const journal = new Journal(reporterStore.value);
  const agents = new ScriptedAgents(opts.script, () => journal);
  const built = createRuntimeEnv({ ctx, plugins, config, launcher: agents, sessions: agents });
  if (!built.ok) throw new Error(built.failure.message);
  const env = built.value;
  return { repo, ctx, env, agents, journal, advance: clock.advance, tick: () => tick(env, newTickId(clock.now())) };
}

/** A new tracker item labelled for intake and assigned to the machine's user. */
export async function newItem(m: Machine, title: string): Promise<string> {
  const made = await m.env.slots.tracker.perform({ kind: "create", title, body: `${title}.`, labels: ["norn"], assignee: "me" }, { receipt_id: `create-${title.replace(/\W+/g, "-")}` });
  if (!made.ok || made.value.id === undefined) throw new Error(`create: ${made.ok ? "no id" : made.failure.message}`);
  return `lt-${made.value.id}`;
}

export type Report = TickReport;

/** Each outcome as `unit rule`, with `!error` when it failed. */
export const rulesOf = (r: Report): string[] => r.outcomes.map((o) => `${o.decision.unit ?? "-"} ${o.decision.rule}${o.ok ? "" : ` !${o.error}`}`);

/**
 * Tick a minute apart, letting started agents work between ticks, until `done` holds; throw after
 * `max` ticks with every rule so far, which is what a failing test needs to be read.
 */
export async function tickUntil(machines: Machine | Machine[], done: () => boolean | Promise<boolean>, max = 40): Promise<Report[]> {
  const ms = Array.isArray(machines) ? machines : [machines];
  const reports: Report[] = [];
  for (let i = 0; i < max; i++) {
    for (const m of ms) {
      reports.push(await m.tick());
      await m.agents.work();
      m.advance(MINUTE);
    }
    if (await done()) return reports;
  }
  throw new Error(`no convergence after ${max} ticks:\n${reports.map((r) => rulesOf(r).join(", ")).join("\n")}`);
}

export async function unitRecord(m: Machine, unit: string) {
  const read = await m.env.journal.readUnit(unit);
  if (!read.ok) throw new Error(read.failure.message);
  return read.value;
}

/** A person decides the gate the unit is parked at, by the receipt `norn gate` writes. */
export async function decideGate(m: Machine, unit: string, outcome: "approve" | "reject"): Promise<void> {
  const state = (await unitRecord(m, unit)).state;
  if (!state) throw new Error(`${unit} has no state`);
  const wrote = await m.journal.record(unit, { id: ulid(), data: { kind: "gate.decided", outcome, by: "person", step: state.step, attempt: state.attempt } });
  if (!wrote.ok) throw new Error(wrote.failure.message);
}

/** A person merges the story branch into main with git, in the machine's checkout, and pushes it. */
export async function personMerges(m: Machine, unit: string): Promise<string> {
  await git(m.repo, "merge", "--no-ff", "-q", "-m", `Merge ${unit}`, `norn/${unit}`);
  await git(m.repo, "push", "-q", "origin", "main");
  return git(m.repo, "rev-parse", "HEAD");
}
