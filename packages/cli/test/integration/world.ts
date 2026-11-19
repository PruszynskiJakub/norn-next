/**
 * A machine for the CLI's end-to-end tests: a temp repository cloned from a bare remote, a temp norn
 * home, and every norn call a subprocess of the binary from source, as a person, a cron or an agent
 * runs it. The test harness plugin (fixtures/test-harness) is installed with `norn plugin add`, and
 * its agent reports through the same binary.
 */
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { nodeExec } from "@norn/host-node";

export const MAIN = join(import.meta.dir, "..", "..", "src", "main.ts");
export const TEST_PLUGIN = join(import.meta.dir, "fixtures", "test-harness");
const NORN_TIMEOUT_MS = 60_000;

export interface World {
  dir: string;
  root: string;
  remote: string;
  home: string;
  notes: string;
  /** where the test raises the test plugin's flag files (`stop-fails`, `missing-bin`) */
  flags: string;
  /** the agent's per-step plans file (TEST_AGENT_PLANS), written by `plans` */
  plans: string;
  env: Record<string, string>;
}

export interface NornOut {
  code: number;
  body: Record<string, unknown>;
  stdout: string;
  stderr: string;
}

export async function sh(cwd: string, ...argv: string[]): Promise<string> {
  const r = await nodeExec(argv, { cwd });
  if (r.code !== 0) throw new Error(`${argv.join(" ")}: ${r.stderr}`);
  return r.stdout.trim();
}

/** The test harness agent's plans (fixtures/test-harness/agent.ts names what each does). */
export type AgentPlan = "work" | "ask" | "ask-then-stuck" | "hang" | "protocol" | "findings" | "attended" | "permission" | "trust" | "logged-out";

/**
 * A fresh clone of an empty bare remote with one commit on main, and a norn home beside it. The
 * env empties HERDR_ENV, so a person's running herdr is never probed, and names a git identity, so
 * the agent's commits and the person's merge need no global config.
 */
export async function world(plan: AgentPlan = "work"): Promise<World> {
  // realpath: macOS hands out /var under /private, and git names the canonical path
  const dir = realpathSync(mkdtempSync(join(tmpdir(), "norn-e2e-")));
  const remote = join(dir, "remote.git");
  const root = join(dir, "repo");
  const home = join(dir, "home");
  const notes = join(dir, "notes");
  const flags = join(dir, "flags");
  const plans = join(dir, "plans.json");
  mkdirSync(notes);
  mkdirSync(flags);
  await sh(dir, "git", "init", "-q", "--bare", "-b", "main", remote);
  await sh(dir, "git", "clone", "-q", remote, root);
  await sh(root, "git", "-c", "user.email=t@t", "-c", "user.name=t", "commit", "-q", "--allow-empty", "-m", "init");
  await sh(root, "git", "push", "-q", "origin", "main");
  const env: Record<string, string> = {
    NORN_HOME_DIR: home,
    HERDR_ENV: "",
    TEST_AGENT_NOTES: notes,
    TEST_AGENT_PLAN: plan,
    TEST_AGENT_PLANS: plans,
    TEST_FLAGS: flags,
    GIT_AUTHOR_NAME: "t",
    GIT_AUTHOR_EMAIL: "t@t",
    GIT_COMMITTER_NAME: "t",
    GIT_COMMITTER_EMAIL: "t@t",
  };
  return { dir, root, remote, home, notes, flags, plans, env };
}

/** Raise or lower one of the test plugin's flag files. */
export function flag(w: World, name: "stop-fails" | "missing-bin", up: boolean): void {
  if (up) writeFileSync(join(w.flags, name), "");
  else rmSync(join(w.flags, name), { force: true });
}

/** The agent's plan per step (`"<step>"`) or per visit (`"<step>#<attempt>"`), over TEST_AGENT_PLAN. */
export function plans(w: World, byStep: Record<string, AgentPlan>): void {
  writeFileSync(w.plans, JSON.stringify(byStep));
}

/** One norn call as a subprocess in the checkout; `--json` output parsed when it is one value. */
export async function norn(w: World, args: string[], env: Record<string, string> = {}, cwd = w.root): Promise<NornOut> {
  const r = await nodeExec(["bun", MAIN, ...args], { cwd, env: { ...w.env, ...env }, timeoutMs: NORN_TIMEOUT_MS });
  let body: Record<string, unknown> = {};
  try {
    body = JSON.parse(r.stdout) as Record<string, unknown>;
  } catch {
    // markdown or nothing: the caller reads stdout
  }
  return { code: r.code, body, stdout: r.stdout, stderr: r.stderr };
}

export interface SetUpOptions {
  /** how stories run (default auto) */
  mode?: "auto" | "manual";
  /** where the agent's process lives: the bundled headless runner (default), the test plugin's, or herdr (`fakeHerdr` first) */
  runner?: "headless" | "test" | "herdr";
  /** the workflow a story takes when it names none (default the pack's e2e) */
  workflow?: string;
  /** repo workflows by name, written into `.agents/workflows/<name>.yaml` */
  workflows?: Record<string, string>;
  /** more `norn config set` pairs, such as a short `kernel.silent_after` */
  config?: [string, string][];
  /** the tracker and forge plugins (default local and none); github needs `fakeGh` first */
  tracker?: "local" | "github";
  forge?: "none" | "github";
}

