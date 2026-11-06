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
 * nothing to move (B14; gh-61 B15: nothing to upgrade). Never commits, pushes, or touches a unit worktree.
 *
 * gh-61 B13, B15–B17 (D9): it also moves the repo to the running norn. In order: the main checkout and
 * the tick lock, the backward check before any write (B17: a binary older than the recorded
 * `norn_version` is refused, no override), the layout and config moves, the bundled skills rewritten
 * and relinked, and `norn_version` written last (the team file edited in place, comments kept), all
 * staged, never committed. Nothing to do: "already on norn X.Y.Z" and no change (B15).
 *
 * gh-67 GR10 (B2, B7): on every run, even with nothing else to move, last: the labels norn uses
 * created on the remote where missing (`runtime/labels.ts`); never edited or deleted, and a remote it
 * cannot reach or write is reported, never a refusal or a changed exit code.
 *
 * gh-195 D14 (B35, B36; S10 retired): then, still under the lock, the run state an older norn left in
 * the base's tree: each finished story's `<spec folder>/runs` packed as is into `refs/norn/runs/<story>`,
 * the refs pushed in one batch before anything is removed (P6), the removal of each story whose ref is on
 * the remote staged, and the `runs/**` line dropped from `.gitattributes` (staged when git tracks it,
 * kept when every story failed); a story whose record
 * fails validation or whose push is rejected keeps its run state, unstaged, and is named with the reason.
 * A rerun pushes only the refs still missing. Committing the removal is the person's (LY3).
 *
 * gh-61 B30 (D9): `norn migrate` is a deprecated alias that runs the same code and adds one line for a
 * person on stderr; it goes in the next minor.
 */
import { existsSync, mkdirSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { cmd, upgradeBackward } from "@norn/core";
import { versionMatch } from "@norn/schema";
import { acquireLock, acquireTickLock, archiveBaseRunState, type BaseRecordOutcome, type ConfigMigration, dropOldIgnoreLine, dropRunsAttribute, gitRemoteUrl, installSkills, linkSkills, loadWorkflows, migrateConfig, machineDir, machineHolder, moveFile, moveOldTrace, OLD_CONFIG_FILE, OLD_TRACE_DIR, OLD_WORKFLOWS_DIR, oldTickLockPath, oldWorkflowEntries, REPO_CONFIG_FILE, recordedNornVersion, removeOldLayoutDirs, repoConfigPath, repoLayout, SKILLS_DIR, traceClashes, WORKFLOWS_DIR, writeNornVersion } from "@norn/store";
import { defineCommand } from "../command.ts";
import { type Context, safeRealpath } from "../context.ts";
import { refuse, rendered } from "../output.ts";
import { agentsInUse } from "../runtime/agents-in-use.ts";
import { assetsDir } from "../runtime/assets.ts";
import { gitRemote } from "../runtime/observe/remote.ts";
import { type LabelsReport, labelsLines, remoteLabels } from "../runtime/labels.ts";
import { layoutRefusal } from "../runtime/layout.ts";
import { comparableVersion } from "../runtime/version-guard.ts";
import { bundledSkills, checkedRepoWorkflows } from "../runtime/workflows.ts";

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
  /** gh-61 B13, B16: the repo's `norn_version` before and after; `changed` when this run wrote it */
  norn_version: { from: string | null; to: string | null; changed: boolean };
  /** gh-61 B13: bundled skills rewritten in `.agents/skills/`, and those an agent's skill folder was relinked to */
  skills: { updated: string[]; linked: string[] };
  /** paths staged by this run, relative to the main checkout */
  staged: string[];
  /** the commit the person makes; null when nothing was staged */
  commit: string | null;
  /** gh-195 B35, B36: each finished story whose run state was in the base's tree, and what happened to it ([] = none left) */
  run_state: BaseRecordOutcome[];
  /** gh-195 S10 (retired): the `runs/**` line dropped from `.gitattributes`, staged or (an untracked file) not; absent = untouched */
  gitattributes?: "staged" | "untracked";
  /** gh-67 GR10, B15: the labels created, already there, unused and not created, or why they were not checked */
  labels?: LabelsReport;
}

