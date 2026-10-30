/**
 * Rules the agent-protocol verbs (`brief`, `done`, `ask`, `stuck`, `hook`; §9) read off one unit's
 * loaded runs/<unit>/: the live run (MO3), the report already made for it (§9.3: exactly one
 * report per run), the implicit ask it is parked on (R6.1) and whether an agent may work on it at
 * all. Pure: the cli loads the unit and turns a refusal into its `CliError`.
 */
import type { CliError, Receipt, Step, UnitState, Workflow } from "@norn/schema";
import type { NumberedReceipt, UnitRef } from "./facts.ts";
import { cmd } from "./commands.ts";

/** One unit as the agent verbs see it: its state, pinned workflow and receipts. */
export interface AgentUnit {
  unit: UnitRef;
  state: UnitState;
  workflow: Workflow;
  /** every valid receipt, ascending */
  receipts: readonly NumberedReceipt[];
  /** receipts above applied_through, ascending */
  unapplied: readonly NumberedReceipt[];
}

/** The workflow step at the unit's cursor; null at `$done` or when the workflow lacks it (S7). */
export const cursorStep = (s: AgentUnit): Step | null => (s.state.step === "$done" ? null : (s.workflow.steps[s.state.step] ?? null));

const atCursor = (s: AgentUnit, r: Receipt) => r.step === s.state.step && r.attempt === s.state.attempt;

/**
 * The live run of the cursor step (MO3): the applied run in state.json, else a `started`
 * receipt for this step/attempt not yet applied by the tick (brief ran, no tick since).
 */
export function currentRun(s: AgentUnit): { run_id: string; applied: boolean } | null {
  const st = s.state;
  if (st.run && st.run.step === st.step && st.run.attempt === st.attempt && (st.status === "running" || st.status === "parked"))
    return { run_id: st.run.run_id, applied: true };
  const pending = s.unapplied.findLast((r) => r.receipt.kind === "started" && atCursor(s, r.receipt) && r.receipt.run_id);
  return pending?.receipt.run_id ? { run_id: pending.receipt.run_id, applied: false } : null;
}

const REPORTS = new Set(["done", "ask", "stuck"]);

/**
 * The report already made for `run_id` that still stands: a `done` or `stuck`, or an `ask`
 * not answered since (an answer resumes the same run, B2). Implicit asks (norn) don't count.
 */
export function standingReport(s: AgentUnit, run_id: string): NumberedReceipt | null {
  let last: NumberedReceipt | null = null;
  for (const nr of s.receipts) {
    const r = nr.receipt;
    if (!atCursor(s, r)) continue;
    if (REPORTS.has(r.kind) && r.run_id === run_id && r.by === "agent" && !(r.kind === "ask" && r.implicit)) last = nr;
    else if (r.kind === "answer" && last?.receipt.kind === "ask") last = null;
  }
  return last;
}

/**
 * R6.1: the implicit ask the unit is parked on (park flag, or the ask receipt of older states), and
 * whether an answer to it (a person's, or the tick's) already waits to be applied. Null when the
 * unit is not parked on an implicit ask.
 */
export function implicitAsk(s: AgentUnit): { ask: NumberedReceipt; answered: boolean } | null {
  const park = s.state.status === "parked" && s.state.park?.kind === "ask" ? s.state.park : null;
  if (!park) return null;
  const ask = s.receipts.findLast((r) => r.receipt.kind === "ask" && atCursor(s, r.receipt) && (!park.receipt_id || r.receipt.receipt_id === park.receipt_id));
  if (!ask || !(park.implicit || (ask.receipt.kind === "ask" && ask.receipt.implicit))) return null;
  return { ask, answered: s.unapplied.some((r) => r.receipt.kind === "answer" && atCursor(s, r.receipt)) };
}

/** R6.1: the implicit ask the unit is parked on, when no answer to it waits to be applied yet. */
export function implicitAskOpen(s: AgentUnit): NumberedReceipt | null {
  const open = implicitAsk(s);
  return open && !open.answered ? open.ask : null;
}

const no = (error: string, do_instead: string, code: string): CliError => ({ error, do_instead, code });

/** Why the unit is in no shape for an agent to `verb` it (do_instead names the right command); null when it is. */
export function agentWorkRefusal(s: AgentUnit, verb: string): CliError | null {
  const st = s.state;
  const key = s.unit.key;
  if (st.status === "done" || st.step === "$done") return no(`unit ${key} is done; there is nothing to ${verb}`, "end your turn", "unit_done");
  if (st.status === "stuck") return no(`unit ${key} is stuck: ${st.park?.reason ?? "unknown"}`, `end your turn; a person unblocks it with: ${cmd.runRerun(key)}`, "unit_stuck");
  const step = cursorStep(s);
  if (!step) return no(`step '${st.step}' does not exist in workflow ${s.workflow.name} (S7)`, `end your turn; a person fixes it with: ${cmd.runRerun(key, { step: "<step>" })}`, "no_step");
  if (step.type === "gate") return no(`${st.step} is a gate: a person decides, not an agent`, `end your turn; a person runs: ${cmd.storyApprove(key)} (or ${cmd.storyReject(key)})`, "gate_step");
  if (step.type !== "agent") return no(`${st.step} is a ${step.type} step: norn runs it, not an agent`, `end your turn; the heartbeat (${cmd.tick()} / ${cmd.watch()}) runs it`, "not_agent_step");
  // R6.1 (A14): an implicit ask (a prompt norn saw in the pane or a hook) does not hold the agent
  // back — its report is the answer, also once a person's answer waits to be applied (B6: the
  // answer let the agent's own `norn done` run); an explicit `norn ask` waits for the person
  if (st.status === "parked" && st.park?.kind === "ask") {
    if (!implicitAsk(s)) return no(`unit ${key} waits for an answer: ${st.park.reason}`, `end your turn; a person answers with: ${cmd.storyAnswer(key)}`, "parked_ask");
  } else if (st.status === "parked" && st.park?.kind !== "attended")
    return no(`unit ${key} is parked (${st.park?.kind}): ${st.park?.reason ?? ""}`, `end your turn; a person resolves it: ${cmd.runRerun(key)}`, "parked");
  return null;
}
