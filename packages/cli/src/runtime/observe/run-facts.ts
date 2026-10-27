/** observe: a unit's run facts — its run windows (C4), hook facts refined per agent (A2), the live or unknown run (R5.1, R5.3, B3). */
import type { AgentAdapter, FileError, Ports, RunFacts, UnitFacts, WorktreeFacts } from "@norn/core";
import type { HookFact } from "@norn/schema";
import { type LocalUnit, liveRun, receiptsOfKinds, runHooks, type StorySnapshot, type UnitSnapshot } from "@norn/store";
import type { DatedCommit } from "./git-facts.ts";

/** A2: each agent adapter's own pass over a run's hook facts (`refineHooks`), once per adapter name. */
function refineHooks(agents: Record<string, AgentAdapter>, hooks: HookFact[]): HookFact[] {
  const seen = new Set<string>();
  let out = hooks;
  for (const a of Object.values(agents)) {
    if (!a.refineHooks || seen.has(a.name)) continue;
    seen.add(a.name);
    out = a.refineHooks(out);
  }
  return out;
}

/** Receipt kinds a run writes, from its start to its end (C4). */
const RUN_KINDS = ["started", "done", "ask", "stuck", "classify", "answer"] as const;

/**
 * C4: the time spans (ms epoch) of every run of the unit — from its first to its last receipt, and
 * open-ended for the run the unit is still in (running, or parked on an ask). An agent launched by
 * norn commits only inside them; a person's commit outside them stays foreign (Q6).
 */
export function runWindows(story: StorySnapshot, u: UnitSnapshot): Array<[number, number]> {
  const spans = new Map<string, [number, number]>();
  const widen = (run: string, t: number, end = t) => {
    if (!Number.isFinite(t)) return;
    const cur = spans.get(run);
    spans.set(run, cur ? [Math.min(cur[0], t), Math.max(cur[1], end)] : [t, end]);
  };
  for (const { receipt: r } of receiptsOfKinds(story, u, RUN_KINDS)) if (r.run_id) widen(r.run_id, Date.parse(r.at));
  // the agent of a run parked on an ask is still at work (a permission prompt answered in its pane)
  const st = u.state;
  if (st?.run) widen(st.run.run_id, Date.parse(st.run.started_at), st.status === "running" || (st.status === "parked" && st.park?.kind === "ask") ? Number.POSITIVE_INFINITY : Date.parse(st.run.started_at));
  // commit dates have second precision
  return [...spans.values()].map(([a, b]) => [Math.floor(a / 1000) * 1000, b]);
}

export const duringRun = (c: DatedCommit, windows: ReadonlyArray<[number, number]>) => {
  const t = Date.parse(c.committed_at ?? c.at);
  return Number.isFinite(t) && windows.some(([a, b]) => t >= a && t <= b);
};

export interface LocalRunEnv {
  /** this machine's `user@host` (R7.2) */
  holder: string;
  /** this machine's available runner */
  runner: Ports["runner"];
  now: number;
}

