/**
 * Receipt application (S5, S6, W3, W4, §10): a pure fold of numbered receipts over
 * `UnitState` given the unit's pinned workflow. Receipts numbered ≤ applied_through are
 * skipped, so re-applying after a crash is idempotent. Receipts whose step/attempt do not
 * match the cursor are rejected (T9), never applied.
 */
import type {
  AgentStep,
  LastOutcome,
  ParkInfo,
  ParkKind,
  Receipt,
  ReceiptOf,
  UnitState,
  Workflow,
} from "@norn/schema";
import type { NumberedReceipt, UnitRef } from "./facts.ts";
import { edgeOf, OVERRIDABLE_ROUTES, stepOf } from "./workflow.ts";

export interface ApplyContext {
  /** the unit's pinned workflow (S7) */
  workflow: Workflow;
  /** ISO time of this tick (facts.now) */
  now: string;
  /** config.limits defaults for steps without their own `nudges` / `retries` (C1) */
  limits: { nudges: number; retries: number };
  tick_id?: string | null;
}

export interface Advance {
  from: string;
  outcome: string;
  to: string;
  counter?: { name: string; value: number; max: number };
}

export interface Rejection {
  n: number;
  receipt_id: string;
  reason: string;
}

export interface ApplyResult {
  state: UnitState;
  /** receipt numbers applied, ascending */
  applied: number[];
  /** receipts refused (stale step/attempt, wrong kind for the step, …); applied_through moves past them */
  rejected: Rejection[];
  /** last edge taken, if the cursor moved */
  advance: Advance | null;
  /** in-step route of the last receipt: nudge the same session, or retry in a fresh one (C1, B2) */
  route: "nudge" | "retry" | null;
  /** answer text to type into the live session (B2), set when the last receipt was an answer */
  deliver: string | null;
  /** one line per applied receipt, for handoff.md heartbeat lines (O6) */
  log: string[];
}

const SOURCE = { agent: "reported", human: "human", norn: "classified" } as const;

/** First state of a unit: cursor entered at `workflow.start` (S7). */
export function initialState(args: {
  unit: UnitRef;
  workflow: Workflow;
  workflowName: string;
  workflowHash: string;
  now: string;
  mode?: UnitState["mode"];
  tick_id?: string | null;
}): UnitState {
  const { unit, workflow, now } = args;
  const base: UnitState = {
    version: 1,
    story: unit.story,
    slice: unit.slice,
    unit_dir: unit.dir,
    workflow: args.workflowName,
    workflow_hash: args.workflowHash,
    step: workflow.start,
    attempt: 1,
    visits: {},
    step_entered_at: now,
    status: "ready",
    park: null,
    counters: Object.fromEntries(Object.keys(workflow.counters ?? {}).map((c) => [c, 0])),
    nudges_used: 0,
    retries_used: 0,
    applied_through: 0,
    run: null,
    last_outcome: null,
    created_at: now,
    updated_at: now,
    last_tick_id: args.tick_id ?? null,
  };
  if (args.mode) base.mode = args.mode;
  return enterStep(base, workflow, workflow.start, now);
}

/** Enter `name`: new attempt, within-step limits reset, status by step type (gate/attended park). */
export function enterStep(prev: UnitState, wf: Workflow, name: string, now: string): UnitState {
  const st: UnitState = { ...prev, visits: { ...prev.visits } };
  const step = stepOf(wf, name);
  st.visits[name] = (st.visits[name] ?? 0) + 1;
  st.attempt = st.visits[name];
  st.step = name;
  st.step_entered_at = now;
  st.nudges_used = 0;
  st.retries_used = 0;
  st.run = null;
  st.park = null;
  st.status = "ready";
  if (!step) return park(st, "workflow", `step '${name}' does not exist in workflow ${wf.name} (S7)`, now, "stuck");
  if (step.type === "gate") return park(st, "gate", step.prompt ?? `approve or reject ${name}`, now);
  if (step.type === "agent" && step.attended) return park(st, "attended", `attended step ${name}: work with the agent in the worktree`, now);
  return st;
}

