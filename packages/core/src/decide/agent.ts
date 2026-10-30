/**
 * decide for agent steps: applying receipts with answer delivery (B2), starting and resuming runs,
 * classifying live runs (§10, C1), launch-unknown recovery (R5), implicit asks (R6) and the launch
 * prompt check (R9.1).
 */
import {
  type AgentStep,
  parseDuration,
  type ReceiptOf,
  type UnitState,
  type Workflow,
} from "@norn/schema";
import type { AgentLaunch, NewReceipt, SessionInput } from "../actions.ts";
import { applyReceipts, routeOf } from "../apply.ts";
import { AUTO_PROMPT, cmd, NUDGE_TEXT } from "../commands.ts";
import type { NumberedReceipt, RunFacts, StoryFacts, UnitFacts } from "../facts.ts";
import { effectiveMode, firstLine, sessionStartedNoTurn, unitWorktree } from "../policy.ts";
import { promptKeys } from "../prompt.ts";
import type { RunnerCapabilities, SessionRef } from "../ports.ts";
import { epoch } from "../time.ts";
import { stepOf } from "../workflow.ts";
import { applyCtx, commitFor, type Ctx, emitApplied, nextReceiptNumber, nornReceipt, synth, unitItem } from "./receipts.ts";

export function applyAction(ctx: Ctx, story: StoryFacts, uf: UnitFacts, st: UnitState, wf: Workflow, receipts: readonly NumberedReceipt[], rule: string): void {
  const res = applyReceipts(st, receipts, applyCtx(ctx, wf));
  let state = res.state;
  let input: SessionInput | null = null;
  let launch: AgentLaunch | null = null;
  const extra: NewReceipt[] = [];
  const run = res.state.run;
  if (res.deliver && run?.session) {
    // B2: type the answer into the same session while it lives and takes input. A headless session
    // has no pane (and its process ends with the turn): continue the same agent session with
    // `--resume <agent_session_id>` and the answer as the prompt. Without a resumable id, a fresh
    // session for the step starts from the handoff.
    const rf = uf.run?.run_id === run.run_id ? uf.run : null;
    const gone = rf?.process_alive === false || rf?.pane?.alive === false;
    // R7.2: a session on another machine is neither typed into nor resumed here (its agent session
    // lives there); R4.1: typing needs a runner that can `send`
    const foreign = foreignRun(ctx, run);
    const caps = runnerCaps(ctx);
    if (!foreign && caps.send && run.session.runner !== "headless" && !gone) {
      input = { run_id: run.run_id, session: sessionRef(run), text: res.deliver };
      // R6.2: an implicit pane prompt takes keystrokes (option number / arrows + enter), not a pasted prompt
      if (st.park?.kind === "ask" && st.park.implicit === "pane") input.keys = promptKeys(st.park, res.deliver).keys;
    }
    else {
      const step = stepOf(wf, res.state.step);
      const resumeId = foreign ? undefined : resumeIdOf(run, rf);
      const cwd = unitWorktree(story, uf);
      if (step?.type === "agent" && resumeId && cwd && ctx.facts.machine.runner) {
        // R5.3: the resumed run is the answered one; any other active run of the step blocks it
        const active = activeRun(ctx, uf, run.run_id);
        if (active) return ctx.noop(uf.unit, "answer.resume.wait_active", `run ${active} of ${res.state.step} still shows hook activity (R5.3)`);
        const resumed = resumeLaunch(ctx, story, uf, res.state, wf, step, run, { resumeId, cwd, prompt: res.deliver, n: nextReceiptNumber(uf) });
        if (!resumed) return ctx.noop(uf.unit, "answer.resume.queued", `answer waits: max_agents ${ctx.config.max_agents} in use (K1)`);
        extra.push(resumed.receipt);
        ({ state, launch } = resumed);
      } else state = { ...res.state, status: "ready", run: null };
    }
  }
  // S7/O2: `story edit --at` / `run rerun` re-enter a step: the old run's session must not keep working
  const moved = res.applied.some((n) => {
    const k = receipts.find((r) => r.n === n)?.receipt.kind;
    return k === "workflow" || k === "unstick";
  });
  const kill = moved && st.run?.session && state.run?.run_id !== st.run.run_id ? sessionRef(st.run) : null;
  const what = res.advance ? `${res.advance.from}.${res.advance.outcome} → ${res.advance.to}${res.advance.reset ? ` (reset ${res.advance.reset.join(", ")})` : ""}` : (res.log.at(-1) ?? "receipts");
  const applied = !res.applied.length ? "receipts.reject" : launch ? `${rule}.resume` : rule;
  emitApplied(ctx, story, uf, applied, res, extra, { message: `norn: ${uf.unit.key} ${what}`, step: st.step }, { input, launch, kill, state });
}

