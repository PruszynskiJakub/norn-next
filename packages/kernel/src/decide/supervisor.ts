/**
 * Who stands in for the person, decided from the person's own policy and the executors' facts. The
 * policy grants a step by name (`policy.stand_in`); a grant is only as good as the enforcement under it,
 * so a gate is handed to a supervisor only when every agent that could act on its workflow, and the
 * supervisor itself, runs inside an OS sandbox. Without one, an agent's shell could write the decision
 * itself, so the gate stays the person's.
 */
import type { Decision } from "../model/actions.ts";
import { type ExecutorCapabilities, launchTarget } from "../model/capabilities.ts";
import type { KernelConfig } from "../model/config.ts";
import type { SupervisorRun } from "../model/run-state.ts";
import type { AgentStepSpec, WorkflowGraph } from "../workflow/graph.ts";
import type { DecideContext } from "./context.ts";
import { ageMs, applyDecision, intentFor, noop, parkDecision, type UnitView } from "./unit-support.ts";

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
 * Why a gate granted to a stand-in must still go to the person, or null when it may be delegated. The
 * sandbox is necessary but not enough: the design also makes delegation wait on a bound over the steps a
 * gate reaches before the next person's gate and on an allowlist of the item's authors, and the sandbox
 * reach here covers only this workflow's agent steps, not other units sharing the store or shell checks
 * running repo scripts. Until those exist no gate is delegated, so a stand-in can never be the only
 * thing between an unchecked story and its next effect.
 */
export function delegationBlocked(ctx: DecideContext, graph: WorkflowGraph): string {
  for (const step of Object.values(graph.steps)) {
    if (!step.agent) continue;
    for (const e of stepCandidates(ctx.config, graph.name, step.name, step.agent)) {
      const t = targetOf(ctx, e, step.agent.attended);
      if (t && t.caps.sandbox !== true) return `step ${step.name}'s executor '${e}' runs in no OS sandbox`;
    }
  }
  const supervisor = matchSupervisor(ctx, true);
  return supervisor.ok ? DELEGATION_UNBUILT : supervisor.why;
}

/** Why a gate stays the person's once every executor is sandboxed. */
export const DELEGATION_UNBUILT =
  "the bound on the steps after a delegated gate and the allowlist of the item's authors are not built yet";

/** The questions a supervisor answers for a step in one visit when its `limits.asks` says nothing. */
export const DEFAULT_SUPERVISOR_ASKS = 3;

/**
 * An agent's question while its unit is parked on it: answered by the supervisor when the step is
 * `attended: agent` and the person's policy grants a stand-in there, unless the question names what
 * only the person grants, the supervisor already handed it back, or the step's `limits.asks` are spent.
 * Null leaves it with the person, in the mailbox: the chain always ends there, never in a stuck unit.
 */
export function decideQuestion(v: UnitView): Decision | null {
  const spec = v.step.agent;
  const parked = v.state.parked;
  if (!spec || spec.attended !== "agent" || parked?.input_id === undefined) return null;
  const granted = grantedTo(v.ctx.config, "attended", v.state.workflow.name, v.state.step);
  const sup = v.state.supervisor;
  if (sup) return granted ? watchSupervisor(v, sup) : escalate(v, sup, "supervisor.revoked", "the person's policy no longer grants a stand-in for this step");
  if (!granted) return null;
  const input = parked.input_id;
  if (v.state.supervised?.escalated?.some((e) => e.input === input)) return null;
  const reserved = v.unit.question_reserved ?? [];
  if (reserved.length > 0) return noop(v, "supervisor.reserved", `the question names ${reserved.join(", ")}, which only the person grants, so it waits for them`);
  const asks = spec.asks ?? DEFAULT_SUPERVISOR_ASKS;
  const answered = v.state.supervised?.answered ?? 0;
  if (answered >= asks) return noop(v, "supervisor.asks_spent", `the supervisor answered ${answered} of the step's ${asks} (limits.asks) this visit, so the question waits for the person in the mailbox`);
  return startSupervisor(v, input);
}

/**
 * A gate the person's policy grants to a stand-in: parked for the person saying why it is not delegated.
 * A gate supervisor the state already holds is still watched, and while it works the gate stays in the
 * person's inbox too, and whoever decides first decides it.
 */
export function decideGrantedGate(v: UnitView, prompt: string): Decision {
  const park = (why: string) => parkDecision(v, GATE_PARK, "gate", { text: `${prompt}\n\n${why}` });
  const sup = v.state.supervisor;
  if (sup?.subject === "gate") {
    const watched = watchSupervisor(v, sup);
    if (watched.kind !== "noop") return watched;
    return park("A supervisor is deciding this gate under your policy's grant (policy.stand_in.gates); you may decide it first.");
  }
  const handed = v.state.supervised?.escalated?.find((e) => e.input === "gate");
  if (handed) return park(`The supervisor handed this gate to you: ${handed.reason}`);
  const blocked = delegationBlocked(v.ctx, v.graph);
  const because = blocked === DELEGATION_UNBUILT ? "" : ": without an OS sandbox an agent's shell could forge the decision";
  return park(`policy.stand_in.gates grants this gate to a supervisor, but ${blocked}${because}, so it is yours to decide`);
}

/** The park of a gate waiting on its decision. */
export const GATE_PARK = "gate.park";

function startSupervisor(v: UnitView, input_id: string): Decision {
  const match = matchSupervisor(v.ctx, false);
  if (!match.ok) return noop(v, "supervisor.no_executor", `no supervisor can take it (${match.why}), so it waits for the person`);
  const run_id = v.ctx.nextId();
  const subject = "ask";
  return {
    kind: "start_supervisor",
    unit: v.unit.id,
    rule: "supervisor.ask",
    run_id,
    executor: match.executor,
    subject,
    input_id,
    intent: intentFor(v, { kind: "supervisor.started", run_id, executor: match.executor, subject, input_id }),
  };
}

/** A supervisor at work is waited on for the quiet window; one gone quiet past it, or whose process is gone, hands its subject back. */
function watchSupervisor(v: UnitView, sup: SupervisorRun): Decision {
  if (v.unit.supervisor_alive === false) return escalate(v, sup, "supervisor.died", "the supervisor ended without an answer");
  if (ageMs(v.ctx, sup.started_at) > v.ctx.config.silentAfterMs) return escalate(v, sup, "supervisor.silent", `the supervisor gave no answer within ${Math.round(v.ctx.config.silentAfterMs / 60_000)} minutes`);
  return noop(v, "supervisor.working", `supervisor ${sup.id} is at work on the ${sup.subject}`);
}

function escalate(v: UnitView, sup: SupervisorRun, rule: string, reason: string): Decision {
  return applyDecision(v, rule, [intentFor(v, { kind: "supervisor.escalated", run_id: sup.id, reason })]);
}
