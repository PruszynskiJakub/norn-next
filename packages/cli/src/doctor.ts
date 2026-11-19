/**
 * The doctor's checks, in the order each needs the last: the config, the plugins it picks (installed
 * and on this norn's plugin API), the slots they build, the workflows (the pack's and the repo's
 * own), the labels norn puts on items, the harness hooks, the pack's skills in the main checkout, and
 * the tools on PATH the config needs
 * (git followed by its remote, gh by its login). A
 * check that cannot run because an earlier one failed is skipped rather than failed, so the first
 * failure is the one to fix. `init` runs the same checks.
 */
import { RUN_ENV } from "@norn/plugin-api";
import { installSkills, REPO_WORKFLOWS_DIR, repoFileOf, type RuntimeEnv, SKILLS_DIR, shellQuote } from "@norn/runtime";
import type { NornConfig } from "./config/schema.ts";
import type { CliContext } from "./context.ts";
import { GIT_UPGRADE, gitTooOld, MIN_GIT_TEXT } from "./git-version.ts";
import { ensureLabels, nornLabels } from "./labels.ts";
import { CliFailure, toFailure } from "./output.ts";

export interface DoctorCheck {
  name: string;
  ok: boolean;
  /** an earlier check failed, so this one could not run */
  skipped?: true;
  detail?: string;
  error?: string;
  do_instead?: string | null;
  code?: string;
}

export interface DoctorReport {
  ok: boolean;
  checks: DoctorCheck[];
}

const passed = (name: string, detail: string): DoctorCheck => ({ name, ok: true, detail });
const skipped = (name: string, after: string): DoctorCheck => ({ name, ok: false, skipped: true, detail: `skipped: ${after} failed` });

function failedCheck(name: string, e: unknown): DoctorCheck {
  const f = e instanceof CliFailure ? e : toFailure(e);
  return { name, ok: false, error: f.body.error, do_instead: f.body.do_instead, ...(f.body.code ? { code: f.body.code } : {}) };
}

async function attempt<T>(name: string, run: () => Promise<T>): Promise<{ check: DoctorCheck | null; value?: T }> {
  try {
    return { check: null, value: await run() };
  } catch (e) {
    return { check: failedCheck(name, e) };
  }
}

/** A tool and why this config needs it. */
export function toolsNeeded(config: NornConfig | null): Array<{ tool: string; why: string; install: string }> {
  const out = [{ tool: "git", why: "norn keeps every story on a git branch", install: "install git (https://git-scm.com)" }];
  if (!config) return out;
  const uses = [config.tracker.use, config.forge.use];
  if (uses.includes("github")) out.push({ tool: "gh", why: "the github tracker or forge calls the GitHub CLI", install: "install the GitHub CLI (https://cli.github.com) and run gh auth login" });
  const executors = Object.values(config.executors);
  if (executors.some((e) => (typeof e.runner === "string" ? e.runner : e.runner.use) === "herdr"))
    out.push({ tool: "herdr", why: "an executor runs in the herdr runner", install: "install herdr, or norn config set executors.<name>.runner headless" });
  if (executors.some((e) => e.harness === "claude")) out.push({ tool: "claude", why: "an executor runs the claude harness", install: "install Claude Code (https://claude.com/claude-code)" });
  if (executors.some((e) => e.harness === "pi")) out.push({ tool: "pi", why: "an executor runs the pi harness", install: "install the pi coding agent (https://pi.dev), or norn config set executors.<name>.harness claude" });
  return out;
}

/** Which workflows load, and which of them are the repo's own files rather than the pack's. */
function workflowsDetail(env: RuntimeEnv): string {
  const names = Object.keys(env.workflows).sort();
  const own = names.filter((n) => repoFileOf(env.repoWorkflows, n, "workflow") !== null);
  return `${names.join(", ")} load${own.length > 0 ? ` (${own.join(", ")} from ${REPO_WORKFLOWS_DIR}/)` : ""}`;
}

const TOOL_TIMEOUT_MS = 15_000;

const firstLine = (r: { stderr: string; code: number }): string => (r.stderr.trim() || `exit ${r.code}`).split("\n")[0] as string;

async function toolCheck(ctx: CliContext, cwd: string, t: { tool: string; why: string; install: string }): Promise<DoctorCheck> {
  const host = await ctx.host();
  const r = await host.exec([t.tool, "--version"], { cwd, timeoutMs: TOOL_TIMEOUT_MS });
  const name = `tool ${t.tool}`;
  const version = (r.stdout.trim().split("\n")[0] ?? "").trim();
  if (r.code !== 0) return { name, ok: false, error: `${t.tool} is not runnable (${t.why}): ${firstLine(r)}`, do_instead: t.install, code: "tool_missing" };
  if (t.tool === "git" && gitTooOld(version))
    return { name, ok: false, error: `${version} is older than ${MIN_GIT_TEXT}, which norn needs to find conflicts with the base (git merge-tree --write-tree)`, do_instead: GIT_UPGRADE, code: "git_too_old" };
  return passed(name, version || "present");
}

