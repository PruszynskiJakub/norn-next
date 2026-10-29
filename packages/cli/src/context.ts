/**
 * Command context: where we are (repo root, unit worktree), resolved config (K2), ports built
 * from the adapter registry (X2), clock and `~/.norn` home (NORN_HOME_DIR overrides it).
 *
 * Repo root discovery works from the main checkout and from any story/slice worktree: a
 * `.norn-unit` marker (A3) found walking up from cwd names the repo; otherwise git's common dir.
 */
import { existsSync, realpathSync } from "node:fs";
import { dirname, join } from "node:path";
import type { herdr } from "@norn/adapters";
import type { AdapterContext, AdapterRegistry, Clock, GitPort, Ports } from "@norn/core";
import { DEFAULT_CONFIG, type ResolvedConfig } from "@norn/schema";
import { type LoadedConfig, loadConfig, nornHome, readUnitMarker, type UnitMarker } from "@norn/store";
import { corruptError, refuse } from "./output.ts";
import { type Interaction, isAgentSession, terminalInteraction } from "./runtime/interaction.ts";
import { buildPorts, defaultRegistry } from "./wiring.ts";

/** Everything a command may get injected; all optional (tests pass fakes). */
export interface CliDeps {
  cwd?: string;
  env?: Record<string, string | undefined>;
  clock?: Clock;
  /** `~/.norn` override (else NORN_HOME_DIR, else ~/.norn) */
  home?: string;
  /** replace whole ports (fake remote, fake runner, …) */
  ports?: Partial<Ports>;
  registry?: AdapterRegistry;
  /** progress lines for long-running commands (watch); never stdout */
  log?: (line: string) => void;
  /** stops `watch` after the current tick */
  signal?: AbortSignal;
  /** stdin text for commands that read it (`norn hook`); else the process stdin */
  stdin?: string;
  /** SPEC-cockpit CP6: raw key chunks for `norn status --watch`; else the process stdin in raw mode */
  input?: AsyncIterable<string>;
  /** HC6/HC12: Herdr for the cockpit; null = none; absent = the real one when `HERDR_ENV=1` */
  herdr?: herdr.HerdrCockpit | null;
  /** an outside command a front end starts for the person (`norn status --watch` opens a PR or issue link); default Bun.spawn */
  shell?: (argv: string[], cwd: string) => Promise<{ code: number; stderr: string }>;
  /** D2: the terminal a person answers prompts in; null = none (no TTY); absent = the process terminal */
  interaction?: Interaction | null;
}

export const systemClock: Clock = {
  now: () => Date.now(),
  iso: () => new Date().toISOString(),
};

export interface Located {
  /** main checkout (realpath) */
  root: string;
  /** worktree containing cwd, when it carries a `.norn-unit` marker */
  worktree: string | null;
  unit: UnitMarker | null;
}

/** Walk up from `cwd` for a `.norn-unit` marker (A3). */
export function findUnitMarker(cwd: string): { worktree: string; marker: UnitMarker } | null {
  let dir = cwd;
  for (;;) {
    const m = readUnitMarker(dir);
    if (m.exists && m.marker) return { worktree: dir, marker: m.marker };
    if (existsSync(join(dir, ".git"))) return null; // top of a checkout or worktree
    const up = dirname(dir);
    if (up === dir) return null;
    dir = up;
  }
}

export async function locateRepo(cwd: string, git: GitPort): Promise<Located> {
  const real = safeRealpath(cwd);
  const found = findUnitMarker(real);
  if (found && existsSync(found.marker.repo)) return { root: safeRealpath(found.marker.repo), worktree: found.worktree, unit: found.marker };
  let root: string;
  try {
    root = await git.repoRoot(real);
  } catch {
    throw refuse(`not inside a git repository: ${cwd}`, "cd into your repository (or a norn worktree) and run the command again", "not_in_repo");
  }
  return { root: safeRealpath(root), worktree: null, unit: null };
}

