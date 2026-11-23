/** Rewrites the generated blocks of docs/reference.md, docs/workflows.md and CONTRIBUTING.md. Run: bun run docs:emit */
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { DEFAULT_KERNEL_CONFIG, type LoadedWorkflow } from "@norn/kernel";
import { SDLC_PACK } from "@norn/pack-sdlc";
import type { Pack } from "@norn/plugin-api";
import { collectSignals, collectStepKinds, loadPackWorkflows, overlayRepoWorkflows, REPO_WORKFLOWS_DIR, type RepoWorkflows, signalDeclarations } from "@norn/runtime";
import { packCatalog } from "../src/catalog.ts";
import { COMMANDS, NOUNS } from "../src/commands/index.ts";
import { CONFIG_DEFAULTS } from "../src/config/schema.ts";
import { BUNDLED_PLUGINS } from "../src/plugins/bundled.ts";
import { CONTRIBUTING_FILE, CONTRIBUTING_MARKERS, type MarkerPair, REFERENCE_FILE, REFERENCE_MARKERS, renderReference, renderWorkflowTable, replaceReference } from "../src/reference.ts";
import { renderWorkflowsPage, WORKFLOWS_FILE, WORKFLOWS_MARKERS } from "../src/workflows-page.ts";

export const ROOT = join(import.meta.dir, "..", "..", "..");

/** The pack `norn init` configures. */
const PACK_NAME = CONFIG_DEFAULTS.packs?.[0] ?? "sdlc";

/** The pack `norn init` configures, and the workflows and skills it ships: the reference lists the pack alone, as it ships to every repo. */
export function freshReference(): string {
  return renderReference({ commands: COMMANDS, nouns: NOUNS, pack: PACK_NAME, catalog: packCatalog(SDLC_PACK, BUNDLED_PLUGINS) });
}

function yamlTexts(dir: string): Record<string, string> {
  if (!existsSync(dir)) return {};
  return Object.fromEntries(
    readdirSync(dir, { withFileTypes: true })
      .filter((e) => e.isFile() && /\.ya?ml$/.test(e.name))
      .map((e) => [e.name, readFileSync(join(dir, e.name), "utf8")]),
  );
}

/** This repo's own workflow files, which replace the pack's of the same name here. */
export function repoWorkflowTexts(): RepoWorkflows {
  const dir = join(ROOT, REPO_WORKFLOWS_DIR);
  return { workflows: yamlTexts(dir), shared: yamlTexts(join(dir, "shared")) };
}

/** CONTRIBUTING.md's workflow table: this repo's workflows, the pack overlaid with its own files. */
export function freshContributing(): string {
  return renderWorkflowTable(packCatalog(overlayRepoWorkflows(SDLC_PACK, repoWorkflowTexts()), BUNDLED_PLUGINS).workflows);
}

/** Every workflow of `pack` as the loader loads it with the bundled plugins' step kinds and signals; one that fails to load throws. */
export function shippedWorkflows(pack: Pack): Record<string, LoadedWorkflow> {
  const kinds = collectStepKinds(BUNDLED_PLUGINS);
  const signals = collectSignals(BUNDLED_PLUGINS);
  if (!kinds.ok) throw new Error(kinds.failure.message);
  if (!signals.ok) throw new Error(signals.failure.message);
  const loads = loadPackWorkflows(pack, kinds.value, DEFAULT_KERNEL_CONFIG, signalDeclarations(signals.value));
  if (!loads.ok) throw new Error(loads.failure.message);
  return Object.fromEntries(
    Object.entries(loads.value).map(([name, load]) => {
      if (!load.ok) throw new Error(`${name} does not load: ${JSON.stringify(load.errors)}`);
      return [name, load.workflow];
    }),
  );
}

export function freshWorkflowsPage(pack: Pack = SDLC_PACK): string {
  return renderWorkflowsPage({ pack: PACK_NAME, workflows: shippedWorkflows(pack) });
}

if (import.meta.main) {
  const blocks: Array<[string, string, MarkerPair]> = [
    [REFERENCE_FILE, freshReference(), REFERENCE_MARKERS],
    [WORKFLOWS_FILE, freshWorkflowsPage(), WORKFLOWS_MARKERS],
    [CONTRIBUTING_FILE, freshContributing(), CONTRIBUTING_MARKERS],
  ];
  for (const [rel, block, markers] of blocks) {
    const file = join(ROOT, rel);
    writeFileSync(file, replaceReference(readFileSync(file, "utf8"), block, markers));
  }
  console.log(JSON.stringify({ emitted: blocks.map(([rel]) => rel) }));
}
