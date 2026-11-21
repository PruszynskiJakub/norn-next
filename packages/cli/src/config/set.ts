/**
 * Setting one key in one config file, as `config set` and the plugin commands do. A valid config
 * must stay valid; one already invalid (a config built up key by key, or a plugin added before
 * `norn init`) takes any set that leaves the written file itself valid, and the answer names what is
 * still missing. A file that does not parse is never written over.
 */
import type { HostFiles } from "@norn/plugin-api";
import { type ConfigProblem, configError, loadConfig } from "./load.ts";
import { getKey, keyPath } from "./merge.ts";
import { leafKeys } from "./origins.ts";
import { type ConfigPaths, LAYERS, type Layer } from "./paths.ts";
import { POLICY_KEY } from "./schema.ts";
import { planSet, setKeyInText, writeLayer } from "./write.ts";

export interface SetOutcome {
  file: string;
  /** the merged config loads after the set */
  valid: boolean;
  problems: ConfigProblem[];
  /** a higher file sets the key too, so the merged config keeps its value rather than the one just written */
  overridden?: Override;
  /** a policy key the merged config holds less of than was written: only the user's file grants, and a repo file narrows */
  narrowed?: { value: unknown };
}

export interface Override {
  /** the highest file that sets the key: the one whose value the merged config holds */
  layer: Layer;
  file: string;
  /** the leaves of what was written that this file sets */
  keys: string[];
  /** what that file sets the key to */
  value: unknown;
}

/**
 * The highest file above `layer` that sets any leaf of what was written. The layers merge user <
 * local < repo, so a person who sets a key in their own file while the committed one holds it gets
 * a value that never applies, and must be told so where they set it.
 */
export function overrideOf(layers: Readonly<Record<Layer, unknown>>, paths: ConfigPaths, layer: Layer, key: string, value: unknown): Override | undefined {
  const leaves = leafKeys(value, key);
  for (const above of [...LAYERS].reverse()) {
    if (LAYERS.indexOf(above) <= LAYERS.indexOf(layer)) return undefined;
    const keys = leaves.filter((k) => getKey(layers[above], k) !== undefined);
    if (keys.length > 0) return { layer: above, file: paths[above], keys, value: getKey(layers[above], key) };
  }
  return undefined;
}

/** `value` undefined removes the key. */
export async function setConfigKey(files: HostFiles, paths: ConfigPaths, layer: Layer, key: string, value: unknown): Promise<SetOutcome> {
  const before = await loadConfig(files, paths);
  const layers = before.ok ? before.value.layers : before.layers;
  if (!before.ok && before.problems.some((p) => p.layer !== "merged")) throw configError(before.problems, layers, paths);
  const current = await files.read(paths[layer]);
  const plan = planSet({ layers, paths }, current, layer, key, value);
  const own = plan.ok ? [] : plan.problems.filter((p) => p.layer !== "merged");
  // the layer set to `{}` keeps the refusal from reading as "nothing configured": something is, just not right
  if (!plan.ok && (before.ok || own.length > 0)) throw configError(plan.problems, { ...layers, [layer]: {} }, paths);
  await writeLayer(files, paths[layer], plan.ok ? plan.text : setKeyInText(current, key, value));
  // a policy key merges the other way round: no file above overrides it, a repo file narrows it
  const policy = keyPath(key)[0] === POLICY_KEY;
  const effective = plan.ok ? getKey(plan.next.config, key) : undefined;
  const narrowed = policy && plan.ok && value !== undefined && !Bun.deepEquals(effective, value) ? { value: effective } : undefined;
  // removing a key leaves whatever a higher file sets, which is no surprise
  const overridden = value === undefined || policy ? undefined : overrideOf(layers, paths, layer, key, value);
  return { file: paths[layer], valid: plan.ok, problems: plan.ok ? [] : plan.problems, ...(overridden && { overridden }), ...(narrowed && { narrowed }) };
}
