/**
 * `norn migrate [--json]` (gh-110 B11–B17, D6): move the main checkout from the old layout to the new
 * one (D1) and stage the moves for the person to commit. A report for a person; `--json` for data
 * (`{moves, staged, commit}`).
 *
 * Checks first, nothing moved on a refusal (exit 3): the main checkout only (B16), no part in both
 * places (B17), the tick lock free (B15). Then, holding the tick lock at its old place: the config and
 * workflows by `git mv` (an untracked file is moved plainly and listed as untracked), the old trace
 * dir's contents into the machine dir (copy then delete across filesystems) with its `checkout.json`,
 * norn's old trace line out of `.gitignore` (staged), the old folder removed, the old lock last.
 * Every step can run again, so a rerun finishes an interrupted run; no rollback. On the new layout:
 * nothing to move (B14). Never commits, pushes, or touches a unit worktree.
 */
import { existsSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { cmd } from "@norn/core";
import { acquireLock, acquireTickLock, type ConfigMigration, dropOldIgnoreLine, migrateConfig, machineDir, moveFile, moveOldTrace, OLD_CONFIG_FILE, OLD_TRACE_DIR, OLD_WORKFLOWS_DIR, oldTickLockPath, oldWorkflowEntries, REPO_CONFIG_FILE, removeOldLayoutDirs, repoLayout, traceClashes, WORKFLOWS_DIR } from "@norn/store";
import { defineCommand } from "../command.ts";
import { type Context, safeRealpath } from "../context.ts";
import { refuse, rendered } from "../output.ts";
import { layoutRefusal } from "../runtime/layout.ts";

export interface MigrateMove {
  part: "config" | "workflows" | "machine files";
  /** relative to the main checkout */
  from: string;
  /** relative to the main checkout; the machine dir's absolute path */
  to: string;
  /** `git mv`: a staged rename; `untracked`: moved plainly, not staged; `moved`: machine-local, outside git */
  how: "git mv" | "untracked" | "moved";
}

export interface MigrateReport {
  moves: MigrateMove[];
  /** gh-64 D13: the config rewrite (renamed and removed keys, files changed) */
  config: { changed: string[]; renamed: ConfigMigration["renamed"]; removed: ConfigMigration["removed"] };
  /** paths staged by this run, relative to the main checkout */
  staged: string[];
  /** the commit the person makes; null when nothing was staged */
  commit: string | null;
}

const COMMIT = `git commit -m "Move norn to its new layout (norn migrate)"`;
const CONFIG_COMMIT = `git commit -m "Move norn config to its new keys (norn migrate)"`;
const NO_CONFIG: MigrateReport["config"] = { changed: [], renamed: [], removed: [] };

/** B16: refuse anywhere but the main checkout (a unit worktree, or any linked worktree). */
async function mainCheckoutOnly(ctx: Context, root: string): Promise<void> {
  const top = ctx.worktree ?? safeRealpath((await ctx.git.status(ctx.cwd)).path);
  if (top !== root) throw refuse(`${top} is not the main checkout; norn migrate moves the main checkout only, so the move never lands in a story's branch`, `cd ${root} && ${cmd.migrate()}`, "not_main_checkout", { main_checkout: root });
}

/**
 * B17: a part in both places, by D4 for the config and workflows. The machine files are never
 * committed, so only an interrupted run leaves them in both places: that is finished, unless one
 * name is in both (then both paths are named).
 */
function refuseBoth(root: string): void {
  const l = repoLayout(root);
  const committed = { ...l, parts: l.parts.filter((p) => p.part !== "machine files" || !p.at_new) };
  if (committed.parts.some((p) => p.at_old && p.at_new)) throw layoutRefusal({ layout: "both", parts: committed.parts }, root);
  const clash = traceClashes(root);
  if (clash.length)
    throw layoutRefusal({ layout: "both", parts: clash.map((n) => ({ part: "machine files", old: join(root, OLD_TRACE_DIR, n), new: join(machineDir(root), n), at_old: true, at_new: true })) }, root);
}

async function migrate(ctx: Context, root: string): Promise<MigrateReport> {
  const moves: MigrateMove[] = [];
  const staged: string[] = [];
  const at = (rel: string) => join(root, rel);
  /** a repo file by `git mv`, or plainly when untracked */
  const gitMove = async (part: MigrateMove["part"], from: string, to: string) => {
    mkdirSync(dirname(at(to)), { recursive: true });
    const isStaged = await ctx.git.move(root, from, to);
    if (!isStaged) moveFile(at(from), at(to));
    moves.push({ part, from, to, how: isStaged ? "git mv" : "untracked" });
    if (isStaged) staged.push(to);
  };

  if (existsSync(at(OLD_CONFIG_FILE))) await gitMove("config", OLD_CONFIG_FILE, REPO_CONFIG_FILE);
  for (const from of oldWorkflowEntries(root)) await gitMove("workflows", from, `${WORKFLOWS_DIR}/${from.slice(OLD_WORKFLOWS_DIR.length + 1)}`);
  if (moveOldTrace(root)) moves.push({ part: "machine files", from: OLD_TRACE_DIR, to: machineDir(root), how: "moved" });
  if (dropOldIgnoreLine(root)) {
    await ctx.git.stage(root, [".gitignore"]);
    staged.push(".gitignore");
  }
  return { moves, config: NO_CONFIG, staged, commit: staged.length ? COMMIT : null };
}

/** gh-64 B45: the tick lock, taken before anything changes and held through the config part. */
async function tickLock(ctx: Context, root: string) {
  const lock = await acquireTickLock(root, { note: "norn migrate", now: () => ctx.clock.iso() });
  if (!lock.ok) throw refuse(`a tick is running (pid ${lock.holder.holder.pid}${lock.holder.note ? `, ${lock.holder.note}` : ""}); norn migrate never rewrites config under a running tick`, `stop norn watch (and any tick), then run ${cmd.migrate()} again`, "tick_locked");
  return lock;
}

/** gh-64 D13 (B40–B45): the config rewrite, run holding the tick lock; stages what is committed. */
async function migrateConfigPart(ctx: Context, root: string, report: MigrateReport): Promise<MigrateReport> {
  const c: ConfigMigration = migrateConfig({ root, home: ctx.home });
  if (c.stage.length) await ctx.git.stage(root, c.stage);
  const staged = [...report.staged, ...c.stage];
  return { ...report, config: { changed: c.changed, renamed: c.renamed, removed: c.removed }, staged, commit: report.commit ?? (staged.length ? CONFIG_COMMIT : null) };
}

function markdown(r: MigrateReport, root: string): string {
  const config = r.config.changed.length || r.config.removed.length || r.config.renamed.length;
  if (!r.moves.length && !r.staged.length && !config) return `# norn migrate\n\n${root} is on the new layout and its config on the new keys: nothing to move.`;
  const how = { "git mv": "staged", untracked: "untracked: moved, not staged", moved: "machine-local, outside git" };
  const out = ["# norn migrate", ""];
  if (r.moves.length) out.push(`Moved ${root} to the new layout:`, "");
  for (const m of r.moves) out.push(`- ${m.part}: ${m.from} → ${m.to} (${how[m.how]})`);
  if (config) {
    const file = (f: "user" | "repo") => (f === "user" ? "the user file" : "the team file");
    out.push(...(r.moves.length ? [""] : []), "Config moved to its new keys:", "");
    for (const n of r.config.renamed) out.push(`- ${file(n.file)}: \`${n.from}\` → ${n.to.includes(" ") ? n.to : `\`${n.to}\``}`);
    for (const d of r.config.removed) out.push(`- removed \`${d.key}: ${typeof d.value === "object" ? JSON.stringify(d.value) : String(d.value)}\` from ${file(d.file)}: ${d.note}`);
    for (const p of r.config.changed) out.push(`- rewrote ${p.startsWith(root) ? p.slice(root.length + 1) : p}`);
  }
  if (r.staged.includes(".gitignore")) out.push(`- .gitignore: dropped ${OLD_TRACE_DIR}/ (staged)`);
  const untracked = r.moves.filter((m) => m.how === "untracked").map((m) => m.to);
  if (untracked.length) out.push("", `Untracked before, so not staged: ${untracked.join(", ")}. Add them yourself if they belong in the repo.`);
  out.push("", r.commit ? `Review the staged moves with \`git status\`, then commit them: \`${r.commit}\`` : "Nothing to commit: only machine-local files moved.");
  return out.join("\n");
}

