/**
 * Receipt application: a pure fold of numbered receipts over
 * `UnitState` given the unit's pinned workflow. Receipts numbered ≤ applied_through are
 * skipped, so re-applying after a crash is idempotent. Receipts whose step/attempt do not
 * match the cursor are rejected, never applied.
 */
import {
  type AgentStep,
  CLASSIFIED_OUTCOMES,
  type LastOutcome,
  type ParkInfo,
  type ParkKind,
  type Receipt,
  type ReceiptOf,
  type UnitState,
  type Workflow,
} from "@norn/schema";
import type { NumberedReceipt, UnitRef } from "./facts.ts";
import { edgeOf, OVERRIDABLE_ROUTES, stepOf } from "./workflow.ts";
import { cmd } from "./commands.ts";
import { stepLimits } from "./policy.ts";
import { waitsForBaseUpdate } from "./verbs.ts";

export interface ApplyContext {
  workflow: Workflow;
  /** ISO time of this tick (facts.now) */
  now: string;
  tick_id?: string | null;
}

export interface Advance {
  from: string;
  outcome: string;
  to: string;
  counter?: { name: string; value: number; max: number };
  /** Counters reset to 0 by taking this edge (their `reset_on`), journaled with the advance */
  reset?: string[];
  /**
   * A person's receipt moved the cursor (a workflow switch, an unstick, an update),
   * not a step's outcome: no step ended, so its commit is no boundary (no `Norn-Outcome`). Absent = an outcome's edge.
   */
  moved?: true;
}

/**
 * Why a takeover restarts the step — the same words in `norn story checkout`'s output,
 * the take's log and the brief's "Why this attempt". `gone` is the record's `Norn-Branch-Commit`.
 */
export const branchRewrittenLine = (story: string, gone: string, step: string, attempt: number): string =>
  `the branch of ${story} was rewritten since the record (${gone} is gone); restarting ${step} as attempt ${attempt}`;

/**
 * What a takeover with the record lost says — in `norn story checkout`'s output, the
 * take's log and the brief's "Why this attempt". `holder` is the claim's holder the record was on
 * (null: the claim was free, its holder unknown).
 */
export const recordLostLine = (story: string, holder: string | null, step: string): string =>
  `the run record of ${story} was on ${holder ?? "the machine that last held it"} and is lost; restarting ${step} from the branch`;

/**
 * The step a takeover with the record lost restarts, from the story unit's last
 * boundary commit on the branch (`last`, store `lastBoundary`: the newest with `Norn-Outcome`; its
 * `Norn-Step` it ended and its `Norn-Next`): the step that boundary moved the cursor to when `wf` has it;
 * else (`$done`, or another round's step) the step it ended when `wf` has that; else, or with no
 * boundary (a branch only an older norn committed to: it wrote no `Norn-Outcome`), the workflow's first step.
 */
export function restartStepOf(wf: Workflow, last: { ended: string; next: string | null } | null): string {
  for (const at of [last?.next, last?.ended]) if (at && stepOf(wf, at)) return at;
  return wf.start;
}

/**
 * What applying take receipt `r` at cursor `st` does about a rewritten branch.
 * `restart`: the cursor is the one the record was written at, or one a session already ran in — it
 * judged code that is gone, so the step is entered again as a new attempt. `fresh`: the record's own
 * receipts just entered this attempt and nothing ran in it yet, so it is the restart as it is
 * (attempts and visits count once). `null`: nothing to restart (no rewrite, `$done`, stuck).
 */
export function rewriteRestart(st: UnitState, r: Receipt, wf: Workflow): "restart" | "fresh" | null {
  if (r.kind !== "take" || !r.rewritten || st.status === "stuck" || st.status === "corrupt" || stepOf(wf, st.step) === null) return null;
  return (st.step === r.step && st.attempt === r.attempt) || st.run ? "restart" : "fresh";
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
  /** in-step route of the last receipt: nudge the same session, or retry in a fresh one */
  route: "nudge" | "retry" | null;
  /** answer text to type into the live session, set when the last receipt was an answer */
  deliver: string | null;
  /** one line per applied receipt, for the commit message (never written into the handoff) */
  log: string[];
}

const SOURCE = { agent: "reported", human: "human", norn: "classified" } as const;