function sessionRef(run: NonNullable<UnitState["run"]>): SessionRef {
  const s = run.session as NonNullable<typeof run.session>;
  const ref: SessionRef = { runner: s.runner, session_id: s.session_id };
  if (s.pane_id) ref.pane_id = s.pane_id;
  if (run.process) ref.process = run.process;
  return ref;
}

// ---------------------------------------------------------------- agent steps

function launchFor(ctx: Ctx, story: StoryFacts, uf: UnitFacts, st: UnitState, step: AgentStep, run_id: string, cwd: string): AgentLaunch {
  const agent = step.agent ?? ctx.config.default_agent;
  const env: Record<string, string> = { NORN_STORY: story.key, NORN_RUN: run_id };
  if (uf.unit.slice) env.NORN_SLICE = uf.unit.slice;
  Object.assign(env, ctx.slotEnv(uf.worktree?.slot ?? null));
  const launch: AgentLaunch = { run_id, agent, cwd, prompt: AUTO_PROMPT, env, title: `${uf.unit.key} ${st.step}` };
  const model = step.model ?? ctx.config.agents[agent]?.model;
  if (model) launch.model = model;
  return launch;
}

function startedReceipt(ctx: Ctx, st: UnitState, step: AgentStep, run_id: string, worktree: string, retry: boolean): ReceiptOf<"started"> {
  const agent = step.agent ?? ctx.config.default_agent;
  const r = nornReceipt(ctx, st, "started", {
    run_id,
    how: "auto",
    agent,
    worktree,
    // R7.1: where and by whom the run was launched (liveness is judged on that machine only, R7.2)
    machine: ctx.facts.machine.holder,
    heartbeat_id: ctx.heartbeat,
  });
  const model = step.model ?? ctx.config.agents[agent]?.model;
  if (model) r.model = model;
  if (retry) r.retry = true;
  return r;
}

export function startRun(ctx: Ctx, story: StoryFacts, uf: UnitFacts, st: UnitState, wf: Workflow, step: AgentStep): void {
  const ref = uf.unit;
  const { mode, downgraded } = effectiveMode(story.mode, !!step.attended, ctx.facts.machine.runner);
  if (mode === "manual")
    return ctx.noop(ref, downgraded ? "agent.ready.manual.no_runner" : "agent.ready.manual", downgraded ? "auto requested, no runner; running manual (MO2)" : `ready: a person starts an agent and runs ${cmd.brief()}`);
  const cwd = unitWorktree(story, uf);
  if (!cwd) return ctx.noop(ref, "agent.no_worktree", "unit worktree missing");
  // R5.3 (A14b): never a second agent beside a run of this step that is still active
  const active = activeRun(ctx, uf, null);
  if (active) return ctx.noop(ref, "agent.start.wait_active", `run ${active} of ${st.step}#${st.attempt} still shows hook activity; no new run beside it (R5.3)`);
  if (ctx.agentsFree <= 0) return ctx.noop(ref, "agent.queued", `queued: max_agents ${ctx.config.max_agents} in use (K1)`);
  ctx.agentsFree--;
  const run_id = ctx.id();
  const receipt = startedReceipt(ctx, st, step, run_id, cwd, st.retries_used > 0);
  const { nr, res } = synth(ctx, st, wf, nextReceiptNumber(uf), receipt);
  ctx.emit({
    kind: "start_run",
    unit: ref,
    rule: st.retries_used > 0 ? "agent.start.retry" : "agent.start",
    step: st.step,
    launch: launchFor(ctx, story, uf, st, step, run_id, cwd),
    receipts: [nr],
    state: res.state,
    // R2.1 (N6): the started receipts reach the record in the launch tick, not by a recover.commit
    commit: commitFor(ctx, story, uf, `norn: ${ref.key} ${st.step} started (run ${run_id})`, st.step),
  });
}

