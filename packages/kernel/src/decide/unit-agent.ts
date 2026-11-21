/**
 * Agent step rules. A ready step starts in auto mode and waits for a person in manual mode (until
 * they start it with `run.requested`) or when attended. A run on the record is judged from its classified session: a report is applied, a dead
 * session (or a launch that never produced one) is retried in a fresh one, a question or permission
 * prompt parks the unit for a person, a usage limit waits for its reset without counting against the
 * deadline, a run past its deadline is stopped once, and a quiet agent is nudged. Every nudge and retry is bounded by
 * the step's `nudges` and `retries`; running out routes the classified outcome, which ends `$stuck`
 * unless the step routes it. A quiet agent takes the step's `stalled` route when it has one, else the
 * silent rules; how long it goes without an event before it counts as quiet is the workflow's
 * `defaults.stalled`, else the config's `kernel.silent_after`.
 */
import type { Mode } from "@norn/schema";
import type { Decision } from "../model/actions.ts";
import { type ExecutorCapabilities, launchTarget } from "../model/capabilities.ts";
import type { ClassifiedOutcome } from "../model/receipts.ts";
import type { RunInfo } from "../model/run-state.ts";
import type { SessionFacts } from "../session/view.ts";
import type { AgentStepSpec } from "../workflow/graph.ts";
import { ageMs, applyDecision, intentFor, noop, parkDecision, type UnitView } from "./unit-support.ts";

/** The story's own mode, then the workflow's, then the config's. */
export function effectiveMode(v: UnitView): Mode {
  return v.state.mode ?? v.graph.mode ?? v.ctx.config.mode;
}

/**
 * Manual mode leaves the step's runs to a person, unless they started this visit's run with
 * `run.requested`: that run is then retried and nudged as an auto run is, since nobody sits beside it.
 */
function personDrives(v: UnitView): boolean {
  return effectiveMode(v) === "manual" && v.state.requested === undefined;
}

/**
 * The executors a step may run on, first choice first: an older step's `by:`, else the config's
 * binding of this workflow's step, else of the step's role, else the config's executor.
 */
function candidatesOf(v: UnitView, spec: AgentStepSpec): readonly string[] {
  if (spec.executor !== null) return [spec.executor];
  const bind = v.ctx.config.bind ?? {};
  const own = bind[`${v.state.workflow.name}.${v.state.step}`];
  if (own) return own;
  const byRole = spec.role !== undefined ? bind[spec.role] : undefined;
  return byRole ?? [v.ctx.config.executor];
}

type Match = { ok: true; target: string; caps: ExecutorCapabilities } | { ok: false; rule: string; text: string };

/**
 * Whether `executor` can run the step, and under which name: in its own runner, else in the runner the
 * step's attendance picks (`launchTarget`). A person beside the agent needs a runner with presence, and
 * a docs-only step a harness that denies a tool: both are facts, so a binding that cannot hold the step
 * parks it before any agent starts, never at the launcher.
 */
function matchExecutor(v: UnitView, spec: AgentStepSpec, executor: string): Match {
  const byAttendance = launchTarget(executor, spec.attended);
  const target = capsOf(v, byAttendance) ? byAttendance : executor;
  const caps = capsOf(v, target);
  const runsElsewhere = Object.keys(v.ctx.facts.capabilities.executors).some((k) => k.startsWith(`${executor}@`));
  const fixPresence = `set runners.person to a runner with presence (norn config set runners.person herdr)`;
  if (!caps && runsElsewhere && spec.attended === "person")
    return { ok: false, rule: "agent.no_presence", text: `step '${v.state.step}' is attended: person, but no runner is set for it to run executor '${executor}' in: ${fixPresence}` };
  if (!caps && runsElsewhere) return { ok: false, rule: "agent.no_executor", text: `executor '${executor}' has no runner for attended: ${spec.attended}: set runners.${spec.attended}` };
  if (!caps) return { ok: false, rule: "agent.no_executor", text: `executor '${executor}' is not configured` };
  if (spec.attended === "person" && !caps.attended)
    return {
      ok: false,
      rule: "agent.no_presence",
      text:
        target === executor
          ? `step '${v.state.step}' is attended: person, but executor '${executor}' runs in a runner without presence, where nobody could work beside its agent: give it one with presence (norn config set executors.${executor}.runner herdr), or bind the step to an executor that has one`
          : `step '${v.state.step}' is attended: person, but runners.person runs executor '${executor}' without presence, where nobody could work beside its agent: ${fixPresence}`,
    };
  const guardless = unguardedText(v, spec, target, caps);
  if (guardless) return { ok: false, rule: "agent.unguarded", text: guardless };
  return { ok: true, target, caps };
}

