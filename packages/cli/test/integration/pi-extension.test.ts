/**
 * norn's pi extension inside a pi process: a fake `pi` first on PATH (fixtures/fake-pi) loads the
 * extension the launcher installed, the way pi loads a project-local extension, and fires pi's events
 * at it; the extension runs the real `norn hook pi <event>` for each. The launcher installs and
 * builds the launch as it does for a real run, so the hook command the extension runs is the one a
 * real run's would be.
 */
import { describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, realpathSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { BriefInputs } from "@norn/kernel";
import { FAILED_WRITE_REASON, piHarness } from "@norn/harness-pi";
import { createNodeHost, nodeExec } from "@norn/host-node";
import { ok, type Runner, type RunnerStartRequest } from "@norn/plugin-api";
import { HarnessLauncher, readEvents, type RuntimeEnv } from "@norn/runtime";
import { CliContext, type CliIo, configPaths, importFromPluginsDir } from "../../src/index.ts";
import { LOCAL_CONFIG } from "../unit/support.ts";
import { AGENT_STEP, RUN, runEnv, seedIn, UNIT } from "../unit/units.ts";

const MAIN = join(import.meta.dir, "..", "..", "src", "main.ts");
const FAKE_PI = join(import.meta.dir, "fixtures", "fake-pi", "pi.ts");
const TEST_MS = 90_000;

interface PiReport {
  argv: string[];
  loaded: string[];
  load_errors: string[];
  handler_errors: { event: string; error: string }[];
  injected: unknown[];
  steered: unknown[];
  steps: Record<string, unknown>[];
  unplayed: number;
}

type Step = { tool: string; input: Record<string, unknown> } | { settle: string; error?: string };

async function sh(cwd: string, ...argv: string[]): Promise<string> {
  const r = await nodeExec(argv, { cwd });
  if (r.code !== 0) throw new Error(`${argv.join(" ")}: ${r.stderr}`);
  return r.stdout.trim();
}

interface Machine {
  root: string;
  worktree: string;
  /** the env every process of this machine runs with: the fake pi's folder first on PATH */
  env: Record<string, string>;
  runtime: RuntimeEnv;
}

/**
 * A temp repo with a pi executor configured, the unit's agent run live on its record and its
 * worktree checked out where norn keeps it, and `pi` on PATH the fake.
 */
async function machine(): Promise<Machine> {
  // realpath: macOS hands out /var under /private, and git names the canonical path
  const dir = realpathSync(mkdtempSync(join(tmpdir(), "norn-pi-")));
  const root = join(dir, "repo");
  const home = join(dir, "home");
  const bin = join(dir, "bin");
  mkdirSync(bin);
  writeFileSync(join(bin, "pi"), `#!/bin/sh\nexec bun ${JSON.stringify(FAKE_PI)} "$@"\n`, { mode: 0o755 });
  await sh(dir, "git", "init", "-q", "-b", "main", root);
  await sh(root, "git", "-c", "user.email=t@t", "-c", "user.name=t", "commit", "-q", "--allow-empty", "-m", "init");
  const env: Record<string, string> = { PATH: `${bin}:${process.env.PATH ?? ""}`, HOME: dir, NORN_HOME_DIR: home, USER: "t", HERDR_ENV: "" };
  const io: CliIo = {
    env,
    cwd: root,
    userHome: dir,
    stdin: async () => "",
    self: ["bun", MAIN],
    version: "0.0.0",
    hosts: { host: createNodeHost, exec: nodeExec },
    importer: importFromPluginsDir,
  };
  const ctx = new CliContext(io);
  await (await ctx.host()).files.write(configPaths(home, root).local, LOCAL_CONFIG.replace("claude: { harness: claude, runner: headless }", "pi: { harness: pi, runner: headless }"));
  const runtime = await ctx.runtimeEnv();
  await seedIn(runtime, { step: AGENT_STEP });
  const worktree = runtime.slots.vcs.worktree.path(UNIT);
  await sh(root, "git", "worktree", "add", "-q", "-b", UNIT, worktree);
  return { root, worktree, env, runtime };
}

/** A runner that keeps the request: the test starts the process itself, with the fake pi on PATH. */
function keepingRunner(): Runner & { starts: RunnerStartRequest[] } {
  const starts: RunnerStartRequest[] = [];
  return {
    name: "kept",
    capabilities: { headless: true, attended: false, paneInput: false },
    starts,
    start: async (req) => {
      starts.push(req);
      return ok({ handle: `kept|${starts.length}` });
    },
    alive: async () => ok(true),
    send: async () => ok(undefined),
    stop: async () => ok(undefined),
  };
}

const BRIEF = "Slice the spec. When the step is done, run `norn done done`.";

/**
 * The launch a real run makes, through the launcher with the CLI's hook command: the extension
 * installed in the worktree, and pi's argv and env, which the test runs instead of a runner.
 */
async function launchPi(m: Machine): Promise<RunnerStartRequest> {
  const runner = keepingRunner();
  const launcher = new HarnessLauncher({
    ctx: m.runtime.ctx,
    executors: { pi: { harness: piHarness, runner } },
    hookCommand: ["bun", MAIN, "hook"],
    renderBrief: async () => ok(BRIEF),
  });
  const brief: BriefInputs = { workflow: "story", hash: "0".repeat(64), step: AGENT_STEP, attempt: 1, skills: [], inputs: [] };
  const started = await launcher.start({ unit: UNIT, run_id: RUN, step: AGENT_STEP, executor: "pi", attended: false, worktree: m.worktree, brief });
  if (!started.ok) throw new Error(started.failure.message);
  const req = runner.starts[0];
  if (!req) throw new Error("the launcher started nothing");
  return req;
}

/** The launch's argv in the worktree, as the runner would start it, with the model's plan. */
async function runPi(m: Machine, req: Pick<RunnerStartRequest, "argv" | "env">, plan: Step[]): Promise<PiReport> {
  const r = await nodeExec(req.argv, { cwd: m.worktree, env: { ...m.env, ...req.env, FAKE_PI_PLAN: JSON.stringify(plan) }, timeoutMs: TEST_MS });
  if (r.code !== 0) throw new Error(`fake pi exited ${r.code}: ${r.stderr}`);
  return JSON.parse(r.stdout) as PiReport;
}

describe("norn's pi extension in a pi process, answered by norn hook pi", () => {
  test(
    "a write outside the worktree is refused, a stop before the report continues the turn, and after `norn done` the stop is allowed",
    async () => {
      const m = await machine();
      const req = await launchPi(m);
      expect(req.argv.slice(0, 4)).toEqual(["pi", "--approve", "-p", "--"]);
      // not the repo beside the worktree: on Linux the test's temp folder is under /tmp, a root any write may land in
      const outside = "/norn-outside-every-root/NOTES.md";
      const report = await runPi(m, req, [
        { tool: "write", input: { path: outside, content: "x" } },
        { tool: "write", input: { path: join(m.worktree, "spec.md"), content: "x" } },
        { settle: "Sliced it." },
        { tool: "bash", input: { command: `bun ${JSON.stringify(MAIN)} done done --json` } },
        { settle: "Reported." },
      ]);

      expect({ loaded: report.loaded, load_errors: report.load_errors, handler_errors: report.handler_errors }).toEqual({
        loaded: [join(m.worktree, ".pi", "extensions", "norn", "index.ts")],
        load_errors: [],
        handler_errors: [],
      });
      const [deniedWrite, ownWrite, earlyStop, done, lateStop] = report.steps as [
        { blocked: boolean; reason: string },
        { blocked: boolean },
        { continue: boolean; entries: { type: string; customType: string; content: string; display: boolean }[] },
        { blocked: boolean; code: number; stdout: string },
        { continue: boolean },
      ];
      expect(deniedWrite.blocked).toBe(true);
      expect(deniedWrite.reason).toContain("outside this unit's worktree");
      expect(ownWrite.blocked).toBe(false);
      expect(earlyStop.continue).toBe(true);
      expect(earlyStop.entries).toEqual([{ type: "custom_message", customType: "norn", content: expect.stringContaining("norn done"), display: true }]);
      expect({ blocked: done.blocked, code: done.code, body: JSON.parse(done.stdout) }).toMatchObject({ blocked: false, code: 0, body: { run_id: RUN, outcome: "done", replayed: false } });
      expect(lateStop.continue).toBe(false);
      expect(report.steps).toHaveLength(5);

      // what the run logged: the brief's turn by its prompt mark, the report `norn done` made inside the bash call,
      // and one turn end, as the refused stop is a turn that goes on
      const log = await readEvents(m.runtime.ctx, UNIT, RUN);
      expect(log.problems).toEqual([]);
      expect(log.events.map((e) => (e.type === "turn.started" ? `${e.type}:${e.source}:${e.prompt_id}` : e.type))).toEqual([
        "session.started",
        `turn.started:brief:${RUN}`,
        "tool.requested",
        "tool.finished",
        "tool.requested",
        "tool.finished",
        "tool.requested",
        "report.made",
        "tool.finished",
        "turn.ended",
        "session.ended",
      ]);
    },
    TEST_MS,
  );

  test(
    "a run that stops on a provider error is never answered with a continue: its turn is logged as ended on the error",
    async () => {
      const m = await machine();
      const req = await launchPi(m);
      const report = await runPi(m, req, [
        { tool: "bash", input: { command: "true" } },
        { settle: "Running the linter next.", error: "429 rate_limit_error" },
      ]);

      expect({ load_errors: report.load_errors, handler_errors: report.handler_errors }).toEqual({ load_errors: [], handler_errors: [] });
      // the unit has not reported, so a completed settle here would be refused; an error settle is a hard exit pi will not continue
      expect(report.steps.at(-1)).toEqual({ settle: "Running the linter next.", continue: false, entries: [] });

      const log = await readEvents(m.runtime.ctx, UNIT, RUN);
      expect(log.problems).toEqual([]);
      expect(log.events.map((e) => e.type)).toEqual(["session.started", "turn.started", "tool.requested", "tool.finished", "turn.ended", "session.ended"]);
      expect(log.events.find((e) => e.type === "turn.ended")).toMatchObject({ last_message: "pi stopped on an error: 429 rate_limit_error" });
    },
    TEST_MS,
  );

  test(
    "with the hook command missing the extension fails open, except that it refuses a write",
    async () => {
      const m = await machine();
      const req = await launchPi(m);
      // the install a machine whose norn is gone would have: the same extension with a command that cannot run
      await piHarness.uninstall({ worktree: m.worktree });
      await piHarness.install({ worktree: m.worktree, hookCommand: `${join(m.root, "no-such-norn")} hook pi` });
      const report = await runPi(m, req, [
        { tool: "write", input: { path: join(m.worktree, "spec.md"), content: "x" } },
        { tool: "edit", input: { path: join(m.worktree, "spec.md"), oldText: "x", newText: "y" } },
        { tool: "read", input: { path: join(m.worktree, "spec.md") } },
        { tool: "bash", input: { command: "true" } },
        { settle: "Stopping without a report." },
      ]);

      expect({ loaded: report.loaded.length, load_errors: report.load_errors, handler_errors: report.handler_errors, injected: report.injected }).toEqual({
        loaded: 1,
        load_errors: [],
        handler_errors: [],
        injected: [],
      });
      expect(report.steps).toEqual([
        { tool: "write", blocked: true, reason: FAILED_WRITE_REASON },
        { tool: "edit", blocked: true, reason: FAILED_WRITE_REASON },
        { tool: "read", blocked: false },
        { tool: "bash", blocked: false, code: 0, stdout: "", stderr: "" },
        { settle: "Stopping without a report.", continue: false, entries: [] },
      ]);
    },
    TEST_MS,
  );

  test(
    "a pi session norn did not launch loads the extension but sends norn nothing",
    async () => {
      const m = await machine();
      const req = await launchPi(m);
      const { [Object.keys(runEnv())[0] as string]: _unit, ...personEnv } = { ...m.env, ...req.env };
      // a hook command that would fail every call: any forwarded event would refuse the write
      await piHarness.uninstall({ worktree: m.worktree });
      await piHarness.install({ worktree: m.worktree, hookCommand: `${join(m.root, "no-such-norn")} hook pi` });
      const r = await nodeExec(req.argv, { cwd: m.worktree, env: { ...personEnv, FAKE_PI_PLAN: JSON.stringify([{ tool: "write", input: { path: "x" } }, { settle: "ok" }]) }, timeoutMs: TEST_MS });
      const report = JSON.parse(r.stdout) as PiReport;
      expect(report.loaded).toHaveLength(1);
      expect(report.steps).toEqual([
        { tool: "write", blocked: false },
        { settle: "ok", continue: false, entries: [] },
      ]);
    },
    TEST_MS,
  );
});
