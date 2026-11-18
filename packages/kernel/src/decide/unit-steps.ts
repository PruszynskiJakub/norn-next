/**
 * Check, gate and plugin step rules. A check and an `effect` step kind run once per attempt; a
 * `wait` step kind is polled every tick until it answers something other than `waiting`. Each run is
 * recorded before the host performs it, and how it went comes back as a receipt the next tick
 * applies. A run cut short, or whose plugin failed, runs again under its run while the retries last,
 * each time recorded, and then ends the unit stuck. A gate never decides itself: it waits for a
 * person, or takes its `stale` or `unpushed` route when the story moved under it.
 */
import { WAITING_OUTCOME } from "@norn/plugin-api";
import type { Decision } from "../model/actions.ts";
import type { RunInfo } from "../model/run-state.ts";
import type { CheckStepSpec } from "../workflow/graph.ts";
import { applyDecision, applyOrPark, endStuckDecision, intentFor, noop, parkDecision, type UnitView } from "./unit-support.ts";

/** The step run the facts show, when it belongs to the step the unit is at. */
function stepRunOf(v: UnitView) {
  const sr = v.unit.step_run;
  return sr && sr.kind === v.step.kind ? sr : null;
}

/**
 * Run the step's check. A check already on the record runs again under its own run, recorded by a
 * `run.resumed` rather than a second `run.started`: a new run would be refused beside the one
 * recorded, and its outcome then routed under a run id applyReceipts does not know.
 */
function runCheck(v: UnitView, check: CheckStepSpec, rule: string, recorded?: string): Decision {
  const base = { kind: "run_check" as const, unit: v.unit.id, rule, step: v.state.step, attempt: v.state.attempt, command: check.command, timeout_ms: check.timeout_ms };
  if (recorded !== undefined) return { ...base, run_id: recorded, intent: resumed(v, recorded) };
  const run_id = v.ctx.nextId();
  return { ...base, run_id, intent: intentFor(v, { kind: "run.started", run_id, run_kind: "check", executor: "check", attended: false }) };
}

function resumed(v: UnitView, run_id: string) {
  const error = stepRunOf(v)?.error;
  return intentFor(v, { kind: "run.resumed", run_id, ...(error ? { reason: error } : {}) });
}

/** Whether a run cut short may run again: each time counts against the config's retries. */
function mayResume(v: UnitView, run: RunInfo): boolean {
  return (run.resumes ?? 0) < v.ctx.config.maxRetries;
}

function resumesSpent(v: UnitView, run: RunInfo, what: string): string {
  const error = stepRunOf(v)?.error;
  return `${what} run ${run.id} at ${v.state.step} ended without an outcome after ${run.resumes ?? 0}/${v.ctx.config.maxRetries} retries${error ? `: ${error}` : ""}`;
}

/** The exit a check's outcome stands for, when only the outcome is known: 0 for `pass`, else the exit its `exits` name, else 1. */
function exitOf(check: CheckStepSpec, outcome: string): number {
  if (outcome === "pass") return 0;
  const named = Object.entries(check.exits).find(([, o]) => o === outcome)?.[0];
  return named === undefined ? 1 : Number(named);
}

export function decideCheck(v: UnitView, check: CheckStepSpec): Decision {
  const run = v.state.run;
  if (!run) return runCheck(v, check, "check.run");
  const sr = stepRunOf(v);
  if (sr?.running) return noop(v, "check.running", `check run ${run.id} in progress`);
  if (sr?.outcome !== undefined) {
    const outcome = sr.outcome;
    return applyOrPark(v, "check.finished", "check.finished.rejected", [intentFor(v, { kind: "check.finished", run_id: run.id, exit: exitOf(check, outcome), outcome })]);
  }
  // recorded but neither running nor answered: the host stopped before it ran, or it could not run; a check runs again safely
  if (!mayResume(v, run)) return endStuckDecision(v, "check.rerun.exhausted", resumesSpent(v, run, "check"));
  return runCheck(v, check, "check.rerun", run.id);
}

/** The story's branch holds commits its change lacks and the step routes `unpushed`: only the story's own unit pushes its change. */
function unpushed(v: UnitView): boolean {
  return v.unit.id === v.story.key && v.story.unpushed === true && v.step.routes.unpushed !== undefined;
}

export function decideGate(v: UnitView, prompt: string): Decision {
  if (v.story.base_stale === true && v.step.routes.stale !== undefined)
    return applyDecision(v, "gate.stale", [intentFor(v, { kind: "step.finished", step_kind: "gate", outcome: "stale" })]);
  if (unpushed(v)) return applyDecision(v, "gate.unpushed", [intentFor(v, { kind: "step.finished", step_kind: "gate", outcome: "unpushed" })]);
  return parkDecision(v, "gate.park", "gate", { text: prompt });
}

export function decidePluginStep(v: UnitView, mode: "effect" | "wait"): Decision {
  const run = v.state.run;
  const base = { kind: "run_step" as const, unit: v.unit.id, step: v.state.step, attempt: v.state.attempt, step_kind: v.step.kind, mode, config: structuredClone(v.step.config ?? {}) };
  if (!run) {
    const run_id = v.ctx.nextId();
    const intent = intentFor(v, { kind: "run.started", run_id, run_kind: "step", executor: v.step.kind, attended: false });
    return { ...base, rule: "step.run", run_id, intent };
  }
  const sr = stepRunOf(v);
  if (sr?.running) return noop(v, "step.running", `${v.step.kind} run ${run.id} in progress`);
  if (sr?.outcome !== undefined && sr.outcome !== WAITING_OUTCOME) {
    const outcome = sr.outcome;
    const detail = sr.detail === undefined ? {} : { detail: structuredClone(sr.detail) };
    return applyOrPark(v, "step.finished", "step.finished.rejected", [intentFor(v, { kind: "step.finished", run_id: run.id, step_kind: v.step.kind, outcome, ...detail })]);
  }
  if (mode === "wait") {
    // checked between polls: the host's base_stale already reads the workflow's base policy, which a step kind does not know
    if (v.story.base_stale === true && v.step.routes.stale !== undefined)
      return applyDecision(v, "step.stale", [intentFor(v, { kind: "step.finished", run_id: run.id, step_kind: v.step.kind, outcome: "stale" })]);
    // a story waiting on a merge goes back to push what its change lacks
    if (unpushed(v)) return applyDecision(v, "step.unpushed", [intentFor(v, { kind: "step.finished", run_id: run.id, step_kind: v.step.kind, outcome: "unpushed" })]);
    return { ...base, rule: "step.poll", run_id: run.id };
  }
  // an effect kind recorded but never answered was cut short, or its plugin failed: run again under its run while the retries last
  if (!mayResume(v, run)) return endStuckDecision(v, "step.resume.exhausted", resumesSpent(v, run, v.step.kind));
  return { ...base, rule: "step.resume", run_id: run.id, intent: resumed(v, run.id) };
}
