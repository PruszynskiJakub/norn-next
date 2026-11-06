/**
 * The precondition of each person verb, stated once (§15, B57): the target picker reads a unit from
 * the view, the verb's refusal reads its run state; both ask these predicates. Each verb keeps its own
 * refusal text; only the rule lives here.
 */
import type { Mode, ParkKind, StepType, UnitState, UnitStatus, Workflow } from "@norn/schema";
import { effectiveMode } from "./policy.ts";
import { stepOf } from "./workflow.ts";

/** What a precondition reads of a unit: a view's unit, or run state with its step's type and effective mode (`situationOf`). */
export interface UnitSituation {
  status: UnitStatus | "not_started";
  park?: { kind: ParkKind } | null;
  step_type?: StepType | "unknown" | null;
  effective_mode?: Mode;
}

/** A unit's run state as a situation: its step's type in `workflow` and the mode it starts under (MO2). */
export function situationOf(st: UnitState, workflow: Workflow | null, mode: Mode, runner: string | null): UnitSituation {
  const step = workflow ? stepOf(workflow, st.step) : null;
  return { status: st.status, park: st.park ?? null, step_type: step?.type ?? null, effective_mode: effectiveMode(mode, step?.type === "agent" && !!step.attended, runner).mode };
}

/** Parked on `kind`: a question (`story answer`), a gate (`story approve|reject`), an attended step. */
export const isParked = (u: Pick<UnitSituation, "status" | "park">, kind: ParkKind): boolean => u.status === "parked" && u.park?.kind === kind;

/** B28 (`story start`): a person starts it — parked at an attended step, or a ready agent step in manual mode. */
export const startable = (u: UnitSituation): boolean => isParked(u, "attended") || (u.status === "ready" && u.step_type === "agent" && u.effective_mode === "manual");

/** BS9 (`story update-branch`): done (its PR unmerged), at a gate or stuck; gh-61 B22: or held by drifted skills. */
export const waitsForBaseUpdate = (u: Pick<UnitSituation, "status" | "park">, heldBySkillsDrift: boolean): boolean =>
  u.status === "done" || u.status === "stuck" || isParked(u, "gate") || heldBySkillsDrift;

/** B48 (`run rerun`): stuck or parked, a gate or an ask included. */
export const rerunnable = (u: Pick<UnitSituation, "status">): boolean => u.status === "stuck" || u.status === "parked";