function park(st: UnitState, kind: ParkKind, reason: string, at: string, status: "parked" | "stuck" = "parked", receipt_id?: string): UnitState {
  const p: ParkInfo = { kind, reason, since: at };
  if (receipt_id) p.receipt_id = receipt_id;
  return { ...st, status, park: p };
}

const stuckPark = (st: UnitState, kind: ParkKind, reason: string, at: string, receipt_id?: string) =>
  park(st, kind, reason, at, "stuck", receipt_id);

/** Apply every receipt numbered above `state.applied_through`, ascending (S6). Pure. */
export function applyReceipts(state: UnitState, receipts: readonly NumberedReceipt[], ctx: ApplyContext): ApplyResult {
  const out: ApplyResult = { state, applied: [], rejected: [], advance: null, route: null, deliver: null, log: [] };
  for (const nr of [...receipts].sort((a, b) => a.n - b.n)) {
    if (nr.n <= out.state.applied_through) continue;
    const r = nr.receipt;
    const res = applyOne(out.state, r, ctx);
    if ("reject" in res) {
      out.rejected.push({ n: nr.n, receipt_id: r.receipt_id, reason: res.reject });
      out.state = { ...out.state, applied_through: nr.n };
      continue;
    }
    out.applied.push(nr.n);
    if (r.kind !== "mode" && r.kind !== "take") {
      out.route = res.route ?? null;
      out.deliver = res.deliver ?? null;
    }
    if (res.advance) out.advance = res.advance;
    out.log.push(res.log);
    out.state = { ...res.state, applied_through: nr.n, updated_at: ctx.now, last_tick_id: ctx.tick_id ?? out.state.last_tick_id };
  }
  return out;
}

type Step1 =
  | { reject: string }
  | { state: UnitState; log: string; advance?: Advance; route?: "nudge" | "retry"; deliver?: string };

