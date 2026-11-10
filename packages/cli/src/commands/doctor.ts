/**
 * `norn doctor [--live] [--repo] [--json]`: is this machine ready to run norn here? Read-only.
 * Labels, the trace window and (in manual mode) the runner only ever warn, never fail.
 * Codex runs project hooks only once `.codex/` is trusted (`/hooks` in Codex).
 * `--live` also runs one cheap headless turn per agent in a throwaway repo and checks its hooks reported.
 * `--repo` runs only the repo checks (missing or unlinked skills stay machine checks).
 * Exit 0 when every check passes, else 1 with the same report.
 */
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, extname, join, relative, resolve } from "node:path";
import { git as gitAdapter, herdr, proc } from "@norn/adapters";
import type { AgentAdapter, FileError, Ports, RunnerPort, SessionRef, WorkflowIssue } from "@norn/core";
import { type ConfigEntry, ExitCode, PROVIDERS, type ResolvedConfig, ulid, type VersionMatch, versionMatch } from "@norn/schema";
import { baseRunStateStories, baseSpecsRoot, bindNornHome, cachedDefaultBranch, defaultBaseRef, loadWorkflows, gitRemoteUrl, machineDir, machineHolder, orphanedMachineDirs, readHookFacts, repoConfigPath, SKILLS_DIR, skillsDrift, skillsReport, spawnBounded, traceDaysBefore, unbindNornHome, workflowsDir, writeUnitMarker } from "@norn/store";
import { defineCommand, opt } from "../command.ts";
import type { Context } from "../context.ts";
import { CliFailure, configError, rendered, withExit } from "../output.ts";
import { agentsInUse } from "../runtime/agents-in-use.ts";
import { assetsDir } from "../runtime/assets.ts";
import { type LabelsReport, labelsWarnings, remoteLabels } from "../runtime/labels.ts";
import { ensureShim, withNornOnPath } from "../runtime/shim.ts";
import { effectiveRetain, formatBytes, retainCutoffDay, retainWarning } from "../runtime/trace-retention.ts";
import { bundledSkills, checkedRepoWorkflows } from "../runtime/workflows.ts";
import { hookBinary, hookCommand } from "./init.ts";
import { baseRunStateHint, cmd } from "@norn/core";
import { oneLine } from "@norn/view";

interface RunOut {
  code: number | null;
  out: string;
  timed_out: boolean;
  error?: string;
}

async function run(argv: string[], o: { cwd?: string; env?: Record<string, string | undefined>; input?: string; timeoutMs: number }): Promise<RunOut> {
  const r = await spawnBounded(argv, {
    ...(o.cwd === undefined ? {} : { cwd: o.cwd }),
    ...(o.env === undefined ? {} : { env: o.env }),
    ...(o.input === undefined ? {} : { stdin: o.input }),
    timeoutMs: o.timeoutMs,
  });
  if (r.spawn_error !== undefined) return { code: null, out: "", timed_out: false, error: r.spawn_error };
  return { code: r.timed_out ? null : r.code, out: `${r.stdout}${r.stderr}`.trim(), timed_out: r.timed_out };
}

const firstLine = (s: string) => s.split("\n")[0]?.trim() ?? "";
const SHORT = 200;
/** An error as one readable line for a person; `--json` keeps all of it. */
const short = (s: string) => {
  const one = oneLine(s, Infinity);
  return one.length > SHORT ? `${one.slice(0, SHORT)}… (${cmd.doctor({ json: true })} has the rest)` : one;
};
const which = (cmd: string, env: Record<string, string | undefined>) => (cmd.includes("/") ? cmd : Bun.which(cmd, { PATH: env.PATH ?? process.env.PATH ?? "" }));

/** A synthetic hook event this adapter recognizes: prefer session start (never blocks). */
function syntheticEvent(agent: AgentAdapter, cwd: string, env: Record<string, string | undefined>): { arg: string; payload: Record<string, string> } | null {
  const natives = Object.entries(agent.hookEvents).sort(([, a], [, b]) => (a === "session_start" ? -1 : b === "session_start" ? 1 : 0));
  for (const [native] of natives) {
    const payload = { hook_event_name: native, session_id: "norn-doctor", cwd };
    for (const arg of [native.replace(/([a-z0-9])([A-Z])/g, "$1-$2").toLowerCase(), native])
      if (agent.parseHookEvent(arg, payload, env, new Date().toISOString())) return { arg, payload };
  }
  return null;
}

