/**
 * `norn upgrade [--json]` (gh-110 B11–B17, D6; `norn migrate` before gh-61 B30): move the main
 * checkout from the old layout to the new one (D1) and stage the moves for the person to commit. A report for a person; `--json` for data
 * (`{moves, staged, commit}`).
 *
 * Checks first, nothing moved on a refusal (exit 3): the main checkout only (B16), no part in both
 * places (B17), the tick lock free (B15). Then, holding the tick lock at its old place: the config and
 * workflows by `git mv` (an untracked file is moved plainly and listed as untracked), the old trace
 * dir's contents into the machine dir (copy then delete across filesystems) with its `checkout.json`,
 * norn's old trace line out of `.gitignore` (staged), the old folder removed, the old lock last.
 * Every step can run again, so a rerun finishes an interrupted run; no rollback. On the new layout:
 * nothing to move (B14). Never commits, pushes, or touches a unit worktree.
 *
 * gh-61 B30 (D9): `norn migrate` is a deprecated alias that runs the same code and adds one line for a
 * person on stderr; it goes in the next minor.
 */
import { existsSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { cmd } from "@norn/core";
import { acquireLock, acquireTickLock, type ConfigMigration, dropOldIgnoreLine, migrateConfig, machineDir, moveFile, moveOldTrace, OLD_CONFIG_FILE, OLD_TRACE_DIR, OLD_WORKFLOWS_DIR, oldTickLockPath, oldWorkflowEntries, REPO_CONFIG_FILE, removeOldLayoutDirs, repoLayout, traceClashes, WORKFLOWS_DIR } from "@norn/store";
import { defineCommand } from "../command.ts";
import { type Context, safeRealpath } from "../context.ts";
import { refuse, rendered } from "../output.ts";
import { layoutRefusal } from "../runtime/layout.ts";

export interface UpgradeMove {
  part: "config" | "workflows" | "machine files";
  /** relative to the main checkout */
  from: string;
  /** relative to the main checkout; the machine dir's absolute path */
  to: string;
  /** `git mv`: a staged rename; `untracked`: moved plainly, not staged; `moved`: machine-local, outside git */
  how: "git mv" | "untracked" | "moved";
}

export interface UpgradeReport {
  moves: UpgradeMove[];
  /** gh-64 D13: the config rewrite (renamed and removed keys, files changed) */
  config: { changed: string[]; renamed: ConfigMigration["renamed"]; removed: ConfigMigration["removed"] };
  /** paths staged by this run, relative to the main checkout */
  staged: string[];
  /** the commit the person makes; null when nothing was staged */
  commit: string | null;
}

const COMMIT = `git commit -m "Move norn to its new layout (norn upgrade)"`;
const CONFIG_COMMIT = `git commit -m "Move norn config to its new keys (norn upgrade)"`;
/** gh-61 B29: a tick (or `norn watch`) holds the lock */
const STOP_WATCH = "stop `norn watch` and run it again";
const NO_CONFIG: UpgradeReport["config"] = { changed: [], renamed: [], removed: [] };

/** B16: refuse anywhere but the main checkout (a unit worktree, or any linked worktree). */
async function mainCheckoutOnly(ctx: Context, root: string): Promise<void> {
  const top = ctx.worktree ?? safeRealpath((await ctx.git.status(ctx.cwd)).path);
  if (top !== root) throw refuse(`${top} is not the main checkout; norn upgrade moves the main checkout only, so the move never lands in a story's branch`, `cd ${root} && ${cmd.upgrade()}`, "not_main_checkout", { main_checkout: root });
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

async function moveLayout(ctx: Context, root: string): Promise<UpgradeReport> {
  const moves: UpgradeMove[] = [];
  const staged: string[] = [];
  const at = (rel: string) => join(root, rel);
  /** a repo file by `git mv`, or plainly when untracked */
  const gitMove = async (part: UpgradeMove["part"], from: string, to: string) => {
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
  const lock = await acquireTickLock(root, { note: "norn upgrade", now: () => ctx.clock.iso() });
  if (!lock.ok) throw refuse(`a tick is running (pid ${lock.holder.holder.pid}${lock.holder.note ? `, ${lock.holder.note}` : ""}); norn upgrade never rewrites config under a running tick`, STOP_WATCH, "tick_locked");
  return lock;
}

/** gh-64 D13 (B40–B45): the config rewrite, run holding the tick lock; stages what is committed. */
async function migrateConfigPart(ctx: Context, root: string, report: UpgradeReport): Promise<UpgradeReport> {
  const c: ConfigMigration = migrateConfig({ root, home: ctx.home });
  if (c.stage.length) await ctx.git.stage(root, c.stage);
  const staged = [...report.staged, ...c.stage];
  return { ...report, config: { changed: c.changed, renamed: c.renamed, removed: c.removed }, staged, commit: report.commit ?? (staged.length ? CONFIG_COMMIT : null) };
}

function markdown(r: UpgradeReport, root: string): string {
  const config = r.config.changed.length || r.config.removed.length || r.config.renamed.length;
  if (!r.moves.length && !r.staged.length && !config) return `# norn upgrade\n\n${root} is on the new layout and its config on the new keys: nothing to move.`;
  const how = { "git mv": "staged", untracked: "untracked: moved, not staged", moved: "machine-local, outside git" };
  const out = ["# norn upgrade", ""];
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

async function upgrade(ctx: Context) {
  const root = ctx.root;
  await mainCheckoutOnly(ctx, root);
  const l = repoLayout(root);
  if (l.layout === "new") {
    const none: UpgradeReport = { moves: [], config: NO_CONFIG, staged: [], commit: null };
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
  const lock = await acquireLock(oldTickLockPath(root), { note: "norn upgrade", now: () => ctx.clock.iso() });
  if (!lock.ok) throw refuse(`a tick is running (pid ${lock.holder.holder.pid}${lock.holder.note ? `, ${lock.holder.note}` : ""}); norn upgrade never moves the trace under a running tick`, STOP_WATCH, "tick_locked");
  let report: UpgradeReport;
  try {
    report = await migrateConfigPart(ctx, root, await moveLayout(ctx, root));
  } finally {
    // D6: the old lock file goes last
    lock.release();
  }
  removeOldLayoutDirs(root);
  return rendered(report, markdown(report, root));
}

export const upgradeCommand = defineCommand({
  name: "upgrade",
  version: "exempt",
  summary: "Move this repo to the new layout and its config to the new keys, and stage the changes for you to commit",
  usage: "norn upgrade [--json]",
  markdown: true,
  layout: false,
  run: (ctx) => upgrade(ctx),
});

/** gh-61 B30: the old name, kept for one minor; the same code, one line on stderr. */
export const MIGRATE_RENAMED = "`norn migrate` is now `norn upgrade`; the old name goes in the next minor";

export const migrateCommand = defineCommand({
  name: "migrate",
  version: "exempt",
  summary: "Deprecated: the old name of norn upgrade, removed in the next minor",
  usage: "norn migrate [--json]",
  markdown: true,
  layout: false,
  run(ctx) {
    ctx.stderr.push(MIGRATE_RENAMED);
    return upgrade(ctx);
  },
});
