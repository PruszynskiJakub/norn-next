/**
 * `norn upgrade [--json]`: move a repo from norn 0.30 on to the running norn — the bundled skills
 * rewritten and relinked, then `norn_version` — staging every change for the person to commit;
 * never commits, pushes or touches a unit worktree.
 *
 * Every check runs before any write, and a refusal (exit 3) changes nothing: the main checkout only,
 * the 0.30 baseline (a repo with no or an older `norn_version` goes through the 0.30.x binary first),
 * a binary older than the recorded `norn_version` (no override), a config that loads, the tick lock free.
 * Every step can run again, so a rerun finishes an interrupted run; there is no rollback.
 * `norn_version` is written last. Labels are created where missing, never edited or deleted, and a
 * remote it cannot reach or write is reported, never a refusal or a changed exit code.
 */
import { join, relative } from "node:path";
import { cmd, upgradeBackward, versionBaseline } from "@norn/core";
import { versionMatch } from "@norn/schema";
import { acquireTickLock, gitRemoteUrl, installSkills, linkSkills, loadWorkflows, REPO_CONFIG_FILE, recordedNornVersion, repoConfigPath, SKILLS_DIR, writeNornVersion } from "@norn/store";
import { defineCommand } from "../command.ts";
import { type Context, safeRealpath } from "../context.ts";
import { refuse, rendered } from "../output.ts";
import { agentsInUse } from "../runtime/agents-in-use.ts";
import { assetsDir } from "../runtime/assets.ts";
import { type LabelsReport, labelsLines, remoteLabels } from "../runtime/labels.ts";
import { comparableVersion } from "../runtime/version-guard.ts";
import { bundledSkills, checkedRepoWorkflows } from "../runtime/workflows.ts";

export interface UpgradeReport {
  /** The repo's `norn_version` before and after; `changed` when this run wrote it */
  norn_version: { from: string | null; to: string | null; changed: boolean };
  /** Bundled skills rewritten in `.agents/skills/`, and those an agent's skill folder was relinked to */
  skills: { updated: string[]; linked: string[] };
  /** paths staged by this run, relative to the main checkout */
  staged: string[];
  /** the commit the person makes; null when nothing was staged */
  commit: string | null;
  /** The labels created, already there, unused and not created, or why they were not checked */
  labels?: LabelsReport;
}

/** A tick (or `norn watch`) holds the lock */
const STOP_WATCH = "stop `norn watch` and run it again";
const versionCommit = (v: string) => `git commit -m "Upgrade norn to ${v} (norn upgrade)"`;
const SKILLS_COMMIT = `git commit -m "Refresh norn's skills (norn upgrade)"`;

/** Refuse anywhere but the main checkout (a unit worktree, or any linked worktree). */
async function mainCheckoutOnly(ctx: Context, root: string): Promise<void> {
  const top = ctx.worktree ?? safeRealpath((await ctx.git.status(ctx.cwd)).path);
  if (top !== root) throw refuse(`${top} is not the main checkout; norn upgrade moves the main checkout only, so the move never lands in a story's branch`, `cd ${root} && ${cmd.upgrade()}`, "not_main_checkout", { main_checkout: root });
}

/**
 * The repo's recorded version and the running one. Refuses a repo below the 0.30 baseline (or
 * recording none), then a binary older than the repo; read from the team file itself, so a config
 * that fails to load still gets the baseline's path rather than a fix this norn cannot finish.
 */
function versions(ctx: Context, root: string): { from: string; to: string | null } {
  const from = recordedNornVersion(repoConfigPath(root));
  const baseline = versionBaseline(from, ctx.version);
  if (baseline) throw refuse(baseline.error, baseline.do_instead, baseline.code, { repo: from, running: ctx.version });
  // the baseline refuses a missing version, so one is recorded here
  const recorded = from as string;
  const to = comparableVersion(ctx.version);
  if (to && versionMatch(recorded, to) === "older") {
    const { error, do_instead } = upgradeBackward(recorded, to);
    throw refuse(error, do_instead, "version_backward", { repo: recorded, running: ctx.version });
  }
  return { from: recorded, to };
}