/** A throwaway unit worktree (its own git repo) whose machine dir is in this command's home; `drop` removes both. */
async function scratchUnit(ctx: Context): Promise<{ repo: string; drop: () => void }> {
  const dir = mkdtempSync(join(tmpdir(), "norn-doctor-"));
  const repo = join(dir, "repo");
  try {
    await run(["git", "init", "-q", repo], { timeoutMs: 10_000 });
    bindNornHome(repo, ctx.home);
    writeUnitMarker(repo, { repo, story: "gh-1", slice: null, unit: "_story", spec_dir: ".agents/specs/gh-1-norn-doctor" });
  } catch (e) {
    rmSync(dir, { recursive: true, force: true });
    throw e;
  }
  const machine = machineDir(repo);
  return {
    repo,
    drop: () => {
      rmSync(machine, { recursive: true, force: true });
      unbindNornHome(repo);
      rmSync(dir, { recursive: true, force: true });
    },
  };
}

/** Invoke the installed hook command the way the agent tool would, and look for the recorded fact. */
async function hookFires(ctx: Context, name: string, agent: AgentAdapter, command: string) {
  const bin = hookBinary(command, ctx.env);
  if (!which(bin, ctx.env)) return { ok: false, command, error: `${bin} not found on PATH (the installed hooks call it)` };
  const { repo, drop } = await scratchUnit(ctx);
  try {
    const ev = syntheticEvent(agent, repo, ctx.env);
    if (!ev) return { ok: false, command, error: "adapter recognizes none of its own hook events" };
    const since = new Date(Date.now() - 1000).toISOString();
    const r = await run(["sh", "-c", `${command} ${ev.arg} --agent ${name}`], { cwd: repo, env: { ...process.env, ...ctx.env }, input: JSON.stringify(ev.payload), timeoutMs: 20_000 });
    const facts = readHookFacts(repo, "0000");
    const ok = r.code === 0 && facts.length > 0;
    return { ok, command: `${command} ${ev.arg} --agent ${name}`, exit: r.code, recorded: facts.length, ...(ok ? {} : { error: r.error ?? (r.code !== 0 ? firstLine(r.out) || `exit ${r.code}` : `no hook fact recorded (since ${since})`) }) };
  } finally {
    drop();
  }
}

/** --live: one cheap headless turn in a throwaway repo with norn hooks installed. */
async function liveTurn(ctx: Context, name: string, agent: AgentAdapter, command: string) {
  const { repo, drop } = await scratchUnit(ctx);
  try {
    if (agent.tier !== "none") await agent.installHooks(repo, command, name);
    const cfg = usableConfig(ctx).config.agents[name];
    const launch = agent.launchCommand({
      cwd: repo,
      prompt: "This is a connectivity test. Reply with the single word OK and do nothing else.",
      headless: true,
      env: { NORN_HOME: repo, NORN_STORY: "gh-1" },
      config: { ...(cfg?.args ? { args: cfg.args } : {}) },
    });
    const r = await run(launch.argv, { cwd: repo, env: { ...process.env, ...ctx.env, ...launch.env }, timeoutMs: 180_000 });
    const facts = readHookFacts(repo, "0000");
    const ok = r.code === 0 && (agent.tier === "none" || facts.length > 0);
    return { ok, exit: r.code, timed_out: r.timed_out, hook_events: facts.map((f) => f.event), ...(ok ? {} : { error: r.error ?? (r.code !== 0 ? firstLine(r.out.slice(-500)) : "the agent ran but no hook reported to norn") }) };
  } finally {
    drop();
  }
}

/**
 * `command -v norn` in a throwaway runner session launched the way act launches agents (shim first
 * on PATH): it must resolve to this norn's shim, not whatever the pane's login shell finds first.
 */
