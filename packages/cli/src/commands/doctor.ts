/**
 * `norn doctor [--live] [--json]` (A7, M4): is this machine ready to run norn here? A report for a person; `--json` for data.
 *
 * Static checks (default, no agent turns):
 *   - git present, version ≥ 2.38 (BS2: `merge-tree --write-tree` for base conflict detection)
 *   - per configured agent: launch binary on PATH + `--version`, norn hooks installed (A1),
 *     and the hook path fires: the installed hook command (`norn hook …`) is invoked with a
 *     synthetic payload from a throwaway unit worktree and must record a hook fact (A2, A3).
 *     Codex: project hooks only run once `.codex/` is trusted (`/hooks` in Codex) — noted.
 *   - remote: the configured git remote exists (sync and push need it) and the provider CLI
 *     answers `whoami` (gh/glab auth)
 *   - runner: configured runner available (Herdr server reachable), and `command -v norn` in a
 *     throwaway runner session resolves to this norn (R8.2); only auto mode needs a runner (MO2),
 *     so with `default_mode: manual` a failing runner is a warning, not a failed check
 *   - machine: the `user@host` runs are recorded with (R7.1); a warning when NORN_MACHINE overrides it (R7.3)
 *   - skills (SK1): every bundled skill is in `.agents/skills/` and linked from each configured
 *     agent's skill folder; one that differs from the bundled version is a warning (`norn init`)
 *   - trace (O7; D11, D13): a `trace.retain` that is not a duration of at least 14d is a warning; day
 *     pairs older than the window are a hint naming `norn tidy` — never a failed check
 * `--live` also runs one cheap headless test turn per agent in a throwaway repo with norn hooks
 * installed, and checks that the agent's own hooks reported to norn.
 * Exit 0 when every check passes, else 1 with the same report.
 */
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { git as gitAdapter, herdr, proc } from "@norn/adapters";
import type { AgentAdapter, RunnerPort, SessionRef } from "@norn/core";
import { ExitCode, ulid } from "@norn/schema";
import { machineHolder, noteSpawn, readHookFacts, skillsReport, traceDaysBefore, writeUnitMarker } from "@norn/store";
import { defineCommand, opt } from "../command.ts";
import type { Context } from "../context.ts";
import { rendered, withExit } from "../output.ts";
import { assetsDir } from "../runtime/assets.ts";
import { gitRemoteUrl } from "../runtime/detect.ts";
import { ensureShim, withNornOnPath } from "../runtime/shim.ts";
import { effectiveRetain, formatBytes, retainCutoffDay, retainWarning } from "../runtime/trace-retention.ts";
import { bundledSkills } from "../runtime/workflows.ts";
import { hookBinary, hookCommand } from "./init.ts";
import { cmd } from "@norn/core";

interface RunOut {
  code: number | null;
  out: string;
  timed_out: boolean;
  error?: string;
}

async function run(argv: string[], o: { cwd?: string; env?: Record<string, string | undefined>; input?: string; timeoutMs: number }): Promise<RunOut> {
  try {
    noteSpawn(argv, o.cwd);
    const p = Bun.spawn(argv, {
      cwd: o.cwd,
      env: (o.env ?? process.env) as Record<string, string>,
      stdin: o.input === undefined ? "ignore" : new TextEncoder().encode(o.input),
      stdout: "pipe",
      stderr: "pipe",
    });
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      p.kill("SIGKILL");
    }, o.timeoutMs);
    const [out, err] = await Promise.all([new Response(p.stdout).text(), new Response(p.stderr).text()]);
    const code = await p.exited;
    clearTimeout(timer);
    return { code: timedOut ? null : code, out: `${out}${err}`.trim(), timed_out: timedOut };
  } catch (e) {
    return { code: null, out: "", timed_out: false, error: (e as Error).message };
  }
}

