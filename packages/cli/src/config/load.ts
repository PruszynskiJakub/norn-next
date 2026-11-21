/**
 * Reading the config: each file parsed and checked on its own (so a problem names the file that
 * has it), then merged over the defaults and checked whole. Any problem is a config error, exit 6:
 * norn never runs on a config it had to guess at.
 */
import { CAPABILITIES, type Capability, type HostFiles } from "@norn/plugin-api";
import { check } from "@norn/schema";
import { parse } from "yaml";
import { configFailure } from "../output.ts";
import { isMapping, mergeLayers } from "./merge.ts";
import { isOldUserConfig } from "./migrate-user.ts";
import { type ConfigPaths, LAYERS, type Layer, layerFileName } from "./paths.ts";
import { renamedProblems } from "./renamed.ts";
import { withoutRetired } from "./retired.ts";
import { CONFIG_DEFAULTS, ConfigLayer, NornConfig, type Policy } from "./schema.ts";

export interface ConfigProblem {
  /** the file at fault, or `merged` when only the files together are wrong */
  layer: Layer | "merged";
  /** a JSON pointer into that file's document */
  path: string;
  message: string;
  /** the file is the old norn's, which `norn init` rewrites */
  old?: true;
  /** the command that fixes this problem, when it is known (an old key's new name) */
  do_instead?: string;
}

/** A config every command may run on: the merged file, the default executor named, and each layer as written. */
export interface LoadedConfig {
  config: NornConfig;
  /** `executor`, or the only executor when it is absent */
  executor: string;
  /** each file's own document, null when the file does not exist */
  layers: Record<Layer, ConfigLayer | null>;
  paths: ConfigPaths;
  /** keys the files set that this norn no longer reads, each with the command that deletes it */
  retired: ConfigProblem[];
}

/** A failed load keeps the layers that did parse, so the refusal can tell "nothing configured" from "wrong". */
export type ConfigLoad = { ok: true; value: LoadedConfig } | { ok: false; problems: ConfigProblem[]; layers: Record<Layer, ConfigLayer | null> };

export type ParsedLayer = { ok: true; value: ConfigLayer | null; retired: ConfigProblem[] } | { ok: false; problems: ConfigProblem[] };

export function parseLayer(layer: Layer, text: string | null): ParsedLayer {
  if (text === null) return { ok: true, value: null, retired: [] };
  let doc: unknown;
  try {
    doc = parse(text);
  } catch (e) {
    return { ok: false, problems: [{ layer, path: "", message: `not YAML: ${e instanceof Error ? e.message : String(e)}` }] };
  }
  // an empty file sets nothing, which is not wrong
  if (doc === null || doc === undefined) return { ok: true, value: {}, retired: [] };
  if (!isMapping(doc)) return { ok: false, problems: [{ layer, path: "", message: "must be a mapping of keys" }] };
  const { doc: kept, retired } = withoutRetired(layer, doc);
  const r = check(ConfigLayer, kept);
  if (r.ok) return { ok: true, value: r.value, retired };
  // an old key's own problem says what replaced it; the schema's "unknown property" for it says less
  const renamed = renamedProblems(layer, kept);
  const named = new Set(renamed.map((p) => p.path.slice(1)));
  const rest = r.errors.filter((e) => !(e.path === "" && named.has(/^unknown property '(.*)'$/.exec(e.message)?.[1] ?? "")));
  return { ok: false, problems: [...renamed, ...rest.map((e) => ({ layer, path: e.path, message: e.message }))] };
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
  for (const [key, bound] of Object.entries(config.bind ?? {}))
    for (const name of typeof bound === "string" ? [bound] : bound)
      if (!names.includes(name)) problems.push({ layer: "merged", path: `/bind/${key}`, message: `names ${name}, which is not under \`executors\` (${names.join(", ")})` });
  return { executor, problems };
}

/**
 * The policy the layers leave: the user's file grants, and each repo file that sets a list keeps only
 * what it names of it. The reverse of every other key's order, since an agent inside its step can
 * change a repo file but not the person's own; a grant only a repo file makes is no grant.
 */