/** First state of a unit: cursor entered at `workflow.start`. */
export function initialState(args: {
  unit: UnitRef;
  workflow: Workflow;
  workflowName: string;
  workflowHash: string;
  now: string;
  mode?: UnitState["mode"];
  tick_id?: string | null;
  /** The step to enter instead of `workflow.start` */
  at?: string;
  /** The story round (story unit) or the round that started the slice; omitted = 1 */
  round?: number;
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
  if (args.round !== undefined && args.round > 1) base.round = args.round;
  if (args.mode) base.mode = args.mode;
  return enterStep(base, workflow, args.at ?? workflow.start, now);
}

/** Enter `name`: new attempt, within-step limits reset, status by step type (gate/attended park). */
function enterStep(prev: UnitState, wf: Workflow, name: string, now: string): UnitState {
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
  if (!step) return park(st, "workflow", `step '${name}' does not exist in workflow ${wf.name}`, now, "stuck");
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

/** Apply every receipt numbered above `state.applied_through`, ascending. Pure. */
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
    // mode is story-level, not bound to a step
    return { state: { ...st, mode: r.mode }, log: `mode ${r.previous} → ${r.mode}` };
  }
  if (r.kind === "take") {
    // A takeover is a record, not a cursor move — applied at any cursor, like mode
    const from = r.previous_holder ? ` from ${r.previous_holder}${r.forced ? " (forced)" : r.expired ? " (expired)" : ""}` : "";
    // A take whose record was lost already is the new round's first entry: nothing to move
    const log = `taken by ${r.who ?? r.by}${from}${r.record_lost ? `; ${recordLostLine(st.story, r.previous_holder, r.step)}` : ""}`;
    // The record judged code that is gone — the step the cursor is at when the take
    // applies (after the record's own unapplied receipts) starts again as a new attempt,
    // counters and history kept; never at `$done` or stuck (`rewriteRestart`)
    const how = rewriteRestart(st, r, wf);
    if (!how || !r.rewritten) return { state: st, log };
    const next = how === "restart" ? enterStep(st, wf, st.step, ctx.now) : st;
    const line = `${log}; ${branchRewrittenLine(st.story, r.rewritten.gone, next.step, next.attempt)}`;
    return how === "restart" ? { state: next, log: line, advance: { from: st.step, outcome: "take", to: st.step } } : { state: next, log: line };
  }
  if (st.status === "corrupt") return { reject: "unit is corrupt" };
  if (r.slice !== undefined && r.slice !== st.slice) return { reject: `receipt for unit ${r.slice ?? st.story}, not ${st.slice ?? st.story}` };
  // `norn story update-branch` may re-enter a story unit that is done (PR unmerged), at a gate, or stuck
  if (r.kind === "update") return updateFrom(st, r, ctx);
  if (st.step === "$done") return { reject: "unit is done" };
  if (r.step !== st.step || r.attempt !== st.attempt)
    return { reject: `stale: receipt for ${r.step}#${r.attempt}, cursor at ${st.step}#${st.attempt}` };

  const step = stepOf(wf, st.step);
  if (r.kind === "workflow") {
    if (!stepOf(wf, r.to)) return { reject: `workflow ${r.name} has no step '${r.to}'` };
    const next = enterStep({ ...st, workflow: r.name, workflow_hash: r.to_hash }, wf, r.to, ctx.now);
    return { state: next, log: `workflow → ${r.name} at ${r.to}`, advance: { from: st.step, outcome: "workflow", to: r.to, moved: true } };
  }
  if (r.kind === "unstick") return unstick(st, r, ctx);
  if (!step) return { reject: `step '${st.step}' no longer exists; use ${cmd.runRerun(undefined, { step: "<step>" })}` };
  if (st.status === "stuck") return { reject: `unit is stuck: ${st.park?.reason ?? "unknown"}; use ${cmd.runRerun()}` };
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
      if (st.status === "running" && st.run) return { reject: `step ${st.step}#${st.attempt} already has run ${st.run.run_id}` };
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
        // What the tick needs to resolve the implicit ask or type an answer into the prompt
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
      // A person's stuck (`norn run cancel`) ends the run here; the step's `stuck` edge is the agent's
      if (r.by !== "human" && edgeOf(wf, st.step, "stuck")) return take(st, "stuck", r, ctx, lastOutcome("stuck"));
      return {
        state: { ...stuckPark(st, "stuck", r.reason, r.at, r.receipt_id), last_outcome: lastOutcome("stuck") },
        log: `${st.step}#${st.attempt} stuck: ${r.reason}`,
      };
    }
    case "answer": {
      if (st.status !== "parked" || st.park?.kind !== "ask")
        return { reject: st.park?.kind === "gate" ? "gate needs approve or reject" : "unit is not waiting for an answer" };
      const resumed: UnitState = { ...st, park: null };
      // The agent moved on by itself, or `norn story answer` already typed it: nothing to deliver
      if ((r.by === "agent" || r.delivered) && st.run) return { state: { ...resumed, status: "running" }, log: `answered: ${r.answer}` };
      // Same session while it lives; manual runs get the answer from the person; else fresh session from the handoff
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
    case "round":
      // A round receipt starts a new round folder; decide applies it alone (round.start)
      return { reject: "a round receipt is applied by round.start, not in a round" };
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

/**
 * The check step whose fail sent the unit to the step it is at, while that fail is still
 * its last outcome and the step has not ended (ready to launch or running); null otherwise. A rerun at
 * that check (`norn run rerun <unit> --step <check>`) retries it on the same code without a cancel first:
 * applying it moves the cursor off the run, and decide stops the run's session.
 */
export function checkRetryOf(wf: Workflow, st: UnitState): string | null {
  const last = st.last_outcome;
  if (!last || (st.status !== "ready" && st.status !== "running")) return null;
  if (stepOf(wf, last.step)?.type !== "check" || last.outcome !== "fail" || last.step === st.step) return null;
  return edgeOf(wf, last.step, last.outcome)?.to === st.step ? last.step : null;
}

function unstick(st: UnitState, r: ReceiptOf<"unstick">, ctx: ApplyContext): Step1 {
  const retry = r.to !== undefined && r.to === checkRetryOf(ctx.workflow, st);
  if (st.status !== "stuck" && st.status !== "parked" && !retry) return { reject: `unit is ${st.status}, nothing to unstick` };
  const declared = ctx.workflow.counters ?? {};
  const unknown = (r.reset ?? []).filter((c) => !Object.hasOwn(declared, c));
  if (unknown.length) return { reject: `unknown counter(s): ${unknown.join(", ")}` };
  const to = r.to ?? st.step;
  if (!stepOf(ctx.workflow, to)) return { reject: `no step '${to}' in workflow ${ctx.workflow.name}` };
  const counters = { ...st.counters };
  for (const c of r.reset ?? []) counters[c] = 0;
  const next = enterStep({ ...st, counters }, ctx.workflow, to, ctx.now);
  const resets = r.reset?.length ? ` (reset ${r.reset.join(", ")})` : "";
  return { state: next, log: `unstick → ${to}${resets}`, advance: { from: st.step, outcome: "unstick", to, moved: true } };
}

/**
 * A person sends the story unit back to its base-update step — from `$done` (the PR is not
 * merged), a gate, or stuck; or from an agent step held by drifted skills (the receipt names
 * them, so a replay decides the same). Counters are unchanged; the ready gate is passed again later.
 */
function updateFrom(st: UnitState, r: ReceiptOf<"update">, ctx: ApplyContext): Step1 {
  if (st.slice !== null) return { reject: `${cmd.storyUpdateBranch()} is for the story unit` };
  if (r.step !== st.step || r.attempt !== st.attempt) return { reject: `stale: receipt for ${r.step}#${r.attempt}, cursor at ${st.step}#${st.attempt}` };
  const held = st.status === "ready" && !!r.skills_drift?.length && stepOf(ctx.workflow, st.step)?.type === "agent";
  if (!waitsForBaseUpdate(st, held)) return { reject: `unit is ${st.status}${st.park ? ` (${st.park.kind})` : ""}; update needs it done, at a gate, stuck or held by drifted skills` };
  if (!stepOf(ctx.workflow, r.to)) return { reject: `no step '${r.to}' in workflow ${ctx.workflow.name}` };
  const next = enterStep(st, ctx.workflow, r.to, ctx.now);
  return { state: next, log: `update by ${r.who ?? r.by}: ${st.step} → ${r.to}`, advance: { from: st.step, outcome: "update", to: r.to, moved: true } };
}

/** Take the declared edge for `outcome` at the cursor, counting it. */
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
      // The edge is not taken; the outcome becomes `exhausted` → $stuck
      const reason = `${edge.counter} ${value}/${max} at ${from}.${outcome}`;
      const parked = stuckPark(st, "exhausted", reason, r.at, r.receipt_id);
      // The way out is the edge's target with the counter reset; record it, never parse `reason`
      if (parked.park) parked.park.counter = { name: edge.counter, max, outcome, to: edge.to };
      return {
        state: { ...parked, last_outcome: { ...last, outcome: "exhausted", source: "classified" } },
        log: `exhausted: ${reason}`,
      };
    }
    counters = { ...st.counters, [edge.counter]: value + 1 };
    counter = { name: edge.counter, value: value + 1, max };
  }
  // Counters declaring `reset_on: <from>.<outcome>` start over (e.g. base_conflict_loop on update.done)
  const reset = Object.entries(wf.counters ?? {})
    .filter(([name, c]) => c.reset_on === `${from}.${outcome}` && (counters[name] ?? 0) > 0)
    .map(([name]) => name);
  if (reset.length) counters = { ...counters, ...Object.fromEntries(reset.map((c) => [c, 0])) };
  const advance: Advance = { from, outcome, to: edge.to, ...(counter ? { counter } : {}), ...(reset.length ? { reset } : {}) };
  const counted = counter ? ` [${counter.name} ${counter.value}/${counter.max}]` : "";
  const log = `${from}.${outcome} → ${edge.to}${counted}${reset.length ? ` (reset ${reset.join(", ")})` : ""}`;
  const base: UnitState = { ...st, counters, last_outcome: last };
  if (edge.to === "$done")
    return { state: { ...base, step: "$done", status: "done", run: null, park: null }, log, advance };
  if (edge.to === "$stuck") {
    const reason = r.kind === "stuck" ? r.reason : `${from}.${outcome} → $stuck`;
    return { state: stuckPark(base, "stuck", reason, r.at, r.receipt_id), log, advance };
  }
  return { state: enterStep(base, wf, edge.to, ctx.now), log, advance };
}