/** The first candidate that can run the step; with none, the first one's rule and every one's reason. */
function chooseExecutor(v: UnitView, spec: AgentStepSpec): Match {
  const tried = candidatesOf(v, spec).map((e) => matchExecutor(v, spec, e));
  const found = tried.find((m) => m.ok);
  if (found) return found;
  const failed = tried as Extract<Match, { ok: false }>[];
  return { ok: false, rule: (failed[0] as Extract<Match, { ok: false }>).rule, text: failed.map((m) => m.text).join("; ") };
}

function capsOf(v: UnitView, executor: string): ExecutorCapabilities | null {
  return v.ctx.facts.capabilities.executors[executor] ?? null;
}

/**
 * A nudge reaches a live session through its pane or a hook that adds to the agent's context; an
 * executor with neither gets a fresh session instead, counted as a retry.
 */
function takesNudge(caps: ExecutorCapabilities | null): boolean {
  return !!caps && (caps.paneInput || caps.injectContext);
}

export function decideAgent(v: UnitView, spec: AgentStepSpec): Decision {
  const run = v.state.run;
  if (!run) return startAgent(v, spec);
  return judgeRun(v, spec, run);
}

function briefOf(v: UnitView, spec: AgentStepSpec) {
  return {
    workflow: v.state.workflow.name,
    hash: v.state.workflow.hash,
    step: v.state.step,
    attempt: v.state.attempt,
    skills: [...spec.skills],
    inputs: structuredClone(spec.inputs),
    ...(spec.model !== undefined && { model: spec.model }),
    ...(v.state.rework_from !== undefined && { rework_from: v.state.rework_from }),
  };
}

/** A docs-only step is held by the write guard alone: on a harness that cannot deny a tool it would run unguarded, so no agent starts, fresh or retried. */
function unguardedText(v: UnitView, spec: AgentStepSpec, executor: string, caps: ExecutorCapabilities): string | null {
  if (spec.writes !== "docs" || caps.denyTool) return null;
  return `step '${v.state.step}' is writes: docs, but executor '${executor}' cannot deny a tool, so its writes would go unguarded; run it on an executor whose harness can (by:)`;
}

function unguarded(v: UnitView, spec: AgentStepSpec, executor: string, caps: ExecutorCapabilities): Decision | null {
  const text = unguardedText(v, spec, executor, caps);
  return text === null ? null : parkDecision(v, "agent.unguarded", "stuck", { text });
}

/**
 * A source the step reads that nothing binds, the workflow by its `path:` or this machine's config:
 * the agent would read a place that is not there, so no agent starts, fresh or retried, until a person
 * binds it. Derived each tick, so the binding alone lifts the park.
 */
function unboundSource(v: UnitView, spec: AgentStepSpec): Decision | null {
  const unbound = (spec.sources ?? []).find((s) => v.graph.sources?.[s]?.path === undefined && v.ctx.config.sources?.[s] === undefined);
  if (unbound === undefined) return null;
  return parkDecision(v, "source.unbound", "stuck", {
    text: `step '${v.state.step}' reads the source \`${unbound}\`, which nothing binds on this machine: bind it with \`norn config set sources.${unbound} <path>\`, or give it a path: in the workflow`,
  });
}

