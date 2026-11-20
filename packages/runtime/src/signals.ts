/**
 * Gathering a story's signals for the tick's facts. Sources are asked only for the story's own unit
 * at a waiting step (a gate, or a wait step between polls), and only for the signals that step routes
 * under `on:`: a running agent or check is never interrupted, so asking anywhere else would spend a
 * trial merge or a code host call on a fact nothing reads. The host's own sources (vcs, clock) and the
 * plugins' are asked alike. A source that fails could not tell, so its signal is left out, which
 * decide reads as nothing happened, never as a guess; `null` means nothing happened now.
 */
import type { RunState, WorkflowGraph } from "@norn/kernel";
import type { ChangeRequest, PluginResult, SignalReadInput, SignalSourceDefinition } from "@norn/plugin-api";
import { check, type Signal, Signal as SignalSchema } from "@norn/schema";
import { baseRefOf, branchOf } from "./branches.ts";
import type { RuntimeEnv } from "./env.ts";
import { clockSignalSource } from "./signal-clock.ts";
import { vcsSignalSources } from "./signal-vcs.ts";

/** The visit a waiting story is on: which step, which visit to it, and since when it waits there. */
export interface WaitingVisit {
  step: string;
  /** `<step>#<visit>`: the round's visits to the step, so coming back is a new visit */
  visit: string;
  since: string;
}

/**
 * The visit of a story unit waiting where signals may move it, or null. A gate waits from its park;
 * one not parked yet parks this tick unless a signal moves it first, so it waits from now. A wait step
 * waits from its run's start; one whose run starts this tick waits from now, and is read on that tick
 * too, so a base move under it is verified once whichever tick first sees it.
 */
export function waitingVisit(env: RuntimeEnv, state: RunState, graph: WorkflowGraph): WaitingVisit | null {
  if (state.ended !== undefined) return null;
  const step = graph.steps[state.step];
  if (!step?.signals?.length) return null;
  const visit = `${state.step}#${state.attempt}`;
  if (step.kind === "gate") return { step: state.step, visit, since: state.parked?.since ?? env.ctx.now() };
  if (step.runner.type === "plugin" && step.runner.mode === "wait") return { step: state.step, visit, since: state.run?.started_at ?? env.ctx.now() };
  return null;
}

/** The source of each signal by name: the host's own for a workflow under `graph`, then the plugins', which never replace them. */
function sourcesFor(env: RuntimeEnv, graph: WorkflowGraph): Record<string, { source: string; def: SignalSourceDefinition }> {
  const vcs = vcsSignalSources(env, graph);
  return {
    ...env.slots.signals,
    stale: { source: "vcs", def: vcs.stale },
    unpushed: { source: "vcs", def: vcs.unpushed },
    timeout: { source: "clock", def: clockSignalSource },
  };
}

const message = (e: unknown): string => (e instanceof Error ? e.message : String(e));

/** A source's answer as the facts may hold it: a valid signal of the name asked for, or why it is left out. */
function signalOf(name: string, got: PluginResult<Signal | null>): { signal: Signal | null } | { problem: string } {
  if (!got.ok) return { problem: got.failure.message };
  if (got.value === null) return { signal: null };
  const valid = check(SignalSchema, got.value);
  if (!valid.ok) return { problem: `answered no signal: ${valid.errors.map((e) => `${e.path || "/"} ${e.message}`).join("; ")}` };
  if (valid.value.type !== name) return { problem: `answered a ${valid.value.type} signal when asked for ${name}` };
  return { signal: structuredClone(valid.value) };
}

/**
 * The signals the story's own unit, at `state` under `graph`, can be moved by now, in the order its
 * step's `on:` lists them. Empty for a story not waiting where a signal is routed.
 */
export async function gatherSignals(env: RuntimeEnv, story: string, state: RunState | null, graph: WorkflowGraph | undefined, change: ChangeRequest | null, problems: string[]): Promise<Signal[]> {
  if (!state || !graph) return [];
  const waiting = waitingVisit(env, state, graph);
  if (!waiting) return [];
  const routed = graph.steps[state.step]?.signals ?? [];
  const sources = sourcesFor(env, graph);
  const { vcs, forge, tracker } = env.slots;
  const input: SignalReadInput = {
    story,
    ...waiting,
    branch: branchOf(story),
    base: { branch: env.config.base, ref: await baseRefOf(env) },
    change,
    slots: { vcs, forge, tracker },
  };
  const out: Signal[] = [];
  for (const { name, params } of routed) {
    const source = sources[name];
    if (!source) {
      problems.push(`${story}: no configured source reports signal ${name}`);
      continue;
    }
    let got: PluginResult<Signal | null>;
    try {
      // a copy per source, so one that edits what it is handed cannot change what the next one reads
      got = await source.def.read({ ...input, change: structuredClone(change) }, structuredClone(params ?? {}), env.ctx);
    } catch (e) {
      problems.push(`${story}: signal ${name} from ${source.source} threw: ${message(e)}`);
      continue;
    }
    const read = signalOf(name, got);
    if ("problem" in read) problems.push(`${story}: signal ${name} from ${source.source}: ${read.problem}`);
    else if (read.signal) out.push(read.signal);
  }
  return out;
}