/** R7.2 (M4, N5): a run launched on another machine — its pid, pane and session mean nothing here. */
function foreignRun(ctx: Ctx, run: NonNullable<UnitState["run"]>): boolean {
  return !!run.machine && run.machine !== ctx.facts.machine.holder;
}

/** R4.1: this machine's runner capabilities; unknown = send only (the behaviour before R4). */
function runnerCaps(ctx: Ctx): RunnerCapabilities {
  return ctx.facts.machine.runner_capabilities ?? { send: true, resume: false };
}

/**
 * R5.3 (A14b): a run of the cursor step/attempt, other than `except`, with hook activity within the
 * stalled window — no new run (start, retry, answer or nudge resume) starts beside it. Runs seen
 * ending (`session_end`, classified `died`) or observed dead this tick do not count.
 */
function activeRun(ctx: Ctx, uf: UnitFacts, except: string | null): string | null {
  const window = parseDuration(ctx.config.limits.stalled);
  const dead = uf.run && (uf.run.process_alive === false || uf.run.pane?.alive === false) ? uf.run.run_id : null;
  for (const r of uf.step_runs ?? []) {
    if (r.run_id === except || r.run_id === dead || r.ended || r.last_hook_at === null) continue;
    if (ctx.facts.now - r.last_hook_at <= window) return r.run_id;
  }
  return null;
}

/** Agent-tool session id to `--resume` a run with (B2): recorded in state, else the newest hook's. */
function resumeIdOf(run: NonNullable<UnitState["run"]>, rf: UnitFacts["run"]): string | undefined {
  return run.agent_session_id ?? (rf?.run_id === run.run_id ? rf.hooks.findLast((h) => h.agent_session_id)?.agent_session_id : undefined);
}

/**
 * B2/R4.2: continue `run`'s agent session with `--resume <resumeId>` and `prompt` (an answer or the
 * nudge text): a `started` receipt numbered `n` for the same run, and the launch. Answer and nudge
 * resume share it, so they share one lease rule (K1): the run's own agent lease is still held by
 * the run being resumed, so it does not count against max_agents; any other resume takes a free
 * agent slot. Null when none is free — the caller queues.
 */
function resumeLaunch(
  ctx: Ctx,
  story: StoryFacts,
  uf: UnitFacts,
  st: UnitState,
  wf: Workflow,
  step: AgentStep,
  run: NonNullable<UnitState["run"]>,
  o: { resumeId: string; cwd: string; prompt: string; n: number },
): { receipt: NewReceipt; state: UnitState; launch: AgentLaunch } | null {
  const ownLease = uf.lease?.kind === "agent" && uf.lease.run_id === run.run_id;
  if (!ownLease) {
    if (ctx.agentsFree <= 0) return null;
    ctx.agentsFree--;
  }
  const started: ReceiptOf<"started"> = { ...startedReceipt(ctx, st, step, run.run_id, o.cwd, false), agent_session_id: o.resumeId, ...(run.agent ? { agent: run.agent } : {}) };
  const { nr, res } = synth(ctx, st, wf, o.n, started);
  const launch: AgentLaunch = { ...launchFor(ctx, story, uf, st, step, run.run_id, o.cwd), prompt: o.prompt, resume: o.resumeId };
  if (run.agent) launch.agent = run.agent;
  return { receipt: nr, state: res.state, launch };
}

