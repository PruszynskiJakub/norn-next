/**
 * `norn brief [--json]`: render the briefing of the cursor step from data only.
 * It prints the briefing as markdown, for the agent; `--json` keeps the machine contract
 * with the run, the markdown and the data.
 * In a unit worktree with no live run for the step, the first brief starts the run: it writes
 * a `started` receipt (run_id, session, PID) that the next tick applies. The exact briefing of
 * every run is stored in the trace and linked from it by a `briefing` event.
 */
import { readdirSync } from "node:fs";
import { basename, join } from "node:path";
import { cmd, currentRun, cursorStep, type NumberedReceipt, type ProcessPort, renderBrief, type Ruling, standingReport, stepLimits, storyRulings } from "@norn/core";
import { type AgentStep, type ProcessIdentity, type ReceiptOf, storyBranch, ulid, type UnitState } from "@norn/schema";
import { appendReceipt, appendTrace, defaultBaseRef, listReceipts, readEnvNorn, readHandoff, readText, writeBriefing, readRemoteCache, spawnSyncCaptured, storyFile, traceEvent, runStateDir, storyRunStateDir } from "@norn/store";
import { defineCommand } from "../command.ts";
import type { Context } from "../context.ts";
import { refuse, rendered } from "../output.ts";
import { gatherBaseSide } from "../runtime/base-side.ts";
import { agentName, callerSession, loadUnitSession, refuseUnlessAgentWork, refuseForeignSession, reportCommand, unitStoryMode, type UnitSession, unitCriteria } from "../runtime/agent-unit.ts";

/** Wrappers between the agent and `norn` that exit right after it (never the run's process). */
const WRAPPERS = /^-?(sh|bash|zsh|dash|fish|ksh|tcsh|csh|env|bun|bunx|npx|pnpm|timeout|sudo|nice|nohup|xargs|script|login)$/;

function parentOf(pid: number): { ppid: number; comm: string } | null {
  let r: ReturnType<typeof spawnSyncCaptured>;
  try {
    r = spawnSyncCaptured(["ps", "-o", "ppid=,comm=", "-p", String(pid)]);
  } catch {
    return null;
  }
  const m = /^\s*(\d+)\s+(.+)$/.exec(r.stdout.toString().trim());
  return r.exitCode === 0 && m ? { ppid: Number(m[1]), comm: (m[2] as string).trim().split("/").at(-1) ?? "" } : null;
}

/**
 * The agent process that ran `norn brief` — the first ancestor that is not a shell or
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

async function startRun(ctx: Context, s: UnitSession, step: AgentStep): Promise<string> {
  const config = ctx.config;
  const ports = await ctx.ports();
  const now = ctx.clock.now();
  const run_id = ulid(now);
  const session = callerSession(ctx, s, "brief");
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
  appendReceipt(s.runsDir, receipt); // Receipt first; the tick applies it
  return run_id;
}

/** Full log of the latest failing check, when committed; the brief uses it only if that check is the rework. */
function checkLog(s: UnitSession): { log: string; text: string } | null {
  const last = s.receipts.findLast((r: NumberedReceipt) => r.receipt.kind === "check" && r.receipt.outcome === "fail");
  const log = last?.receipt.kind === "check" ? last.receipt.log : undefined;
  const text = log ? readText(join(s.runsDir, log)) : null;
  return log && text !== null ? { log, text } : null;
}