const COMMIT = `git commit -m "Move norn to its new layout (norn upgrade)"`;
const CONFIG_COMMIT = `git commit -m "Move norn config to its new keys (norn upgrade)"`;
/** gh-61 B29: a tick (or `norn watch`) holds the lock */
const STOP_WATCH = "stop `norn watch` and run it again";
const NO_CONFIG: UpgradeReport["config"] = { changed: [], renamed: [], removed: [] };
const NO_SKILLS: UpgradeReport["skills"] = { updated: [], linked: [] };
const versionCommit = (v: string) => `git commit -m "Upgrade norn to ${v} (norn upgrade)"`;
const SKILLS_COMMIT = `git commit -m "Refresh norn's skills (norn upgrade)"`;
const RUN_STATE_COMMIT = `git commit -m "Move norn run state to archive refs (norn upgrade)"`;
const ATTRIBUTES_COMMIT = `git commit -m "Drop norn's runs/ line from .gitattributes (norn upgrade)"`;

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
  return { moves, config: NO_CONFIG, norn_version: { from: null, to: null, changed: false }, skills: NO_SKILLS, run_state: [], staged, commit: staged.length ? COMMIT : null };
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

/**
 * gh-61 B17 (D9): the repo's recorded version (the team file at whichever place the layout keeps it)
 * and the running one; refuses before any write when the binary is older than the repo.
 */
function versions(ctx: Context, root: string): { from: string | null; to: string | null } {
  const team = existsSync(repoConfigPath(root)) ? repoConfigPath(root) : join(root, OLD_CONFIG_FILE);
  const from = recordedNornVersion(team);
  const to = comparableVersion(ctx.version);
  if (from && to && versionMatch(from, to) === "older") {
    const { error, do_instead } = upgradeBackward(from, to);
    throw refuse(error, do_instead, "version_backward", { repo: from, running: ctx.version });
  }
  return { from, to };
}

/** gh-61 B13 (D9): the bundled skills rewritten from this norn's copies and relinked, then `norn_version` last; all staged. */
async function versionPart(ctx: Context, root: string, report: UpgradeReport, v: { from: string | null; to: string | null }): Promise<UpgradeReport> {
  // the layout and config moves are done: the config loads from its new place and keys
  ctx.reload();
  const names = bundledSkills(ctx.env);
  const installed = installSkills(root, join(assetsDir(ctx.env), "skills"), names);
  const stage = installed.updated.map((n) => `${SKILLS_DIR}/${n}`);
  const linked = new Set<string>();
  const links: string[] = [];
  const seen = new Set<string>();
  for (const agent of Object.values(agentsInUse(root, ctx.resolved, await ctx.ports()))) {
    const dir = agent.skillDir(root);
    if (seen.has(dir)) continue;
    seen.add(dir);
    for (const n of linkSkills(root, dir, names).linked) {
      linked.add(n);
      links.push(relative(root, join(dir, n)));
    }
  }
  // a link in a folder the repo ignores (`.claude/` in .gitignore) is relinked but never committed: `git add` would refuse it
  const ignored = new Set(await ctx.git.ignored(root, links));
  stage.push(...links.filter((l) => !ignored.has(l)));
  const changed = v.to !== null && v.from !== v.to;
  if (changed) {
    const w = writeNornVersion(root, v.to as string);
    // P8: a refusal, not a crash; the skills are rewritten, nothing staged yet, and a rerun finishes it
    if (!w.ok) throw refuse(`norn upgrade could not write norn_version to ${REPO_CONFIG_FILE}: ${w.error}`, `fix ${REPO_CONFIG_FILE} and run \`${cmd.upgrade()}\` again`, "config_invalid");
    stage.push(REPO_CONFIG_FILE);
  }
  if (stage.length) await ctx.git.stage(root, stage);
  const staged = [...new Set([...report.staged, ...stage])];
  const commit = changed ? versionCommit(v.to as string) : (report.commit ?? (stage.length ? SKILLS_COMMIT : null));
  return { ...report, norn_version: { ...v, changed }, skills: { updated: installed.updated, linked: [...linked].sort() }, staged, commit };
}