/** The real path of `p`, or `p` itself when it cannot be resolved (missing, no access). */
export function safeRealpath(p: string): string {
  try {
    return realpathSync(p);
  } catch {
    return p;
  }
}

export class Context {
  readonly cwd: string;
  readonly env: Record<string, string | undefined>;
  readonly clock: Clock;
  readonly home: string;
  readonly registry: AdapterRegistry;
  readonly deps: CliDeps;
  /** lines for a person on stderr (a one-time notice, B13), returned in `CliResult.stderr`; never data */
  readonly stderr: string[] = [];
  private located: Located | null = null;
  private loadedConfig: LoadedConfig | null = null;
  private builtPorts: Ports | null = null;
  private bootGit: GitPort | null = null;

  constructor(deps: CliDeps = {}) {
    this.deps = deps;
    this.cwd = deps.cwd ?? process.cwd();
    this.env = deps.env ?? process.env;
    this.clock = deps.clock ?? systemClock;
    this.home = nornHome(deps.home, this.env);
    this.registry = deps.registry ?? defaultRegistry();
  }

  /** Git before config is known (root discovery, init). */
  get git(): GitPort {
    if (this.builtPorts) return this.builtPorts.git;
    if (!this.bootGit) this.bootGit = this.deps.ports?.git ?? this.registry.git(this.adapterContext("", DEFAULT_CONFIG));
    return this.bootGit;
  }

  /** Resolve the repo; commands with `repo: true` get this before `run`. */
  async locate(): Promise<Located> {
    if (!this.located) this.located = await locateRepo(this.cwd, this.git);
    return this.located;
  }

  /** Main checkout root. Throws if `locate()` has not run. */
  get root(): string {
    if (!this.located) throw new Error("Context.root used before locate()");
    return this.located.root;
  }

  /** Marker of the worktree the command runs in, if any (A3). */
  get unit(): UnitMarker | null {
    return this.located?.unit ?? null;
  }
  get worktree(): string | null {
    return this.located?.worktree ?? null;
  }

  /** Raw config load result (both layers, K2). */
  get loaded(): LoadedConfig {
    if (!this.loadedConfig) this.loadedConfig = loadConfig({ repoRoot: this.root, home: this.home, env: this.env });
    return this.loadedConfig;
  }

  /** Resolved config; refuses with exit `corrupt` when a layer fails validation (S2). */
  get config(): ResolvedConfig {
    const l = this.loaded;
    if (!l.ok) throw corruptError(`config failed validation: ${l.errors.map((e) => `${e.file}: ${e.errors.map((x) => `${x.path || "/"} ${x.message}`).join("; ")}`).join(" | ")}`, "fix the config file(s) listed in details", l.errors);
    return l.config;
  }

  /** Forget cached config and ports (after `init` writes config). */
  reload(): void {
    this.loadedConfig = null;
    this.builtPorts = null;
  }

  adapterContext(root = this.located?.root ?? "", config: ResolvedConfig = this.loadedConfig?.ok ? this.loadedConfig.config : DEFAULT_CONFIG): AdapterContext {
    return { repoRoot: root, home: this.home, config, clock: this.clock, env: this.env };
  }

  /** Ports selected by config (X2), built once per context. */
  async ports(): Promise<Ports> {
    if (!this.builtPorts) {
      const config = this.config;
      this.builtPorts = await buildPorts(this.registry, this.adapterContext(this.root, config), config, { git: this.git, ...this.deps.ports });
    }
    return this.builtPorts;
  }

  /** D2: the terminal to prompt in — a TTY, no `--json`, not an agent session (A6, orient) — else null. */
  terminal(json: boolean): Interaction | null {
    const t = this.deps.interaction === undefined ? terminalInteraction() : this.deps.interaction;
    return t?.tty && !json && !isAgentSession(this.env) ? t : null;
  }

  log(line: string): void {
    this.deps.log?.(line);
  }
}