function applyOne(st: UnitState, r: Receipt, ctx: ApplyContext): Step1 {
  const wf = ctx.workflow;
  if (r.kind === "mode") {
    // mode is story-level, not bound to a step (MO1)
    return { state: { ...st, mode: r.mode }, log: `mode ${r.previous} → ${r.mode}` };
  }
  if (r.kind === "take") {
    // R10.1: a takeover is a record, not a cursor move — applied at any cursor, like mode
    const from = r.previous_holder ? ` from ${r.previous_holder}${r.forced ? " (forced)" : r.expired ? " (expired)" : ""}` : "";
    return { state: st, log: `taken by ${r.who ?? r.by}${from}` };
  }
  if (st.status === "corrupt") return { reject: "unit is corrupt (S2)" };
  if (r.slice !== undefined && r.slice !== st.slice) return { reject: `receipt for unit ${r.slice ?? st.story}, not ${st.slice ?? st.story}` };
  if (st.step === "$done") return { reject: "unit is done" };
  if (r.step !== st.step || r.attempt !== st.attempt)
    return { reject: `stale: receipt for ${r.step}#${r.attempt}, cursor at ${st.step}#${st.attempt}` };

  const step = stepOf(wf, st.step);
  if (r.kind === "workflow") {
    if (!stepOf(wf, r.to)) return { reject: `workflow ${r.name} has no step '${r.to}'` };
    const next = enterStep({ ...st, workflow: r.name, workflow_hash: r.to_hash }, wf, r.to, ctx.now);
    return { state: next, log: `workflow → ${r.name} at ${r.to}`, advance: { from: st.step, outcome: "workflow", to: r.to } };
  }
  if (r.kind === "unstick") return unstick(st, r, ctx);
  if (!step) return { reject: `step '${st.step}' no longer exists (S7); use norn unstick --to` };
  if (st.status === "stuck") return { reject: `unit is stuck: ${st.park?.reason ?? "unknown"}; use norn unstick` };
  const lastOutcome = (outcome: string): LastOutcome => ({
    step: st.step,
    outcome,
    source: SOURCE[r.by],
    at: r.at,
    receipt_id: r.receipt_id,
  });

  switch (r.kind) {
    case "started": {
      if (step.type !== "agent") return { reject: `${st.step} is a ${step.type} step, not an agent step` };
      if (!r.run_id) return { reject: "started receipt without run_id" };
      if (st.run?.run_id === r.run_id) return { state: { ...st, run: runFrom(st, r) }, log: `run ${r.run_id} updated` };
      if (st.status === "running" && st.run) return { reject: `step ${st.step}#${st.attempt} already has run ${st.run.run_id} (MO3)` };
      if (st.status === "parked" && st.park?.kind !== "attended") return { reject: `unit is parked on ${st.park?.kind}` };
      return {
        state: { ...st, status: "running", park: null, run: runFrom(st, r) },
        log: `${st.step}#${st.attempt} started (${r.how}${r.retry ? ", retry" : ""})`,
      };
    }
    case "done": {
      if (step.type !== "agent") return { reject: `${st.step} is a ${step.type} step; done is for agent steps` };
      if (st.run && r.run_id && st.run.run_id !== r.run_id) return { reject: `stale run ${r.run_id}; current run is ${st.run.run_id}` };
      if (st.park?.kind === "gate") return { reject: "unit waits at a gate" };
      if ((OVERRIDABLE_ROUTES as readonly string[]).includes(r.outcome) || !edgeOf(wf, st.step, r.outcome))
        return { reject: `outcome '${r.outcome}' is not declared at ${st.step}` };
      return take(st, r.outcome, r, ctx, lastOutcome(r.outcome));
    }
    case "ask": {
      if (step.type !== "agent") return { reject: `${st.step} is a ${step.type} step; ask is for agent steps` };
      if (st.run && r.run_id && st.run.run_id !== r.run_id) return { reject: `stale run ${r.run_id}` };
      if (edgeOf(wf, st.step, "ask")) return take(st, "ask", r, ctx, lastOutcome("ask"));
      const parked = park(st, "ask", r.question, r.at, "parked", r.receipt_id);
      if (r.command && parked.park) parked.park.command = r.command;
      if (r.implicit && parked.park) {
        // R6.1/R6.2: what the tick needs to resolve the implicit ask or type an answer into the prompt
        parked.park.implicit = r.choice || r.screen ? "pane" : "hook";
        if (r.options?.length) parked.park.options = r.options;
        if (r.choice) parked.park.choice = r.choice;
        if (r.screen) parked.park.screen = r.screen;
      }
      return {
        state: { ...parked, last_outcome: lastOutcome("ask") },
        log: `${st.step}#${st.attempt} asks: ${r.question}`,
      };
    }
    case "stuck": {
      if (step.type !== "agent") return { reject: `${st.step} is a ${step.type} step; stuck is for agent steps` };
      if (st.run && r.run_id && st.run.run_id !== r.run_id) return { reject: `stale run ${r.run_id}` };
      if (edgeOf(wf, st.step, "stuck")) return take(st, "stuck", r, ctx, lastOutcome("stuck"));
      return {
        state: { ...stuckPark(st, "stuck", r.reason, r.at, r.receipt_id), last_outcome: lastOutcome("stuck") },
        log: `${st.step}#${st.attempt} stuck: ${r.reason}`,
      };
    }
    case "answer": {
      if (st.status !== "parked" || st.park?.kind !== "ask")
        return { reject: st.park?.kind === "gate" ? "gate needs approve or reject" : "unit is not waiting for an answer" };
      const resumed: UnitState = { ...st, park: null };
      // R6.1: the agent moved on by itself; R6.2: `norn answer` already typed it — nothing to deliver
      if ((r.by === "agent" || r.delivered) && st.run) return { state: { ...resumed, status: "running" }, log: `answered: ${r.answer}` };
      // B2: same session while it lives; manual runs get the answer from the person; else fresh session from the handoff
      if (st.run?.session)
        return { state: { ...resumed, status: "running" }, log: `answered: ${r.answer}`, deliver: r.answer };
      if (st.run?.how === "manual") return { state: { ...resumed, status: "running" }, log: `answered: ${r.answer}` };
      return { state: { ...resumed, status: "ready", run: null }, log: `answered: ${r.answer}` };
    }
    case "approve":
    case "reject": {
      if (step.type !== "gate" || st.park?.kind !== "gate") return { reject: `${st.step} is not a gate waiting for a decision` };
      return take({ ...st, park: null, status: "ready" }, r.kind, r, ctx, lastOutcome(r.kind));
    }
    case "check": {
      if (step.type !== "check") return { reject: `${st.step} is a ${step.type} step, not a check` };
      return take(st, r.outcome, r, ctx, lastOutcome(r.outcome));
    }
    case "classify":
      return classify(st, r, step, ctx, lastOutcome(r.outcome));
  }
}