/** §10 classification of a live agent run from facts (C1, C2, MO4). */
export function classifyRun(ctx: Ctx, story: StoryFacts, uf: UnitFacts, st: UnitState, wf: Workflow, step: AgentStep): void {
  const ref = uf.unit;
  const run = st.run;
  const rf = uf.run;
  if (!run) return ctx.noop(ref, "agent.running.no_run", "running without a run record");
  if (!rf || rf.run_id !== run.run_id) return ctx.noop(ref, "agent.running.unobserved", `no facts for run ${run.run_id}`);
  const now = ctx.facts.now;
  const touched = Math.max(epoch(run.started_at), epoch(st.updated_at));
  const lastHook = rf.hooks.at(-1);
  const hookAt = lastHook ? epoch(lastHook.at) : 0;
  const stalledMs = parseDuration(ctx.config.limits.stalled);

  // R7.2: process and pane liveness only for runs started on this machine
  const foreign = foreignRun(ctx, run);
  if (foreign && run.heartbeat_id !== ctx.heartbeat) {
    // the story was taken from the heartbeat that launched it: judged by its hooks and the claim alone
    const takenAt = story.claim.state === "mine" ? epoch(story.claim.blob.acquired_at) : 0;
    if (now - Math.max(touched, hookAt, takenAt) > stalledMs) return routeOutcome(ctx, story, uf, st, wf, step, { outcome: "died", rule: "agent.died.foreign", detail: "foreign run, holder changed" }, []);
    return ctx.noop(ref, "agent.running.foreign", `run ${run.run_id} started on ${run.machine}; no hook activity yet for ${ctx.config.limits.stalled} after the take (R7.2)`);
  }
  const died = !foreign && (rf.process_alive === false || rf.pane?.alive === false);
  let outcome: string | null = null;
  let rule = "";
  let detail: string | undefined;
  if (died) [outcome, rule, detail] = ["died", "agent.died", diedDetail(rf, now - epoch(run.started_at))];
  else if (!step.attended) {
    const waiting = (rf.pane?.state === "waiting_input" && (rf.pane.since ?? touched + 1) > touched) || (lastHook && (lastHook.event === "waiting_input" || lastHook.event === "permission_prompt") && hookAt > touched);
    const deadline = parseDuration(step.deadline ?? ctx.config.limits.deadline);
    const turnEnded =
      (lastHook && (lastHook.event === "turn_end" || lastHook.event === "session_end") && hookAt > touched) ||
      ((rf.pane?.state === "idle" || rf.pane?.state === "done") && (rf.pane.since ?? 0) > touched);
    if (waiting) return parkOnImplicitAsk(ctx, story, uf, st, wf, rf, lastHook);
    // R9.1 (M6, A11): the agent session started but never took its launch prompt
    const launch = launchPromptCheck(ctx, story, uf, st, rf);
    if (launch === "acted") return;
    if (launch) [outcome, rule, detail] = launch;
    // the deadline runs from the run's start, not the last state write; after a timeout nudge the
    // agent gets the stalled window before the next one (otherwise every tick would nudge again)
    const started = epoch(run.started_at);
    const lastTimeout = st.last_outcome?.outcome === "timeout" && st.last_outcome.step === st.step && epoch(st.last_outcome.at) >= started ? epoch(st.last_outcome.at) : null;
    const overdue = now - started > deadline && (lastTimeout === null || now - lastTimeout > stalledMs);
    if (outcome) {
      // R9.1 classified it
    } else if (overdue) [outcome, rule, detail] = ["timeout", "agent.timeout", `deadline ${step.deadline ?? ctx.config.limits.deadline} passed`];
    else if (turnEnded) [outcome, rule, detail] = ["silent", "agent.silent", "turn ended without a receipt"];
    else if (now - Math.max(rf.last_activity_at ?? 0, touched) > stalledMs) [outcome, rule, detail] = ["stalled", "agent.stalled", `no activity for ${ctx.config.limits.stalled}`];
  }
  if (!outcome) return ctx.noop(ref, step.attended ? "agent.attended.running" : "agent.running", `run ${run.run_id} in progress`);
  routeOutcome(ctx, story, uf, st, wf, step, { outcome, rule, ...(detail ? { detail } : {}) }, []);
}