function startAgent(v: UnitView, spec: AgentStepSpec): Decision {
  const unbound = unboundSource(v, spec);
  if (unbound) return unbound;
  // matched before an attended step waits, so a person is never asked to start what cannot run beside them
  const match = chooseExecutor(v, spec);
  if (!match.ok) return parkDecision(v, match.rule, "stuck", { text: match.text });
  const { target: executor, caps } = match;
  // an attended step waits for the person who works beside it to start it (`run.requested`), in either mode
  if (spec.attended === "person" && v.state.requested === undefined) return parkDecision(v, "agent.ready.attended", "attended", { text: spec.instructions });
  // a person's `run.requested` starts this visit's agent once; manual mode still holds the next step
  if (personDrives(v)) return parkDecision(v, "agent.ready.manual", "manual", { text: spec.instructions });
  // a run a person started may open where they watch it (a pane); one nobody started must run headless
  const personStarted = v.state.requested !== undefined && caps.attended;
  if (!caps.headless && !personStarted) return parkDecision(v, "agent.ready.no_headless", "manual", { text: `auto mode, but executor '${executor}' cannot run headless` });
  const run_id = v.ctx.nextId();
  // the match gave a person beside the step a runner with presence, and their start is on the record
  const attended = spec.attended === "person";
  return {
    kind: "start_run",
    unit: v.unit.id,
    rule: "agent.start",
    run_id,
    executor,
    attended,
    brief: briefOf(v, spec),
    intent: intentFor(v, { kind: "run.started", run_id, run_kind: "agent", executor, attended }),
  };
}

/** The session's own error travels with the outcome: a run that stopped on one says so in the reason it ends with. */
function classified(v: UnitView, run: RunInfo, outcome: ClassifiedOutcome, rule: string): Decision {
  const error = v.unit.session?.error;
  return applyDecision(v, rule, [intentFor(v, { kind: "run.classified", run_id: run.id, outcome, rule, ...(error ? { error } : {}) })]);
}

function routes(v: UnitView, outcome: ClassifiedOutcome): boolean {
  return v.step.routes[outcome] !== undefined;
}

function judgeRun(v: UnitView, spec: AgentStepSpec, run: RunInfo): Decision {
  const session = v.unit.session;
  // a report outranks the session ending: an agent reports, then its process exits
  if (session?.report) return reportWithoutReceipt(v, run, session);
  if (session?.activity === "ended") return died(v, spec, run);
  // a person works beside an attended run: only its report or its end is decided
  if (run.attended) return noop(v, "agent.running", `attended run ${run.id} in progress`);
  if (session?.activity === "asking" && session.ask) {
    if (routes(v, "ask")) return classified(v, run, "ask", "agent.ask.route");
    const ask = session.ask;
    return parkDecision(v, "agent.asking.park", "ask", { text: ask.question, input_id: ask.id, ...(ask.options ? { options: ask.options } : {}) });
  }
  if (session?.activity === "permission" && session.permission) {
    const { prompt, call, id } = session.permission;
    return parkDecision(v, "agent.permission.park", "permission", { text: call ? `${call.tool}: ${prompt}` : prompt, input_id: id });
  }
  if (!session) {
    const inPane = v.unit.run_alive === true && capsOf(v, run.executor)?.paneInput === true;
    // a dialog read off the pane is the answer the silent window would only guess at, so it parks now
    if (inPane && v.unit.run_dialog !== undefined) return parkDecision(v, "agent.no_events.park", "permission", { text: dialogText(v, run, v.unit.run_dialog) });
    if (ageMs(v.ctx, run.started_at) <= quietWindowMs(v)) return noop(v, "agent.unobserved", `run ${run.id} is on the record; no session seen yet`);
    // alive in a pane yet silent: its hooks never loaded, as behind a trust dialog, and a fresh
    // session in a fresh pane would stop at the same dialog, so a person answers it instead
    if (inPane) return parkDecision(v, "agent.no_events.park", "permission", { text: noEventsText(v, run) });
    // the launch was recorded and never produced a session (a crash between the two, a launch that failed): dead
    return died(v, spec, run);
  }
  // a limit outranks the deadline: the agent cannot act until the reset, and stopping it would only meet the limit again
  if (session.activity === "limited") {
    const resets = session.limit?.resets_at;
    if (resets === undefined) return parkDecision(v, "agent.limited.unknown", "limited", { text: `run ${run.id} hit a usage limit with no reset time given` });
    if (ageMs(v.ctx, resets) < 0) {
      if (run.limited_until !== resets) return applyDecision(v, "agent.limited.record", [intentFor(v, { kind: "run.limited", run_id: run.id, resets_at: resets })]);
      return noop(v, "agent.limited.wait", `limited until ${resets}`);
    }
  }
  if (spec.deadline_ms !== null && ageMs(v.ctx, deadlineFrom(run)) > spec.deadline_ms) return overdue(v, spec, run);
  if (session.activity === "limited") return quiet(v, spec, run, "agent.limited");
  if (silentNow(v, session)) return quiet(v, spec, run, "agent.silent");
  if (session.activity === "turn_ended") return quiet(v, spec, run, "agent.turn_ended");
  return noop(v, "agent.running", `run ${run.id} ${session.activity}`);
}