/** Files in each evidence folder of the unit's receipts, so Rework can list them; renderBrief stays pure. */
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
 * The story's gate rulings, from the receipts of every unit of the story this machine holds
 * (all in the checkout's machine dir). The gate receipt is the record; renderBrief stays pure.
 */
function rulings(s: UnitSession): Ruling[] {
  const units: Array<{ unit: string; receipts: NumberedReceipt[] }> = [];
  for (const { unit: dir, dir: path } of storyRecord(s)) {
    const unit = dir === "_story" ? s.unit.story : `${s.unit.story}/${dir.split("-")[0]}`;
    units.push({ unit, receipts: listReceipts(path).receipts });
  }
  return storyRulings(units);
}

/**
 * Every unit of the story's record, its folder name and its run-state folder (the story's current
 * round for `_story`), all in this checkout's machine dir, whichever worktree.
 */
function storyRecord(s: UnitSession): Array<{ unit: string; dir: string }> {
  const run = { key: s.unit.story, spec_dir: s.marker.spec_dir };
  const dirs = new Set<string>();
  try {
    for (const d of readdirSync(storyRunStateDir(s.root, run), { withFileTypes: true })) if (d.isDirectory() && !d.name.startsWith(".")) dirs.add(d.name);
  } catch {
    /* no run state yet */
  }
  return [...dirs].sort().map((unit) => ({ unit, dir: runStateDir(s.root, run, unit) }));
}

/** `<remote>/<base>` when the remote-tracking base exists, else the local base branch (solo). */
function storyDiffBase(ctx: Context, root: string): string {
  // Config `base_branch` when set, else the discovered default branch
  const branch = ctx.config.base_branch ?? readRemoteCache(root).default_branch ?? "main";
  const ref = defaultBaseRef(root, ctx.config.git_remote, branch);
  return ref ? ref.slice("refs/remotes/".length) : branch;
}

export const briefCommand = defineCommand({
  name: "brief",
  version: "acts",
  summary: "Brief the agent on the current step of this worktree's unit; starts the run in manual mode",
  usage: "norn brief [--json]",
  markdown: true,
  async run(ctx, args) {
    const s = loadUnitSession(ctx, "brief");
    const config = ctx.config;
    const key = s.unit.key;

    // receipts the tick has not applied yet (other than this run's start) change what is next
    let run = currentRun(s);
    if (run) {
      const report = standingReport(s, run.run_id);
      if (report) {
        // An unapplied report waits for a tick: without a heartbeat nobody applies it, so say who does
        const waits = s.unapplied.some((r) => r.receipt.receipt_id === report.receipt.receipt_id);
        const next = waits ? `end your turn; a tick applies the report: tell the person to run ${cmd.tick()} if ${cmd.watch()} is not running on this checkout` : "end your turn";
        throw refuse(`this run already reported \`${reportCommand(report.receipt)}\`; exactly one report per run`, next, "already_reported");
      }
      refuseForeignSession(ctx, s, run.run_id, "brief"); // Never join another session's run
    }
    const pending = s.unapplied.filter((r) => r.receipt.kind !== "started" && r.receipt.kind !== "mode");
    if (pending.length) throw refuse(`unit ${key} has receipts the heartbeat has not applied yet (${pending.map((r) => r.receipt.kind).join(", ")})`, `${cmd.tick()}, then run ${cmd.brief()} again`, "pending_receipts");
    refuseUnlessAgentWork(s, "brief");
    const step = cursorStep(s) as AgentStep;

    let started = false;
    if (!run) {
      run = { run_id: await startRun(ctx, s, step), applied: false };
      started = true;
    }

    const mode = unitStoryMode(ctx, s, config);
    const limits = stepLimits(s.workflow, step);
    const env = readEnvNorn(s.worktree) ?? {};
    const num = (v: string | undefined) => (v !== undefined && /^\d+$/.test(v) ? Number(v) : null);
    const slicePath = s.unit.slice ? `${s.marker.spec_dir}/slices/${s.unit.dir}.md` : null;
    const slug = s.marker.spec_dir.split("/").at(-1)?.slice(s.unit.story.length + 1) ?? "";
    // A story diffs against the fetched base (`origin/main`), never the main checkout's stale local `main`
    const base = s.unit.slice ? storyBranch(s.unit.story, slug) : storyDiffBase(ctx, s.root);
    // Only rendered, never written: the run this brief is about to report, on the state as it stands
    const state = run.applied ? s.state : ({ ...s.state, run: { run_id: run.run_id, step: s.state.step, attempt: s.state.attempt, started_at: ctx.clock.iso(), how: "manual" as const } } as UnitState);
    const base_side = await gatherBaseSide((await ctx.ports()).git, s.worktree, step, s);
    const briefing = renderBrief({
      unit: s.unit,
      state,
      workflow: s.workflow,
      mode,
      runner: config.runner ? config.runner.adapter : null,
      paths: {
        worktree: s.worktree,
        spec_dir: s.marker.spec_dir,
        story_file: `${s.marker.spec_dir}/${basename(storyFile(s.specPath))}`,
        slice_file: slicePath,
        unit_dir: s.runsDir,
      },
      diff_range: `${base}...HEAD`,
      // The agent-written part only; the generated header and heartbeat are not for the agent
      handoff: readHandoff(s.handoffFile)?.body ?? null,
      receipts: s.receipts,
      limits: {
        deadline: limits.deadline,
        nudges: limits.nudges,
        retries: limits.retries,
        slot: num(env.NORN_SLOT),
        port_base: num(env.PORT_BASE),
      },
      check_log: checkLog(s),
      evidence_files: evidenceFiles(s),
      rulings: rulings(s),
      criteria: unitCriteria(s),
      record: storyRecord(s),
      base_side,
    });
    // The exact briefing of every run, in the trace
    const id = ulid(ctx.clock.now());
    const stored = writeBriefing(s.root, run.run_id, id, briefing.markdown);
    // Link the run to its briefing in the trace (`norn run list <unit>` shows it)
    appendTrace(s.root, traceEvent("briefing", ctx.clock.now(), { id, unit: key, run_id: run.run_id, step: s.state.step, attempt: s.state.attempt, briefing: stored }));
    return rendered({ unit: key, step: s.state.step, attempt: s.state.attempt, run_id: run.run_id, started, briefing: stored, markdown: briefing.markdown, brief: briefing.json }, briefing.markdown);
  },
});