/** B3: a run that died before it got going (no hook yet, or within a minute) shows what it printed. */
const EARLY_DEATH_MS = 60_000;
function diedDetail(rf: RunFacts, sinceStart: number): string {
  const early = rf.hooks.length === 0 || sinceStart <= EARLY_DEATH_MS;
  return rf.output && early ? `process gone, no receipt; it printed: ${rf.output}` : "process gone, no receipt";
}

interface Classified {
  outcome: string;
  /** decide rule id, recorded in the classify receipt */
  rule: string;
  detail?: string;
}

/**
 * Write a classify receipt for the unit's run and take its route (C1): nudge (R4.2: `send`, else
 * `resume`, else a counted retry), retry in a fresh session, park or `$stuck`. `prior` are unapplied
 * receipts applied first (R5.2: the `started` receipt of a run whose launch is unknown).
 */
function routeOutcome(ctx: Ctx, story: StoryFacts, uf: UnitFacts, st0: UnitState, wf: Workflow, step: AgentStep, c: Classified, prior: readonly NumberedReceipt[]): void {
  const ref = uf.unit;
  const { outcome, rule, detail } = c;
  const st = prior.length ? applyReceipts(st0, prior, applyCtx(ctx, wf)).state : st0;
  const run = st.run as NonNullable<UnitState["run"]>;
  const rf = uf.run?.run_id === run.run_id ? uf.run : null;
  const n = nextReceiptNumber(uf);
  const receipt = nornReceipt(ctx, st, "classify", { run_id: run.run_id, outcome, rule, route: "park" });
  if (detail) receipt.detail = detail;
  const applyWith = (r: ReceiptOf<"classify">) => synth(ctx, st0, wf, n, r, prior).res;
  let res = applyWith(receipt);
  const foreign = foreignRun(ctx, run);
  // R7.2: a session on another machine is never typed into or killed from here
  const session = run.session && !foreign ? sessionRef(run) : null;
  const { mode } = effectiveMode(story.mode, !!step.attended, ctx.facts.machine.runner);
  const cwd = unitWorktree(story, uf);
  const caps = runnerCaps(ctx);
  const local = !!session && session.runner === ctx.facts.machine.runner;
  const resumeId = resumeIdOf(run, rf);
  if (res.route === "nudge" && mode === "auto" && local && !caps.send && !(caps.resume && resumeId && cwd)) {
    // R4.2: this runner can neither type into the session nor resume it — a fresh session instead,
    // counted as a retry, not a nudge
    receipt.route = "retry";
    res = applyWith(receipt);
  }
  // §10, W4: the route is where applying the receipt sent the unit (an exhausted counter → $stuck)
  receipt.route = routeOf(res) ?? "park";
  if (res.route === "nudge") receipt.counter = { name: "nudges", value: res.state.nudges_used, max: step.nudges ?? ctx.config.limits.nudges };
  if (res.route === "retry") receipt.counter = { name: "retries", value: res.state.retries_used, max: step.retries ?? ctx.config.limits.retries };
  const commit = commitFor(ctx, story, uf, `norn: ${ref.key} ${st.step} ${outcome} → ${receipt.route}`, st.step);
  const snapshot = outcome === "silent" ? { transcript: rf?.transcript ?? null, cwd: cwd ?? "" } : null;
  const receipts: NewReceipt[] = [{ n, receipt }];

  if (res.route === "nudge") {
    // C1 in manual effective mode (or when no session on this machine takes input): norn types
    // into nobody's session. The silent/timeout/stalled outcome is still counted — so the
    // C1 route to `$stuck` after max still holds — but instead of an undelivered nudge the unit
    // shows an inbox item (unitInboxItem: "agent ended its turn without reporting — reopen the
    // agent and run norn brief"), notified once per counted nudge (O3).
    if (mode === "auto" && local && session) {
      // R4.2: type into the live session when the runner can …
      if (caps.send) return ctx.emit({ kind: "nudge", unit: ref, rule: `${rule}.nudge`, input: { run_id: run.run_id, session, text: NUDGE_TEXT }, launch: null, kill: null, snapshot, receipts, state: res.state, commit });
      // … else resume the agent session with the nudge text (the B2 answer path), the old process killed first
      const resumed = resumeLaunch(ctx, story, uf, res.state, wf, step, run, { resumeId: resumeId as string, cwd: cwd as string, prompt: NUDGE_TEXT, n: n + 1 });
      if (!resumed) return ctx.noop(ref, "agent.nudge.queued", `nudge waits: max_agents ${ctx.config.max_agents} in use (K1)`);
      receipts.push(resumed.receipt);
      return ctx.emit({ kind: "nudge", unit: ref, rule: `${rule}.nudge.resume`, input: null, launch: resumed.launch, kill: session, snapshot, receipts, state: resumed.state, commit });
    }
    return ctx.emit({ kind: "classify", unit: ref, rule: `${rule}.surface`, outcome, kill: null, snapshot, receipts, state: res.state, commit });
  }
  if (res.route === "retry") {
    let state = res.state;
    let launch: AgentLaunch | null = null;
    // R5.3: no fresh session while another run of the step shows hook activity (the next tick retries)
    if (mode === "auto" && cwd && ctx.agentsFree > 0 && !activeRun(ctx, uf, run.run_id)) {
      ctx.agentsFree--;
      const run_id = ctx.id();
      const started = startedReceipt(ctx, state, step, run_id, cwd, true);
      receipts.push({ n: n + 1, receipt: started });
      state = synth(ctx, state, wf, n + 1, started).res.state;
      launch = launchFor(ctx, story, uf, state, step, run_id, cwd);
    }
    const retryRule = outcome === "died" ? `${rule}.retry` : `${rule}.retry.no_nudge`;
    return ctx.emit({ kind: "retry_fresh", unit: ref, rule: retryRule, kill: session, launch, receipts, state, commit });
  }
  const stuck = res.state.status === "stuck";
  ctx.emit({
    kind: "classify",
    unit: ref,
    rule: `${rule}.${res.route ?? (stuck ? "stuck" : "route")}`,
    outcome,
    kill: stuck && outcome !== "silent" && outcome !== "died" ? session : null,
    snapshot,
    receipts,
    state: res.state,
    commit,
  });
}

