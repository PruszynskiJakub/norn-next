/**
 * Building what a command runs on, in the order each piece needs the last: the repo and its machine
 * dir, the host over them, the config, the plugins it picks, then the runtime. Each step refuses
 * with a CliError naming the fix, so a command never starts on half a setup.
 */
import { userInfo } from "node:os";
import type { HostContext, NornPlugin } from "@norn/plugin-api";
import { PLUGIN_API_VERSION } from "@norn/plugin-api";
import { createRuntimeEnv, EventLogSessionSource, newTickId, readRepoWorkflows, type RepoWorkflows, type Runtime, type RuntimeConfig, type RuntimeEnv, tick } from "@norn/runtime";
import { runtimeConfigOf } from "./config/derive.ts";
import { configError, type LoadedConfig, loadConfig } from "./config/load.ts";
import { oldConfigRefusal } from "./config/migrate.ts";
import { configPaths, lockPath } from "./config/paths.ts";
import { homePaths, locateRepo, machineDir, type RepoIdentity } from "./home.ts";
import { configFailure, refuse } from "./output.ts";
import { BUNDLED_PLUGINS } from "./plugins/bundled.ts";
import { type PluginImporter, loadInstalled } from "./plugins/installed.ts";
import { type PluginLock, readLock } from "./plugins/lock.ts";
import { resolvePlugins } from "./plugins/resolve.ts";

export interface WiredRepo {
  home: string;
  repo: RepoIdentity;
  /** `<home>/repos/<id>`, the host's `repo.dataDir` */
  machine: string;
  ctx: HostContext;
}

export interface HostFactory {
  /** the host over a checkout and its machine dir */
  host(opts: { root: string; dataDir: string }): HostContext;
  /** runs git before the repo is known, to find it */
  exec: HostContext["exec"];
}

export async function wireRepo(home: string, cwd: string, hosts: HostFactory): Promise<WiredRepo> {
  const repo = await locateRepo(hosts.exec, cwd);
  const machine = machineDir(home, repo.id);
  return { home, repo, machine, ctx: hosts.host({ root: repo.root, dataDir: machine }) };
}

export async function wireConfig(w: WiredRepo): Promise<LoadedConfig> {
  const paths = configPaths(w.home, w.repo.root);
  // before the files load: the user's file alone may make a valid config, which the old team config would then silently lose to
  const old = await oldConfigRefusal(w.ctx.files, w.repo.root, paths);
  if (old) throw old;
  const loaded = await loadConfig(w.ctx.files, paths);
  if (!loaded.ok) throw configError(loaded.problems, loaded.layers, paths);
  return loaded.value;
}

/** Team mode: the config is committed, so the lock is too. */
export const isTeamMode = (loaded: LoadedConfig): boolean => loaded.layers.repo !== null;

export interface WiredPlugins {
  plugins: NornPlugin[];
  /** plugin name to its lock entry's name, for every installed plugin that loads */
  installedAs: Record<string, string>;
  lock: PluginLock;
  lockPath: string;
}

export async function wirePlugins(w: WiredRepo, loaded: LoadedConfig, importer: PluginImporter): Promise<WiredPlugins> {
  const path = lockPath(w.repo.root, w.machine, isTeamMode(loaded));
  const lock = await readLock(w.ctx.files, path);
  const pluginsDir = homePaths(w.home).plugins;
  const installed = await Promise.all(lock.plugins.map((e) => loadInstalled(e, pluginsDir, importer, PLUGIN_API_VERSION)));
  const r = resolvePlugins({ config: loaded.config, bundled: BUNDLED_PLUGINS, lock, installed });
  if (!r.ok) throw r.failure;
  const installedAs: Record<string, string> = {};
  for (const load of installed) if (load.ok) installedAs[load.plugin.name] = load.entry.name;
  return { plugins: r.plugins, installedAs, lock, lockPath: path };
}