const firstLine = (s: string) => s.split("\n")[0]?.trim() ?? "";
const SHORT = 200;
/** An error as one readable line for a person; `--json` keeps all of it. */
const short = (s: string) => {
  const one = s.replace(/\s+/g, " ").trim();
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

function scratchUnit(): { dir: string; repo: string } {
  const dir = mkdtempSync(join(tmpdir(), "norn-doctor-"));
  const repo = join(dir, "repo");
  mkdirSync(join(repo, ".agents", "norn", "trace"), { recursive: true });
  writeUnitMarker(repo, { repo, story: "gh-1", slice: null, unit: "_story", spec_dir: ".agents/specs/gh-1-norn-doctor" });
  return { dir, repo };
}

/** Invoke the installed hook command the way the agent tool would, and look for the recorded fact. */
async function hookFires(ctx: Context, name: string, agent: AgentAdapter, command: string) {
  const bin = hookBinary(command, ctx.env);
  if (!which(bin, ctx.env)) return { ok: false, command, error: `${bin} not found on PATH (the installed hooks call it)` };
  const { dir, repo } = scratchUnit();
  try {
    const ev = syntheticEvent(agent, repo, ctx.env);
    if (!ev) return { ok: false, command, error: "adapter recognizes none of its own hook events" };
    const since = new Date(Date.now() - 1000).toISOString();
    const r = await run(["sh", "-c", `${command} ${ev.arg} --agent ${name}`], { cwd: repo, env: { ...process.env, ...ctx.env }, input: JSON.stringify(ev.payload), timeoutMs: 20_000 });
    const facts = readHookFacts(repo, "0000");
    const ok = r.code === 0 && facts.length > 0;
    return { ok, command: `${command} ${ev.arg} --agent ${name}`, exit: r.code, recorded: facts.length, ...(ok ? {} : { error: r.error ?? (r.code !== 0 ? firstLine(r.out) || `exit ${r.code}` : `no hook fact recorded (since ${since})`) }) };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

/** --live: one cheap headless turn in a throwaway repo with norn hooks installed. */
async function liveTurn(ctx: Context, name: string, agent: AgentAdapter, command: string) {
  const { dir, repo } = scratchUnit();
  try {
    await run(["git", "init", "-q", repo], { timeoutMs: 10_000 });
    if (agent.tier !== "none") await agent.installHooks(repo, command, name);
    const cfg = ctx.config.agents[name];
    const launch = agent.launchCommand({
      cwd: repo,
      prompt: "This is a connectivity test. Reply with the single word OK and do nothing else.",
      headless: true,
      env: { NORN_HOME: repo, NORN_STORY: "gh-1" },
      config: { ...(cfg?.command ? { command: cfg.command } : {}), ...(cfg?.args ? { args: cfg.args } : {}), ...(cfg?.env ? { env: cfg.env } : {}) },
    });
    const r = await run(launch.argv, { cwd: repo, env: { ...process.env, ...ctx.env, ...launch.env }, timeoutMs: 180_000 });
    const facts = readHookFacts(repo, "0000");
    const ok = r.code === 0 && (agent.tier === "none" || facts.length > 0);
    return { ok, exit: r.code, timed_out: r.timed_out, hook_events: facts.map((f) => f.event), ...(ok ? {} : { error: r.error ?? (r.code !== 0 ? firstLine(r.out.slice(-500)) : "the agent ran but no hook reported to norn") }) };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

/**
 * R8.2 (M5, A1): `command -v norn` in one throwaway runner session, launched the way act launches
 * agents (R8.1: shim first on PATH inside the command) — it must resolve to this norn's shim, not
 * to whatever the pane's login shell finds first.
 */
async function nornThroughRunner(ctx: Context, runner: RunnerPort): Promise<{ ok: boolean; expected: string; resolved: string | null; error?: string }> {
  const expected = ensureShim(ctx.home);
  const dir = mkdtempSync(join(tmpdir(), "norn-doctor-path-"));
  const out = join(dir, "norn-path.txt");
  let session: SessionRef | null = null;
  try {
    // B2: the session keeps a process in the foreground until doctor closes it — a runner reports a
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
 * HC11: how to add the cockpit plugin. It ships in the repo, not in the package or binary: when norn
 * runs from source, link this checkout's copy (it follows `git pull`); otherwise install it from GitHub.
 */
export function pluginLinkHint(assets: string): string {
  const dir = join(assets, "..", "..", "..", "plugins", "herdr");
  const how = existsSync(join(dir, "herdr-plugin.toml")) ? `herdr plugin link ${resolve(dir)}` : `herdr plugin install ${HERDR_PLUGIN_SOURCE}`;
  return `${how} (optional: the cockpit of norn status --watch, HC9)`;
}

/** HC11: the plugin's GitHub source for `herdr plugin install`. */
const HERDR_PLUGIN_SOURCE = "PruszynskiJakub/norn-next/plugins/herdr";

/** HC11: whether norn's Herdr plugin is linked; a hint when it is not (never an error). */
async function cockpitPlugin(ctx: Context): Promise<Record<string, unknown>> {
  const o = ctx.config.runner?.options ?? {};
  const cockpit = herdr.createHerdrCockpit({ env: ctx.env, ...(typeof o.bin === "string" ? { bin: o.bin } : {}), ...(typeof o.session === "string" ? { session: o.session } : {}) });
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

/** `norn doctor`: one line per check, then what failed and what to do. */
function formatDoctor(r: {
  ok: boolean;
  machine: { holder: string };
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
  warnings: string[];
  hints: string[];
}): string {
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
  // HC11: informational, never a failed check
  const plugin = runner.cockpit_plugin as { linked: boolean | null; do_instead?: string } | undefined;
  if (plugin) sub(plugin.linked ? "· cockpit plugin linked" : `· cockpit plugin not linked${plugin.do_instead ? ` → ${plugin.do_instead}` : ""}`);
  const sk = r.skills;
  const unlinked = Object.entries(sk.unlinked);
  line(sk.ok, "skills", sk.ok ? "installed and linked" : [sk.missing.length ? `missing ${sk.missing.join(", ")}` : "", ...unlinked.map(([agent, names]) => `not linked for ${agent}: ${names.join(", ")}`)].filter(Boolean).join("; "));
  if (!sk.ok) fix(sk);
  out.push(`       ${"machine".padEnd(14)} ${r.machine.holder}`);

  const head = r.ok ? "norn doctor: every check passes" : `norn doctor: ${failed.length} check${failed.length === 1 ? "" : "s"} failed (${failed.join(", ")})`;
  const warnings = r.warnings.length ? ["", "Warnings", ...r.warnings.map((w) => `  ! ${w}`)] : [];
  const hints = r.hints.length ? ["", "Hints", ...r.hints.map((h) => `  · ${h}`)] : [];
  return [head, "", ...out, ...warnings, ...hints].join("\n");
}

export const doctorCommand = defineCommand({
  name: "doctor",
  summary: "Check agents, hooks, skills, remote auth and runner on this machine (A7); --live runs one test turn per agent",
  usage: "norn doctor [--live] [--json]",
  markdown: true,
  options: { live: { type: "boolean" } },
  async run(ctx, args) {
    const live = opt.bool(args, "live");
    const config = ctx.config;
    const ports = await ctx.ports();
    const command = hookCommand(ctx);

    const g = await run(["git", "--version"], { timeoutMs: 10_000 });
    // BS2: base conflict detection (BS1) needs `git merge-tree --write-tree`, git ≥ 2.38
    const gitVersion = firstLine(g.out) || null;
    const gitNew = g.code === 0 && gitAdapter.gitVersionOk(gitVersion ?? "");
    const gitCheck = {
      ok: gitNew,
      version: gitVersion,
      ...(g.code === 0 && !gitNew ? { error: `git ≥ ${gitAdapter.MIN_GIT_VERSION.join(".")} is required (merge-tree --write-tree, BS2)`, do_instead: "upgrade git" } : {}),
    };

    const agents = [];
    for (const [name, agent] of Object.entries(ports.agents)) {
      const cfg = config.agents[name];
      const argv = agent.launchCommand({ cwd: ctx.root, prompt: "x", headless: true, env: {}, config: { ...(cfg?.command ? { command: cfg.command } : {}) } }).argv;
      const bin = argv[0] ?? name;
      const path = which(bin, ctx.env);
      const v = path ? await run([path, "--version"], { timeoutMs: 15_000 }) : null;
      const hooksInstalled = agent.tier === "none" ? null : await agent.hooksInstalled(ctx.root).catch(() => false);
      const fires = agent.tier === "none" ? null : await hookFires(ctx, name, agent, command);
      const turn = live ? await liveTurn(ctx, name, agent, command) : null;
      const notes: string[] = [];
      if (agent.tier === "none") notes.push("no hooks: runner, process and git facts only (A5)");
      if (cfg?.adapter === "codex" || name === "codex")
        notes.push("Codex runs project hooks only once the project's .codex/ layer is trusted and the hooks reviewed via /hooks in Codex");
      if (hooksInstalled === false) notes.push(`run ${cmd.init()} to install hooks`);
      const ok = !!path && hooksInstalled !== false && (fires?.ok ?? true) && (turn?.ok ?? true);
      agents.push({
        name,
        adapter: cfg?.adapter ?? name,
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
    if (!ports.remote) remote = { ok: true, provider: config.remote.provider, configured: false };
    else {
      try {
        remote = { ok: true, provider: ports.remote.provider, user: await ports.remote.whoami() };
      } catch (e) {
        remote = { ok: false, provider: ports.remote.provider, error: (e as Error).message, do_instead: `${config.remote.provider === "glab" ? "glab" : "gh"} auth login` };
      }
    }
    // sync reads issues and every step pushes through this remote: without it nothing moves
    const gitRemote = { name: config.remote.git_remote, url: gitRemoteUrl(ctx.root, config.remote.git_remote) };
    remote.git_remote = gitRemote;
    if (!gitRemote.url && remote.ok === true)
      remote = { ...remote, ok: false, error: `this repository has no git remote named ${gitRemote.name}`, do_instead: `git remote add ${gitRemote.name} <url>` };

    let runner: Record<string, unknown> = { ok: true, configured: false, note: "manual mode only: a person starts agents (MO2)" };
    if (ports.runner) {
      const available = await ports.runner.available().catch(() => false);
      const onPath = available ? await nornThroughRunner(ctx, ports.runner) : null;
      runner = {
        ok: available && (onPath?.ok ?? true),
        configured: true,
        // MO2: only auto mode starts agents through the runner
        required: config.default_mode === "auto",
        name: ports.runner.name,
        available,
        ...(onPath ? { norn_on_path: onPath } : {}),
        ...(available ? {} : { error: ports.runner.name === "herdr" ? "herdr server not reachable (start herdr)" : `${ports.runner.name} runner not available` }),
      };
      // HC11: informational — the cockpit plugin is optional, so it never fails doctor
      if (available && ports.runner.name === "herdr") runner.cockpit_plugin = await cockpitPlugin(ctx);
    }

    const names = bundledSkills(ctx.env);
    const sk = skillsReport(ctx.root, join(assetsDir(ctx.env), "skills"), names, Object.fromEntries(Object.entries(ports.agents).map(([n, a]) => [n, a.skillDir(ctx.root)])));
    const skillsOk = sk.missing.length === 0 && Object.keys(sk.unlinked).length === 0;
    const skills = { ok: skillsOk, ...sk, ...(skillsOk ? {} : { do_instead: cmd.init() }) };

    // R7.3: NORN_MACHINE overrides the machine name — a test aid (single-host dogfood), never a
    // setup for real teams: two checkouts claiming one machine name defeat R7.2's liveness rules
    const machine = { holder: machineHolder(ctx.env), override: ctx.env.NORN_MACHINE ?? null };
    const warnings: string[] = [];
    if (machine.override !== null)
      warnings.push(`NORN_MACHINE=${machine.override} overrides this machine's name (a test aid): runs are judged by pid only on the machine they were started on (R7.2), so two hosts must never share a name — unset it outside tests`);

    if (sk.drifted.length) warnings.push(`skills differ from this norn's bundled version: ${sk.drifted.join(", ")} — run ${cmd.init()} to update them (git diff .agents/skills/ shows the change)`);

    // D11, D13: the trace window — a value that does not apply warns; days beyond it are a hint
    const retainWarn = retainWarning(config.trace.retain);
    if (retainWarn) warnings.push(retainWarn);
    const hints: string[] = [];
    const window = effectiveRetain(config);
    const beyond = traceDaysBefore(ctx.root, retainCutoffDay(ctx.clock.now(), window.ms));
    if (beyond.length) {
      const bytes = beyond.reduce((n, d) => n + d.bytes, 0);
      hints.push(`trace keeps ${beyond.length} day${beyond.length === 1 ? "" : "s"} (${formatBytes(bytes)}) beyond trace.retain ${window.retain} — run \`norn tidy\` (\`norn tidy --dry-run\` lists them)`);
    }

    const ok = gitCheck.ok && agents.every((a) => a.ok) && remote.ok === true && (runner.ok === true || runner.required === false) && skillsOk;
    const report = { ok, live, hook_command: command, machine, git: gitCheck, agents, remote, runner, skills, warnings, hints };
    const out = rendered(report, formatDoctor(report));
    return ok ? out : withExit(out, ExitCode.error);
  },
});