/** The unit's facts: what store read from its receipts (`LocalUnit`), extended with its worktree and run (R5.1, R5.3, B3). */
export async function unitFacts(ports: Ports, story: StorySnapshot, lu: LocalUnit, worktree: WorktreeFacts | null, hooks: HookFact[], env: LocalRunEnv): Promise<UnitFacts> {
  const now = env.now;
  const u = lu.snapshot;
  const st = u.state;
  const prefix = `${story.spec_dir}/runs/${u.unit.dir}/`;
  const dirty = worktree?.status ? [...worktree.status.staged, ...worktree.status.unstaged, ...worktree.status.untracked] : [];
  const uncommitted = dirty.some((p) => p.startsWith(prefix));

  const cursor = lu.cursor;
  const unknown = lu.unknown_launch;
  let run: RunFacts | null = null;
  if (unknown && st) {
    // R5.1: look for the run: its hook facts, runner sessions in its worktree, processes with its NORN_RUN
    const r = unknown.receipt;
    const runId = r.run_id as string;
    const mine = refineHooks(ports.agents, hooks.filter((h) => h.run_id === runId));
    const agentSession = mine.findLast((h) => h.agent_session_id)?.agent_session_id ?? null;
    const foreign = !!r.machine && r.machine !== env.holder;
    const candidates = !foreign && env.runner?.findSessions ? await env.runner.findSessions({ run_id: runId, cwd: r.worktree }).catch(() => []) : [];
    // a pane another run of the unit already recorded is that run's, not this one
    const fresh = candidates.filter((c) => !cursor?.sessions.has(c.session.session_id));
    const chosen = fresh.find((c) => !!agentSession && c.agent_session_id === agentSession) ?? (fresh.length === 1 ? fresh[0] : undefined);
    const last = mine.at(-1);
    const last_hook_at = last ? Date.parse(last.at) : null;
    run = {
      run_id: runId,
      session: chosen?.session ?? null,
      process_alive: chosen?.session.process ? await ports.process.isAlive(chosen.session.process).catch(() => null) : null,
      pane: null,
      hooks: mine,
      last_hook_at,
      last_activity_at: last_hook_at,
      transcript: [...mine].reverse().find((h) => h.transcript)?.transcript ?? null,
      launch_unknown: { n: unknown.n, at: Date.parse(r.at), agent_session_id: agentSession ?? chosen?.agent_session_id ?? null },
    };
  } else if (liveRun(st) && st?.run) {
    const r = st.run;
    const session = r.session ? { runner: r.session.runner, session_id: r.session.session_id, ...(r.session.pane_id ? { pane_id: r.session.pane_id } : {}), ...(r.process ? { process: r.process } : {}) } : null;
    // R7.2 (N5): a pid or pane id from another machine means nothing in this machine's tables
    const foreign = !!r.machine && r.machine !== env.holder;
    const process_alive = r.process && !foreign ? await ports.process.isAlive(r.process).catch(() => null) : null;
    const pane = session && !foreign && ports.runner && session.runner === ports.runner.name ? await ports.runner.paneState(session).catch(() => null) : null;
    // A2: a Claude permission prompt names no command; its adapter takes it from the preceding
    // PreToolUse (other agents' facts pass through unchanged) so the implicit ask and inbox show it
    const mine = refineHooks(ports.agents, runHooks(hooks, r, worktree?.path ?? null));
    const last = mine.at(-1);
    const last_hook_at = last ? Date.parse(last.at) : null;
    const acts = [last_hook_at, worktree?.last_commit_at ?? null, worktree?.last_file_change_at ?? null].filter((x): x is number => x !== null);
    run = {
      run_id: r.run_id,
      session,
      process_alive,
      pane,
      hooks: mine,
      last_hook_at,
      last_activity_at: acts.length ? Math.min(Math.max(...acts), now) : null,
      transcript: [...mine].reverse().find((h) => h.transcript)?.transcript ?? r.transcript ?? null,
    };
    // B3: a gone process's first output lines (its run log) say why it never got going
    if (session && (process_alive === false || pane?.alive === false) && ports.runner?.output && session.runner === ports.runner.name) {
      const output = await ports.runner.output(session).catch(() => null);
      if (output) run.output = output;
    }
  }

  const errors: FileError[] = u.errors;
  return {
    unit: u.unit,
    state: st,
    workflow: u.workflow?.workflow ?? null,
    workflow_hash: u.workflow?.hash ?? null,
    errors,
    unapplied: u.unapplied,
    last_check: lu.last_check,
    last_findings: lu.last_findings,
    last_outcome_receipt: lu.last_outcome_receipt,
    worktree,
    run,
    lease: lu.lease,
    uncommitted,
    ...(lu.step_runs ? { step_runs: lu.step_runs } : {}),
  };
}
