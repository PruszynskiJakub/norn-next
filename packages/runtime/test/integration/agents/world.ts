/**
 * A machine whose agents are real processes: the runtime builds its HarnessLauncher from the config
 * (the scripted harness in the headless runner), reads sessions from the event log, and runs checks
 * detached through host-node. The test only ticks, moves the clock, and plays the person.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { manualClock } from "@norn/conformance";
import type { KernelConfig } from "@norn/kernel";
import type { HostContext } from "@norn/plugin-api";
import { ulid } from "@norn/schema";
import { createRuntimeEnv, EventLogSessionSource, newTickId, type RuntimeEnv, sessionLogPath, type TickReport, tick } from "../../../src/index.ts";
import { rulesOf, START, type Team } from "../world.ts";
import type { AgentPlan } from "./scripted-harness.ts";
import { configOf, hostOf, type MachineSetup, pluginsOf } from "./setup.ts";

export interface TimedReport {
  report: TickReport;
  /** how long the tick took, in real ms */
  ms: number;
}

export interface AgentMachine {
  repo: string;
  ctx: HostContext;
  env: RuntimeEnv;
  /** the run ids launched, in order */
  launched: string[];
  reports: TimedReport[];
  advance(ms: number): void;
  tick(): Promise<TimedReport>;
}

export interface AgentMachineOptions {
  workflow: string;
  kernel?: Partial<KernelConfig>;
  /** each launch's plan, in launch order; a launch past the end is a test defect */
  plans: AgentPlan[];
}

export async function agentMachine(t: Team, opts: AgentMachineOptions): Promise<AgentMachine> {
  const repo = await t.clone("a");
  const clock = manualClock(START);
  const setup: MachineSetup = {
    repo,
    dataDir: join(t.dir, "a-machine"),
    trackerDir: t.trackerDir,
    clockFile: join(t.dir, "clock"),
    workflow: opts.workflow,
    ...(opts.kernel && { kernel: opts.kernel }),
  };
  const setupPath = join(t.dir, "setup.json");
  writeFileSync(setup.clockFile, `${clock.now()}\n`);
  writeFileSync(setupPath, `${JSON.stringify(setup)}\n`);
  const launched: string[] = [];
  const plans = [...opts.plans];
  const { plugins } = pluginsOf(setupPath, (runId) => {
    launched.push(runId);
    const plan = plans.shift();
    if (!plan) throw new Error(`launch ${launched.length} of run ${runId} has no plan`);
    return plan;
  });
  const ctx = hostOf(setup);
  const config = configOf(setup);
  const built = createRuntimeEnv({
    ctx,
    plugins,
    config,
    hookCommand: nornHook(setupPath),
    sessions: (launcher) => new EventLogSessionSource({ ctx, classify: { silentAfterMs: config.kernel.silentAfterMs }, alive: (h) => launcher.alive?.(h) ?? Promise.resolve(null) }),
  });
  if (!built.ok) throw new Error(built.failure.message);
  const env = built.value;
  const reports: TimedReport[] = [];
  return {
    repo,
    ctx,
    env,
    launched,
    reports,
    advance: (ms) => {
      clock.advance(ms);
      writeFileSync(setup.clockFile, `${clock.now()}\n`);
    },
    tick: async () => {
      const began = performance.now();
      const report = await tick(env, newTickId(clock.now()));
      const timed = { report, ms: performance.now() - began };
      reports.push(timed);
      return timed;
    },
  };
}

/** The hook command an agent's hooks run, before the harness's name: the stand-in's `hook` verb. */
function nornHook(setupPath: string): string[] {
  return ["bun", new URL("./norn-bin.ts", import.meta.url).pathname, setupPath, "hook"];
}

/**
 * Tick, let real time pass for the agent and check processes, move the clock by `stepMs`, until
 * `done` holds; throw after `maxMs` of real time with every rule so far.
 */
export async function drive(m: AgentMachine, done: () => boolean | Promise<boolean>, opts: { stepMs?: number; maxMs?: number; pauseMs?: number } = {}): Promise<TimedReport[]> {
  const out: TimedReport[] = [];
  const until = performance.now() + (opts.maxMs ?? 45_000);
  while (performance.now() < until) {
    out.push(await m.tick());
    if (await done()) return out;
    await Bun.sleep(opts.pauseMs ?? 150);
    m.advance(opts.stepMs ?? 5_000);
  }
  throw new Error(`no convergence:\n${out.map((r) => rulesOf(r.report).join(", ")).join("\n")}`);
}

/** `n` ticks `stepMs` apart, whatever they decide. */
export async function ticks(m: AgentMachine, n: number, stepMs: number): Promise<TimedReport[]> {
  const out: TimedReport[] = [];
  for (let i = 0; i < n; i++) {
    out.push(await m.tick());
    await Bun.sleep(150);
    m.advance(stepMs);
  }
  return out;
}

/** A new tracker item labelled for intake and assigned to the machine's user. */
export async function newStory(m: AgentMachine, title: string): Promise<void> {
  const made = await m.env.slots.tracker.perform({ kind: "create", title, body: `${title}.`, labels: ["norn"], assignee: "me" }, { receipt_id: `create-${title.replace(/\W+/g, "-")}` });
  if (!made.ok) throw new Error(`create: ${made.failure.message}`);
}

export async function unitOf(m: AgentMachine, unit: string) {
  const read = await m.env.journal.readUnit(unit);
  if (!read.ok) throw new Error(read.failure.message);
  return read.value;
}

/** What the agent of `runId` noted, in order, from the run's log. */
export function notes(m: AgentMachine, runId: string): { note: string; value: unknown }[] {
  let text = "";
  try {
    text = readFileSync(sessionLogPath(m.ctx, runId), "utf8");
  } catch {
    return [];
  }
  return text
    .split("\n")
    .filter((l) => l.startsWith("{"))
    .map((l) => JSON.parse(l) as { note: string; value: unknown });
}

export function noteOf(m: AgentMachine, runId: string, what: string): unknown {
  return notes(m, runId).find((n) => n.note === what)?.value;
}

/** A person answers what the unit is parked on, by the receipt `norn story answer` writes. */
export async function personAnswers(m: AgentMachine, unit: string, inputId: string, text: string): Promise<void> {
  const state = (await unitOf(m, unit)).state;
  if (!state) throw new Error(`${unit} has no state`);
  const wrote = await m.env.journal.record(unit, { id: ulid(), data: { kind: "answer.sent", input_id: inputId, text, by: "person", step: state.step, attempt: state.attempt } });
  if (!wrote.ok) throw new Error(wrote.failure.message);
}
