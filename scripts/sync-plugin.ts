/**
 * Copies the bundled skills (packages/cli/assets/skills, §16) into the Claude Code plugin (X3),
 * and keeps the plugin version equal to @norn/cli's. The plugin holds no logic of its own.
 *
 *   bun scripts/sync-plugin.ts          write the copy
 *   bun scripts/sync-plugin.ts --check  exit 1 if the copy is stale (also run by the test suite)
 */
import { cpSync, existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { listFiles } from "./build.ts";

const ROOT = resolve(import.meta.dir, "..");
const SRC = join(ROOT, "packages", "cli", "assets", "skills");
const PLUGIN = join(ROOT, "plugins", "claude-code");
const DEST = join(PLUGIN, "skills");
const MANIFEST = join(PLUGIN, ".claude-plugin", "plugin.json");

const cliVersion = () => (JSON.parse(readFileSync(join(ROOT, "packages", "cli", "package.json"), "utf8")) as { version: string }).version;
const readManifest = () => JSON.parse(readFileSync(MANIFEST, "utf8")) as Record<string, unknown>;

/** Every way the plugin differs from the source of truth; empty when in sync. */
export function pluginDrift(): string[] {
  const drift: string[] = [];
  const src = listFiles(SRC);
  const dest = existsSync(DEST) ? listFiles(DEST) : [];
  for (const f of src) {
    if (!dest.includes(f)) drift.push(`missing skills/${f}`);
    else if (!readFileSync(join(SRC, f)).equals(readFileSync(join(DEST, f)))) drift.push(`changed skills/${f}`);
  }
  for (const f of dest) if (!src.includes(f)) drift.push(`extra skills/${f}`);
  const v = readManifest().version;
  if (v !== cliVersion()) drift.push(`plugin.json version ${String(v)} != @norn/cli ${cliVersion()}`);
  return drift;
}

export function syncPlugin(): void {
  rmSync(DEST, { recursive: true, force: true });
  cpSync(SRC, DEST, { recursive: true });
  const m = readManifest();
  if (m.version !== cliVersion()) writeFileSync(MANIFEST, `${JSON.stringify({ ...m, version: cliVersion() }, null, 2)}\n`);
}

if (import.meta.main) {
  if (process.argv.includes("--check")) {
    const drift = pluginDrift();
    for (const d of drift) console.error(d);
    if (drift.length) {
      console.error("plugin is stale: run `bun run sync:plugin`");
      process.exit(1);
    }
  } else {
    syncPlugin();
    console.error("synced plugins/claude-code/skills");
  }
}