function runFrom(st: UnitState, r: ReceiptOf<"started">): NonNullable<UnitState["run"]> {
  const run: NonNullable<UnitState["run"]> = {
    run_id: r.run_id as string,
    step: st.step,
    attempt: st.attempt,
    started_at: r.at,
    how: r.how,
  };
  if (r.agent) run.agent = r.agent;
  if (r.model) run.model = r.model;
  if (r.session) run.session = r.session;
  if (r.agent_session_id) run.agent_session_id = r.agent_session_id;
  if (r.process) run.process = r.process;
  if (r.machine) run.machine = r.machine;
  if (r.heartbeat_id) run.heartbeat_id = r.heartbeat_id;
  return run;
}

function unstick(st: UnitState, r: ReceiptOf<"unstick">, ctx: ApplyContext): Step1 {
  if (st.status !== "stuck" && st.status !== "parked") return { reject: `unit is ${st.status}, nothing to unstick` };
  const declared = ctx.workflow.counters ?? {};
  const unknown = (r.reset ?? []).filter((c) => !Object.hasOwn(declared, c));
  if (unknown.length) return { reject: `unknown counter(s): ${unknown.join(", ")}` };
  const to = r.to ?? st.step;
  if (!stepOf(ctx.workflow, to)) return { reject: `no step '${to}' in workflow ${ctx.workflow.name}` };
  const counters = { ...st.counters };
  for (const c of r.reset ?? []) counters[c] = 0;
  const next = enterStep({ ...st, counters }, ctx.workflow, to, ctx.now);
  const resets = r.reset?.length ? ` (reset ${r.reset.join(", ")})` : "";
  return { state: next, log: `unstick → ${to}${resets}`, advance: { from: st.step, outcome: "unstick", to } };
}

/** Take the declared edge for `outcome` at the cursor (W3), counting it (W4). */
function take(st: UnitState, outcome: string, r: Receipt, ctx: ApplyContext, last: LastOutcome): Step1 {
  const wf = ctx.workflow;
  const from = st.step;
  const edge = edgeOf(wf, from, outcome);
  if (!edge) {
    const reason = `${from}.${outcome} has no route`;
    return { state: { ...stuckPark(st, "stuck", reason, r.at, r.receipt_id), last_outcome: last }, log: reason };
  }
  let counters = st.counters;
  let counter: Advance["counter"];
  if (edge.counter) {
    const max = wf.counters?.[edge.counter]?.max ?? 0;
    const value = st.counters[edge.counter] ?? 0;
    if (value + 1 > max) {
      // W4: the edge is not taken; the outcome becomes `exhausted` → $stuck
      const reason = `${edge.counter} ${value}/${max} at ${from}.${outcome}`;
      return {
        state: { ...stuckPark(st, "exhausted", reason, r.at, r.receipt_id), last_outcome: { ...last, outcome: "exhausted", source: "classified" } },
        log: `exhausted: ${reason}`,
      };
    }
    counters = { ...st.counters, [edge.counter]: value + 1 };
    counter = { name: edge.counter, value: value + 1, max };
  }
  const advance: Advance = { from, outcome, to: edge.to, ...(counter ? { counter } : {}) };
  const counted = counter ? ` [${counter.name} ${counter.value}/${counter.max}]` : "";
  const log = `${from}.${outcome} → ${edge.to}${counted}`;
  const base: UnitState = { ...st, counters, last_outcome: last };
  if (edge.to === "$done")
    return { state: { ...base, step: "$done", status: "done", run: null, park: null }, log, advance };
  if (edge.to === "$stuck") {
    const reason = r.kind === "stuck" ? r.reason : `${from}.${outcome} → $stuck`;
    return { state: stuckPark(base, "stuck", reason, r.at, r.receipt_id), log, advance };
  }
  return { state: enterStep(base, wf, edge.to, ctx.now), log, advance };
}

