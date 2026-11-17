import type { Harness } from "./harness.ts";
import { apiSatisfies, PLUGIN_API_VERSION } from "./version.ts";

/**
 * The slots a plugin fills, each keyed by the name a config selects it by. Only the harness slot
 * exists yet; later slots join as optional members, so a plugin written now stays valid.
 */
export interface PluginProvides {
  harness?: Record<string, Harness>;
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
  readonly provides: Readonly<{ harness?: Readonly<Record<string, Harness>> }>;
}

const HARNESS_METHODS = ["install", "uninstall", "launch", "normalize", "respond"] as const;

function refuse(plugin: string, why: string): never {
  throw new Error(`norn plugin ${plugin || "(unnamed)"}: ${why}`);
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
  const provides: { harness?: Readonly<Record<string, Harness>> } = {};
  if (spec.provides?.harness !== undefined) {
    const harness: Record<string, Harness> = {};
    for (const [key, h] of Object.entries(spec.provides.harness)) {
      if (!key) refuse(name, "provides a harness with an empty key");
      const missing = HARNESS_METHODS.filter((m) => typeof (h as unknown as Record<string, unknown>)?.[m] !== "function");
      if (missing.length > 0) refuse(name, `harness ${key} lacks ${missing.join(", ")}`);
      if (typeof h.name !== "string" || typeof h.capabilities !== "object" || h.capabilities === null)
        refuse(name, `harness ${key} needs a name and capabilities`);
      harness[key] = h;
    }
    provides.harness = Object.freeze(harness);
  }
  return Object.freeze({ name, api: spec.api, provides: Object.freeze(provides) });
}
