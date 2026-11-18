/**
 * Reading the config: each file parsed and checked on its own (so a problem names the file that
 * has it), then merged over the defaults and checked whole. Any problem is a config error, exit 6:
 * norn never runs on a config it had to guess at.
 */
import type { HostFiles } from "@norn/plugin-api";
import { check } from "@norn/schema";
import { parse } from "yaml";
import { configFailure } from "../output.ts";
import { isMapping, mergeLayers } from "./merge.ts";
import { type ConfigPaths, LAYERS, type Layer, layerFileName } from "./paths.ts";
import { CONFIG_DEFAULTS, ConfigLayer, NornConfig } from "./schema.ts";

export interface ConfigProblem {
  /** the file at fault, or `merged` when only the files together are wrong */
  layer: Layer | "merged";
  /** a JSON pointer into that file's document */
  path: string;
  message: string;
}

/** A config every command may run on: the merged file, the default executor named, and each layer as written. */
export interface LoadedConfig {
  config: NornConfig;
  /** `executor`, or the only executor when it is absent */
  executor: string;
  /** each file's own document, null when the file does not exist */
  layers: Record<Layer, ConfigLayer | null>;
  paths: ConfigPaths;
}

/** A failed load keeps the layers that did parse, so the refusal can tell "nothing configured" from "wrong". */
export type ConfigLoad = { ok: true; value: LoadedConfig } | { ok: false; problems: ConfigProblem[]; layers: Record<Layer, ConfigLayer | null> };

export function parseLayer(layer: Layer, text: string | null): { ok: true; value: ConfigLayer | null } | { ok: false; problems: ConfigProblem[] } {
  if (text === null) return { ok: true, value: null };
  let doc: unknown;
  try {
    doc = parse(text);
  } catch (e) {
    return { ok: false, problems: [{ layer, path: "", message: `not YAML: ${e instanceof Error ? e.message : String(e)}` }] };
  }
  // an empty file sets nothing, which is not wrong
  if (doc === null || doc === undefined) return { ok: true, value: {} };
  if (!isMapping(doc)) return { ok: false, problems: [{ layer, path: "", message: "must be a mapping of keys" }] };
  const r = check(ConfigLayer, doc);
  if (!r.ok) return { ok: false, problems: r.errors.map((e) => ({ layer, path: e.path, message: e.message })) };
  return { ok: true, value: r.value };
}

/** The merged config's own rules, beyond its shape. */
function crossProblems(config: NornConfig): { executor: string; problems: ConfigProblem[] } {
  const names = Object.keys(config.executors);
  const problems: ConfigProblem[] = [];
  let executor = config.executor ?? (names.length === 1 ? (names[0] as string) : "");
  if (!config.executor && names.length > 1)
    problems.push({ layer: "merged", path: "/executor", message: `several executors are configured (${names.join(", ")}); name the default with \`executor\`` });
  if (config.executor && !names.includes(config.executor)) {
    problems.push({ layer: "merged", path: "/executor", message: `names ${config.executor}, which is not under \`executors\` (${names.join(", ")})` });
    executor = "";
  }
  return { executor, problems };
}

/** Merge parsed layers over the defaults and check the whole. */
export function mergeConfig(layers: Record<Layer, ConfigLayer | null>, paths: ConfigPaths): ConfigLoad {
  const merged = mergeLayers([CONFIG_DEFAULTS, ...LAYERS.map((l) => layers[l])]);
  const r = check(NornConfig, merged);
  if (!r.ok) return { ok: false, problems: r.errors.map((e) => ({ layer: "merged", path: e.path, message: e.message })), layers };
  const cross = crossProblems(r.value);
  if (cross.problems.length > 0) return { ok: false, problems: cross.problems, layers };
  return { ok: true, value: { config: r.value, executor: cross.executor, layers, paths } };
}

export async function loadConfig(files: HostFiles, paths: ConfigPaths): Promise<ConfigLoad> {
  const layers = { user: null, local: null, repo: null } as Record<Layer, ConfigLayer | null>;
  const problems: ConfigProblem[] = [];
  for (const layer of LAYERS) {
    const parsed = parseLayer(layer, await files.read(paths[layer]));
    if (parsed.ok) layers[layer] = parsed.value;
    else problems.push(...parsed.problems);
  }
  if (problems.length > 0) return { ok: false, problems, layers };
  return mergeConfig(layers, paths);
}

export function problemText(p: ConfigProblem): string {
  const where = p.layer === "merged" ? "the merged config" : layerFileName(p.layer);
  return `${where}${p.path ? ` ${p.path}` : ""}: ${p.message}`;
}

/**
 * The config error a command refuses with. Nothing configured at all sends a person to `norn init`;
 * otherwise to the first file at fault.
 */
export function configError(problems: readonly ConfigProblem[], layers?: Partial<Record<Layer, unknown>>, paths?: ConfigPaths) {
  const first = problems[0];
  const nothing = layers !== undefined && problems.every((p) => p.layer === "merged") && LAYERS.every((l) => layers[l] === null || layers[l] === undefined);
  const doInstead = nothing ? "norn init" : first && first.layer !== "merged" ? `fix ${layerFileName(first.layer)}` : "norn config show";
  const details = problems.map((p) => ({ ...p, ...(paths && p.layer !== "merged" ? { file: paths[p.layer] } : {}) }));
  return configFailure(problems.map(problemText).join("; ") || "the config is invalid", doInstead, nothing ? "config_missing" : "config_invalid", details);
}
