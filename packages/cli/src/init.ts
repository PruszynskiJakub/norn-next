/**
 * What `norn init` detects and chooses. Detection only reads (git's remote and branches, the build
 * files that name the test command, which tools answer `--version`); every choice can be given as a flag instead, and a flag always wins. The herdr
 * runner is offered, never taken unasked: agents in panes are a person's choice, so it takes
 * `--runner herdr` or `--yes`. The executor is claude unless only pi is on PATH; pi beside claude is
 * offered, since which agent does the work is a person's choice too.
 */
import { join } from "node:path";
import { type HostContext, type HostFiles, parseJson } from "@norn/plugin-api";
import { DEFAULT_CHECKS } from "@norn/runtime";
import { Type } from "@sinclair/typebox";
import { stringify } from "yaml";
import { REPO_COMMITTED_FILE } from "./config/paths.ts";
import type { ConfigLayer } from "./config/schema.ts";
import { setKeyInText } from "./config/write.ts";

export interface Detected {
  /** origin's URL, when the repo has one */
  origin: string | null;
  /** origin is on GitHub */
  github: boolean;
  gh: boolean;
  claude: boolean;
  pi: boolean;
  /** herdr answers and this shell runs inside it */
  herdr: boolean;
  /** origin's default branch, else the current branch */
  base: string | null;
  /** bun answers, for a JS repo with no lockfile to say which tool installs it */
  bun: boolean;
}

export interface InitFlags {
  tracker?: string;
  forge?: string;
  store?: string;
  executor?: string;
  runner?: string;
  mode?: "auto" | "manual";
  yes: boolean;
}

export interface Choices {
  tracker: string;
  forge: string;
  store: string;
  /** the executor's harness, which also names it */
  executor: string;
  runner: string;
  /** how stories run: a headless runner has nobody beside the agent, so it starts on its own */
  mode: "auto" | "manual";
  base: string;
}

const PROBE_TIMEOUT_MS = 15_000;

async function answers(host: HostContext, argv: string[], cwd: string): Promise<string | null> {
  const r = await host.exec(argv, { cwd, timeoutMs: PROBE_TIMEOUT_MS });
  return r.code === 0 ? r.stdout.trim() : null;
}

export const isGithubUrl = (url: string): boolean => /^(?:https?:\/\/|ssh:\/\/)?(?:[^@/]+@)?github\.com[:/]/i.test(url);