/** A gh that is installed but logged out fails every tracker and forge call, so the tick that needs it is the first to say so. */
async function ghAuthCheck(ctx: CliContext, cwd: string): Promise<DoctorCheck> {
  const r = await (await ctx.host()).exec(["gh", "auth", "status"], { cwd, timeoutMs: TOOL_TIMEOUT_MS });
  if (r.code === 0) return passed("gh auth", "gh is logged in");
  return { name: "gh auth", ok: false, error: `gh is not logged in: ${firstLine(r)}`, do_instead: "gh auth login", code: "gh_logged_out" };
}

const DEFAULT_REMOTE = "origin";

const remoteKey = (slot: object): string | null => {
  const r = (slot as { remote?: unknown }).remote;
  return typeof r === "string" ? r : null;
};

/**
 * The git remotes this config pushes to, each with what pushes there: the vcs remote for a code host's
 * forge, and the refs store's own remote, which need not be the same one. Without one every push to it
 * fails; a repo on forge none with a local store keeps its work local and needs none.
 */
function remotesNeeded(config: NornConfig): Map<string, string[]> {
  const needed = new Map<string, string[]>();
  const need = (remote: string, who: string) => needed.set(remote, [...(needed.get(remote) ?? []), who]);
  if (config.vcs.use === "git" && config.forge.use !== "none") need(remoteKey(config.vcs) ?? DEFAULT_REMOTE, `the ${config.forge.use} forge`);
  if (config.store.use === "refs") need(remoteKey(config.store) ?? DEFAULT_REMOTE, "the refs store");
  return needed;
}

async function remoteChecks(ctx: CliContext, cwd: string, config: NornConfig): Promise<DoctorCheck[]> {
  const needed = remotesNeeded(config);
  const host = await ctx.host();
  const url = async (remote: string) => host.exec(["git", "remote", "get-url", remote], { cwd, timeoutMs: TOOL_TIMEOUT_MS });
  if (needed.size === 0) {
    if (config.vcs.use !== "git") return [];
    const remote = remoteKey(config.vcs) ?? DEFAULT_REMOTE;
    const r = await url(remote);
    return [passed("remote", r.code === 0 ? `${remote} is ${r.stdout.trim()}` : `no remote ${remote}; none needed with forge ${config.forge.use} and store ${config.store.use}`)];
  }
  const checks: DoctorCheck[] = [];
  for (const [remote, needs] of needed) {
    const name = needed.size === 1 ? "remote" : `remote ${remote}`;
    const r = await url(remote);
    checks.push(
      r.code === 0
        ? passed(name, `${remote} is ${r.stdout.trim()}`)
        : { name, ok: false, error: `this repository has no git remote ${remote}, which ${needs.join(" and ")} pushes to`, do_instead: `git remote add ${remote} <url>`, code: "no_remote" },
    );
  }
  return checks;
}

/** The hook name the probe passes: any name will do, as norn answers a hook outside a run before it reads the name. */
const HOOK_PROBE = "doctor-probe";

/**
 * Runs the hook line each harness writes, the way an agent runs it: through a shell, outside any run.
 * `norn --version` alone is not enough: run by bun without its script, the binary runs while every
 * hook line fails, which leaves an agent unguarded whose events never reach norn. Outside a run norn
 * answers a hook before it reads any config, so the probe proves only that the line dispatches, not
 * that a hook inside a run records its event.
 */
async function hooksCheck(ctx: CliContext, cwd: string, harnesses: Readonly<Record<string, { name: string; install?: unknown }>>): Promise<DoctorCheck> {
  const lacking = Object.entries(harnesses).filter(([, h]) => typeof h.install !== "function").map(([name]) => name);
  if (lacking.length > 0) return { name: "hooks", ok: false, error: `the harness of executor ${lacking.join(", ")} cannot install hooks`, do_instead: "norn plugin update <the harness plugin>", code: "hooks_uninstallable" };
  const host = await ctx.host();
  const lines: string[] = [];
  for (const name of [...new Set(Object.values(harnesses).map((h) => h.name))]) {
    const line = `${shellQuote([...ctx.io.self, "hook", name])} ${HOOK_PROBE}`;
    // emptied, so a doctor run inside a unit never files its probe under that unit's run
    const r = await host.exec(["sh", "-c", line], { cwd, input: "{}", env: { [RUN_ENV.unit]: "", [RUN_ENV.run]: "" }, timeoutMs: TOOL_TIMEOUT_MS });
    if (r.code !== 0)
      return { name: "hooks", ok: false, error: `the ${name} hook line (${line}) does not run: ${firstLine(r)}`, do_instead: "put norn on PATH, or reinstall norn, then norn doctor", code: "hook_not_firing" };
    lines.push(line);
  }
  return passed("hooks", `every hook line runs: ${lines.join("; ")}`);
}

/**
 * The labels norn puts on items, defined where missing: a label is missing only on a repository norn
 * has never set up, and init runs this check.
 */