async function nornThroughRunner(ctx: Context, runner: RunnerPort): Promise<{ ok: boolean; expected: string; resolved: string | null; error?: string }> {
  const expected = ensureShim(ctx.home);
  const dir = mkdtempSync(join(tmpdir(), "norn-doctor-path-"));
  const out = join(dir, "norn-path.txt");
  let session: SessionRef | null = null;
  try {
    // The session keeps a process in the foreground until doctor closes it — a runner reports a
    // command that never took the foreground as a failed launch
    const probe = `command -v norn > ${proc.shellQuote(`${out}.tmp`)}; mv ${proc.shellQuote(`${out}.tmp`)} ${proc.shellQuote(out)}; exec sleep 60`;
    const argv = withNornOnPath(["sh", "-c", probe], expected, ctx.env.PATH);
    session = await runner.launch({ cwd: dir, argv: argv.argv, env: argv.env, title: "norn doctor", run_id: ulid(ctx.clock.now()) });
    const deadline = Date.now() + RUNNER_PATH_WAIT_MS;
    while (!existsSync(out) && Date.now() < deadline) await Bun.sleep(200);
    const resolved = existsSync(out) ? readFileSync(out, "utf8").trim() || null : null;
    if (resolved === null) return { ok: false, expected, resolved, error: `no answer from the ${runner.name} session within ${RUNNER_PATH_WAIT_MS / 1000}s` };
    const ok = resolved === expected;
    return { ok, expected, resolved, ...(ok ? {} : { error: `agents in ${runner.name} sessions would run ${resolved}, not this norn (${expected})` }) };
  } catch (e) {
    return { ok: false, expected, resolved: null, error: `could not start a ${runner.name} session: ${(e as Error).message}` };
  } finally {
    if (session) await runner.kill(session).catch(() => undefined);
    rmSync(dir, { recursive: true, force: true });
  }
}

const RUNNER_PATH_WAIT_MS = 15_000;

/**
 * How to add the cockpit plugin. It ships in the repo, not in the package or binary: when norn
 * runs from source, link this checkout's copy (it follows `git pull`); otherwise install it from GitHub.
 */
export function pluginLinkHint(assets: string): string {
  const dir = join(assets, "..", "..", "..", "plugins", "herdr");
  const how = existsSync(join(dir, "herdr-plugin.toml")) ? `herdr plugin link ${resolve(dir)}` : `herdr plugin install ${HERDR_PLUGIN_SOURCE}`;
  return `${how} (optional: the cockpit of norn status --watch)`;
}

const HERDR_PLUGIN_SOURCE = "PruszynskiJakub/norn-next/plugins/herdr";

/** Whether norn's Herdr plugin is linked; a hint when it is not (never an error). */
async function cockpitPlugin(ctx: Context): Promise<Record<string, unknown>> {
  const cockpit = herdr.createHerdrCockpit({ env: ctx.env });
  const linked = await cockpit.pluginLinked().catch(() => undefined);
  if (linked === undefined) return { linked: null, note: "could not list Herdr plugins" };
  if (!linked) return { linked: false, do_instead: pluginLinkHint(assetsDir(ctx.env)) };
  return { linked: true, enabled: linked.enabled, root: linked.root };
}

interface Check {
  ok: boolean;
  error?: string;
  do_instead?: string;
}

type ConfigFail = { ok: false; error: string; do_instead: string | null };

/** The config doctor runs on — the resolved one, or the valid values of one that does not load. */
function usableConfig(ctx: Context): { config: ResolvedConfig; entries: readonly ConfigEntry[] } {
  const l = ctx.loaded;
  return l.ok ? l : l.fallback;
}

const portsTried = new WeakMap<Context, Promise<{ ports: Ports; fail: ConfigFail | null }>>();

/**
 * The ports for the usable config, with an adapter that fails to build recorded as one
 * failure and the rest built without notifiers. Not cached on the context, so no later caller gets
 * the fallback ports. Anything other than a config error is a bug and is thrown.
 */
function doctorPorts(ctx: Context) {
  let p = portsTried.get(ctx);
  if (!p) {
    const { config } = usableConfig(ctx);
    p = ctx.portsFor(config).then(
      (ports) => ({ ports, fail: null }),
      async (e: unknown) => {
        if (!(e instanceof CliFailure) || e.exit !== ExitCode.config) throw e;
        return { ports: await ctx.portsFor(config, { notifiers: [] }), fail: { ok: false as const, error: e.body.error, do_instead: e.body.do_instead } };
      },
    );
    portsTried.set(ctx, p);
  }
  return p;
}

