/**
 * The config files and the plugin lock, spelled once: a message names a file by the same text a
 * person sees in their checkout.
 */
import { join } from "node:path";
import { homePaths } from "../home.ts";

/** The layers, lowest first; a higher layer's value wins. */
export const LAYERS = ["user", "local", "repo"] as const;
export type Layer = (typeof LAYERS)[number];

/** Relative to the checkout's root. */
export const REPO_LOCAL_FILE = ".agents/norn.local.yaml";
export const REPO_COMMITTED_FILE = ".agents/norn.yaml";
/** Committed beside the repo config in team mode, so a team installs the same plugin versions. */
export const REPO_LOCK_FILE = ".agents/norn.plugins.lock";
/**
 * The old norn's team config. Read only to move a repo over: while it is there and no config of this
 * norn is, every command that needs a config sends the person to `norn init`, which reads it.
 */
export const OLD_REPO_CONFIG_FILE = ".agents/norn.config.yaml";
/**
 * The old norn's repo-local config: the person's mode and agent. Moved into REPO_LOCAL_FILE by the
 * first command that loads a config of this norn, or by `norn init`, and kept beside it as `.old`.
 */
export const OLD_LOCAL_CONFIG_FILE = ".agents/norn.config.local.yaml";
/** The folder init keeps out of git (`.git/info/exclude`) unless the config is committed. */
export const AGENTS_DIR = ".agents/";

export interface ConfigPaths {
  user: string;
  local: string;
  repo: string;
}

export function configPaths(home: string, root: string): ConfigPaths {
  return { user: homePaths(home).userConfig, local: join(root, REPO_LOCAL_FILE), repo: join(root, REPO_COMMITTED_FILE) };
}

/** How a message names a layer's file. */
export function layerFileName(layer: Layer): string {
  return layer === "user" ? "<norn home>/config.yaml" : layer === "local" ? REPO_LOCAL_FILE : REPO_COMMITTED_FILE;
}

/** The plugin lock: committed in team mode, else in the machine dir. */
export function lockPath(root: string, machine: string, team: boolean): string {
  return team ? join(root, REPO_LOCK_FILE) : join(machine, "plugins.lock");
}