/**
 * A report the session shows whose receipt the facts do not hold, as the host strips a report whose
 * receipt stands. The receipt is the report: it carries the agent's text, criteria and findings,
 * and the reporting API writes it before the event, so a tick that read the record just before the
 * report landed sees the event alone and the next tick finds the receipt. Writing one here would
 * record the report a second time without its text. A refused receipt parks the unit with the
 * refusal; a report whose receipt never comes (a reporting path that broke that order) is handed to
 * a person once the agent has been quiet for the window, never guessed at. That park is derived, so
 * a later event from the agent lifts it until the next quiet window passes.
 */
function reportWithoutReceipt(v: UnitView, run: RunInfo, session: SessionFacts): Decision {
  const rejected = v.unit.report_rejected;
  if (rejected !== undefined) return parkDecision(v, "agent.reported.rejected", "stuck", { text: `not applied: ${rejected}` });
  const { verb } = session.report as NonNullable<SessionFacts["report"]>;
  if (ageMs(v.ctx, session.last_event_at ?? run.started_at) <= quietWindowMs(v)) return noop(v, "agent.reporting", `run ${run.id} reported ${verb}; waiting for its receipt`);
  return parkDecision(v, "agent.reporting.lost", "stuck", {
    text: `run ${run.id}'s session shows a ${verb} report that is not on the record; start the step again with norn run rerun ${v.unit.id}`,
  });
}

/** only an executor that can press keys in its pane takes the answer from story answer */
function answerFromHere(v: UnitView, run: RunInfo): string {
  return capsOf(v, run.executor)?.dialogKeys === true ? `, or answer it from here with norn story answer ${v.unit.id} <option>` : "";
}

function dialogText(v: UnitView, run: RunInfo, dialog: string): string {
  return [`run ${run.id}'s agent waits on a dialog in its pane: ${dialog}`, `Answer it there${answerFromHere(v, run)}; the run goes on with its first event.`].join(" ");
}

function noEventsText(v: UnitView, run: RunInfo): string {
  const fromHere = answerFromHere(v, run).replace("<option>", "yes");
  return [
    `run ${run.id}'s agent runs in its pane but has sent no event since it started, so its hooks never loaded;`,
    "the pane most likely shows a trust dialog.",
    `Trust the folder there${fromHere}; the run goes on with its first event.`,
    `If the pane shows something else, start the step again with norn run rerun ${v.unit.id}.`,
  ].join(" ");
}

/** How long an agent goes without an event before it reads as quiet: the workflow's `defaults.stalled`, else the config's window. */
function quietWindowMs(v: UnitView): number {
  return v.graph.stalled_ms ?? v.ctx.config.silentAfterMs;
}

/**
 * Whether a working agent has gone quiet. The session source judges it by the config's window, which
 * holds unless the workflow sets its own; with its own, the newest event's time is judged again here.
 */
function silentNow(v: UnitView, session: SessionFacts): boolean {
  if (v.graph.stalled_ms === null || session.last_event_at === undefined) return session.silent;
  // only a working agent with nothing outstanding can be silent; any wait has a reason to be quiet
  return session.activity === "working" && session.pending_tools === 0 && session.subagents === 0 && ageMs(v.ctx, session.last_event_at) > v.graph.stalled_ms;
}

/** A run's deadline counts from its start, or from the reset of a usage limit it waited out, whichever is later. */
function deadlineFrom(run: RunInfo): string {
  return run.limited_until !== undefined && Date.parse(run.limited_until) > Date.parse(run.started_at) ? run.limited_until : run.started_at;
}

