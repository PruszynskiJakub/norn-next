/** act: agent sessions — launch, resume, nudge, kill, classify and transcript snapshots (A6, B2, K1, R4.2, C4). */
import { existsSync } from "node:fs";
import { relative } from "node:path";
import {
  type Action,
  type ActionResult,
  type AgentLaunch,
  type NewReceipt,
  type SessionRef,
  type UnitRef,
  applyReceipts as applyToState,
} from "@norn/core";
import { type ReceiptOf, type UnitState, type Workflow, ulid } from "@norn/schema";
import {
  acquireRunLease,
  appendHandoffHeartbeat,
  listLeases,
  readEnvNorn,
  releaseLease,
  updateLease,
  writeReceiptAt,
  writeTranscriptSnapshot,
} from "@norn/store";
import { ensureShim, withNornOnPath } from "../shim.ts";
import { type ActEnv, QueueFull, ReceiptTaken } from "./env.ts";

// ------------------------------------------------------------ runner

async function killSession(act: ActEnv, session: SessionRef | null): Promise<boolean> {
  const runner = act.obs.ports.runner;
  if (!session || !runner || session.runner !== runner.name) return false;
  await runner.kill(session).catch(() => undefined);
  return true;
}

/** Launch an agent session for a run (A6, B5), holding an agent lease (K1). */
async function launchSession(act: ActEnv, unit: UnitRef, launch: AgentLaunch): Promise<{ session: SessionRef; lease: string }> {
  const runner = act.obs.ports.runner;
  if (!runner) throw new Error("no runner configured (MO2)");
  const agent = act.obs.ports.agents[launch.agent];
  if (!agent) throw new Error(`agent '${launch.agent}' is not configured`);
  const lease = await acquireRunLease(act.ctx.home, "agent", act.config.max_agents, {
    repo: act.root,
    story: unit.story,
    slice: unit.slice,
    run_id: launch.run_id,
    now: act.nowIso(),
    liveness: act.liveness(),
  });
  if (!lease.ok) throw new QueueFull(`queued: max_agents ${act.config.max_agents} in use (K1)`);
  try {
    const env = { ...(readEnvNorn(launch.cwd) ?? {}), ...launch.env, NORN_HOME: act.root };
    const cfg = act.config.agents[launch.agent];
    const cmd = agent.launchCommand({
      cwd: launch.cwd,
      prompt: launch.prompt,
      env,
      headless: runner.name === "headless",
      config: { ...(cfg?.command ? { command: cfg.command } : {}), ...(cfg?.args ? { args: cfg.args } : {}), ...(cfg?.env ? { env: cfg.env } : {}) },
      ...(launch.model ? { model: launch.model } : {}),
      ...(launch.resume ? { resume: launch.resume } : {}),
    });
    // R8.1 (A1): the agent's `norn` is this norn — shim first on PATH inside the command itself
    const onPath = withNornOnPath(cmd.argv, ensureShim(act.ctx.home), act.ctx.env.PATH);
    const session = await runner.launch({ cwd: launch.cwd, argv: onPath.argv, env: { ...env, ...cmd.env, ...onPath.env }, title: launch.title, run_id: launch.run_id });
    // K1/K3: the lease must outlive this tick. With an agent process it follows that process; without
    // one (pane runners) it carries the worktree and stays live while the run is running (leases.ts).
    if (session.process) updateLease(act.ctx.home, lease.entry.file, { ...lease.entry.lease, holder: session.process });
    else updateLease(act.ctx.home, lease.entry.file, { ...lease.entry.lease, worktree: launch.cwd });
    return { session, lease: lease.entry.file };
  } catch (e) {
    releaseLease(act.ctx.home, lease.entry.file);
    throw e;
  }
}

/**
 * The decided `started` receipt carries no session (it is written before the launch, P6).
 * Record the session in a second `started` receipt for the same run and apply it, so
 * state.run.session / process are filled exactly as a later apply would.
 */