/**
 * gh-195 D14 (B35, B36): the base's run state into archive refs, pushed before any removal is staged
 * (`archiveBaseRunState`); then the retired S10 line out of `.gitattributes`. Both staged, never committed.
 */
async function runStatePart(ctx: Context, root: string, report: UpgradeReport): Promise<UpgradeReport> {
  const remote = await gitRemote(ctx.git, root, ctx.config.git_remote);
  const run_state = await archiveBaseRunState(root, remote, { holder: machineHolder(ctx.env), at: ctx.clock.iso() });
  const moved = run_state.filter((r) => r.done !== "failed").map((r) => r.path);
  // F4: when run state was there and none of it moved, the line stays with it
  if (run_state.length && !moved.length) return { ...report, run_state };
  const attributes = dropRunsAttribute(root);
  const stage = [...moved];
  // LY3: an untracked file is edited, never staged
  if (attributes.changed && attributes.tracked) {
    await ctx.git.stage(root, [".gitattributes"]);
    stage.push(".gitattributes");
  }
  const staged = [...new Set([...report.staged, ...stage])];
  const commit = report.commit ?? (moved.length ? RUN_STATE_COMMIT : stage.length ? ATTRIBUTES_COMMIT : null);
  return { ...report, run_state, ...(attributes.changed ? { gitattributes: attributes.tracked ? "staged" : "untracked" } : {}), staged, commit };
}

/** gh-67 GR10 (B2): the labels, after every move, so the workflows are read from their new place. */
async function labelsPart(ctx: Context, root: string, report: UpgradeReport): Promise<UpgradeReport> {
  ctx.reload();
  const ports = await ctx.ports();
  const workflows = checkedRepoWorkflows(loadWorkflows(root), root, ctx.config, ports.agents);
  const labels = await remoteLabels({ remote: ports.remote, gitRemoteUrl: gitRemoteUrl(root, ctx.config.git_remote), intake: ctx.config.label, workflows, create: true });
  return { ...report, labels };
}

/** gh-61 B13: the one line that says what moved: the version, the skills, the config. */
function summary(r: UpgradeReport): string {
  const v = r.norn_version;
  const parts = [v.changed ? `norn version ${v.from ?? "(none)"} → ${v.to}` : `norn version ${v.from ?? v.to}`];
  if (r.skills.updated.length) parts.push(`skills updated: ${r.skills.updated.join(", ")}`);
  if (r.skills.linked.length) parts.push(`skills relinked: ${r.skills.linked.join(", ")}`);
  const config = [
    ...(r.moves.length ? ["moved to the new layout"] : []),
    ...r.config.renamed.map((n) => `\`${n.from}\` → ${n.to.includes(" ") ? n.to : `\`${n.to}\``}`),
    ...r.config.removed.map((d) => `\`${d.key}\` removed`),
  ];
  if (config.length) parts.push(`config: ${config.join(", ")}`);
  return parts.join("; ");
}