export const migrateCommand = defineCommand({
  name: "migrate",
  summary: "Move this repo to the new layout and its config to the new keys, and stage the changes for you to commit",
  usage: "norn migrate [--json]",
  markdown: true,
  layout: false,
  async run(ctx) {
    const root = ctx.root;
    await mainCheckoutOnly(ctx, root);
    const l = repoLayout(root);
    if (l.layout === "new") {
      const none: MigrateReport = { moves: [], config: NO_CONFIG, staged: [], commit: null };
      const tick = await tickLock(ctx, root);
      try {
        const report = await migrateConfigPart(ctx, root, none);
        return rendered(report, markdown(report, root));
      } finally {
        tick.release();
      }
    }
    refuseBoth(root);
    // B45: on the old layout only an old norn ticks, under the old lock: taken before anything
    // moves and held through the config part
    const lock = await acquireLock(oldTickLockPath(root), { note: "norn migrate", now: () => ctx.clock.iso() });
    if (!lock.ok) throw refuse(`a tick is running (pid ${lock.holder.holder.pid}${lock.holder.note ? `, ${lock.holder.note}` : ""}); norn migrate never moves the trace under a running tick`, `stop norn watch (and any tick), then run ${cmd.migrate()} again`, "tick_locked");
    let report: MigrateReport;
    try {
      report = await migrateConfigPart(ctx, root, await migrate(ctx, root));
    } finally {
      // D6: the old lock file goes last
      lock.release();
    }
    removeOldLayoutDirs(root);
    return rendered(report, markdown(report, root));
  },
});