/**
 * The repo's own workflows, read from the main checkout like its config, so every worktree of the
 * repo runs the workflows its base holds there.
 */
export function wireRepoWorkflows(w: WiredRepo): Promise<RepoWorkflows> {
  return readRepoWorkflows(w.ctx.files, w.repo.root);
}

/**
 * The text of every file a runtime is built from: the config layers, the plugin lock in either place
 * it can be, and the repo's workflow files. Two equal answers mean a rebuild would build the same
 * runtime, so a long-running command rebuilds only when this changes. An installed plugin's code
 * changes only with its lock entry, so the lock stands for it.
 */
export async function wiringSources(w: WiredRepo): Promise<string> {
  const paths = configPaths(w.home, w.repo.root);
  const files = [paths.user, paths.local, paths.repo, lockPath(w.repo.root, w.machine, true), lockPath(w.repo.root, w.machine, false)];
  const [texts, workflows] = await Promise.all([Promise.all(files.map((f) => w.ctx.files.read(f))), wireRepoWorkflows(w)]);
  return JSON.stringify({ texts, workflows });
}

/** Who claims from this machine when the config names nobody. */
export function defaultHolder(env: Readonly<Record<string, string | undefined>>, hostname: string): string {
  let user = env.USER ?? env.LOGNAME ?? "";
  if (!user) {
    try {
      user = userInfo().username;
    } catch {
      user = "norn";
    }
  }
  return `${user}@${hostname}`;
}

export interface RuntimeParts {
  w: WiredRepo;
  loaded: LoadedConfig;
  plugins: readonly NornPlugin[];
  holder: string;
  /** how a launched agent's hooks call back into this binary, before `hook <harness>` */
  self: readonly string[];
  /** this process's PATH, which launched agents get with a `norn` running `self` in front */
  path?: string;
  /** the norn home the env chose (`NORN_HOME_DIR`), which launched agents and their hooks take too */
  home?: string;
  /** the repo's own workflow files, laid over the pack's */
  repoWorkflows?: RepoWorkflows;
}

function runtimeDeps(p: RuntimeParts): Parameters<typeof createRuntimeEnv>[0] {
  const config: RuntimeConfig = runtimeConfigOf(p.loaded, p.holder);
  return {
    ctx: p.w.ctx,
    plugins: p.plugins,
    config,
    hookCommand: [...p.self, "hook"],
    ...(p.path !== undefined ? { hostPath: p.path } : {}),
    ...(p.home !== undefined ? { agentEnv: { NORN_HOME_DIR: p.home } } : {}),
    ...(p.repoWorkflows !== undefined ? { repoWorkflows: p.repoWorkflows } : {}),
    sessions: (launcher) =>
      new EventLogSessionSource({ ctx: p.w.ctx, classify: { silentAfterMs: config.kernel.silentAfterMs }, alive: (h) => launcher.alive?.(h) ?? Promise.resolve(null) }),
  };
}

/**
 * What the agent verbs and read-only views need: the resolved slots, the journal and the workflows.
 * A workflow that does not load is kept as its failure here; the commands that run workflows refuse
 * it through `packFailure`, so a broken pack leaves the rest working.
 */
export function wireRuntimeEnv(p: RuntimeParts): RuntimeEnv {
  const built = createRuntimeEnv(runtimeDeps(p));
  // a factory refusing its slot's config is the person's config to fix, not a rule saying no
  if (!built.ok)
    throw built.failure.code === "invalid"
      ? configFailure(built.failure.message, "norn doctor", "slot_config_invalid", { failure: built.failure })
      : refuse(built.failure.message, "norn doctor", "runtime_unresolved", { failure: built.failure });
  return built.value;
}

/** The tick host over the env the other verbs see, so a tick and a report resolve the same plugins. */
export function wireRuntime(env: RuntimeEnv): Runtime {
  return { tick: () => tick(env, newTickId(env.ctx.now())) };
}
