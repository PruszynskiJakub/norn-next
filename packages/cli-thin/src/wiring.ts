/**
 * Building what a command runs on, in the order each piece needs the last: the repo and its machine
 * dir, the host over them, the config, the plugins it picks, then the runtime. Each step refuses
 * with a CliError naming the fix, so a command never starts on half a setup.
 */
import { userInfo } from "node:os";
import type { HostContext, NornPlugin } from "@norn/plugin-api";
import { PLUGIN_API_VERSION } from "@norn/plugin-api";
import { createRuntimeEnv, EventLogSessionSource, newTickId, type Runtime, type RuntimeConfig, type RuntimeEnv, tick } from "@norn/runtime";
import { runtimeConfigOf } from "./config/derive.ts";
import { configError, type LoadedConfig, loadConfig } from "./config/load.ts";
import { configPaths, lockPath } from "./config/paths.ts";
import { homePaths, locateRepo, machineDir, type RepoIdentity } from "./home.ts";
import { configFailure, refuse } from "./output.ts";
import { BUNDLED_PLUGINS } from "./plugins/bundled.ts";
import { type PluginImporter, loadInstalled } from "./plugins/installed.ts";
import { type PluginLock, readLock } from "./plugins/lock.ts";
import { missingStepKinds, resolvePlugins } from "./plugins/resolve.ts";

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
  const loaded = await loadConfig(w.ctx.files, paths);
  if (!loaded.ok) throw configError(loaded.problems, loaded.layers, paths);
  return loaded.value;
}

/** Team mode: the config is committed, so the lock is too. */
export const isTeamMode = (loaded: LoadedConfig): boolean => loaded.layers.repo !== null;

export interface WiredPlugins {
  plugins: NornPlugin[];
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
  return { plugins: r.plugins, lock, lockPath: path };
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
}

function runtimeDeps(p: RuntimeParts): Parameters<typeof createRuntimeEnv>[0] {
  const config: RuntimeConfig = runtimeConfigOf(p.loaded, p.holder);
  return {
    ctx: p.w.ctx,
    plugins: p.plugins,
    config,
    hookCommand: [...p.self, "hook"],
    sessions: (launcher) =>
      new EventLogSessionSource({ ctx: p.w.ctx, classify: { silentAfterMs: config.kernel.silentAfterMs }, alive: (h) => launcher.alive?.(h) ?? Promise.resolve(null) }),
  };
}

/** What the agent verbs and read-only views need: the resolved slots, the journal and the workflows. */
export function wireRuntimeEnv(p: RuntimeParts): RuntimeEnv {
  const built = createRuntimeEnv(runtimeDeps(p));
  // a factory refusing its slot's config is the person's config to fix, not a rule saying no
  if (!built.ok)
    throw built.failure.code === "invalid"
      ? configFailure(built.failure.message, "norn doctor", "slot_config_invalid", { failure: built.failure })
      : refuse(built.failure.message, "norn doctor", "runtime_unresolved", { failure: built.failure });
  const missing = missingStepKinds(built.value.workflows);
  if (missing) throw missing;
  return built.value;
}

/** The tick host over the env the other verbs see, so a tick and a report resolve the same plugins. */
export function wireRuntime(env: RuntimeEnv): Runtime {
  return { tick: () => tick(env, newTickId(env.ctx.now())) };
}