/**
 * Installed before init names it, as a person adds a harness norn does not bundle: the test plugin
 * (harness `test`, runner `test`, pack `e2e`), then init on the local tracker, no forge, the local
 * store and the test harness in the headless runner (or the test runner), then the pack's workflow
 * in auto mode, unless the options say otherwise.
 */
export async function setUp(w: World, opts: SetUpOptions = {}): Promise<{ added: NornOut; init: NornOut }> {
  const added = await norn(w, ["plugin", "add", TEST_PLUGIN, "--json"]);
  const runner = opts.runner ?? "headless";
  const init = await norn(w, ["init", "--tracker", opts.tracker ?? "local", "--forge", opts.forge ?? "none", "--store", "local", "--executor", "test", "--runner", runner, "--yes", "--json"]);
  if (init.code !== 0) throw new Error(`init: ${init.stdout}${init.stderr}`);
  for (const [name, text] of Object.entries(opts.workflows ?? {})) {
    mkdirSync(join(w.root, ".agents", "workflows"), { recursive: true });
    writeFileSync(join(w.root, ".agents", "workflows", `${name}.yaml`), text);
  }
  for (const [key, value] of [["packs", "[e2e]"], ["kernel.workflow", opts.workflow ?? "e2e"], ["kernel.mode", opts.mode ?? "auto"], ...(opts.config ?? [])] as const) {
    const set = await norn(w, ["config", "set", key, value, "--json"]);
    if (set.code !== 0) throw new Error(`config set ${key}: ${set.stdout}${set.stderr}`);
  }
  return { added, init };
}

export interface UnitShown {
  id: string;
  step: string | null;
  ended?: string;
  ended_reason?: string;
  parked?: string;
  waiting: { for: string; text: string; next?: string } | null;
}

export interface StoryShown {
  key: string;
  change: { id: number; state: string } | null;
  units: UnitShown[];
}

export async function status(w: World): Promise<{ stories: StoryShown[]; intake: { key: string }[] }> {
  const r = await norn(w, ["status", "--json"]);
  if (r.code !== 0) throw new Error(`status: ${r.stdout}${r.stderr}`);
  return r.body as unknown as { stories: StoryShown[]; intake: { key: string }[] };
}

export async function unitOf(w: World, key: string): Promise<UnitShown | null> {
  return (await status(w)).stories.find((s) => s.key === key)?.units[0] ?? null;
}

/**
 * `norn tick --json` again and again, as watch does, until `done` holds of the story's unit; every
 * tick's rules are kept (a failed action marked `!`), and a tick that exits non-zero or the end of
 * the patience throws with them all.
 */
export async function tickUntil(w: World, rules: string[], done: (u: UnitShown | null) => boolean, maxMs = 60_000, key = "lt-1"): Promise<void> {
  for (const until = performance.now() + maxMs; performance.now() < until; ) {
    const t = await norn(w, ["tick", "--json"]);
    const outcomes = (t.body.outcomes ?? []) as { decision: { rule: string }; ok: boolean }[];
    rules.push(...outcomes.map((o) => `${o.decision.rule}${o.ok ? "" : "!"}`));
    if (t.code !== 0) throw new Error(`tick exited ${t.code}: ${t.stdout}${t.stderr}\nrules: ${rules.join(", ")}`);
    if (done(await unitOf(w, key))) return;
    await Bun.sleep(300);
  }
  throw new Error(`no convergence; rules: ${rules.join(", ")}`);
}

/** What the agent of each run noted, run by run in launch order of their files' names. */
export function agentNotes(w: World): { run: string; note: string; value: unknown }[] {
  return readdirSync(w.notes)
    .filter((f) => f.endsWith(".jsonl"))
    .sort()
    .flatMap((f) =>
      readFileSync(join(w.notes, f), "utf8")
        .split("\n")
        .filter((l) => l.startsWith("{"))
        .map((l) => ({ run: f.replace(/\.jsonl$/, ""), ...(JSON.parse(l) as { note: string; value: unknown }) })),
    );
}

export function noteOf(w: World, what: string): unknown {
  return agentNotes(w).find((n) => n.note === what)?.value;
}

/** The note once the agent wrote it, or undefined after `ms`: a detached part of the agent may write it late. */
export async function awaitNote(w: World, what: string, ms = 10_000): Promise<unknown> {
  for (const until = Date.now() + ms; Date.now() < until; await Bun.sleep(50)) {
    const found = noteOf(w, what);
    if (found !== undefined) return found;
  }
  return noteOf(w, what);
}

/**
 * A second clone of `a`'s remote with a norn home and an agent plans file of its own: another
 * machine on the same team. Its notes and flags stay `a`'s, so a test reads every agent in one place.
 */
export async function otherMachine(a: World, name = "b"): Promise<World> {
  const root = join(a.dir, `repo-${name}`);
  const home = join(a.dir, `home-${name}`);
  const plansFile = join(a.dir, `plans-${name}.json`);
  await sh(a.dir, "git", "clone", "-q", a.remote, root);
  return { ...a, root, home, plans: plansFile, env: { ...a.env, NORN_HOME_DIR: home, TEST_AGENT_PLANS: plansFile } };
}

/** The machine dir of the checkout: where `plugin add` pinned the lock. */
export const machineOf = (added: NornOut): string => dirname(added.body.lock as string);
