/** Rewrites the generated block of docs/reference.md. Run: bun run docs:emit */
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { COMMANDS, NOUNS } from "../src/commands/index.ts";
import { REFERENCE_FILE, renderReference, replaceReference } from "../src/reference.ts";

export const ROOT = join(import.meta.dir, "..", "..", "..");
const WORKFLOWS = join(import.meta.dir, "..", "assets", "workflows");

export function shippedWorkflows(): string[] {
  return readdirSync(WORKFLOWS)
    .filter((n) => n.endsWith(".yaml"))
    .map((n) => readFileSync(join(WORKFLOWS, n), "utf8"));
}

export function freshReference(): string {
  return renderReference({ commands: COMMANDS, nouns: NOUNS, workflows: shippedWorkflows() });
}

if (import.meta.main) {
  const file = join(ROOT, REFERENCE_FILE);
  writeFileSync(file, replaceReference(readFileSync(file, "utf8"), freshReference()));
  console.log(JSON.stringify({ emitted: REFERENCE_FILE }));
}