/** A config file that does not load, as one failure; the team file's problems are the repo group's own line. */
function loadFail(ctx: Context): ConfigFail | null {
  const l = ctx.loaded;
  if (l.ok) return null;
  const machine = l.problems.filter((p) => p.file !== "repo");
  if (!machine.length) return null;
  const body = configError(machine, { ...l.paths }).body;
  return { ok: false, error: body.error, do_instead: body.do_instead };
}

/** The repo's `norn_version` against this binary; no key is a warning, never a failure. */
interface VersionCheck extends Check {
  running: string;
  repo: string | null;
  match: VersionMatch | null;
  warning?: string;
}

function versionCheck(running: string, repo: string | null): VersionCheck {
  if (repo === null) return { ok: true, running, repo, match: null, warning: `no norn version recorded: run \`${cmd.upgrade()}\`` };
  const match = versionMatch(repo, running);
  if (match === "match") return { ok: true, running, repo, match };
  const line = `${repo.split(".").slice(0, 2).join(".")}.x`;
  // A newer binary moves the repo forward with a commit; an older one installs the repo's line
  const do_instead = match === "newer" ? `run \`${cmd.upgrade()}\` to move this repo to norn ${running} and commit the change, or install norn ${line}` : `install norn ${line}`;
  return { ok: false, running, repo, match, error: `norn ${running} does not match this repo's norn version ${repo}`, do_instead };
}

/** The bundled skills in `.agents/skills/` that differ from this norn's copies; a repo-local one is never compared. */
interface SkillsDriftCheck extends Check {
  drifted: string[];
}

function driftCheck(drifted: string[]): SkillsDriftCheck {
  if (!drifted.length) return { ok: true, drifted };
  return { ok: false, drifted, do_instead: `run \`${cmd.upgrade()}\` and commit (git diff ${SKILLS_DIR}/ shows the change)` };
}

const driftText = (drifted: string[], running: string) => `${drifted.join(", ")} ${drifted.length === 1 ? "differs" : "differ"} from norn ${running}'s copy`;

interface RepoReport {
  ok: boolean;
  version: VersionCheck;
  skills: SkillsDriftCheck;
  workflows: Array<{ name: string; file: string; ok: boolean; issues: WorkflowIssue[] }>;
  config: { ok: boolean; file: string; present: boolean; errors: FileError["errors"] };
  /** Run state an older norn left in the base's tree, never read: fixed by `norn upgrade` */
  run_state: Check & { stories: string[] };
}

/**
 * The repo workflows through the validator a tick uses, with each configured agent's
 * visible skills, and the repo config layer against its schema. Reads files only.
 */
async function repoGroup(ctx: Context): Promise<RepoReport> {
  const root = ctx.root;
  const loaded = ctx.loaded;
  const listing = loadWorkflows(root);
  // On the valid values of a config that does not load, so its skills are still checked
  const agents = (await doctorPorts(ctx)).ports.agents;
  const checked = checkedRepoWorkflows(listing, root, { agent: usableConfig(ctx).config.agent }, agents);
  const fileOf = (name: string) => {
    const wf = listing.workflows[name];
    return wf ? relative(root, wf.file) : (listing.errors.find((e) => basename(e.file, extname(e.file)) === name)?.file ?? name);
  };
  const workflows = Object.values(checked)
    .map((w) => {
      const file = fileOf(w.name);
      // schema issues carry their file in the message for a tick's inbox; doctor names it once, on its own line
      const issues = w.issues.map((i) => (i.message.startsWith(`${file}: `) ? { ...i, message: i.message.slice(file.length + 2) } : i));
      return { name: w.name, file, ok: issues.length === 0, issues };
    })
    .sort((a, b) => a.name.localeCompare(b.name));
  const configFile = relative(root, repoConfigPath(root));
  const configErrors = loaded.ok ? [] : loaded.errors.filter((e) => e.file === configFile).flatMap((e) => e.errors);
  const config = { ok: configErrors.length === 0, file: configFile, present: existsSync(repoConfigPath(root)), errors: configErrors };
  const version = versionCheck(ctx.version, usableConfig(ctx).config.norn_version);
  const skills = driftCheck(skillsDrift(join(root, SKILLS_DIR), join(assetsDir(ctx.env), "skills"), bundledSkills(ctx.env)));
  const run_state = runStateCheck(ctx);
  return {
    ok: version.ok && skills.ok && workflows.every((w) => w.ok) && config.ok && run_state.ok,
    version,
    skills,
    workflows,
    config,
    run_state,
  };
}