function recordSession(act: ActEnv, unit: UnitRef, runsDir: string, decided: UnitState, receipts: NewReceipt[], session: SessionRef): UnitState {
  const started = [...receipts].reverse().find((r) => r.receipt.kind === "started")?.receipt as ReceiptOf<"started"> | undefined;
  const wf = unitWorkflow(act, unit);
  if (!started || !wf) return decided;
  const r: ReceiptOf<"started"> = {
    ...started,
    receipt_id: ulid(act.ctx.clock.now()),
    at: act.nowIso(),
    session: { runner: session.runner, session_id: session.session_id, ...(session.pane_id ? { pane_id: session.pane_id } : {}), ...reachOf(act, session) },
    ...(session.process ? { process: session.process } : {}),
  };
  const n = Math.max(...receipts.map((x) => x.n)) + 1;
  const res = writeReceiptAt(runsDir, n, r);
  if (!res.ok) throw new Error(`receipt number ${n} is taken (S6)`);
  return applyToState(decided, [{ n, file: "", receipt: r }], { workflow: wf, now: act.nowIso(), limits: act.config.limits, tick_id: act.tick }).state;
}

/** R6.3, R9.1: how a person reaches the session, recorded with it for the inbox */
function reachOf(act: ActEnv, session: SessionRef): { reach?: string } {
  const runner = act.obs.ports.runner;
  const reach = runner?.reach && runner.name === session.runner ? runner.reach(session) : undefined;
  return reach ? { reach } : {};
}

function unitWorkflow(act: ActEnv, unit: UnitRef): Workflow | null {
  return act.obs.units[unit.key]?.workflow ?? null;
}

// ------------------------------------------------------------ unit actions

export async function applyReceipts(act: ActEnv, a: Extract<Action, { kind: "apply_receipts" }>): Promise<ActionResult> {
  const loc = act.unitLoc(a.unit);
  const prevRun = loc.state?.run?.run_id;
  let state = a.state;
  let resumed: SessionRef | null = null;
  // S7/O2: the cursor moved off a live run (workflow --to / unstick): stop it before the new state
  const killed = await killSession(act, a.kill ?? null);
  if (a.launch) {
    // B2: resume the same agent session with the answer as the prompt (headless / session gone)
    ({ session: resumed } = await launchAfterReceipts(act, a.unit, loc.runsDir, a.receipts, a.launch));
    if (state) state = recordSession(act, a.unit, loc.runsDir, state, a.receipts, resumed);
  } else
    try {
      act.writeReceipts(loc.runsDir, a.receipts);
    } catch (e) {
      // R6.1, B11: the tick resolving an implicit ask raced the agent's own report, whose `answer`
      // (`by: "agent"`) took the number first. S6 keeps the first; the ask is closed either way, so
      // this is not a failed action — nothing else is written, the next tick applies the report.
      if (e instanceof ReceiptTaken && a.rule === "agent.ask.implicit.resolved") return { ok: true, detail: { superseded: e.message } };
      throw e;
    }
  for (const r of a.rejected) act.traceReject(a.unit.key, `receipt ${r.n}`, r.reason, { receipt_id: r.receipt_id });
  let keyed = false;
  const keys = a.input?.keys;
  if (a.input && keys) {
    // R6.2/R6.3: an answer to a pane prompt is typed as its keystrokes before state is written —
    // a failed delivery leaves the unit parked on the ask (the next tick tries again)
    const input = a.input;
    try {
      const runner = act.obs.ports.runner;
      if (!runner || runner.name !== input.session.runner) throw new Error("the session's runner is not available here");
      if (!runner.sendKeys) throw new Error(`runner ${runner.name} cannot type into a prompt`);
      await runner.sendKeys(input.session, keys);
    } catch (e) {
      act.failedSession = input.session;
      throw new Error(`answer to ${a.unit.key} not delivered: ${(e as Error).message}`);
    }
    act.effectsOk.add("answer");
    keyed = true;
  }
  if (state) act.writeUnitState(a.unit, loc.runsDir, state);
  const released =
    state && state.status !== "running"
      ? await act.releaseRunLeases(a.unit, ["agent"])
      : a.kill && prevRun
        ? await act.releaseRunLeases(a.unit, ["agent"], prevRun)
        : [];
  const summary = a.advance ? `${a.advance.from}.${a.advance.outcome} → ${a.advance.to}${a.advance.reset ? ` (reset ${a.advance.reset.join(", ")})` : ""}` : `applied ${a.applied.join(", ") || "none"}`;
  const committed = await act.commit(a.commit, a.unit, state, `${a.rule}: ${summary}`);
  let delivered: boolean | string = resumed ? "resumed" : keyed;
  if (resumed) act.effectsOk.add("resume");
  if (a.input && !keyed) {
    // B2: the answer goes into the same session after state is written
    try {
      const runner = act.obs.ports.runner;
      if (!runner || runner.name !== a.input.session.runner) throw new Error("session's runner is not available here");
      await runner.send(a.input.session, a.input.text, { submit: true });
      delivered = true;
      act.effectsOk.add("answer");
    } catch (e) {
      delivered = `not delivered: ${(e as Error).message}`;
      // R4.3 (A4): the state is written, but the answer never reached the agent — not ok
      act.effectErrors.push({ effect: "answer", reason: `answer to ${a.unit.key} not delivered: ${(e as Error).message}` });
      act.failedSession = a.input.session;
    }
  }
  return { ok: true, detail: { ...committed, released, delivered, ...(a.kill ? { killed } : {}), ...(resumed ? { session: resumed } : {}) } };
}