export function narrowPolicy(layers: Readonly<Record<Layer, ConfigLayer | null>>): Policy | undefined {
  if (LAYERS.every((l) => layers[l]?.policy === undefined)) return undefined;
  const lists = ["attended", "gates"] as const;
  const standIn: NonNullable<Policy["stand_in"]> = {};
  for (const list of lists) {
    let kept: string[] | undefined;
    for (const layer of LAYERS) {
      const named = layers[layer]?.policy?.stand_in?.[list];
      if (named === undefined) continue;
      kept = layer === "user" ? [...named] : (kept ?? []).filter((ref) => named.includes(ref));
    }
    if (kept !== undefined) standIn[list] = kept;
  }
  // absent from the user's file caps nothing, so a repo file narrows from every capability
  let capabilities: Capability[] | undefined;
  for (const layer of LAYERS) {
    const named = layers[layer]?.policy?.allow;
    if (named === undefined) continue;
    capabilities = layer === "user" ? [...named] : (capabilities ?? [...CAPABILITIES]).filter((c) => named.includes(c));
  }
  return { ...(Object.keys(standIn).length > 0 && { stand_in: standIn }), ...(capabilities !== undefined && { allow: capabilities }) };
}

/** Merge parsed layers over the defaults and check the whole. */
export function mergeConfig(layers: Record<Layer, ConfigLayer | null>, paths: ConfigPaths, retired: ConfigProblem[] = []): ConfigLoad {
  const merged = mergeLayers([CONFIG_DEFAULTS, ...LAYERS.map((l) => layers[l])]);
  const policy = narrowPolicy(layers);
  if (policy === undefined) delete merged.policy;
  else merged.policy = policy;
  const r = check(NornConfig, merged);
  if (!r.ok) return { ok: false, problems: r.errors.map((e) => ({ layer: "merged", path: e.path, message: e.message })), layers };
  const cross = crossProblems(r.value);
  if (cross.problems.length > 0) return { ok: false, problems: cross.problems, layers };
  return { ok: true, value: { config: r.value, executor: cross.executor, layers, paths, retired } };
}

/** `read`: the layers to read; one left out loads as if its file did not exist. */
export async function loadConfig(files: HostFiles, paths: ConfigPaths, read: readonly Layer[] = LAYERS): Promise<ConfigLoad> {
  const layers = { user: null, local: null, repo: null } as Record<Layer, ConfigLayer | null>;
  const problems: ConfigProblem[] = [];
  const retired: ConfigProblem[] = [];
  for (const layer of LAYERS) {
    if (!read.includes(layer)) continue;
    const text = await files.read(paths[layer]);
    const parsed = parseLayer(layer, text);
    if (parsed.ok) {
      layers[layer] = parsed.value;
      retired.push(...parsed.retired);
    } else if (layer === "user" && isOldUserConfig(text))
      problems.push({ layer, path: "", message: "is the old norn's user config, whose keys this norn spells otherwise (mode is kernel.mode)", old: true });
    else problems.push(...parsed.problems);
  }
  if (problems.length > 0) return { ok: false, problems, layers };
  return mergeConfig(layers, paths, retired);
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
  if (problems.some((p) => p.old)) {
    const details = problems.map((p) => ({ ...p, ...(paths && p.layer !== "merged" ? { file: paths[p.layer] } : {}) }));
    return configFailure(
      problems.map(problemText).join("; "),
      `norn init, which rewrites ${layerFileName("user")} in this norn's keys and keeps the old file as config.yaml.old`,
      "config_old",
      details,
    );
  }
  const nothing = layers !== undefined && problems.every((p) => p.layer === "merged") && LAYERS.every((l) => layers[l] === null || layers[l] === undefined);
  const doInstead = nothing ? "norn init" : first?.do_instead ? first.do_instead : first && first.layer !== "merged" ? `fix ${layerFileName(first.layer)}` : "norn config show";
  const details = problems.map((p) => ({ ...p, ...(paths && p.layer !== "merged" ? { file: paths[p.layer] } : {}) }));
  return configFailure(problems.map(problemText).join("; ") || "the config is invalid", doInstead, nothing ? "config_missing" : "config_invalid", details);
}
