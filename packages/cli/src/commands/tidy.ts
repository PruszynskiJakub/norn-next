/**
 * `norn tidy [--dry-run]` (K5): report, or clean, what no unit needs any more:
 *   - orphan worktrees (norn-shaped, story unknown here) — removed only when clean; stale
 *     worktree records (`git worktree prune`)
 *   - orphan branches (observe: finished/unknown story, integrated/dropped slice) — deleted only
 *     when their commits are kept elsewhere (story branch, default branch, or the remote copy)
 *   - dead or unreadable leases in `~/.norn/leases/` (K3)
 *   - leftover `.NNNN.reserve` receipt reservations (S6) older than a minute
 * Nothing with unique work is removed; such items are listed under `kept` with the reason.
 */
import { readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { ulid } from "@norn/schema";
import { acquireTickLock, reclaimLeases, receiptsDir, safeUnlink, git as rawGit } from "@norn/store";
import { defineCommand, opt } from "../command.ts";
import { busyError } from "../output.ts";
import { leaseLiveness } from "../runtime/leases.ts";
import { observe } from "../runtime/observe.ts";

/** A reservation lives only while a receipt is being written; older ones are crash leftovers. */
const RESERVE_STALE_MS = 60_000;
const RESERVE = /^\.\d{4,}\.reserve$/;

export const tidyCommand = defineCommand({
  name: "tidy",
  summary: "Report or clean orphan worktrees, branches, stale leases and receipt reservations (K5)",
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

      const verb = dry ? "would_remove" : "removed";
      return {
        dry_run: dry,
        [verb]: { worktrees, stale_worktree_records: prunable, branches, leases, reserve_files: reserves },
        kept,
      };
    } finally {
      lock.release();
    }
  },
});
