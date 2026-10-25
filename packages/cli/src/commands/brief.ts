/**
 * `norn brief [--json]` (B3–B6, MO3): render the briefing of the cursor step from data only.
 * It prints the briefing as markdown, the one command whose reader is an agent rather than a
 * program; `--json` keeps the machine contract (P8) with the run, the markdown and the data.
 * In a unit worktree with no live run for the step, the first brief starts the run: it writes
 * a `started` receipt (run_id, session, PID) that the next tick applies. The exact briefing of
 * every run is stored in the trace (B4) and linked from it by a `briefing` event (O4).
 */
import { readdirSync } from "node:fs";
import { join } from "node:path";
import { type NumberedReceipt, type ProcessPort, renderBrief, type Ruling, storyRulings, storyWorktreePath } from "@norn/core";
import { type AgentStep, type ProcessIdentity, type ReceiptOf, storyBranch, ulid } from "@norn/schema";
import { appendReceipt, appendTrace, defaultBaseRef, listReceipts, readEnvNorn, readHandoff, readText, writeBriefing } from "@norn/store";
import { defineCommand, opt } from "../command.ts";
import type { Context } from "../context.ts";
import { refuse, textOutput } from "../output.ts";
import {
  agentName,
  currentRun,
  loadUnitSession,
  refuseUnlessAgentWork,
  reportCommand,
  standingReport,
  stepOfSession,
  storyMode,
  type UnitSession,
  unitCriteria,
} from "../runtime/agent-unit.ts";
import { readRemoteCache } from "../runtime/local.ts";
import { readHookFacts } from "../runtime/observe.ts";

/** Wrappers between the agent and `norn` that exit right after it (never the run's process). */
const WRAPPERS = /^-?(sh|bash|zsh|dash|fish|ksh|tcsh|csh|env|bun|bunx|npx|pnpm|timeout|sudo|nice|nohup|xargs|script|login)$/;

function parentOf(pid: number): { ppid: number; comm: string } | null {
  const r = Bun.spawnSync(["ps", "-o", "ppid=,comm=", "-p", String(pid)], { stdout: "pipe", stderr: "ignore" });
  const m = /^\s*(\d+)\s+(.+)$/.exec(r.stdout.toString().trim());
  return r.exitCode === 0 && m ? { ppid: Number(m[1]), comm: (m[2] as string).trim().split("/").at(-1) ?? "" } : null;
}

/**
 * MO3: the agent process that ran `norn brief` — the first ancestor that is not a shell or
 * launcher wrapper. `NORN_AGENT_PID` overrides (wrappers, tests).
 */
async function agentProcess(ctx: Context, proc: ProcessPort): Promise<ProcessIdentity | null> {
  const forced = ctx.env.NORN_AGENT_PID;
  if (forced && /^\d+$/.test(forced)) return proc.identify(Number(forced)).catch(() => null);
  let pid = process.ppid;
  for (let i = 0; i < 8 && pid > 1; i++) {
    const p = parentOf(pid);
    if (!p) return null;
    if (!WRAPPERS.test(p.comm)) return proc.identify(pid).catch(() => null);
    pid = p.ppid;
  }
  return null;
}

/** Agent session id and transcript from the hooks that fired in this worktree just before (A2). */
function recentSession(ctx: Context, s: UnitSession): { agent_session_id?: string; transcript?: string; agent?: string } {
  const since = new Date(ctx.clock.now() - 3_600_000).toISOString();
  const facts = readHookFacts(s.root, since).filter((f) => f.cwd === s.worktree || f.cwd.startsWith(`${s.worktree}/`));
  const last = facts.findLast((f) => f.agent_session_id);
  const id = last?.agent_session_id ?? ctx.env.NORN_AGENT_SESSION_ID;
  const out: { agent_session_id?: string; transcript?: string; agent?: string } = {};
  if (id) out.agent_session_id = id;
  if (last?.transcript) out.transcript = last.transcript;
  if (last?.agent) out.agent = last.agent;
  return out;
}