export async function detect(host: HostContext, env: Readonly<Record<string, string | undefined>>, root: string): Promise<Detected> {
  const origin = await answers(host, ["git", "remote", "get-url", "origin"], root);
  const github = origin !== null && isGithubUrl(origin);
  const gh = github && (await answers(host, ["gh", "--version"], root)) !== null;
  const claude = (await answers(host, ["claude", "--version"], root)) !== null;
  const pi = (await answers(host, ["pi", "--version"], root)) !== null;
  const bun = (await answers(host, ["bun", "--version"], root)) !== null;
  const herdr = Boolean(env.HERDR_ENV) && (await answers(host, ["herdr", "--version"], root)) !== null;
  const originHead = await answers(host, ["git", "symbolic-ref", "--short", "refs/remotes/origin/HEAD"], root);
  const current = originHead ? null : await answers(host, ["git", "branch", "--show-current"], root);
  const base = originHead ? originHead.replace(/^origin\//, "") : current || null;
  return { origin, github, gh, claude, pi, herdr, base, bun };
}

/**
 * The kernel's default mode is manual, which parks every agent step for a person: right where a
 * person works beside the agent's pane, a dead end with a headless runner nobody watches.
 */
export function modeFor(runner: string): "auto" | "manual" {
  return runner === "headless" ? "auto" : "manual";
}

export function choose(d: Detected, f: InitFlags): { choices: Choices; offered: string[] } {
  const onGithub = d.github && d.gh;
  const runner = f.runner ?? (d.herdr && f.yes ? "herdr" : "headless");
  const choices: Choices = {
    tracker: f.tracker ?? (onGithub ? "github" : "local"),
    forge: f.forge ?? (onGithub ? "github" : "none"),
    store: f.store ?? "local",
    executor: f.executor ?? (d.pi && !d.claude ? "pi" : "claude"),
    runner,
    mode: f.mode ?? modeFor(runner),
    base: d.base ?? "main",
  };
  const offered = [
    ...(d.herdr && runner !== "herdr" && f.runner === undefined ? ["herdr"] : []),
    ...(d.pi && choices.executor !== "pi" && f.executor === undefined ? ["pi"] : []),
  ];
  return { choices, offered };
}

/** One line of init's markdown per offer: what was found and the command that takes it. */
export function offerLine(offer: string, c: Choices): string {
  if (offer === "pi") return `- offered: pi is on PATH; norn config set executors.pi "{harness: pi, runner: ${c.runner}}" adds it as an executor, and norn config set executor pi makes it the default`;
  return `- offered: this shell runs inside ${offer}; norn config set executors.${c.executor}.runner ${offer} runs agents in its panes`;
}

export interface DetectedTestCommand {
  command: string;
  /** the file it was read from, such as `package.json` */
  from: string;
}

/** The part of package.json init reads; a malformed one names no test script. */
const PackageJson = Type.Object({ scripts: Type.Optional(Type.Record(Type.String(), Type.Unknown())) });

/** npm's placeholder for a project without tests */
const NPM_NO_TEST = /no test specified/;

/** a package.json script that runs bun */
const RUNS_BUN = /(^|[\s;&|(])(bun|bunx)(\s|$)/;

/**
 * The repo's test command from its build files, or null when nothing says. A check runs in a fresh
 * worktree with no installed dependencies, so a JS command installs first. With no lockfile the
 * install is told not to write one: it would be left untracked in the unit's worktree and hold back
 * the next agent's `norn done`. `bun` says whether bun is on PATH.
 */
export async function detectTestCommand(files: HostFiles, root: string, opts: { bun?: boolean } = {}): Promise<DetectedTestCommand | null> {
  const read = (f: string) => files.read(join(root, f));
  const has = async (f: string) => (await read(f)) !== null;
  const pkgText = await read("package.json");
  if (pkgText !== null) {
    const pkg = parseJson(PackageJson, pkgText, "package.json");
    const scripts = pkg.ok ? (pkg.value.scripts ?? {}) : {};
    const script = scripts.test;
    const hasScript = typeof script === "string" && !NPM_NO_TEST.test(script);
    const from = "package.json";
    const bunTest = hasScript ? "bun run test" : "bun test";
    if ((await has("bun.lock")) || (await has("bun.lockb"))) return { command: `bun install --frozen-lockfile && ${bunTest}`, from };
    if (hasScript) {
      if (await has("pnpm-lock.yaml")) return { command: "pnpm install --frozen-lockfile && pnpm test", from };
      if (await has("yarn.lock")) return { command: "yarn install && yarn test", from };
      if (await has("package-lock.json")) return { command: "npm ci && npm test", from };
    }
    const usesBun = Object.values(scripts).some((v) => typeof v === "string" && RUNS_BUN.test(v));
    if (opts.bun === true && usesBun) return { command: `bun install --no-save && ${bunTest}`, from };
    if (hasScript) return { command: "npm install --no-package-lock && npm test", from };
  }
  if (await has("Cargo.toml")) return { command: "cargo test", from: "Cargo.toml" };
  if (await has("go.mod")) return { command: "go test ./...", from: "go.mod" };
  if (await has("uv.lock")) return { command: "uv run pytest", from: "uv.lock" };
  for (const f of ["pyproject.toml", "pytest.ini", "setup.py", "tox.ini"]) if (await has(f)) return { command: "pytest", from: f };
  if (await has("mix.exs")) return { command: "mix test", from: "mix.exs" };
  if (await has("gradlew")) return { command: "./gradlew test", from: "gradlew" };
  if (await has("pom.xml")) return { command: "mvn test", from: "pom.xml" };
  if (/^test\s*:(?!=)/m.test((await read("Makefile")) ?? "")) return { command: "make test", from: "Makefile" };
  return null;
}

/** init's line on the test command: what it found, or what the checks run without one. */
export function testLine(test: DetectedTestCommand | null): string {
  if (test) return `- test: ${test.command} (from ${test.from}), as checks.test`;
  return `- test: none detected, so the checks run ${DEFAULT_CHECKS.test}; norn config set checks.test "<command>" names yours`;
}

export const INTAKE_LABEL = "norn";

/** The config file init writes: every slot named, so a person reads what was chosen in one place. */
export function initLayer(c: Choices, test: DetectedTestCommand | null = null): ConfigLayer {
  return {
    format: 1,
    // a local tracker has nobody to assign to: every open item with the label is intake
    tracker: { use: c.tracker, intake: c.tracker === "local" ? { label: INTAKE_LABEL, assignee: null } : { label: INTAKE_LABEL } },
    forge: { use: c.forge },
    store: { use: c.store },
    executors: { [c.executor]: { harness: c.executor, runner: c.runner } },
    base: c.base,
    kernel: { mode: c.mode },
    ...(test && { checks: { test: test.command } }),
  };
}

/**
 * The committed file's share of init's layer, and the person's: the mode is how this person works,
 * and the committed file wins over every person's file, so a mode committed there would hold the
 * whole team to it.
 */
export function splitPersonal(layer: ConfigLayer): { team: ConfigLayer; mode: "auto" | "manual" | undefined } {
  const { mode, ...kernel } = layer.kernel ?? {};
  const { kernel: _k, ...rest } = layer;
  return { team: { ...rest, ...(Object.keys(kernel).length > 0 && { kernel }) }, mode };
}

/** A new repo-local file holding only the person's mode, written beside a committed config. */
export function personalText(mode: "auto" | "manual"): string {
  return `# your own norn config for this repo (kept out of git); the committed ${REPO_COMMITTED_FILE} wins over it\n${stringify({ format: 1, kernel: { mode } })}`;
}

export function initText(layer: ConfigLayer): string {
  return `# norn's config, written by norn init; norn config set changes one key, norn config show prints the merged result\n${stringify(layer)}`;
}

/** The exclude file with the line added once; null when it is there already. */
export function withExcluded(text: string | null, line: string): string | null {
  const lines = (text ?? "").split("\n").map((l) => l.trim());
  if (lines.includes(line) || lines.includes(line.replace(/\/$/, ""))) return null;
  const body = text ?? "";
  return `${body}${body && !body.endsWith("\n") ? "\n" : ""}# norn: the repo-local config stays on this machine\n${line}\n`;
}

/** What `norn plugin add` writes into a config file: a file holding no more is one init completes. */
const PLUGIN_ADD_KEYS = new Set(["format", "plugins"]);

/**
 * Whether init may complete the file already there: only one `norn plugin add` started, so a
 * plugin (a harness, a tracker) can be installed before init names it. Anything else a person
 * wrote is a config init never touches.
 */
export function completable(existing: ConfigLayer | null): boolean {
  return existing !== null && Object.keys(existing).every((k) => PLUGIN_ADD_KEYS.has(k));
}

/** The file's text with init's keys added beside what is there, which wins and keeps its comments. */
export function completedText(current: string, existing: ConfigLayer, layer: ConfigLayer): string {
  let text = current;
  for (const [key, value] of Object.entries(layer)) if (!(key in existing)) text = setKeyInText(text, key, value);
  return text;
}
