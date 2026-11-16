/** Writes every published schema (`PUBLISHED_SCHEMAS`) to packages/schema/json/<name>.schema.json. Run: bun run schema:emit */
import { join } from "node:path";
import { PUBLISHED_SCHEMAS, type SchemaName, toJsonSchema } from "../src/index.ts";

export const JSON_DIR = join(import.meta.dir, "..", "json");

export function renderSchema(name: SchemaName): string {
  return `${JSON.stringify(toJsonSchema(name), null, 2)}\n`;
}

if (import.meta.main) {
  for (const name of PUBLISHED_SCHEMAS) {
    await Bun.write(join(JSON_DIR, `${name}.schema.json`), renderSchema(name));
  }
  console.log(JSON.stringify({ emitted: PUBLISHED_SCHEMAS.length, dir: JSON_DIR }));
}