/** The tick lock, taken after every check and before anything changes, held through the labels. */
async function tickLock(ctx: Context, root: string) {
  const lock = await acquireTickLock(root, { note: "norn upgrade", now: () => ctx.clock.iso() });
  if (!lock.ok) throw refuse(`a tick is running (pid ${lock.holder.holder.pid}${lock.holder.note ? `, ${lock.holder.note}` : ""}); norn upgrade never rewrites the repo under a running tick`, STOP_WATCH, "tick_locked");
  return lock;
}

/** The bundled skills rewritten from this norn's copies and relinked, then `norn_version` last; all staged. */
async function skillsAndVersion(ctx: Context, root: string, v: { from: string; to: string | null }): Promise<UpgradeReport> {
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
    // A refusal, not a crash; the skills are rewritten, nothing staged yet, and a rerun finishes it
    if (!w.ok) throw refuse(`norn upgrade could not write norn_version to ${REPO_CONFIG_FILE}: ${w.error}`, `fix ${REPO_CONFIG_FILE} and run \`${cmd.upgrade()}\` again`, "config_invalid");
    stage.push(REPO_CONFIG_FILE);
  }
  if (stage.length) await ctx.git.stage(root, stage);
  const commit = changed ? versionCommit(v.to as string) : stage.length ? SKILLS_COMMIT : null;
  return { norn_version: { ...v, changed }, skills: { updated: installed.updated, linked: [...linked].sort() }, staged: [...new Set(stage)], commit };
}

async function labelsPart(ctx: Context, root: string, report: UpgradeReport): Promise<UpgradeReport> {
  const ports = await ctx.ports();
  const workflows = checkedRepoWorkflows(loadWorkflows(root), root, ctx.config, ports.agents);
  const labels = await remoteLabels({ remote: ports.remote, gitRemoteUrl: gitRemoteUrl(root, ctx.config.git_remote), intake: ctx.config.label, workflows, create: true });
  return { ...report, labels };
}

/** The one line that says what moved: the version and the skills. */
function summary(r: UpgradeReport): string {
  const v = r.norn_version;
  const parts = [v.changed ? `norn version ${v.from} → ${v.to}` : `norn version ${v.from}`];
  if (r.skills.updated.length) parts.push(`skills updated: ${r.skills.updated.join(", ")}`);
  if (r.skills.linked.length) parts.push(`skills relinked: ${r.skills.linked.join(", ")}`);
  return parts.join("; ");
}

function markdown(r: UpgradeReport): string {
  const labels = r.labels ? ["", ...labelsLines(r.labels)] : [];
  // The labels lines still show what upgrade did on the remote
  if (!r.staged.length && !r.skills.updated.length && !r.skills.linked.length && !r.norn_version.changed)
    return [`# norn upgrade\n\nalready on norn ${r.norn_version.from}: nothing to upgrade`, ...labels].join("\n");
  const out = ["# norn upgrade", "", summary(r)];
  if (r.skills.updated.length) out.push("", `Skills rewritten from norn ${r.norn_version.to}'s copies (\`git diff --staged ${SKILLS_DIR}/\` shows how): ${r.skills.updated.join(", ")}`);
  if (r.norn_version.changed) out.push("", `${REPO_CONFIG_FILE}: \`norn_version: ${r.norn_version.to}\` (staged)`);
  out.push(...labels);
  out.push("", r.commit ? `Review the staged changes with \`git diff --staged\`, then commit them: \`${r.commit}\`` : "Nothing to commit: only links in an ignored folder changed.");
  return out.join("\n");
}

async function upgrade(ctx: Context) {
  const root = ctx.root;
  await mainCheckoutOnly(ctx, root);
  const v = versions(ctx, root);
  // a config that fails to load is its own error (exit 6), before anything is written
  void ctx.resolved;
  const tick = await tickLock(ctx, root);
  try {
    const report = await labelsPart(ctx, root, await skillsAndVersion(ctx, root, v));
    return rendered(report, markdown(report));
  } finally {
    tick.release();
  }
}

export const upgradeCommand = defineCommand({
  name: "upgrade",
  version: "exempt",
  summary: "Move this repo's norn_version and bundled skills to this norn, from norn 0.30 on, staged for you to commit",
  usage: "norn upgrade [--json]",
  markdown: true,
  layout: false,
  run: (ctx) => upgrade(ctx),
});