/**
 * R5.1/R5.2 (H2, A10): the run's `started` receipt is not applied — a crash between the receipt and
 * `state.json`. Observe looked for the run (hook facts with its run_id, runner sessions in the unit
 * worktree, processes with its NORN_RUN). Found → adopt: apply the receipt with what was found, and
 * the run continues as a normal running step. Nothing found and no hook activity for 2 watch
 * intervals → `died` (C1, counted). Before that, nothing else is decided for the unit.
 */
export function launchUnknown(ctx: Ctx, story: StoryFacts, uf: UnitFacts, st: UnitState, wf: Workflow): void {
  const ref = uf.unit;
  const rf = uf.run as RunFacts;
  const lu = rf.launch_unknown as NonNullable<RunFacts["launch_unknown"]>;
  const startedNr = uf.unapplied.find((r) => r.n === lu.n);
  if (!startedNr || startedNr.receipt.kind !== "started") return applyAction(ctx, story, uf, st, wf, uf.unapplied, "receipts.apply");
  if (rf.session || rf.hooks.length) {
    const n = nextReceiptNumber(uf);
    const prev = startedNr.receipt;
    const adopted: ReceiptOf<"started"> = { ...prev, receipt_id: ctx.id(), at: ctx.nowIso, tick_id: ctx.facts.tick_id };
    if (rf.session) {
      adopted.session = { runner: rf.session.runner, session_id: rf.session.session_id, ...(rf.session.pane_id ? { pane_id: rf.session.pane_id } : {}) };
      if (rf.session.process) adopted.process = rf.session.process;
    }
    if (lu.agent_session_id) adopted.agent_session_id = lu.agent_session_id;
    const { nr, res } = synth(ctx, st, wf, n, adopted, uf.unapplied);
    const found = rf.session ? `session ${rf.session.session_id}` : `${rf.hooks.length} hook fact(s)`;
    return emitApplied(ctx, story, uf, "run.adopt", res, [nr], { message: `norn: ${ref.key} adopted run ${rf.run_id} (${found})`, step: st.step });
  }
  const grace = 2 * parseDuration(ctx.config.watch_interval);
  if (ctx.facts.now - lu.at <= grace) return ctx.noop(ref, "run.launch_unknown.wait", `run ${rf.run_id} has a started receipt but no state; looking for it for 2 watch intervals (R5.1)`);
  const applied = applyReceipts(st, uf.unapplied, applyCtx(ctx, wf));
  const step = stepOf(wf, applied.state.step);
  if (applied.state.run?.run_id !== rf.run_id || step?.type !== "agent") return applyAction(ctx, story, uf, st, wf, uf.unapplied, "receipts.apply");
  routeOutcome(ctx, story, uf, st, wf, step, { outcome: "died", rule: "agent.died.launch_unknown", detail: "launch unknown: no session, process or hook activity found for the run (R5.2)" }, uf.unapplied);
}