async function startRun(ctx: Context, s: UnitSession, step: AgentStep): Promise<string> {
  const config = ctx.config;
  const ports = await ctx.ports();
  const now = ctx.clock.now();
  const run_id = ulid(now);
  const session = recentSession(ctx, s);
  const agent = session.agent && config.agents[session.agent] ? session.agent : agentName(s, config);
  const receipt: ReceiptOf<"started"> = {
    kind: "started",
    receipt_id: ulid(now),
    run_id,
    step: s.state.step,
    attempt: s.state.attempt,
    at: ctx.clock.iso(),
    by: "agent",
    who: agent,
    how: "manual",
    agent,
    worktree: s.worktree,
  };
  const model = step.model ?? config.agents[agent]?.model;
  if (model) receipt.model = model;
  if (session.agent_session_id) receipt.agent_session_id = session.agent_session_id;
  const process = await agentProcess(ctx, ports.process);
  if (process) receipt.process = process;
  if (s.state.retries_used > 0) receipt.retry = true;
  if (s.unit.slice) receipt.slice = s.unit.slice;
  appendReceipt(s.runsDir, receipt); // P6: receipt first; the tick applies it (S6)
  return run_id;
}

/** Full log of the latest failing check (C5), when committed; the brief uses it only if that check is the rework (B6). */
function checkLog(s: UnitSession): { log: string; text: string } | null {
  const last = s.receipts.findLast((r: NumberedReceipt) => r.receipt.kind === "check" && r.receipt.outcome === "fail");
  const log = last?.receipt.kind === "check" ? last.receipt.log : undefined;
  const text = log ? readText(join(s.runsDir, log)) : null;
  return log && text !== null ? { log, text } : null;
}

/** Files in each evidence folder of the unit's receipts, so Rework can list them (B3); renderBrief stays pure. */
function evidenceFiles(s: UnitSession): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  for (const { receipt: r } of s.receipts) {
    if (r.kind !== "done" || !r.evidence || out[r.evidence]) continue;
    try {
      out[r.evidence] = readdirSync(join(s.runsDir, r.evidence)).sort();
    } catch {
      out[r.evidence] = [];
    }
  }
  return out;
}

/**
 * F28/O2: the story's gate rulings, from the receipts of every unit of the story this machine can
 * see — this worktree, the story worktree and each slice worktree beside it (a slice still running
 * keeps its live runs/ there, §7). The gate receipt is the record; renderBrief stays pure.
 */
function rulings(s: UnitSession): Ruling[] {
  const slug = s.marker.spec_dir.split("/").at(-1)?.slice(s.unit.story.length + 1) ?? "";
  const storyWt = storyWorktreePath(s.root, s.unit.story, slug);
  const runsOf = (wt: string) => join(wt, s.marker.spec_dir, "runs");
  const dirs = new Set<string>();
  for (const wt of [s.worktree, storyWt])
    try {
      for (const d of readdirSync(runsOf(wt), { withFileTypes: true })) if (d.isDirectory()) dirs.add(d.name);
    } catch {
      /* no runs/ here */
    }
  const units: Array<{ unit: string; receipts: NumberedReceipt[] }> = [];
  for (const dir of [...dirs].sort()) {
    const unit = dir === "_story" ? s.unit.story : `${s.unit.story}/${dir.split("-")[0]}`;
    for (const wt of new Set([s.worktree, storyWt, `${storyWt}--${dir}`])) units.push({ unit, receipts: listReceipts(join(runsOf(wt), dir)).receipts });
  }
  return storyRulings(units);
}

/** `<remote>/<base>` when the remote-tracking base exists, else the local base branch (solo). */
export function storyDiffBase(ctx: Context, root: string): string {
  // BS0: config `base_branch` when set, else the discovered default branch
  const branch = ctx.config.base_branch ?? readRemoteCache(root).default_branch ?? "main";
  const ref = defaultBaseRef(root, ctx.config.remote.git_remote, branch);
  return ref ? ref.slice("refs/remotes/".length) : branch;
}

