/**
 * `norn doctor [--live]` (A7, M4): is this machine ready to run norn here? JSON report.
 *
 * Static checks (default, no agent turns):
 *   - git present (version)
 *   - per configured agent: launch binary on PATH + `--version`, norn hooks installed (A1),
 *     and the hook path fires: the installed hook command (`norn hook …`) is invoked with a
 *     synthetic payload from a throwaway unit worktree and must record a hook fact (A2, A3).
 *     Codex: project hooks only run once `.codex/` is trusted (`/hooks` in Codex) — noted.
 *   - remote: the provider CLI answers `whoami` (gh/glab auth)
 *   - runner: configured runner available (Herdr server reachable), and `command -v norn` in a
 *     throwaway runner session resolves to this norn (R8.2)
 *   - machine: the `user@host` runs are recorded with (R7.1); a warning when NORN_MACHINE overrides it (R7.3)
 * `--live` also runs one cheap headless test turn per agent in a throwaway repo with norn hooks
 * installed, and checks that the agent's own hooks reported to norn.
 * Exit 0 when every check passes, else 1 with the same report.
 */
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { proc } from "@norn/adapters";
import type { AgentAdapter, RunnerPort, SessionRef } from "@norn/core";
import { ExitCode, ulid } from "@norn/schema";
import { writeUnitMarker } from "@norn/store";
import { defineCommand, opt } from "../command.ts";
import type { Context } from "../context.ts";
import { withExit } from "../output.ts";
import { machineHolder, readHookFacts } from "../runtime/observe.ts";
import { ensureShim, withNornOnPath } from "../runtime/shim.ts";
import { hookBinary, hookCommand } from "./init.ts";

interface RunOut {
  code: number | null;
  out: string;
  timed_out: boolean;
  error?: string;
}

async function run(argv: string[], o: { cwd?: string; env?: Record<string, string | undefined>; input?: string; timeoutMs: number }): Promise<RunOut> {
  try {
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
    const cmd = agent.launchCommand({
      cwd: repo,
      prompt: "This is a connectivity test. Reply with the single word OK and do nothing else.",
      headless: true,
      env: { NORN_HOME: repo, NORN_STORY: "gh-1" },
      config: { ...(cfg?.command ? { command: cfg.command } : {}), ...(cfg?.args ? { args: cfg.args } : {}), ...(cfg?.env ? { env: cfg.env } : {}) },
    });
    const r = await run(cmd.argv, { cwd: repo, env: { ...process.env, ...ctx.env, ...cmd.env }, timeoutMs: 180_000 });
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

export const doctorCommand = defineCommand({
  name: "doctor",
  summary: "Check agents, hooks, remote auth and runner on this machine (A7); --live runs one test turn per agent",
  usage: "norn doctor [--live]",
  options: { live: { type: "boolean" } },
  async run(ctx, args) {
    const live = opt.bool(args, "live");
    const config = ctx.config;
    const ports = await ctx.ports();
    const command = hookCommand(ctx);

    const g = await run(["git", "--version"], { timeoutMs: 10_000 });
    const gitCheck = { ok: g.code === 0, version: firstLine(g.out) || null };

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
      if (hooksInstalled === false) notes.push("run norn init to install hooks");
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

    let runner: Record<string, unknown> = { ok: true, configured: false, note: "manual mode only: a person starts agents (MO2)" };
    if (ports.runner) {
      const available = await ports.runner.available().catch(() => false);
      const onPath = available ? await nornThroughRunner(ctx, ports.runner) : null;
      runner = {
        ok: available && (onPath?.ok ?? true),
        configured: true,
        name: ports.runner.name,
        available,
        ...(onPath ? { norn_on_path: onPath } : {}),
        ...(available ? {} : { error: ports.runner.name === "herdr" ? "herdr server not reachable (start herdr)" : `${ports.runner.name} runner not available` }),
      };
    }

    // R7.3: NORN_MACHINE overrides the machine name — a test aid (single-host dogfood), never a
    // setup for real teams: two checkouts claiming one machine name defeat R7.2's liveness rules
    const machine = { holder: machineHolder(ctx.env), override: ctx.env.NORN_MACHINE ?? null };
    const warnings: string[] = [];
    if (machine.override !== null)
      warnings.push(`NORN_MACHINE=${machine.override} overrides this machine's name (a test aid): runs are judged by pid only on the machine they were started on (R7.2), so two hosts must never share a name — unset it outside tests`);

    const ok = gitCheck.ok && agents.every((a) => a.ok) && remote.ok === true && runner.ok === true;
    const report = { ok, live, hook_command: command, machine, git: gitCheck, agents, remote, runner, warnings };
    return ok ? report : withExit(report, ExitCode.error);
  },
});