async function labelsCheck(env: RuntimeEnv): Promise<DoctorCheck> {
  const labels = nornLabels(env);
  const r = await attempt("labels", () => ensureLabels(env, labels));
  if (r.check) return r.check;
  return passed("labels", env.slots.tracker.capabilities.labels ? `${labels.length} labels defined on the ${env.slots.tracker.name} tracker` : `the ${env.slots.tracker.name} tracker keeps no labels`);
}

/**
 * The pack's skills written into the main checkout, where a person's own session finds the ones a
 * person runs (norn-fsd, norn-retro, norn-triage): a launch writes them only into unit worktrees.
 * The same marked copies and links a launch writes, so a later run brings norn's up to date and
 * never touches a folder of the same name the person or the repo keeps; init runs this check, and
 * doctor again after an upgrade.
 */
async function skillsCheck(env: RuntimeEnv): Promise<DoctorCheck> {
  const root = env.ctx.repo.root;
  const dirs = [...new Set(Object.values(env.slots.executors).map((h) => h.skillsDir ?? SKILLS_DIR))];
  const r = await attempt("skills", async () => {
    let changed = 0;
    for (const dir of dirs) changed += (await installSkills(env.ctx.files, root, dir, env.slots.pack.skills)).length;
    return changed;
  });
  if (r.check) return { ...r.check, do_instead: r.check.do_instead ?? `make ${root} writable, then norn doctor` };
  const count = Object.keys(env.slots.pack.skills).length;
  return passed("skills", `${count} pack skills in ${dirs.join(", ")}${r.value ? ` (${r.value} files written)` : ""}`);
}

export interface DoctorOptions {
  /**
   * Only what the repo's tree decides: its config (the repo's own files, never the user's), the
   * plugins it names, its slots and workflows. No hooks and no tools, so a machine with no agent or
   * runner (CI checking a branch) can run it.
   */
  repoOnly?: boolean;
}

export async function runDoctor(ctx: CliContext, opts: DoctorOptions = {}): Promise<DoctorReport> {
  const checks: DoctorCheck[] = [];
  if (opts.repoOnly) ctx.repoLayersOnly();
  const w = await ctx.repo();
  const cwd = w.repo.root;

  const config = await attempt("config", () => ctx.config());
  checks.push(config.check ?? passed("config", `executor ${config.value?.executor}; tracker ${config.value?.config.tracker.use}, forge ${config.value?.config.forge.use}, store ${config.value?.config.store.use}`));

  if (config.check) checks.push(skipped("plugins", "config"), skipped("slots", "config"), skipped("workflows", "config"), ...(opts.repoOnly ? [] : [skipped("labels", "config"), skipped("hooks", "config"), skipped("skills", "config")]));
  else {
    const plugins = await attempt("plugins", () => ctx.plugins());
    checks.push(plugins.check ?? passed("plugins", `${plugins.value?.plugins.length} plugins (${plugins.value?.lock.plugins.length} installed), every one on this plugin API`));
    if (plugins.check) checks.push(skipped("slots", "plugins"), skipped("workflows", "plugins"), ...(opts.repoOnly ? [] : [skipped("labels", "plugins"), skipped("hooks", "plugins"), skipped("skills", "plugins")]));
    else {
      const env = await attempt("slots", () => ctx.runtimeEnv());
      if (env.check) checks.push(env.check, skipped("workflows", "slots"), ...(opts.repoOnly ? [] : [skipped("labels", "slots"), skipped("hooks", "slots"), skipped("skills", "slots")]));
      else if (env.value) {
        checks.push(passed("slots", "every slot builds from its config"));
        const workflows = await attempt("workflows", () => ctx.workflowEnv());
        checks.push(workflows.check ?? passed("workflows", workflowsDetail(env.value)));
        if (!opts.repoOnly) checks.push(await labelsCheck(env.value), await hooksCheck(ctx, cwd, env.value.slots.executors), await skillsCheck(env.value));
      }
    }
  }

  if (!opts.repoOnly)
    for (const t of toolsNeeded(config.value?.config ?? null)) {
      const tool = await toolCheck(ctx, cwd, t);
      checks.push(tool);
      if (!tool.ok) continue;
      if (t.tool === "git" && config.value) {
        checks.push(...(await remoteChecks(ctx, cwd, config.value.config)));
      }
      if (t.tool === "gh") checks.push(await ghAuthCheck(ctx, cwd));
    }
  return { ok: checks.every((c) => c.ok), checks };
}

export function doctorLines(r: DoctorReport): string[] {
  return r.checks.map((c) => {
    const mark = c.ok ? "ok" : c.skipped ? "skipped" : "FAILED";
    const body = c.ok || c.skipped ? (c.detail ?? "") : `${c.error}${c.do_instead ? ` — do instead: ${c.do_instead}` : ""}`;
    return `- ${c.name}: ${mark}${body ? ` — ${body.replace(/^skipped: /, "")}` : ""}`;
  });
}
