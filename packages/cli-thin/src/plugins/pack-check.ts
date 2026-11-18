/**
 * Whether the pack's workflows can run: a workflow naming a step kind no plugin provides, or a pack
 * file that does not parse or load, is refused with the plugin, pack and file named. Only the
 * commands that run workflows ask (a tick, watch, doctor's workflows check), so a broken pack never
 * keeps a person from the commands that would fix it: config, plugin, doctor, story create.
 */
import type { WorkflowLoad } from "@norn/kernel";
import type { NornPlugin } from "@norn/plugin-api";
import { type CliFailure, refuse } from "../output.ts";
import { missingStepKinds } from "./resolve.ts";

export interface PackSource {
  /** the pack the config picks */
  pack: string;
  plugins: readonly NornPlugin[];
  /** plugin name to the name `norn plugin remove` takes, for every installed plugin; bundled ones are absent */
  installedAs: Readonly<Record<string, string>>;
}

function fileOf(plugin: NornPlugin | undefined, pack: string, workflow: string): string {
  const files = Object.keys(plugin?.provides.packs?.[pack]?.workflows ?? {});
  return files.find((f) => f.replace(/\.ya?ml$/, "") === workflow) ?? `${workflow}.yaml`;
}

export function packFailure(byName: Readonly<Record<string, WorkflowLoad>>, src: PackSource): CliFailure | null {
  const missing = missingStepKinds(byName);
  if (missing) return missing;
  const broken = Object.entries(byName).flatMap(([name, load]) => (load.ok ? [] : [{ name, errors: load.errors }]));
  if (broken.length === 0) return null;
  const plugin = src.plugins.find((p) => p.provides.packs?.[src.pack] !== undefined);
  const pluginName = plugin?.name ?? "(none)";
  const files = broken.map((b) => ({ file: fileOf(plugin, src.pack, b.name), errors: b.errors.map((e) => `${e.path ? `${e.path}: ` : ""}${e.message}`) }));
  const what = files.map((f) => `${f.file}: ${f.errors.join("; ")}`).join("; ");
  const installed = src.installedAs[pluginName];
  const fix = files.map((f) => f.file).join(", ");
  const do_instead =
    installed !== undefined
      ? `fix ${fix} in plugin ${installed} and run norn plugin update ${installed}, or norn plugin remove ${installed}`
      : `fix ${fix} in plugin ${pluginName}, or norn config set packs <another pack>`;
  return refuse(`pack ${src.pack} of plugin ${pluginName} has workflow files that do not load: ${what}`, do_instead, "pack_invalid", {
    plugin: pluginName,
    pack: src.pack,
    files: files.map((f) => f.file),
  });
}
