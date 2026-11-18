/**
 * What `norn init` detects and chooses. Detection only reads (git's remote and branches, which tools
 * answer `--version`); every choice can be given as a flag instead, and a flag always wins. The herdr
 * runner is offered, never taken unasked: agents in panes are a person's choice, so it takes
 * `--runner herdr` or `--yes`. The executor is claude unless only pi is on PATH; pi beside claude is
 * offered, since which agent does the work is a person's choice too.
 */
import type { HostContext } from "@norn/plugin-api";
import { stringify } from "yaml";
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
  const herdr = Boolean(env.HERDR_ENV) && (await answers(host, ["herdr", "--version"], root)) !== null;
  const originHead = await answers(host, ["git", "symbolic-ref", "--short", "refs/remotes/origin/HEAD"], root);
  const current = originHead ? null : await answers(host, ["git", "branch", "--show-current"], root);
  const base = originHead ? originHead.replace(/^origin\//, "") : current || null;
  return { origin, github, gh, claude, pi, herdr, base };
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

export const INTAKE_LABEL = "norn";

/** The config file init writes: every slot named, so a person reads what was chosen in one place. */
export function initLayer(c: Choices): ConfigLayer {
  return {
    format: 1,
    // a local tracker has nobody to assign to: every open item with the label is intake
    tracker: { use: c.tracker, intake: c.tracker === "local" ? { label: INTAKE_LABEL, assignee: null } : { label: INTAKE_LABEL } },
    forge: { use: c.forge },
    store: { use: c.store },
    executors: { [c.executor]: { harness: c.executor, runner: c.runner } },
    base: c.base,
    kernel: { mode: c.mode },
  };
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
