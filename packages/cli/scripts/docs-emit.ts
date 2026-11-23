/** Rewrites the generated blocks of docs/reference.md and CONTRIBUTING.md. Run: bun run docs:emit */
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { SDLC_PACK } from "@norn/pack-sdlc";
import { overlayRepoWorkflows, REPO_WORKFLOWS_DIR, type RepoWorkflows } from "@norn/runtime";
import { packCatalog } from "../src/catalog.ts";
import { COMMANDS, NOUNS } from "../src/commands/index.ts";
import { CONFIG_DEFAULTS } from "../src/config/schema.ts";
import { BUNDLED_PLUGINS } from "../src/plugins/bundled.ts";
import { CONTRIBUTING_FILE, CONTRIBUTING_MARKERS, REFERENCE_FILE, REFERENCE_MARKERS, renderReference, renderWorkflowTable, replaceReference } from "../src/reference.ts";

export const ROOT = join(import.meta.dir, "..", "..", "..");

/** The pack `norn init` configures, and the workflows and skills it ships: the reference lists the pack alone, as it ships to every repo. */
export function freshReference(): string {
  const pack = CONFIG_DEFAULTS.packs?.[0] ?? "sdlc";
  return renderReference({ commands: COMMANDS, nouns: NOUNS, pack, catalog: packCatalog(SDLC_PACK, BUNDLED_PLUGINS) });
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

if (import.meta.main) {
  for (const [file, block, markers] of [
    [REFERENCE_FILE, freshReference(), REFERENCE_MARKERS],
    [CONTRIBUTING_FILE, freshContributing(), CONTRIBUTING_MARKERS],
  ] as const) {
    const path = join(ROOT, file);
    writeFileSync(path, replaceReference(readFileSync(path, "utf8"), block, markers));
  }
  console.log(JSON.stringify({ emitted: [REFERENCE_FILE, CONTRIBUTING_FILE] }));
}