/**
 * The stories whose run state is still in the base's tree (the fetched base
 * branch, the main checkout without one); a failed check until the removal `norn upgrade` stages is committed.
 */
function runStateCheck(ctx: Context): Check & { stories: string[] } {
  const base = usableConfig(ctx).config.base_branch ?? cachedDefaultBranch(ctx.root) ?? "main";
  const ref = defaultBaseRef(ctx.root, usableConfig(ctx).config.git_remote, base);
  const tree = ref ? baseSpecsRoot(ctx.root, ref) : null;
  const stories = baseRunStateStories(tree ?? ctx.root);
  if (!stories.length) return { ok: true, stories };
  return { ok: false, stories, error: baseRunStateHint.text(base, stories), do_instead: baseRunStateHint.fix() };
}

/** One line per check: `ok`, `warn` or `FAIL`, a label, the text; failed labels are collected for the head line. */
function lines() {
  const out: string[] = [];
  const failed: string[] = [];
  const line = (ok: boolean, label: string, text: string, warn = false) => {
    out.push(`  ${ok ? "ok  " : warn ? "warn" : "FAIL"} ${label.padEnd(14)} ${text}`);
    if (!ok && !warn) failed.push(label);
  };
  const sub = (text: string) => out.push(`       ${"".padEnd(14)} ${text}`);
  const fix = (c: { error?: unknown; do_instead?: unknown }) => {
    if (c.error) sub(`! ${short(String(c.error))}`);
    if (c.do_instead) sub(`→ ${String(c.do_instead)}`);
  };
  const head = (ok: boolean) => (ok ? "norn doctor: every check passes" : `norn doctor: ${failed.length} check${failed.length === 1 ? "" : "s"} failed (${failed.join(", ")})`);
  return { out, line, sub, fix, head };
}

function formatVersion(v: VersionCheck, l: ReturnType<typeof lines>): void {
  if (v.repo === null) return l.line(false, "norn", v.warning ?? "", true);
  l.line(v.ok, "norn", `${v.running} ${v.ok ? "matches" : "does not match"} this repo's norn version ${v.repo}`);
  if (v.do_instead) l.sub(`→ ${v.do_instead}`);
}

/**
 * The repo group's lines: the norn version, drifted skills (`--repo` only: the full doctor folds them
 * into its one skills line), the valid workflows on one line, each invalid one with its issues, the config.
 */
function formatRepo(r: RepoReport, l: ReturnType<typeof lines>, dir: string, o: { skills: boolean }): void {
  formatVersion(r.version, l);
  if (o.skills && !r.skills.ok) {
    l.line(false, "skills", driftText(r.skills.drifted, r.version.running));
    l.fix(r.skills);
  }
  const valid = r.workflows.filter((w) => w.ok).map((w) => w.name);
  if (valid.length || !r.workflows.length) l.line(true, "workflows", valid.length ? `${valid.join(", ")} valid (${dir}/)` : `none valid in ${dir}/`);
  for (const w of r.workflows.filter((x) => !x.ok)) {
    l.line(false, `workflow ${w.name}`, w.file);
    for (const i of w.issues) l.sub(`! ${i.path || "/"}: ${i.message}`);
  }
  if (!r.run_state.ok) {
    l.line(false, "run state", r.run_state.stories.join(", "));
    l.fix(r.run_state);
  }
  l.line(r.config.ok, "config", r.config.present ? r.config.file : `${r.config.file} (none: built-in defaults)`);
  for (const e of r.config.errors) l.sub(`! ${e.path || "/"}: ${e.message}`);
}

