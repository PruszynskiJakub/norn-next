/** Rewrites the generated block of docs/reference.md. Run: bun run docs:emit */
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { SDLC_PACK } from "@norn/pack-sdlc";
import { COMMANDS, NOUNS } from "../src/commands/index.ts";
import { CONFIG_DEFAULTS } from "../src/config/schema.ts";
import { REFERENCE_FILE, REFERENCE_MARKERS, renderReference, replaceReference } from "../src/reference.ts";

export const ROOT = join(import.meta.dir, "..", "..", "..");

/** The pack `norn init` configures, and the workflows it ships. */
export function freshReference(): string {
  const pack = CONFIG_DEFAULTS.packs?.[0] ?? "sdlc";
  return renderReference({ commands: COMMANDS, nouns: NOUNS, pack, workflows: Object.values(SDLC_PACK.workflows) });
}

if (import.meta.main) {
  const file = join(ROOT, REFERENCE_FILE);
  writeFileSync(file, replaceReference(readFileSync(file, "utf8"), freshReference(), REFERENCE_MARKERS));
  console.log(JSON.stringify({ emitted: REFERENCE_FILE }));
}
