/**
 * The doctor's checks, in the order each needs the last: the config, the plugins it picks (installed
 * and on this norn's plugin API), the slots they build, the workflows (the pack's and the repo's
 * own), the labels norn puts on items, the harness hooks, and the tools on PATH the config needs. A
 * check that cannot run because an earlier one failed is skipped rather than failed, so the first
 * failure is the one to fix. `init` runs the same checks.
 */
import { REPO_WORKFLOWS_DIR, repoFileOf, type RuntimeEnv } from "@norn/runtime";
import type { NornConfig } from "./config/schema.ts";
import type { CliContext } from "./context.ts";
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

async function toolCheck(ctx: CliContext, cwd: string, t: { tool: string; why: string; install: string }): Promise<DoctorCheck> {
  const host = await ctx.host();
  const r = await host.exec([t.tool, "--version"], { cwd, timeoutMs: TOOL_TIMEOUT_MS });
  const name = `tool ${t.tool}`;
  if (r.code === 0) return passed(name, (r.stdout.trim().split("\n")[0] ?? "").trim() || "present");
  return { name, ok: false, error: `${t.tool} is not runnable (${t.why}): ${(r.stderr.trim() || `exit ${r.code}`).split("\n")[0]}`, do_instead: t.install, code: "tool_missing" };
}

/**
 * The hooks an agent's harness installs call back into this binary; a harness that lacks install, or
 * a binary that cannot be run, leaves an agent that never reports.
 */
async function hooksCheck(ctx: CliContext, cwd: string, harnesses: Readonly<Record<string, { install?: unknown }>>): Promise<DoctorCheck> {
  const lacking = Object.entries(harnesses).filter(([, h]) => typeof h.install !== "function").map(([name]) => name);
  if (lacking.length > 0) return { name: "hooks", ok: false, error: `the harness of executor ${lacking.join(", ")} cannot install hooks`, do_instead: "norn plugin update <the harness plugin>", code: "hooks_uninstallable" };
  const self = ctx.io.self;
  const host = await ctx.host();
  const r = await host.exec([...self, "--version"], { cwd, timeoutMs: TOOL_TIMEOUT_MS });
  if (r.code !== 0)
    return { name: "hooks", ok: false, error: `the hook command (${self.join(" ")} hook) cannot be run: ${(r.stderr.trim() || `exit ${r.code}`).split("\n")[0]}`, do_instead: "put norn on PATH, or run norn from where it is installed", code: "hook_command_missing" };
  return passed("hooks", `${Object.keys(harnesses).join(", ")} install hooks that run ${self.join(" ")} hook`);
}

/**
 * The labels norn puts on items, defined where missing: the one check that changes something, since
 * a label is missing only on a repository norn has never set up, and init runs this check.
 */
async function labelsCheck(env: RuntimeEnv): Promise<DoctorCheck> {
  const labels = nornLabels(env);
  const r = await attempt("labels", () => ensureLabels(env, labels));
  if (r.check) return r.check;
  return passed("labels", env.slots.tracker.capabilities.labels ? `${labels.length} labels defined on the ${env.slots.tracker.name} tracker` : `the ${env.slots.tracker.name} tracker keeps no labels`);
}

export interface DoctorOptions {
  /**
   * Only what the repo's tree decides: its config, the plugins it names, its slots and workflows. No
   * hooks and no tools, so a machine with no agent or runner (CI checking a branch) can run it.
   */
  repoOnly?: boolean;
}

export async function runDoctor(ctx: CliContext, opts: DoctorOptions = {}): Promise<DoctorReport> {
  const checks: DoctorCheck[] = [];
  const w = await ctx.repo();
  const cwd = w.repo.root;

  const config = await attempt("config", () => ctx.config());
  checks.push(config.check ?? passed("config", `executor ${config.value?.executor}; tracker ${config.value?.config.tracker.use}, forge ${config.value?.config.forge.use}, store ${config.value?.config.store.use}`));

  if (config.check) checks.push(skipped("plugins", "config"), skipped("slots", "config"), skipped("workflows", "config"), ...(opts.repoOnly ? [] : [skipped("labels", "config"), skipped("hooks", "config")]));
  else {
    const plugins = await attempt("plugins", () => ctx.plugins());
    checks.push(plugins.check ?? passed("plugins", `${plugins.value?.plugins.length} plugins (${plugins.value?.lock.plugins.length} installed), every one on this plugin API`));
    if (plugins.check) checks.push(skipped("slots", "plugins"), skipped("workflows", "plugins"), ...(opts.repoOnly ? [] : [skipped("labels", "plugins"), skipped("hooks", "plugins")]));
    else {
      const env = await attempt("slots", () => ctx.runtimeEnv());
      if (env.check) checks.push(env.check, skipped("workflows", "slots"), ...(opts.repoOnly ? [] : [skipped("labels", "slots"), skipped("hooks", "slots")]));
      else if (env.value) {
        checks.push(passed("slots", "every slot builds from its config"));
        const workflows = await attempt("workflows", () => ctx.workflowEnv());
        checks.push(workflows.check ?? passed("workflows", workflowsDetail(env.value)));
        if (!opts.repoOnly) checks.push(await labelsCheck(env.value), await hooksCheck(ctx, cwd, env.value.slots.executors));
      }
    }
  }

  if (!opts.repoOnly) for (const t of toolsNeeded(config.value?.config ?? null)) checks.push(await toolCheck(ctx, cwd, t));
  return { ok: checks.every((c) => c.ok), checks };
}

export function doctorLines(r: DoctorReport): string[] {
  return r.checks.map((c) => {
    const mark = c.ok ? "ok" : c.skipped ? "skipped" : "FAILED";
    const body = c.ok || c.skipped ? (c.detail ?? "") : `${c.error}${c.do_instead ? ` — do instead: ${c.do_instead}` : ""}`;
    return `- ${c.name}: ${mark}${body ? ` — ${body.replace(/^skipped: /, "")}` : ""}`;
  });
}