export async function startRun(act: ActEnv, a: Extract<Action, { kind: "start_run" }>): Promise<ActionResult> {
  const loc = act.unitLoc(a.unit);
  const { session, lease } = await launchAfterReceipts(act, a.unit, loc.runsDir, a.receipts, a.launch);
  act.effectsOk.add("launch");
  const state = a.state ? recordSession(act, a.unit, loc.runsDir, a.state, a.receipts, session) : null;
  if (state) act.writeUnitState(a.unit, loc.runsDir, state);
  // R2.1 (N6): commit and push the started receipts now — only runs/, never the agent's fresh work
  const committed = await act.commit(a.commit, a.unit, state, `${a.rule}: ${a.step} run ${a.launch.run_id}`, a.commit ? [relative(a.commit.cwd, loc.runsDir)] : undefined);
  return { ok: true, detail: { session, lease, ...committed } };
}

/**
 * K1 is checked before anything is written (a full machine just queues). Then receipts (P6),
 * then the launch. A failed launch leaves the started receipt; the next tick applies it and
 * classification (stalled/timeout) bounds the run.
 */
async function launchAfterReceipts(act: ActEnv, unit: UnitRef, runsDir: string, receipts: NewReceipt[], launch: AgentLaunch, beforeLaunch?: () => Promise<unknown>) {
  const listing = await listLeases(act.ctx.home, act.liveness());
  const agents = listing.live.filter((e) => e.lease.kind === "agent" && e.lease.run_id !== launch.run_id).length;
  if (agents >= act.config.max_agents) throw new QueueFull(`queued: max_agents ${act.config.max_agents} in use (K1)`);
  act.writeReceipts(runsDir, receipts);
  await beforeLaunch?.();
  return launchSession(act, unit, launch);
}

/**
 * R4.2: deliver a counted nudge — typed into the live session (`input`), or by resuming the agent
 * session with the nudge text (`launch`) after terminating the old process. R4.3: a failed delivery
 * throws (ok: false; the classify receipt stays and is applied next tick, the nudge counted) and is
 * kept as the unit's act failure for the inbox.
 */
export async function nudge(act: ActEnv, a: Extract<Action, { kind: "nudge" }>): Promise<ActionResult> {
  const loc = act.unitLoc(a.unit);
  const runId = a.input?.run_id ?? a.launch?.run_id ?? "unknown";
  let resumed: SessionRef | null = null;
  if (a.launch) {
    const launch = a.launch;
    const kill = a.kill;
    try {
      ({ session: resumed } = await launchAfterReceipts(act, a.unit, loc.runsDir, a.receipts, launch, async () => {
        await killSession(act, kill);
        // the old process held the run's agent lease; the resumed one takes it over (K1)
        await act.releaseRunLeases(a.unit, ["agent"], launch.run_id);
      }));
    } catch (e) {
      if (e instanceof QueueFull) throw e;
      act.failedSession = kill;
      throw new Error(`nudge to ${a.unit.key} not delivered: resume failed: ${(e as Error).message}`);
    }
    act.effectsOk.add("resume");
  } else act.writeReceipts(loc.runsDir, a.receipts);
  const snapshot = await snapshotRun(act, a.unit, runId, a.snapshot);
  if (a.input) {
    const runner = act.obs.ports.runner;
    try {
      if (!runner || runner.name !== a.input.session.runner) throw new Error("the run's runner is not available on this machine");
      await runner.send(a.input.session, a.input.text, { submit: true });
    } catch (e) {
      act.failedSession = a.input.session;
      throw new Error(`nudge to ${a.unit.key} not delivered: ${(e as Error).message}`);
    }
    act.effectsOk.add("nudge");
  }
  let state = a.state;
  if (state && resumed) state = recordSession(act, a.unit, loc.runsDir, state, a.receipts, resumed);
  if (state) act.writeUnitState(a.unit, loc.runsDir, state);
  const committed = await act.commit(a.commit, a.unit, state, `${a.rule}: nudged ${state?.nudges_used ?? "?"}${resumed ? " (resumed)" : ""}`);
  return { ok: true, detail: { ...committed, ...(resumed ? { session: resumed } : {}) }, ...(snapshot ? { transcript: snapshot } : {}) };
}

