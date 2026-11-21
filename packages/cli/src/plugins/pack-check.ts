/**
 * Whether the workflows can run: a workflow naming a step kind no plugin provides, or a pack file
 * that does not parse or load, is refused with the plugin, pack and file named; a repo file
 * (`.agents/workflows/`) with its path. Only the commands that run workflows ask (a tick, watch, doctor's workflows check), so a broken pack never
 * keeps a person from the commands that would fix it: config, plugin, doctor, story create.
 */
import type { WorkflowError, WorkflowLoad } from "@norn/kernel";
import type { NornPlugin } from "@norn/plugin-api";
import { NO_REPO_WORKFLOWS, type RepoWorkflows, repoFileOf } from "@norn/runtime";
import { type CliFailure, refuse } from "../output.ts";
import { missingStepKinds } from "./resolve.ts";

export interface PackSource {
  /** the pack the config picks */
  pack: string;
  plugins: readonly NornPlugin[];
  /** plugin name to the name `norn plugin remove` takes, for every installed plugin; bundled ones are absent */
  installedAs: Readonly<Record<string, string>>;
  /** the repo's own files laid over the pack; a failure in one of them is the repo's to fix, never the plugin's */
  repo?: RepoWorkflows;
  /** the workflows held for the person's confirmation: waiting for the person, not broken, so they stop no tick */
  held?: readonly string[];
}

function fileOf(plugin: NornPlugin | undefined, pack: string, workflow: string): string {
  const files = Object.keys(plugin?.provides.packs?.[pack]?.workflows ?? {});
  return files.find((f) => f.replace(/\.ya?ml$/, "") === workflow) ?? `${workflow}.yaml`;
}

/** The repo file a broken workflow is the repo's to fix through: its own file, or a repo shared file its errors name. */
function repoFileFor(repo: RepoWorkflows, name: string, errors: readonly WorkflowError[]): { file: string; own: boolean } | null {
  const own = repoFileOf(repo, name, "workflow");
  if (own !== null) return { file: own, own: true };
  for (const e of errors) {
    const shared = e.shared !== undefined ? repoFileOf(repo, e.shared, "shared") : null;
    if (shared !== null) return { file: shared, own: false };
  }
  return null;
}

const errorText = (errors: readonly WorkflowError[]): string[] => errors.map((e) => `${e.path ? `${e.path}: ` : ""}${e.message}`);

export function packFailure(byName: Readonly<Record<string, WorkflowLoad>>, src: PackSource): CliFailure | null {
  const missing = missingStepKinds(byName);
  if (missing) return missing;
  const broken = Object.entries(byName).flatMap(([name, load]) => (load.ok || src.held?.includes(name) ? [] : [{ name, errors: load.errors }]));
  if (broken.length === 0) return null;
  const repo = src.repo ?? NO_REPO_WORKFLOWS;
  const inRepo = broken.flatMap((b) => {
    const found = repoFileFor(repo, b.name, b.errors);
    return found === null ? [] : [{ workflow: b.name, ...found, errors: errorText(b.errors) }];
  });
  if (inRepo.length > 0) return repoFailure(inRepo);
  const plugin = src.plugins.find((p) => p.provides.packs?.[src.pack] !== undefined);
  const pluginName = plugin?.name ?? "(none)";
  const files = broken.map((b) => ({ file: fileOf(plugin, src.pack, b.name), errors: errorText(b.errors) }));
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

/**
 * The repo's own files come first: they are what the person edits, and a pack workflow failing only
 * because a repo shared file broke is fixed in that repo file too.
 */
function repoFailure(inRepo: ReadonlyArray<{ workflow: string; file: string; own: boolean; errors: string[] }>): CliFailure {
  const files = [...new Set(inRepo.map((b) => b.file))];
  const what = inRepo.map((b) => `${b.file}${b.own ? "" : ` (workflow ${b.workflow})`}: ${b.errors.join("; ")}`).join("; ");
  return refuse(`the repo's workflow files do not load: ${what}`, `fix ${files.join(", ")}, or delete it to run the pack's workflow of that name`, "repo_workflow_invalid", {
    files,
    workflows: inRepo.map((b) => b.workflow),
  });
}