/** `norn doctor`: one line per check, then what failed and what to do. */
function formatDoctor(r: {
  ok: boolean;
  machine: { holder: string };
  config?: { ok: false; error: string; do_instead: string | null };
  git: Check & { version: string | null };
  agents: Array<{
    name: string;
    tier: string;
    ok: boolean;
    binary: { command: string; path: string | null; version: string | null };
    hooks_installed: boolean | null;
    hook_fires: (Check & { command: string }) | null;
    test_turn?: (Check & { hook_events?: string[] }) | null;
    notes: string[];
  }>;
  remote: Record<string, unknown>;
  runner: Record<string, unknown>;
  skills: Check & { dir: string; missing: string[]; drifted: string[]; unlinked: Record<string, string[]> };
  repo: RepoReport;
  warnings: string[];
  hints: string[];
}, dir: string): string {
  const l = lines();
  const { out, line, sub, fix } = l;

  if (r.config) {
    line(false, "config", r.config.error);
    if (r.config.do_instead) sub(`→ ${r.config.do_instead}`);
  }
  line(r.git.ok, "git", r.git.version ?? "not found");
  fix(r.git);
  for (const a of r.agents) {
    const bin = a.binary.path ? `${a.binary.path}${a.binary.version ? ` (${a.binary.version})` : ""}` : `${a.binary.command} not on PATH`;
    const hooks = a.tier === "none" ? "no hooks" : a.hooks_installed === false ? "hooks missing" : a.hook_fires?.ok ? "hooks fire" : "hooks installed, not firing";
    const turn = a.test_turn ? (a.test_turn.ok ? " · test turn ok" : " · test turn failed") : "";
    line(a.ok, `agent ${a.name}`, `${bin} · ${hooks}${turn}`);
    if (a.hook_fires && !a.hook_fires.ok) sub(`! hook: ${a.hook_fires.error}`);
    if (a.test_turn && !a.test_turn.ok) sub(`! test turn: ${a.test_turn.error}`);
    for (const n of a.notes) sub(`· ${n}`);
  }
  const remote = r.remote;
  line(remote.ok === true, "remote", remote.configured === false ? `${remote.provider ?? "none"} (not configured)` : `${remote.provider}${remote.user ? ` as ${remote.user}` : ""}`);
  fix(remote);
  const runner = r.runner;
  const onPath = runner.norn_on_path as (Check & { resolved: string | null }) | undefined;
  line(runner.ok === true, "runner", runner.configured === false ? `none — ${runner.note}` : `${runner.name}${runner.available ? " available" : " not available"}${onPath ? (onPath.ok ? " · sessions run this norn" : "") : ""}`, runner.required === false);
  fix(runner);
  if (onPath && !onPath.ok) sub(`! ${short(String(onPath.error))}`);
  if (runner.ok !== true && runner.required === false) sub("· only auto mode needs a runner; in manual mode you start agents yourself");
  // Informational, never a failed check
  const plugin = runner.cockpit_plugin as { linked: boolean | null; do_instead?: string } | undefined;
  if (plugin) sub(plugin.linked ? "· cockpit plugin linked" : `· cockpit plugin not linked${plugin.do_instead ? ` → ${plugin.do_instead}` : ""}`);
  const sk = r.skills;
  const unlinked = Object.entries(sk.unlinked);
  line(
    sk.ok,
    "skills",
    sk.ok
      ? "installed and linked"
      : [
          sk.drifted.length ? driftText(sk.drifted, r.repo.version.running) : "",
          sk.missing.length ? `missing ${sk.missing.join(", ")}` : "",
          ...unlinked.map(([agent, names]) => `not linked for ${agent}: ${names.join(", ")}`),
        ]
          .filter(Boolean)
          .join("; "),
  );
  // Drift is fixed by `norn upgrade`, a missing or unlinked skill by `norn init`
  if (!r.repo.skills.ok) fix(r.repo.skills);
  if (sk.missing.length || unlinked.length) sub(`→ ${cmd.init()}`);
  out.push(`       ${"machine".padEnd(14)} ${r.machine.holder}`);
  formatRepo(r.repo, l, dir, { skills: false });

  const warnings = r.warnings.length ? ["", "Warnings", ...r.warnings.map((w) => `  ! ${w}`)] : [];
  const hints = r.hints.length ? ["", "Hints", ...r.hints.map((h) => `  · ${h}`)] : [];
  return [l.head(r.ok), "", ...out, ...warnings, ...hints].join("\n");
}

function formatRepoOnly(r: { ok: boolean; repo: RepoReport }, dir: string): string {
  const l = lines();
  formatRepo(r.repo, l, dir, { skills: true });
  return [l.head(r.ok), "", ...l.out].join("\n");
}