export async function retryFresh(act: ActEnv, a: Extract<Action, { kind: "retry_fresh" }>): Promise<ActionResult> {
  const loc = act.unitLoc(a.unit);
  let state = a.state;
  let session: SessionRef | null = null;
  await act.releaseRunLeases(a.unit, ["agent"]);
  if (a.launch) {
    // receipts, kill the old session, then the fresh one (B2, C1)
    ({ session } = await launchAfterReceipts(act, a.unit, loc.runsDir, a.receipts, a.launch, () => killSession(act, a.kill)));
    act.effectsOk.add("launch");
    if (state) state = recordSession(act, a.unit, loc.runsDir, state, a.receipts, session);
  } else {
    act.writeReceipts(loc.runsDir, a.receipts);
    await killSession(act, a.kill);
  }
  if (state) act.writeUnitState(a.unit, loc.runsDir, state);
  const committed = await act.commit(a.commit, a.unit, state, `${a.rule}: fresh session${session ? "" : " (ready)"}`);
  return { ok: true, detail: { session, ...committed } };
}

export async function classify(act: ActEnv, a: Extract<Action, { kind: "classify" }>): Promise<ActionResult> {
  const loc = act.unitLoc(a.unit);
  act.writeReceipts(loc.runsDir, a.receipts);
  const killed = await killSession(act, a.kill);
  const runId = loc.state?.run?.run_id ?? a.receipts[0]?.receipt.run_id ?? "none";
  const transcript = await snapshotRun(act, a.unit, runId, a.snapshot);
  if (a.state) act.writeUnitState(a.unit, loc.runsDir, a.state);
  const released = a.state && a.state.status !== "running" ? await act.releaseRunLeases(a.unit, ["agent"]) : [];
  const committed = await act.commit(a.commit, a.unit, a.state, `${a.rule}: ${a.outcome}`);
  return { ok: true, detail: { killed, released, ...committed }, ...(transcript ? { transcript } : {}) };
}

/** C4: last assistant message + head + diff stat into the trace; a pointer line in the handoff. */
async function snapshotRun(act: ActEnv, unit: UnitRef, runId: string, req: { transcript: string | null; cwd: string } | null): Promise<string | null> {
  if (!req) return null;
  const loc = act.unitLoc(unit);
  const agentName = loc.state?.run?.agent ?? act.config.default_agent;
  const agent = act.obs.ports.agents[agentName];
  const last = req.transcript && agent ? await agent.lastAssistantMessage(req.transcript).catch(() => null) : null;
  const head = req.cwd ? await act.git.revParse(req.cwd, "HEAD").catch(() => null) : null;
  const diff = req.cwd ? await act.git.diffStat(req.cwd, "HEAD").catch(() => "") : "";
  const text = [`# snapshot ${unit.key} run ${runId}`, `head: ${head ?? "?"}`, "", "## last assistant message", last ?? "(none)", "", "## diff --stat HEAD", diff || "(clean)"].join("\n");
  const rel = writeTranscriptSnapshot(act.root, /^[0-9A-Z]{26}$/.test(runId) ? runId : "unknown", ulid(act.ctx.clock.now()), text);
  if (existsSync(loc.runsDir)) appendHandoffHeartbeat(loc.runsDir, `- silent: last message snapshot in trace/${rel}`);
  return rel;
}
