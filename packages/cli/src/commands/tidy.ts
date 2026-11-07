/**
 * `norn tidy [--dry-run]`: report, or clean, what no unit needs any more:
 *   - orphan worktrees (norn-shaped, story unknown here) — removed only when clean; stale
 *     worktree records (`git worktree prune`)
 *   - orphan branches (observe: finished/unknown story, integrated/dropped slice) — deleted only
 *     when their commits are kept elsewhere (story branch, default branch, or the remote copy)
 *   - dead or unreadable leases in `~/.norn/leases/`
 *   - leftover `.NNNN.reserve` receipt reservations older than a minute
 *   - records set aside as superseded (`superseded/<story>-<ulid>/` in the
 *     machine dir) longer ago than the window, and their Check item with them
 *   - with Herdr as the runner, the panes left by runs that reported done — the run's tab, or
 *     only its pane when the tab holds something else, and the workspace when nothing else is left
 *   - trace day pairs (day file and chunks file) dated before today minus the window
 *     (`--retain`, else `trace.retain`, default and minimum 14d); `trace/workflows/`
 *     is never pruned. Only tidy prunes the trace, never watch or a tick.
 *   - the hook files of units with no live run untouched within the window, and the
 *     briefings, transcripts and old `runs/<run_id>.log` session logs of runs that are not
 *     live whose newest file is older than the window;
 *     never a live run's, nor `backfill.json`, the caches or the locks.
 *   - rejected mailbox receipts (`rejected.json`) cleared and rejected before the window
 * Nothing with unique work is removed; such items are listed under `kept` with the reason.
 */
import { readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { herdr } from "@norn/adapters";
import { ulid } from "@norn/schema";
import { deleteTraceDays, pruneRejectedReceipts, pruneSuperseded, rejectedReceiptsPath, deleteTracePaths, reclaimLeases, receiptsDir, safeUnlink, traceDaysBefore } from "@norn/store";
import { defineCommand, opt } from "../command.ts";
import type { Context } from "../context.ts";
import { refuse, usageError } from "../output.ts";
import { waitForTickLock } from "../runtime/tick-lock.ts";
import { leaseLiveness } from "../runtime/leases.ts";
import { type Observed, observe } from "../runtime/observe/index.ts";
import { doneHerdrRuns, planHerdrTidy } from "../runtime/tidy-herdr.ts";
import { checkRetain, MIN_TRACE_RETAIN, retainCutoffDay, unitTracesBefore } from "../runtime/trace-retention.ts";
import { cmd, storyFinished } from "@norn/core";

/** A reservation lives only while a receipt is being written; older ones are crash leftovers. */
const RESERVE_STALE_MS = 60_000;
const RESERVE = /^\.\d{4,}\.reserve$/;

/** Herdr when it is the runner — injected, else the real one; null = another runner. */
function tidyHerdr(ctx: Context): herdr.HerdrCockpit | null {
  if (ctx.config.runner.adapter !== herdr.RUNNER_NAME) return null;
  if (ctx.deps.herdr !== undefined) return ctx.deps.herdr;
  return herdr.createHerdrCockpit({ env: ctx.env });
}

/** Close (or, dry, list) what runs that reported done left in Herdr; a Herdr that fails is kept, not fatal. */
async function tidyHerdrPanes(cockpit: herdr.HerdrCockpit, obs: Observed, dry: boolean, kept: Array<{ item: string; reason: string }>) {
  const closed = { workspaces: [] as string[], tabs: [] as string[], panes: [] as string[] };
  const runs = doneHerdrRuns(
    Object.entries(obs.units).map(([key, u]) => ({ key, runsDir: u.runsDir })),
    obs.facts.machine.holder,
  );
  if (!runs.length) return closed;
  try {
    const plan = planHerdrTidy(runs, await cockpit.listPanes());
    kept.push(...plan.kept);
    for (const id of plan.workspaces) {
      if (!dry) await cockpit.closeWorkspace(id);
      closed.workspaces.push(id);
    }
    for (const id of plan.tabs) {
      if (!dry) await cockpit.closeTab(id);
      closed.tabs.push(id);
    }
    for (const id of plan.panes) {
      if (!dry) await cockpit.closePane(id);
      closed.panes.push(id);
    }
  } catch (e) {
    kept.push({ item: "herdr", reason: `could not tidy Herdr: ${(e as Error).message}` });
  }
  return closed;
}

/** The window for this run — `--retain`, else `trace.retain` — refused before anything is touched. */
function retainWindow(ctx: Context, flag: string | undefined): { retain: string; ms: number } {
  const retain = flag ?? ctx.config.trace.retain;
  const c = checkRetain(retain);
  if (c.ok) return c;
  const source = flag === undefined ? `trace.retain ${retain}` : `--retain ${retain}`;
  const fix = flag === undefined ? `set trace.retain to ${MIN_TRACE_RETAIN} or more (norn config get trace shows the layer that sets it)` : `norn tidy --retain ${MIN_TRACE_RETAIN}`;
  if (c.reason === "short") throw refuse(`the trace window must be at least ${MIN_TRACE_RETAIN} (${source})`, fix, "retain_too_short");
  const error = `${source} is not a duration: expected a form like ${MIN_TRACE_RETAIN}`;
  throw flag === undefined ? refuse(error, fix, "retain_invalid") : usageError(error, fix, "retain_invalid");
}

export const tidyCommand = defineCommand({
  name: "tidy",
  version: "acts",
  summary: "Report or clean orphan worktrees, branches, stale leases, receipt reservations, Herdr panes of runs that reported done, and trace days, hook files, briefings, transcripts, old session logs, cleared rejected mailbox receipts and records set aside as superseded older than trace.retain",
  usage: "norn tidy [--dry-run] [--retain <duration>]",
  options: { "dry-run": { type: "boolean" }, retain: { type: "string" } },
  async run(ctx, args) {
    const dry = opt.bool(args, "dry-run");
    const window = retainWindow(ctx, opt.str(args, "retain"));
    const lock = await waitForTickLock(ctx, "norn tidy", `retry: ${cmd.tidy()}`);
    try {
      const obs = await observe(ctx, { tick_id: ulid(ctx.clock.now()), sync: "never" });
      const git = obs.ports.git;
      const root = obs.root;
      const kept: Array<{ item: string; reason: string }> = [];

      const worktrees: string[] = [];
      for (const path of obs.facts.orphans.worktrees) {
        const st = await git.status(path).catch(() => null);
        if (st && !st.clean) {
          kept.push({ item: path, reason: "worktree has uncommitted changes" });
          continue;
        }
        if (!dry) await git.worktreeRemove(root, path, { force: !st });
        worktrees.push(path);
      }
      const prunable = (await git.worktreeList(root)).filter((w) => w.prunable).map((w) => w.path);
      if (!dry && prunable.length) await git.worktreePrune(root).catch(() => undefined);

      // Branches: delete only when their commits are contained elsewhere
      const branches: string[] = [];
      const base = obs.facts.repo.default_branch;
      for (const b of obs.facts.orphans.branches) {
        const story = /^((?:gh|gl)-\d+)/.exec(b)?.[1];
        const storyBranch = story ? obs.facts.stories.find((s) => s.key === story)?.branch : undefined;
        const homes = [
          ...(storyBranch && storyBranch !== b ? [`refs/heads/${storyBranch}`] : []),
          `refs/heads/${base}`,
          ...(obs.remote ? [`refs/remotes/${obs.remote}/${b}`, `refs/remotes/${obs.remote}/${base}`] : []),
        ];
        let safe = false;
        for (const h of homes) if ((await git.readRef(root, h)) && (await git.isAncestor(root, `refs/heads/${b}`, h))) safe = true;
        if (!safe) {
          kept.push({ item: b, reason: "branch has commits found nowhere else (not merged, not pushed)" });
          continue;
        }
        if (!dry) await git.deleteBranch(root, b, { force: true });
        branches.push(b);
      }

      const leaseFiles = obs.facts.machine.dead_lease_files ?? [];
      const leases = dry ? [...leaseFiles] : await reclaimLeases(ctx.home, leaseFiles, leaseLiveness((p) => obs.ports.process.isAlive(p)));

      // Receipt reservations left by a crashed writer
      const reserves: string[] = [];
      const now = Date.now(); // file mtimes are wall-clock
      for (const u of Object.values(obs.units)) {
        let names: string[];
        try {
          names = readdirSync(receiptsDir(u.runsDir));
        } catch {
          continue;
        }
        for (const n of names.filter((x) => RESERVE.test(x))) {
          const file = join(receiptsDir(u.runsDir), n);
          try {
            if (now - statSync(file).mtimeMs < RESERVE_STALE_MS) continue;
          } catch {
            continue;
          }
          if (!dry) safeUnlink(file);
          reserves.push(file);
        }
      }

      const cockpit = tidyHerdr(ctx);
      const herdrClosed = cockpit ? await tidyHerdrPanes(cockpit, obs, dry, kept) : null;

      // Trace day pairs older than the window (under the tick lock, so no tick appends to them)
      const days = traceDaysBefore(root, retainCutoffDay(ctx.clock.now(), window.ms));
      // Hook files and run dirs past the window that no live run needs
      const { hook_files, runs } = unitTracesBefore(root, obs.facts.stories.flatMap((s) => s.units), ctx.clock.now() - window.ms);
      if (!dry) {
        deleteTraceDays(root, days);
        deleteTracePaths(root, [...hook_files.map((f) => f.file), ...runs.flatMap((r) => r.files)]);
      }
      // Cleared rejected mailbox receipts age out with the trace that also records them; an open
      // one (its Check item still shown: no answer or approval since, story not finished) stays
      const open = new Set(obs.facts.stories.filter((s) => !storyFinished(s)).flatMap((s) => (s.rejected_mailbox ?? []).map((r) => r.receipt_id)));
      // A rejected.json that cannot be pruned is one kept item; the rest of tidy goes on
      const pruned = await pruneRejectedReceipts(root, new Date(ctx.clock.now() - window.ms).toISOString(), open, dry);
      if (pruned.error) kept.push({ item: rejectedReceiptsPath(root), reason: pruned.error });
      const rejected = pruned.removed.map((r) => r.receipt_id);
      // Records set aside as superseded go once older than the window; their Check item with them
      const superseded = pruneSuperseded(root, new Date(ctx.clock.now() - window.ms).toISOString(), dry).map((c) => c.name);
      const bytes = [...days, ...hook_files, ...runs].reduce((n, d) => n + d.bytes, 0);
      const trace = { retain: window.retain, days, hook_files, runs, bytes };

      const verb = dry ? "would_remove" : "removed";
      return {
        dry_run: dry,
        [verb]: { worktrees, stale_worktree_records: prunable, branches, leases, reserve_files: reserves, rejected_receipts: rejected, superseded, ...(herdrClosed ? { herdr: herdrClosed } : {}) },
        trace,
        kept,
      };
    } finally {
      lock.release();
    }
  },
});