export const doctorCommand = defineCommand({
  name: "doctor",
  version: "reads",
  summary: "Check agents, hooks, skills, remote auth and runner on this machine, and the repo workflows and config",
  usage: "norn doctor [--repo] [--live] [--json]",
  markdown: true,
  options: { live: { type: "boolean" }, repo: { type: "boolean" } },
  optionHelp: {
    "--repo": "check only the repo: its norn version, bundled skills, workflows and config; no agent, runner or remote needed (CI, a test check)",
    "--live": "also run one cheap headless test turn per agent",
  },
  async run(ctx, args) {
    const live = opt.bool(args, "live");
    const repoOnly = opt.bool(args, "repo");
    const repo = await repoGroup(ctx);
    const dir = relative(ctx.root, workflowsDir(ctx.root));
    // --repo looks at no agent, runner or remote
    if (repoOnly) {
      const report = { ok: repo.ok, repo };
      const out = rendered(report, formatRepoOnly(report, dir));
      return report.ok ? out : withExit(out, ExitCode.error);
    }
    // A config file that does not load, or an adapter that fails to build, is one
    // `FAIL config` line; the other checks still run, on the values that are valid
    const usable = usableConfig(ctx);
    const config = usable.config;
    const { ports, fail: buildFail } = await doctorPorts(ctx);
    const fails = [loadFail(ctx), buildFail].filter((f): f is ConfigFail => f !== null);
    const configFail: ConfigFail | null = fails.length ? { ok: false, error: fails.map((f) => f.error).join("; "), do_instead: fails.map((f) => f.do_instead).filter(Boolean).join("; ") || null } : null;
    const command = hookCommand(ctx);

    const g = await run(["git", "--version"], { timeoutMs: 10_000 });
    // Base conflict detection needs `git merge-tree --write-tree`, git ≥ 2.38
    const gitVersion = firstLine(g.out) || null;
    const gitNew = g.code === 0 && gitAdapter.gitVersionOk(gitVersion ?? "");
    const gitCheck = {
      ok: gitNew,
      version: gitVersion,
      ...(g.code === 0 && !gitNew ? { error: `git ≥ ${gitAdapter.MIN_GIT_VERSION.join(".")} is required (merge-tree --write-tree)`, do_instead: "upgrade git" } : {}),
    };

    const agents = [];
    const used = agentsInUse(ctx.root, usable, ports);
    for (const [name, agent] of Object.entries(used)) {
      const argv = agent.launchCommand({ cwd: ctx.root, prompt: "x", headless: true, env: {}, config: {} }).argv;
      const bin = argv[0] ?? name;
      const path = which(bin, ctx.env);
      const v = path ? await run([path, "--version"], { timeoutMs: 15_000 }) : null;
      const hooksInstalled = agent.tier === "none" ? null : await agent.hooksInstalled(ctx.root).catch(() => false);
      const fires = agent.tier === "none" ? null : await hookFires(ctx, name, agent, command);
      const turn = live ? await liveTurn(ctx, name, agent, command) : null;
      const notes: string[] = [];
      if (agent.tier === "none") notes.push("no hooks: runner, process and git facts only");
      if (agent.setupNote) notes.push(agent.setupNote);
      if (hooksInstalled === false) notes.push(`run ${cmd.init()} to install hooks`);
      const ok = !!path && hooksInstalled !== false && (fires?.ok ?? true) && (turn?.ok ?? true);
      agents.push({
        name,
        adapter: name,
        tier: agent.tier,
        ok,
        binary: { command: bin, path: path ?? null, version: v && v.code === 0 ? firstLine(v.out) : null },
        hooks_installed: hooksInstalled,
        hook_fires: fires,
        ...(live ? { test_turn: turn } : {}),
        notes,
      });
    }

    let remote: Record<string, unknown>;
    if (!ports.remote) remote = { ok: true, provider: config.provider, configured: false };
    else {
      try {
        remote = { ok: true, provider: ports.remote.provider, user: await ports.remote.whoami() };
      } catch (e) {
        remote = { ok: false, provider: ports.remote.provider, error: (e as Error).message, do_instead: `${PROVIDERS[config.provider].cli} auth login` };
      }
    }
    // sync reads issues and every step pushes through this remote: without it nothing moves
    const gitRemote = { name: config.git_remote, url: gitRemoteUrl(ctx.root, config.git_remote) };
    remote.git_remote = gitRemote;
    if (!gitRemote.url && remote.ok === true)
      remote = { ...remote, ok: false, error: `this repository has no git remote named ${gitRemote.name}`, do_instead: `git remote add ${gitRemote.name} <url>` };

    // Checked, never created; a warning at most
    const labels: LabelsReport = await remoteLabels({ remote: ports.remote, gitRemoteUrl: gitRemote.url, intake: config.label, workflows: checkedRepoWorkflows(loadWorkflows(ctx.root), ctx.root, { agent: config.agent }, ports.agents), create: false });

    let runner: Record<string, unknown> = { ok: true, configured: false, note: "manual mode only: a person starts agents" };
    if (ports.runner) {
      const available = await ports.runner.available().catch(() => false);
      const onPath = available ? await nornThroughRunner(ctx, ports.runner) : null;
      runner = {
        ok: available && (onPath?.ok ?? true),
        configured: true,
        // Only auto mode starts agents through the runner
        required: config.mode === "auto",
        name: ports.runner.name,
        available,
        ...(onPath ? { norn_on_path: onPath } : {}),
        ...(available ? {} : { error: ports.runner.unavailableHint ?? `${ports.runner.name} runner not available` }),
      };
      // Informational — the cockpit plugin is optional, so it never fails doctor
      if (available && ports.runner.name === herdr.RUNNER_NAME) runner.cockpit_plugin = await cockpitPlugin(ctx);
    }

    const names = bundledSkills(ctx.env);
    const sk = skillsReport(ctx.root, join(assetsDir(ctx.env), "skills"), names, Object.fromEntries(Object.entries(used).map(([n, a]) => [n, a.skillDir(ctx.root)])));
    // Drift fails the one skills line too (fixed by `norn upgrade`); missing or unlinked ones by `norn init`
    const setup = sk.missing.length === 0 && Object.keys(sk.unlinked).length === 0;
    const skillsOk = setup && repo.skills.ok;
    const fixes = [repo.skills.do_instead, setup ? undefined : cmd.init()].filter(Boolean).join("; ");
    const skills = { ok: skillsOk, ...sk, ...(skillsOk ? {} : { do_instead: fixes }) };

    // NORN_MACHINE is a test aid, never a team setup: two checkouts claiming one machine name
    // defeat run liveness: a pid is judged only on the machine its run started on
    const machine = { holder: machineHolder(ctx.env), override: ctx.env.NORN_MACHINE ?? null };
    const warnings: string[] = [];
    if (machine.override !== null)
      warnings.push(`NORN_MACHINE=${machine.override} overrides this machine's name (a test aid): runs are judged by pid only on the machine they were started on, so two hosts must never share a name — unset it outside tests`);

    // A machine dir left behind when this repo folder moved; adopting it keeps the heartbeat.
    // The own dir exists already (every traced command makes it), so a plain mv would nest into it.
    const mine = proc.shellQuote(machineDir(ctx.root));
    for (const o of orphanedMachineDirs(ctx.home, ctx.root))
      warnings.push(
        `orphaned machine dir ${o.dir}: its checkout ${o.checkout} no longer exists — if this repo moved from there, stop norn watch and adopt it (keeps its heartbeat and claims): rm -rf ${mine} && mv ${proc.shellQuote(o.dir)} ${mine}`,
      );

    warnings.push(...labelsWarnings(labels));

    // The trace window — a value that does not apply warns; days beyond it are a hint
    const retainWarn = retainWarning(config.trace.retain);
    if (retainWarn) warnings.push(retainWarn);
    const hints: string[] = [];
    const window = effectiveRetain(config);
    const beyond = traceDaysBefore(ctx.root, retainCutoffDay(ctx.clock.now(), window.ms));
    if (beyond.length) {
      const bytes = beyond.reduce((n, d) => n + d.bytes, 0);
      hints.push(`trace keeps ${beyond.length} day${beyond.length === 1 ? "" : "s"} (${formatBytes(bytes)}) beyond trace.retain ${window.retain} — run \`norn tidy\` (\`norn tidy --dry-run\` lists them)`);
    }

    const ok = !configFail && gitCheck.ok && agents.every((a) => a.ok) && remote.ok === true && (runner.ok === true || runner.required === false) && skillsOk && repo.ok;
    const report = { ok, live, hook_command: command, machine, ...(configFail ? { config: configFail } : {}), git: gitCheck, agents, remote, labels, runner, skills, repo, warnings, hints };
    const out = rendered(report, formatDoctor(report, dir));
    return ok ? out : withExit(out, ExitCode.error);
  },
});
