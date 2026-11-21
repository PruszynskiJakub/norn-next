/**
 * `norn config show`: print the merged config and which file set each key. It is where a config
 * error that only the files together make sends a person, so an invalid config is shown too, merged
 * as far as it goes, with `valid: false` and its problems; a file that does not parse is left out of
 * the merge and named among them.
 */
import { stringify } from "yaml";
import { defineCommand } from "../command.ts";
import { type ConfigProblem, loadConfig, problemText } from "../config/load.ts";
import { keyPath, mergeLayers } from "../config/merge.ts";
import { type Origin, originsOf } from "../config/origins.ts";
import { configPaths, LAYERS, type Layer, layerFileName } from "../config/paths.ts";
import { CONFIG_DEFAULTS } from "../config/schema.ts";
import { rendered, tableCell } from "../output.ts";

export interface ConfigShown {
  valid: boolean;
  config: Record<string, unknown>;
  /** dotted key → the layer that set it */
  origins: Record<string, Origin>;
  files: Record<Layer, { path: string; exists: boolean }>;
  problems: ConfigProblem[];
}

const cellValue = (v: unknown): string => tableCell(typeof v === "object" && v !== null ? JSON.stringify(v) : String(v));

function markdown(s: ConfigShown): string {
  const out = ["# Config", ""];
  out.push(...LAYERS.map((l) => `- ${l}: ${s.files[l].path}${s.files[l].exists ? "" : " (none)"}`), "");
  if (!s.valid) out.push("**Invalid:**", ...s.problems.map((p) => `- ${problemText(p)}`), "");
  out.push("```yaml", stringify(s.config).trimEnd(), "```", "", "| key | value | from |", "| --- | --- | --- |");
  for (const [key, from] of Object.entries(s.origins)) {
    const value = keyPath(key).reduce<unknown>((at, k) => (at as Record<string, unknown>)?.[k], s.config);
    out.push(`| ${key} | ${cellValue(value)} | ${from === "default" ? "default" : layerFileName(from)} |`);
  }
  return out.join("\n");
}

export const configShowCommand = defineCommand({
  name: "config show",
  summary: "Print the merged config and which file set each key",
  usage: "norn config show",
  async run(ctx) {
    const w = await ctx.repo();
    const paths = configPaths(w.home, w.repo.root);
    const loaded = await loadConfig(w.ctx.files, paths);
    const layers = loaded.ok ? loaded.value.layers : loaded.layers;
    const config = loaded.ok ? (loaded.value.config as Record<string, unknown>) : mergeLayers([CONFIG_DEFAULTS, ...LAYERS.map((l) => layers[l])]);
    const files = {} as ConfigShown["files"];
    for (const l of LAYERS) files[l] = { path: paths[l], exists: (await w.ctx.files.read(paths[l])) !== null };
    const shown: ConfigShown = { valid: loaded.ok, config, origins: originsOf(config, layers), files, problems: loaded.ok ? [] : loaded.problems };
    return rendered(shown, markdown(shown));
  },
});
