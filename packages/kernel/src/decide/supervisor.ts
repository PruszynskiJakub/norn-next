/**
 * Who stands in for the person, decided from the person's own policy and the executors' facts. The
 * policy grants a step by name (`policy.stand_in`); a grant is only as good as the enforcement under it,
 * so a gate is handed to a supervisor only when every agent that could act on its workflow, and the
 * supervisor itself, runs inside an OS sandbox. Without one, an agent's shell could write the decision
 * itself, so the gate stays the person's.
 */
import { type ExecutorCapabilities, launchTarget } from "../model/capabilities.ts";
import type { KernelConfig } from "../model/config.ts";
import type { AgentStepSpec, WorkflowGraph } from "../workflow/graph.ts";
import type { DecideContext } from "./context.ts";

/** The role a supervisor binds under (`bind.supervisor`); no step names it. */
export const SUPERVISOR_ROLE = "supervisor";

/** Whether the person's policy lets a stand-in take `<workflow>.<step>` in its list. */
export function grantedTo(config: KernelConfig, list: "gates" | "attended", workflow: string, step: string): boolean {
  return config.standIn?.[list].includes(`${workflow}.${step}`) === true;
}

/**
 * The executors an agent step may run on, first choice first: an older step's `by:`, else the config's
 * binding of this workflow's step, else of the step's role, else the config's executor.
 */
export function stepCandidates(config: KernelConfig, workflow: string, step: string, spec: AgentStepSpec): readonly string[] {
  if (spec.executor !== null) return [spec.executor];
  const bind = config.bind ?? {};
  const own = bind[`${workflow}.${step}`];
  if (own) return own;
  const byRole = spec.role !== undefined ? bind[spec.role] : undefined;
  return byRole ?? [config.executor];
}

/** The executors a supervisor may run on: its role's binding, else the config's executor. */
export function supervisorCandidates(config: KernelConfig): readonly string[] {
  return config.bind?.[SUPERVISOR_ROLE] ?? [config.executor];
}

/** The name `executor` runs under for `attendance`: in the runner it picks, else in its own. */
function targetOf(ctx: DecideContext, executor: string, attendance: AgentStepSpec["attended"]): { name: string; caps: ExecutorCapabilities } | null {
  const executors = ctx.facts.capabilities.executors;
  const byAttendance = launchTarget(executor, attendance);
  const name = executors[byAttendance] ? byAttendance : executor;
  const caps = executors[name];
  return caps ? { name, caps } : null;
}

export type SupervisorMatch = { ok: true; executor: string } | { ok: false; why: string };

/**
 * The executor a supervisor runs on: the first candidate that can run with nobody watching and can deny
 * a tool, since it may write nothing; for a gate, also inside an OS sandbox. With none, why not.
 */
export function matchSupervisor(ctx: DecideContext, needsSandbox: boolean): SupervisorMatch {
  const why: string[] = [];
  for (const e of supervisorCandidates(ctx.config)) {
    const t = targetOf(ctx, e, "agent");
    if (!t) why.push(`executor '${e}' is not configured`);
    else if (!t.caps.headless) why.push(`executor '${e}' cannot run headless`);
    else if (!t.caps.denyTool) why.push(`executor '${e}' cannot deny a tool, so the supervisor's writes would go unguarded`);
    else if (needsSandbox && t.caps.sandbox !== true) why.push(`the supervisor's executor '${e}' runs in no OS sandbox`);
    else return { ok: true, executor: t.name };
  }
  return { ok: false, why: why.join("; ") };
}

/**
 * Why a gate granted to a stand-in must still go to the person, or null when it may be delegated: every
 * executor any agent step of the workflow may run on runs sandboxed, since any of them could otherwise
 * forge the decision, and so does the supervisor's.
 */
export function delegationBlocked(ctx: DecideContext, graph: WorkflowGraph): string | null {
  for (const step of Object.values(graph.steps)) {
    if (!step.agent) continue;
    for (const e of stepCandidates(ctx.config, graph.name, step.name, step.agent)) {
      const t = targetOf(ctx, e, step.agent.attended);
      if (t && t.caps.sandbox !== true) return `step ${step.name}'s executor '${e}' runs in no OS sandbox`;
    }
  }
  const supervisor = matchSupervisor(ctx, true);
  return supervisor.ok ? null : supervisor.why;
}
