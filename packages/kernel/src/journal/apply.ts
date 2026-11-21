/**
 * Receipts to run state. Pure: the same state, receipts and graph give the same next state, so a
 * replay after a crash converges on what the first pass would have committed.
 */
import type { Mode } from "@norn/schema";
import type { KernelReceipt, RejectedReceipt } from "../model/receipts.ts";
import { RUN_STATE_FORMAT, type RunState } from "../model/run-state.ts";
import type { LoadedWorkflow, WorkflowGraph } from "../workflow/graph.ts";
import { applyOne } from "./apply-one.ts";

/** One outcome routed: where it went, and what happened to the counters on the way. */
export interface RouteTaken {
  seq: number;
  from: string;
  outcome: string;
  /** a step, `$done` or `$stuck` */
  to: string;
  /** the counter the edge bumped, its value after, and its bound */
  counter?: { name: string; value: number; max: number };
  /** set when this route ran the counter out, which sent the unit to `$stuck` instead of `to` */
  exhausted?: string;
  /** counters the edge reset to 0 */
  reset: string[];
}

export interface ApplyResult {
  state: RunState;
  /** seqs applied, refused ones included: `state.applied_through` moves past both */
  applied: number[];
  /** receipts refused, each with why; the host records a `receipt.rejected` for each */
  rejected: RejectedReceipt[];
  routes: RouteTaken[];
  /**
   * set when applying stopped at receipt `seq` because it needs the graph of workflow `hash` (a new
   * round's, or the unit's pinned one when another graph was passed); it and the receipts after it
   * stay unapplied, so the caller applies them with that graph rather than losing them as refused
   */
  blocked?: { seq: number; hash: string };
}

/**
 * Apply `receipts` above `state.applied_through`, ascending. An outcome is routed through the graph:
 * counters bump or reset, an exhausted counter routes to `$stuck` naming it, and entering a step
 * starts a new attempt with no run. Refused, as a rejected receipt and never a throw: an outcome the
 * step does not declare, a receipt for another step or attempt, a run's report when that run is not
 * the current one, and an approve or reject that comes from a step agent rather than through
 * `gate.decided` by a person or their delegate.
 */
export function applyReceipts(state: RunState, receipts: readonly KernelReceipt[], graph: WorkflowGraph): ApplyResult {
  const out: ApplyResult = { state, applied: [], rejected: [], routes: [] };
  const ordered = [...receipts].sort((a, b) => a.seq - b.seq);
  const vetoed = vetoedReports(ordered);
  for (const r of ordered) {
    if (r.seq <= out.state.applied_through) continue;
    const veto = vetoed.get(r.seq);
    if (veto !== undefined) {
      out.applied.push(r.seq);
      out.rejected.push({ seq: r.seq, reason: veto });
      out.state = { ...out.state, applied_through: r.seq };
      continue;
    }
    const needs = r.data.kind === "round.started" ? r.data.workflow.hash : out.state.workflow.hash;
    if (needs !== graph.hash) {
      out.blocked = { seq: r.seq, hash: needs };
      break;
    }
    const from = out.state.step;
    const one = applyOne(out.state, r, graph);
    out.applied.push(r.seq);
    if ("reject" in one) {
      out.rejected.push({ seq: r.seq, reason: one.reject });
      out.state = { ...out.state, applied_through: r.seq };
      continue;
    }
    out.state = { ...one.state, applied_through: r.seq };
    if (one.taken) {
      const { outcome, to, counter, exhausted, reset } = one.taken;
      if (out.state.ended === undefined && out.state.step === to && graph.steps[to]?.agent && sendsBack(graph, from, outcome, r)) out.state.rework_from = r.seq;
      out.routes.push({ seq: r.seq, from, outcome, to, ...(counter ? { counter } : {}), ...(exhausted ? { exhausted } : {}), reset });
    }
  }
  return out;
}

/**
 * The reports a later check refused or could not do, by seq, each with why: such a report never
 * routes, whichever tick applies it, and the check's own receipt parks the unit.
 */
function vetoedReports(ordered: readonly KernelReceipt[]): Map<number, string> {
  const out = new Map<number, string>();
  for (const c of ordered) {
    if (c.data.kind !== "run.checked" || c.data.verdict === "clean" || c.data.verdict === "reset") continue;
    const { run_id, verdict } = c.data;
    for (const r of ordered)
      if (r.seq < c.seq && r.data.kind === "run.reported" && r.data.run_id === run_id)
        out.set(r.seq, `the check after run ${run_id} reported ${verdict === "refused" ? "refused it" : "could not be done"}`);
  }
  return out;
}

/**
 * Whether outcome `outcome` of step `from`, recorded by `r`, sends the work back for the step it
 * enters to rework (only an agent step's brief reads it, so only an agent step is given one): a counted edge (a loop the workflow bounds), a gate's reject, a check that did not
 * pass, or an agent outcome that must hand back findings. Read from the graph and the receipt, so a
 * workflow's own outcome names need no list here.
 */
function sendsBack(graph: WorkflowGraph, from: string, outcome: string, r: KernelReceipt): boolean {
  const d = r.data;
  // a session norn classified (quiet, dead, past its deadline) failed to work; nothing was judged and sent back
  if (d.kind === "run.classified") return false;
  const step = graph.steps[from];
  if (step?.routes[outcome]?.counter !== undefined) return true;
  if (d.kind === "gate.decided") return d.outcome === "reject";
  if (d.kind === "check.finished") return d.outcome !== "pass";
  if (d.kind === "run.reported") return step?.agent?.hand_back[outcome] === "findings";
  return false;
}

export interface NewRunStateInput {
  unit: string;
  story: string;
  workflow: LoadedWorkflow;
  mode?: Mode;
}

/** A unit's first run state: at the workflow's start step, attempt 1, no run, every counter 0, nothing applied. */
export function newRunState(input: NewRunStateInput): RunState {
  const { graph, pinned } = input.workflow;
  const state: RunState = {
    format: RUN_STATE_FORMAT,
    unit: input.unit,
    story: input.story,
    workflow: structuredClone(pinned),
    step: graph.start,
    attempt: 1,
    counters: Object.fromEntries(Object.keys(graph.counters).map((name) => [name, 0])),
    retries_used: 0,
    run: null,
    applied_through: 0,
  };
  if (input.mode !== undefined) state.mode = input.mode;
  return state;
}
