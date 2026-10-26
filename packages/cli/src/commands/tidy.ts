/**
 * `norn tidy [--dry-run]` (K5): report, or clean, what no unit needs any more:
 *   - orphan worktrees (norn-shaped, story unknown here) — removed only when clean; stale
 *     worktree records (`git worktree prune`)
 *   - orphan branches (observe: finished/unknown story, integrated/dropped slice) — deleted only
 *     when their commits are kept elsewhere (story branch, default branch, or the remote copy)
 *   - dead or unreadable leases in `~/.norn/leases/` (K3)
 *   - leftover `.NNNN.reserve` receipt reservations (S6) older than a minute
 *   - R2.3: runs/ work (receipts, state) of a story this checkout no longer holds that never reached
 *     the record — moved to `runs/<unit>/orphaned/<holder>-<file>` and committed on the local branch
 *     only, never pushed, so its receipt numbers are not reused
 *   - K7: with Herdr as the runner, the panes left by runs that reported done — the run's tab, or
 *     only its pane when the tab holds something else, and the workspace when nothing else is left
 * Nothing with unique work is removed; such items are listed under `kept` with the reason.
 */
import { readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { herdr } from "@norn/adapters";
import { ulid } from "@norn/schema";
import { acquireTickLock, copyToOrphaned, reclaimLeases, receiptsDir, safeUnlink, git as rawGit } from "@norn/store";
import { defineCommand, opt } from "../command.ts";
import type { Context } from "../context.ts";
import { busyError } from "../output.ts";
import { leaseLiveness } from "../runtime/leases.ts";
import { type Observed, observe } from "../runtime/observe.ts";
import { doneHerdrRuns, planHerdrTidy } from "../runtime/tidy-herdr.ts";

/** A reservation lives only while a receipt is being written; older ones are crash leftovers. */
const RESERVE_STALE_MS = 60_000;
const RESERVE = /^\.\d{4,}\.reserve$/;

/** K7: Herdr when it is the runner — injected, else the real one; null = another runner. */
function tidyHerdr(ctx: Context): herdr.HerdrCockpit | null {
  if (ctx.config.runner?.adapter !== herdr.RUNNER_NAME) return null;
  if (ctx.deps.herdr !== undefined) return ctx.deps.herdr;
  const o = ctx.config.runner.options ?? {};
  return herdr.createHerdrCockpit({ env: ctx.env, ...(typeof o.bin === "string" ? { bin: o.bin } : {}), ...(typeof o.session === "string" ? { session: o.session } : {}) });
}

/** K7: close (or, dry, list) what runs that reported done left in Herdr; a Herdr that fails is kept, not fatal. */
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

export const tidyCommand = defineCommand({
  name: "tidy",
  summary: "Report or clean orphan worktrees, branches, stale leases, receipt reservations (K5), runs/ work not in the record (R2.3) and Herdr panes of runs that reported done (K7)",
  usage: "norn tidy [--dry-run]",
  options: { "dry-run": { type: "boolean" } },
  async run(ctx, args) {
    const dry = opt.bool(args, "dry-run");
    const lock = await acquireTickLock(ctx.root, { note: "norn tidy", now: () => ctx.clock.iso() });
    if (!lock.ok) throw busyError(`a tick is running (pid ${lock.holder.holder.pid})`, "retry: norn tidy", "tick_locked");
    try {
      const obs = await observe(ctx, { tick_id: ulid(ctx.clock.now()), sync: "never" });
      const git = obs.ports.git;
      const root = obs.root;
      const kept: Array<{ item: string; reason: string }> = [];

      // ---- worktrees
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
      if (!dry && prunable.length) await rawGit(root, ["worktree", "prune"]);

      // ---- branches: delete only when their commits are contained elsewhere
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

      // ---- leases (K3): dead holders and unreadable files
      const leaseFiles = obs.facts.machine.dead_lease_files ?? [];
      const leases = dry ? [...leaseFiles] : await reclaimLeases(ctx.home, leaseFiles, leaseLiveness((p) => obs.ports.process.isAlive(p)));

      // ---- receipt reservations (S6) left by a crashed writer
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

      // ---- R2.3: runs/ work this checkout wrote for a story it no longer holds → orphaned/ (local only)
      const orphaned: Array<{ story: string; unit: string; moved: Array<{ from: string; to: string }>; commit: string | null }> = [];
      const holder = obs.facts.machine.holder;
      for (const [story, units] of Object.entries(obs.unpushed)) {
        for (const u of units) {
          const unitDir = join(u.cwd, obs.stories[story]?.spec_dir ?? "", "runs", u.dir);
          const moved: Array<{ from: string; to: string }> = [];
          for (const f of u.files) {
            const src = join(u.cwd, f);
            if (dry) {
              moved.push({ from: f, to: relative(u.cwd, join(unitDir, "orphaned", `${holder}-${f.split("/").at(-1)}`)) });
              continue;
            }
            const dest = copyToOrphaned(unitDir, src, holder);
            // back to the record's version of the path: the merge-base copy, or gone when it is new here
            const inBase = (await rawGit(u.cwd, ["cat-file", "-e", `${u.base}:${f}`])).code === 0;
            if (inBase) await rawGit(u.cwd, ["checkout", u.base, "--", f]);
            else {
              await rawGit(u.cwd, ["rm", "-q", "--cached", "--ignore-unmatch", "--", f]);
              safeUnlink(src);
            }
            if (dest) moved.push({ from: f, to: relative(u.cwd, dest) });
          }
          // committed on the local branch only — never pushed (R2.2: this checkout does not hold the claim)
          const commit = dry
            ? null
            : await git.commit(u.cwd, {
                message: `norn: ${u.unit} work not in the record moved to orphaned/`,
                trailers: { "Norn-Story": story, ...(u.unit !== story ? { "Norn-Slice": u.unit } : {}), "Norn-Tick": obs.facts.tick_id },
                paths: [relative(u.cwd, unitDir)],
              });
          orphaned.push({ story, unit: u.unit, moved, commit });
        }
      }

      // ---- K7: Herdr panes of runs that reported done
      const cockpit = tidyHerdr(ctx);
      const herdrClosed = cockpit ? await tidyHerdrPanes(cockpit, obs, dry, kept) : null;

      const verb = dry ? "would_remove" : "removed";
      return {
        dry_run: dry,
        [verb]: { worktrees, stale_worktree_records: prunable, branches, leases, reserve_files: reserves, ...(herdrClosed ? { herdr: herdrClosed } : {}) },
        [dry ? "would_orphan" : "orphaned"]: orphaned,
        kept,
      };
    } finally {
      lock.release();
    }
  },
});