/** Tick-classified outcomes (§10, C1). Agent routes: nudge / retry / park, unless the step overrides them. */
function classify(st: UnitState, r: ReceiptOf<"classify">, step: NonNullable<ReturnType<typeof stepOf>>, ctx: ApplyContext, last: LastOutcome): Step1 {
  const o = r.outcome;
  if (o === "exhausted") {
    const reason = r.detail ?? `exhausted at ${st.step}`;
    return { state: { ...stuckPark(st, "exhausted", reason, r.at, r.receipt_id), last_outcome: last }, log: `exhausted: ${reason}` };
  }
  if (step.type !== "agent") {
    if (!(step.type === "check" ? ["pass", "fail"] : step.type === "gate" ? ["approve", "reject"] : step.type === "git" ? ["done", "conflict"] : ["done", "stuck"]).includes(o))
      return { reject: `outcome '${o}' cannot be classified for a ${step.type} step` };
    return take(st, o, r, ctx, last);
  }
  if ((OVERRIDABLE_ROUTES as readonly string[]).includes(o) && edgeOf(ctx.workflow, st.step, o)) return take(st, o, r, ctx, last);
  return agentRoute(st, step, r, ctx, last);
}

function agentRoute(st: UnitState, step: AgentStep, r: ReceiptOf<"classify">, ctx: ApplyContext, last: LastOutcome): Step1 {
  const o = r.outcome;
  const withLast = (s: UnitState) => ({ ...s, last_outcome: last });
  switch (o) {
    case "silent":
    case "timeout":
    case "stalled": {
      // R4.2: no way to deliver a nudge (runner neither types nor resumes) — decide routed it to a
      // fresh session, counted as a retry, not a nudge
      if (r.route === "retry") return retryRoute(st, step, r, ctx, withLast, o);
      const max = step.nudges ?? ctx.limits.nudges;
      if (st.nudges_used < max)
        return {
          state: withLast({ ...st, nudges_used: st.nudges_used + 1, status: "running" }),
          log: `${o}: nudge ${st.nudges_used + 1}/${max}`,
          route: "nudge",
        };
      const reason = `${o}: nudges ${st.nudges_used}/${max} at ${st.step}`;
      return { state: withLast(stuckPark(st, "exhausted", reason, r.at, r.receipt_id)), log: `exhausted: ${reason}` };
    }
    case "died":
      return retryRoute(st, step, r, ctx, withLast, o);
    case "ask": {
      const q = r.detail ?? "the agent is waiting for input";
      return { state: withLast(park(st, "ask", q, r.at, "parked", r.receipt_id)), log: `asks: ${q}` };
    }
    default:
      return { reject: `outcome '${o}' cannot be classified for an agent step` };
  }
}

/** C1 retry: a fresh session for the same step while retries last, else exhausted. */
function retryRoute(st: UnitState, step: AgentStep, r: ReceiptOf<"classify">, ctx: ApplyContext, withLast: (s: UnitState) => UnitState, o: string): Step1 {
  const max = step.retries ?? ctx.limits.retries;
  if (st.retries_used < max)
    return {
      state: withLast({ ...st, retries_used: st.retries_used + 1, status: "ready", run: null }),
      log: `${o}: retry ${st.retries_used + 1}/${max} in a fresh session`,
      route: "retry",
    };
  const reason = `${o}: retries ${st.retries_used}/${max} at ${st.step}`;
  return { state: withLast(stuckPark(st, "exhausted", reason, r.at, r.receipt_id)), log: `exhausted: ${reason}` };
}

/** Helper for receipt writers (act, CLI): the route a classified outcome takes, for the receipt's `route` field. */
export function routeFor(wf: Workflow, stepName: string, outcome: string): string {
  const edge = edgeOf(wf, stepName, outcome);
  if (edge) return edge.to;
  if (["silent", "timeout", "stalled"].includes(outcome)) return "nudge";
  if (outcome === "died") return "retry";
  if (outcome === "ask") return "park";
  return "$stuck";
}