function markdown(r: UpgradeReport, root: string): string {
  const config = r.config.changed.length || r.config.removed.length || r.config.renamed.length;
  const skills = r.skills.updated.length || r.skills.linked.length;
  const labels = r.labels ? ["", ...labelsLines(r.labels)] : [];
  // B15; gh-67 B2: the labels line still shows what upgrade did on the remote
  if (!r.moves.length && !r.staged.length && !config && !skills && !r.norn_version.changed && !r.run_state.length && !r.gitattributes)
    return [`# norn upgrade\n\nalready on norn ${r.norn_version.from ?? r.norn_version.to}: nothing to upgrade (${root} is on the new layout, its config on the new keys, its skills match and no run state is left in its tree).`, ...labels].join("\n");
  const how = { "git mv": "staged", untracked: "untracked: moved, not staged", moved: "machine-local, outside git" };
  // every section below starts with its own blank line
  const out = ["# norn upgrade", "", summary(r)];
  if (r.moves.length) out.push("", `Moved ${root} to the new layout:`, "");
  for (const m of r.moves) out.push(`- ${m.part}: ${m.from} → ${m.to} (${how[m.how]})`);
  if (config) {
    const file = (f: "user" | "repo") => (f === "user" ? "the user file" : "the team file");
    out.push("", "Config moved to its new keys:", "");
    for (const n of r.config.renamed) out.push(`- ${file(n.file)}: \`${n.from}\` → ${n.to.includes(" ") ? n.to : `\`${n.to}\``}`);
    for (const d of r.config.removed) out.push(`- removed \`${d.key}: ${typeof d.value === "object" ? JSON.stringify(d.value) : String(d.value)}\` from ${file(d.file)}: ${d.note}`);
    for (const p of r.config.changed) out.push(`- rewrote ${p.startsWith(root) ? p.slice(root.length + 1) : p}`);
  }
  if (r.staged.includes(".gitignore")) out.push(`- .gitignore: dropped ${OLD_TRACE_DIR}/ (staged)`);
  const untracked = r.moves.filter((m) => m.how === "untracked").map((m) => m.to);
  if (untracked.length) out.push("", `Untracked before, so not staged: ${untracked.join(", ")}. Add them yourself if they belong in the repo.`);
  if (r.skills.updated.length) out.push("", `Skills rewritten from norn ${r.norn_version.to}'s copies (\`git diff --staged ${SKILLS_DIR}/\` shows how): ${r.skills.updated.join(", ")}`);
  if (r.norn_version.changed) out.push("", `${REPO_CONFIG_FILE}: \`norn_version: ${r.norn_version.to}\` (staged)`);
  if (r.run_state.length) out.push("", "Run state in the tree, to archive refs:", "");
  for (const s of r.run_state)
    out.push(s.done === "failed" ? `- ${s.story}: not moved, its run state stays in the tree (not staged): ${s.reason}` : `- ${s.story}: ${s.done === "pushed" ? "pushed" : "already on the remote:"} ${s.ref}; removal of ${s.path} staged`);
  if (r.gitattributes) out.push("", `.gitattributes: dropped the \`runs/**\` line (${r.gitattributes === "staged" ? "staged" : "untracked: edited, not staged"})`);
  out.push(...labels);
  out.push("", r.commit ? `Review the staged moves with \`git status\`, then commit them: \`${r.commit}\`` : r.run_state.length ? "Nothing to commit: no run state moved." : "Nothing to commit: only machine-local files moved.");
  return out.join("\n");
}

async function upgrade(ctx: Context) {
  const root = ctx.root;
  await mainCheckoutOnly(ctx, root);
  // B17: before any write, the tick lock included
  const v = versions(ctx, root);
  const l = repoLayout(root);
  if (l.layout === "new") {
    const none: UpgradeReport = { moves: [], config: NO_CONFIG, norn_version: { ...v, changed: false }, skills: NO_SKILLS, run_state: [], staged: [], commit: null };
    const tick = await tickLock(ctx, root);
    try {
      const report = await labelsPart(ctx, root, await runStatePart(ctx, root, await versionPart(ctx, root, await migrateConfigPart(ctx, root, none), v)));
      return rendered(report, markdown(report, root));
    } finally {
      tick.release();
    }
  }
  refuseBoth(root);
  // B45: on the old layout only an old norn ticks, under the old lock: taken before anything
  // moves and held through the config, skills and version parts
  const lock = await acquireLock(oldTickLockPath(root), { note: "norn upgrade", now: () => ctx.clock.iso() });
  if (!lock.ok) throw refuse(`a tick is running (pid ${lock.holder.holder.pid}${lock.holder.note ? `, ${lock.holder.note}` : ""}); norn upgrade never moves the trace under a running tick`, STOP_WATCH, "tick_locked");
  let report: UpgradeReport;
  try {
    report = await runStatePart(ctx, root, await versionPart(ctx, root, await migrateConfigPart(ctx, root, await moveLayout(ctx, root)), v));
  } finally {
    // D6: the old lock file goes last
    lock.release();
  }
  removeOldLayoutDirs(root);
  report = await labelsPart(ctx, root, report);
  return rendered(report, markdown(report, root));
}

export const upgradeCommand = defineCommand({
  name: "upgrade",
  version: "exempt",
  summary: "Move this repo to this norn: its norn_version, the bundled skills, the layout and config keys, staged for you to commit",
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
