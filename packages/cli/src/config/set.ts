/**
 * Setting one key in one config file, as `config set` and the plugin commands do. A valid config
 * must stay valid; one already invalid (a config built up key by key, or a plugin added before
 * `norn init`) takes any set that leaves the written file itself valid, and the answer names what is
 * still missing. A file that does not parse is never written over.
 */
import type { HostFiles } from "@norn/plugin-api";
import { type ConfigProblem, configError, loadConfig } from "./load.ts";
import type { ConfigPaths, Layer } from "./paths.ts";
import { planSet, setKeyInText, writeLayer } from "./write.ts";

export interface SetOutcome {
  file: string;
  /** the merged config loads after the set */
  valid: boolean;
  problems: ConfigProblem[];
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
  return { file: paths[layer], valid: plan.ok, problems: plan.ok ? [] : plan.problems };
}