/**
 * A run past its deadline: routed when the step routes `timeout`, else stopped once, the order
 * recorded. Its session then ends and the died rules retry or end it; a session that outlives the
 * order by the silent window is judged dead all the same, so a stop that does not take ends bounded.
 */
function overdue(v: UnitView, spec: AgentStepSpec, run: RunInfo): Decision {
  if (routes(v, "timeout")) return classified(v, run, "timeout", "agent.timeout.route");
  if (run.stopped_at === undefined)
    return { kind: "stop_run", unit: v.unit.id, rule: "agent.timeout", run_id: run.id, reason: "timeout", intent: intentFor(v, { kind: "stop.sent", run_id: run.id, reason: "timeout" }) };
  if (ageMs(v.ctx, run.stopped_at) > v.ctx.config.silentAfterMs) return died(v, spec, run);
  return noop(v, "agent.timeout.stopping", `stop of run ${run.id} ordered at ${run.stopped_at}; waiting for its session to end`);
}

function died(v: UnitView, spec: AgentStepSpec, run: RunInfo): Decision {
  if (routes(v, "died")) return classified(v, run, "died", "agent.died.route");
  // a person drives a manual run: the dead session is theirs to start again
  if (personDrives(v) || run.attended) {
    const error = v.unit.session?.error;
    return parkDecision(v, "agent.died.manual", "stuck", { text: `run ${run.id} ended without a report${error ? `: ${error}` : ""}` });
  }
  if (v.state.retries_used < spec.retries) return retry(v, spec, run, "agent.died.retry");
  return classified(v, run, "died", "agent.died.exhausted");
}

/**
 * An agent that went quiet, ended its turn without a report, or came back from a limit. Nudged while
 * the step's nudges last, once per quiet spell: a nudge sent within the silent window is still on
 * its way. An executor that cannot take a nudge gets a fresh session while retries last.
 */
function quiet(v: UnitView, spec: AgentStepSpec, run: RunInfo, base: string): Decision {
  // a session with no activity is what a workflow names `stalled`; a turn ended or a limit waited out is `silent`
  if (base === "agent.silent" && routes(v, "stalled")) return classified(v, run, "stalled", "agent.stalled.route");
  if (routes(v, "silent")) return classified(v, run, "silent", `${base}.route`);
  if (run.last_nudge_at !== undefined && ageMs(v.ctx, run.last_nudge_at) < quietWindowMs(v))
    return noop(v, `${base}.nudged`, `nudged at ${run.last_nudge_at}; waiting for the agent to take it`);
  if (personDrives(v)) return parkDecision(v, `${base}.manual`, "stuck", { text: `run ${run.id} went quiet without a report` });
  if (run.nudges >= spec.nudges) return classified(v, run, "silent", `${base}.exhausted`);
  if (takesNudge(capsOf(v, run.executor))) {
    const reason = base.slice("agent.".length);
    return { kind: "nudge", unit: v.unit.id, rule: `${base}.nudge`, run_id: run.id, reason, intent: intentFor(v, { kind: "nudge.sent", run_id: run.id, reason }) };
  }
  if (v.state.retries_used < spec.retries) return retry(v, spec, run, `${base}.retry`);
  return classified(v, run, "silent", `${base}.exhausted`);
}

/** A fresh session for the step in place of `run`. */
function retry(v: UnitView, spec: AgentStepSpec, run: RunInfo, rule: string): Decision {
  const caps = capsOf(v, run.executor);
  if (!caps?.headless) return parkDecision(v, "agent.retry.no_headless", "stuck", { text: `run ${run.id} needs a fresh session; executor '${run.executor}' cannot run headless` });
  const unbound = unboundSource(v, spec);
  if (unbound) return unbound;
  const guardless = unguarded(v, spec, run.executor, caps);
  if (guardless) return guardless;
  const run_id = v.ctx.nextId();
  return {
    kind: "retry_run",
    unit: v.unit.id,
    rule,
    run_id,
    previous_run_id: run.id,
    executor: run.executor,
    attended: false,
    brief: briefOf(v, spec),
    intent: intentFor(v, { kind: "run.started", run_id, run_kind: "agent", executor: run.executor, attended: false, retry_of: run.id }),
  };
}
