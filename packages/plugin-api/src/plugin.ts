import type { ForgeFactory } from "./forge.ts";
import type { Harness } from "./harness.ts";
import type { TrackerFactory } from "./tracker.ts";
import { apiSatisfies, PLUGIN_API_VERSION } from "./version.ts";

/**
 * The slots a plugin fills, each keyed by the name a config selects it by. Slots join as optional
 * members, so a plugin written against an older 1.x stays valid.
 */
export interface PluginProvides {
  harness?: Record<string, Harness>;
  tracker?: Record<string, TrackerFactory>;
  forge?: Record<string, ForgeFactory>;
}

export interface NornPluginSpec {
  name: string;
  /** the plugin API range the plugin was written against, e.g. `^1` */
  api: string;
  provides: PluginProvides;
}

export interface NornPlugin {
  readonly name: string;
  readonly api: string;
  readonly provides: Readonly<{
    harness?: Readonly<Record<string, Harness>>;
    tracker?: Readonly<Record<string, TrackerFactory>>;
    forge?: Readonly<Record<string, ForgeFactory>>;
  }>;
}

const HARNESS_METHODS = ["install", "uninstall", "launch", "normalize", "respond"] as const;

function refuse(plugin: string, why: string): never {
  throw new Error(`norn plugin ${plugin || "(unnamed)"}: ${why}`);
}

function checkHarness(plugin: string, key: string, h: Harness): void {
  const missing = HARNESS_METHODS.filter((m) => typeof (h as unknown as Record<string, unknown>)?.[m] !== "function");
  if (missing.length > 0) refuse(plugin, `harness ${key} lacks ${missing.join(", ")}`);
  if (typeof h.name !== "string" || typeof h.capabilities !== "object" || h.capabilities === null)
    refuse(plugin, `harness ${key} needs a name and capabilities`);
}

/** A tracker or forge is made per repo from its config, so only the factory can be checked here. */
function checkFactory(slot: string): (plugin: string, key: string, f: TrackerFactory | ForgeFactory) => void {
  return (plugin, key, f) => {
    const loose = f as unknown as Record<string, unknown> | null;
    const schema = loose?.configSchema;
    if (schema === null || typeof schema !== "object") refuse(plugin, `${slot} ${key} needs a configSchema`);
    if (typeof loose?.create !== "function") refuse(plugin, `${slot} ${key} lacks create`);
  };
}

function slot<T>(plugin: string, name: string, given: Record<string, T> | undefined, checkOne: (plugin: string, key: string, v: T) => void): Readonly<Record<string, T>> | undefined {
  if (given === undefined) return undefined;
  const out: Record<string, T> = {};
  for (const [key, v] of Object.entries(given)) {
    if (!key) refuse(plugin, `provides a ${name} with an empty key`);
    checkOne(plugin, key, v);
    out[key] = v;
  }
  return Object.freeze(out);
}

/**
 * Check and freeze a plugin. It refuses at definition time, not at first use, so a plugin that
 * cannot work fails when it loads rather than midway through a run.
 */
export function defineNornPlugin(spec: NornPluginSpec): NornPlugin {
  const name = typeof spec?.name === "string" ? spec.name.trim() : "";
  if (!name) refuse(name, "needs a non-empty name");
  if (typeof spec.api !== "string" || !apiSatisfies(spec.api))
    refuse(name, `wants plugin API ${JSON.stringify(spec.api)}, but this norn implements ${PLUGIN_API_VERSION}`);
  const harness = slot(name, "harness", spec.provides?.harness, checkHarness);
  const tracker = slot(name, "tracker", spec.provides?.tracker, checkFactory("tracker"));
  const forge = slot(name, "forge", spec.provides?.forge, checkFactory("forge"));
  const provides: NornPlugin["provides"] = {
    ...(harness && { harness }),
    ...(tracker && { tracker }),
    ...(forge && { forge }),
  };
  return Object.freeze({ name, api: spec.api, provides: Object.freeze(provides) });
}