/**
 * §10 implicit ask: the agent waits on a prompt (pane `waiting_input`, or a permission hook). L1 (A7):
 * the question is the prompt's question block and the command its first line; the full screen goes
 * to `screen` (inbox --details, why). R6.2: the parsed options and how one is chosen go with it.
 */
function parkOnImplicitAsk(ctx: Ctx, story: StoryFacts, uf: UnitFacts, st: UnitState, wf: Workflow, rf: RunFacts, lastHook: RunFacts["hooks"][number] | undefined): void {
  const pane = rf.pane?.state === "waiting_input" ? rf.pane : null;
  const prompt = pane?.prompt;
  const question = prompt?.question || (pane ? "the agent waits for input in its pane" : null) || lastHook?.message || "the agent is waiting for input (permission prompt?)";
  const command = prompt?.command ?? firstLine(lastHook?.command);
  const receipt = nornReceipt(ctx, st, "ask", { run_id: st.run?.run_id ?? null, question, implicit: true });
  if (command) receipt.command = command;
  if (prompt?.options.length) receipt.options = prompt.options;
  if (prompt?.choice) receipt.choice = prompt.choice;
  if (pane?.detail) receipt.screen = pane.detail;
  const { nr, res } = synth(ctx, st, wf, nextReceiptNumber(uf), receipt);
  ctx.emit({
    kind: "park",
    unit: uf.unit,
    rule: "agent.ask.implicit",
    notify: unitItem(ctx, story, uf, res.state),
    receipts: [nr],
    state: res.state,
    commit: commitFor(ctx, story, uf, `norn: ${uf.unit.key} ${st.step} waits for input`, st.step),
  });
}

/** Hook events that are the agent waiting, not moving on (R6.1). */
const WAITING_EVENTS = new Set(["waiting_input", "permission_prompt"]);

/**
 * R6.1: why an implicit ask is over, or null: the pane that raised it no longer waits for input, a
 * newer hook event for the run arrived (not another wait), or — handled by the agent verbs — the
 * agent reported. Explicit asks (`norn ask`) are never resolved by facts.
 */