export const briefCommand = defineCommand({
  name: "brief",
  summary: "Brief the agent on the current step of this worktree's unit; starts the run in manual mode (B3, MO3)",
  usage: "norn brief [--json]",
  options: { json: { type: "boolean" } },
  async run(ctx, args) {
    const s = loadUnitSession(ctx, "brief");
    const config = ctx.config;
    const key = s.unit.key;

    // receipts the tick has not applied yet (other than this run's start) change what is next
    let run = currentRun(s);
    if (run) {
      const report = standingReport(s, run.run_id);
      if (report) throw refuse(`this run already reported \`${reportCommand(report.receipt)}\`; exactly one report per run`, "end your turn", "already_reported");
    }
    const pending = s.unapplied.filter((r) => r.receipt.kind !== "started" && r.receipt.kind !== "mode");
    if (pending.length) throw refuse(`unit ${key} has receipts the heartbeat has not applied yet (${pending.map((r) => r.receipt.kind).join(", ")})`, "norn tick, then run norn brief again", "pending_receipts");
    refuseUnlessAgentWork(s, "brief");
    const step = stepOfSession(s) as AgentStep;

    let started = false;
    if (!run) {
      run = { run_id: await startRun(ctx, s, step), applied: false };
      started = true;
    }

    const mode = storyMode(ctx, s, config);
    const env = readEnvNorn(s.worktree) ?? {};
    const num = (v: string | undefined) => (v !== undefined && /^\d+$/.test(v) ? Number(v) : null);
    const slicePath = s.unit.slice ? `${s.marker.spec_dir}/slices/${s.unit.dir}.md` : null;
    const slug = s.marker.spec_dir.split("/").at(-1)?.slice(s.unit.story.length + 1) ?? "";
    // F33: a story diffs against the fetched base (`origin/main`), never the main checkout's stale local `main`
    const base = s.unit.slice ? storyBranch(s.unit.story, slug) : storyDiffBase(ctx, s.root);
    const state = run.applied ? s.state : { ...s.state, run: { run_id: run.run_id, step: s.state.step, attempt: s.state.attempt, started_at: ctx.clock.iso(), how: "manual" as const } };
    const briefing = renderBrief({
      unit: s.unit,
      state,
      workflow: s.workflow,
      mode,
      runner: config.runner ? config.runner.adapter : null,
      paths: {
        worktree: s.worktree,
        spec_dir: s.marker.spec_dir,
        story_file: `${s.marker.spec_dir}/story.md`,
        slice_file: slicePath,
        unit_dir: `${s.marker.spec_dir}/runs/${s.unit.dir}`,
      },
      diff_range: `${base}...HEAD`,
      // S9: the agent-written part only; the generated header and heartbeat are not for the agent
      handoff: readHandoff(s.runsDir)?.body ?? null,
      receipts: s.receipts,
      limits: {
        deadline: step.deadline ?? config.limits.deadline,
        nudges: step.nudges ?? config.limits.nudges,
        retries: step.retries ?? config.limits.retries,
        slot: num(env.NORN_SLOT),
        port_base: num(env.PORT_BASE),
      },
      check_log: checkLog(s),
      evidence_files: evidenceFiles(s),
      rulings: rulings(s),
      criteria: unitCriteria(s),
      // QV5a: what this run's agent may `pass`
      capabilities: config.agents[agentName(s, config)]?.capabilities ?? [],
    });
    // B4: the exact briefing of every run, in the trace
    const id = ulid(ctx.clock.now());
    const stored = writeBriefing(s.root, run.run_id, id, briefing.markdown);
    // O4: link the run to its briefing in the trace (`norn trace <unit>` shows it)
    appendTrace(s.root, { type: "briefing", id, at: ctx.clock.iso(), unit: key, run_id: run.run_id, step: s.state.step, attempt: s.state.attempt, briefing: stored });
    if (!opt.bool(args, "json")) return textOutput(briefing.markdown);
    return { unit: key, step: s.state.step, attempt: s.state.attempt, run_id: run.run_id, started, briefing: stored, markdown: briefing.markdown, brief: briefing.json };
  },
});