/** Tick-classified outcomes. Agent routes: nudge / retry / park, unless the step overrides them. */
function classify(st: UnitState, r: ReceiptOf<"classify">, step: NonNullable<ReturnType<typeof stepOf>>, ctx: ApplyContext, last: LastOutcome): Step1 {
  const o = r.outcome;
  if (o === "exhausted") {
    const reason = r.detail ?? `exhausted at ${st.step}`;
    return { state: { ...stuckPark(st, "exhausted", reason, r.at, r.receipt_id), last_outcome: last }, log: `exhausted: ${reason}` };
  }
  if (step.type !== "agent") {
    if (!(CLASSIFIED_OUTCOMES[step.type] as readonly string[]).includes(o))
      return { reject: `outcome '${o}' cannot be classified for a ${step.type} step` };
    // A git step that cannot run (dirty worktree, diverged branch) parks under Unblock with the reason
    if (step.type === "git" && o === "stuck") {
      const reason = r.detail ?? `${st.step}: stuck`;
      return { state: { ...stuckPark(st, "stuck", reason, r.at, r.receipt_id), last_outcome: last }, log: `${st.step} stuck: ${reason}` };
    }
    if (step.type === "gate") {
      // Only `stale` is tick-classified at a gate, and only through a declared route
      if (o !== "stale" || st.park?.kind !== "gate" || !edgeOf(ctx.workflow, st.step, o)) return { reject: `outcome '${o}' cannot be classified at gate ${st.step}` };
      return take({ ...st, park: null, status: "ready" }, o, r, ctx, last);
    }
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
      // No way to deliver a nudge (runner neither types nor resumes) — decide routed it to a
      // fresh session, counted as a retry, not a nudge
      if (r.route === "retry") return retryRoute(st, step, r, ctx, withLast, o);
      const max = stepLimits(ctx.workflow, step).nudges;
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

/** Retry: a fresh session for the same step while retries last, else exhausted. */
function retryRoute(st: UnitState, step: AgentStep, r: ReceiptOf<"classify">, ctx: ApplyContext, withLast: (s: UnitState) => UnitState, o: string): Step1 {
  const max = stepLimits(ctx.workflow, step).retries;
  if (st.retries_used < max)
    return {
      state: withLast({ ...st, retries_used: st.retries_used + 1, status: "ready", run: null }),
      log: `${o}: retry ${st.retries_used + 1}/${max} in a fresh session`,
      route: "retry",
    };
  const reason = `${o}: retries ${st.retries_used}/${max} at ${st.step}`;
  return { state: withLast(stuckPark(st, "exhausted", reason, r.at, r.receipt_id)), log: `exhausted: ${reason}` };
}

/**
 * The route a classify receipt records, read from what applying it actually did:
 * the in-step route (`nudge` / `retry`) when there is one, else the edge taken, else `$stuck` when
 * the unit stopped (an exhausted counter, nudges or retries included), else `park` for an ask.
 * Receipt writers apply the receipt in memory first and record this, so the route never disagrees
 * with where the next tick's apply sends the unit. `null` when the receipt was not applied.
 */
export function routeOf(res: ApplyResult): ReceiptOf<"classify">["route"] | null {
  if (!res.applied.length) return null;
  if (res.route) return res.route;
  if (res.advance) return res.advance.to as ReceiptOf<"classify">["route"];
  if (res.state.status === "stuck") return "$stuck";
  if (res.state.status === "parked" && res.state.park?.kind === "ask") return "park";
  return null;
}