export function implicitAskResolved(st: UnitState, uf: UnitFacts): string | null {
  const park = st.park;
  const rf = uf.run;
  if (park?.kind !== "ask" || !park.implicit || !st.run || rf?.run_id !== st.run.run_id) return null;
  const since = epoch(park.since);
  const pane = rf.pane;
  if (park.implicit === "pane" && pane?.alive && pane.state !== "waiting_input" && pane.state !== "unknown") return `the pane no longer waits for input (${pane.state})`;
  const hook = rf.hooks.find((h) => epoch(h.at) > since && !WAITING_EVENTS.has(h.event));
  return hook ? `hook ${hook.native} at ${hook.at}` : null;
}

/** R6.1: write the `answer` receipt (`by: "agent"`) that ends an implicit ask; the run goes on, nothing is typed. */
export function resolveImplicitAsk(ctx: Ctx, story: StoryFacts, uf: UnitFacts, st: UnitState, wf: Workflow, why: string): void {
  const run = st.run as NonNullable<UnitState["run"]>;
  const answer = nornReceipt(ctx, st, "answer", { run_id: run.run_id, by: "agent", who: run.agent ?? ctx.config.default_agent, answer: `the agent moved on: ${why}` });
  if (st.park?.receipt_id) answer.ask_receipt_id = st.park.receipt_id;
  if (uf.unit.slice) answer.slice = uf.unit.slice;
  const { nr, res } = synth(ctx, st, wf, nextReceiptNumber(uf), answer);
  emitApplied(ctx, story, uf, "agent.ask.implicit.resolved", res, [nr], { message: `norn: ${uf.unit.key} ${st.step} moved on (${why})`, step: st.step });
}

/** R9.1: how long a started session may go without taking its launch prompt, before a re-send and again before `silent`. */
export const LAUNCH_PROMPT_MS = 60_000;

/**
 * R9.1 (M6, A11): the run's newest `session_start` hook has no turn after it. After 60 s the launch
 * prompt is typed again, once per run (a `nudge` that is not counted: it changes only
 * `run.prompt_resent_at`); 60 s after that re-send the run is `silent` ("launch prompt not
 * received"). Only for local sessions of a runner that can type (R4.1); otherwise the usual rules.
 */
function launchPromptCheck(ctx: Ctx, story: StoryFacts, uf: UnitFacts, st: UnitState, rf: RunFacts): "acted" | [string, string, string] | null {
  const run = st.run as NonNullable<UnitState["run"]>;
  const start = sessionStartedNoTurn(rf);
  if (!start) return null;
  if (!run.session || foreignRun(ctx, run) || run.session.runner !== ctx.facts.machine.runner || !runnerCaps(ctx).send) return null;
  const startedAt = epoch(start.at);
  const now = ctx.facts.now;
  if (!run.prompt_resent_at) {
    if (now - startedAt < LAUNCH_PROMPT_MS) return null;
    const state: UnitState = { ...st, run: { ...run, prompt_resent_at: ctx.nowIso }, last_tick_id: ctx.facts.tick_id };
    ctx.emit({
      kind: "nudge",
      unit: uf.unit,
      rule: "agent.launch_prompt.resend",
      input: { run_id: run.run_id, session: sessionRef(run), text: AUTO_PROMPT },
      launch: null,
      kill: null,
      snapshot: null,
      receipts: [],
      state,
      commit: commitFor(ctx, story, uf, `norn: ${uf.unit.key} ${st.step} launch prompt re-sent (run ${run.run_id})`, st.step),
    });
    return "acted";
  }
  const resent = epoch(run.prompt_resent_at);
  // measured from the re-send, or from the last classification (its nudge), so it fires once per 60 s
  if (resent < startedAt || now - Math.max(resent, epoch(st.updated_at)) < LAUNCH_PROMPT_MS) return null;
  return ["silent", "agent.silent.launch_prompt", "launch prompt not received"];
}
