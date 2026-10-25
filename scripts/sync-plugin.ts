/**
 * Keeps the Claude Code plugin (X3) version equal to @norn/cli's. The plugin ships only the /norn
 * command: skills come from the repo (`.agents/skills/`, linked into `.claude/skills/` by
 * `norn init`, SK1), so the plugin never brings a second copy of them.
 *
 *   bun scripts/sync-plugin.ts          write the version
 *   bun scripts/sync-plugin.ts --check  exit 1 if the plugin is stale (also run by the test suite)
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

const ROOT = resolve(import.meta.dir, "..");
const PLUGIN = join(ROOT, "plugins", "claude-code");
const MANIFEST = join(PLUGIN, ".claude-plugin", "plugin.json");

const cliVersion = () => (JSON.parse(readFileSync(join(ROOT, "packages", "cli", "package.json"), "utf8")) as { version: string }).version;
const readManifest = () => JSON.parse(readFileSync(MANIFEST, "utf8")) as Record<string, unknown>;

/** Every way the plugin differs from what it should be; empty when in sync. */
export function pluginDrift(): string[] {
  const drift: string[] = [];
  if (existsSync(join(PLUGIN, "skills"))) drift.push("plugin has a skills/ folder: skills come from the repo (norn init)");
  const v = readManifest().version;
  if (v !== cliVersion()) drift.push(`plugin.json version ${String(v)} != @norn/cli ${cliVersion()}`);
  return drift;
}

export function syncPlugin(): void {
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
    console.error("synced plugins/claude-code/.claude-plugin/plugin.json");
  }
}
