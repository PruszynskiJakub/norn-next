/**
 * Where norn's shipped assets live (§11 workflow templates, §16 skills, K2 config template).
 *
 * First match wins:
 *   1. `NORN_ASSETS_DIR` — explicit override (tests, packagers, custom skill sets);
 *   2. embedded assets of a compiled binary, extracted once into `<cache>/norn/assets-<hash>`
 *      (`/$bunfs` cannot be listed with readdirSync);
 *   3. `assets/` next to the running bundle (npm package: `dist/npm/{norn.js,assets}`);
 *   4. the source tree (`packages/cli/assets`).
 */
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { EMBEDDED_ASSETS, type EmbeddedAssets } from "./embedded-assets.ts";

/** A directory is an assets dir when it holds the config template. */
const MARKER = "config.yaml";

export interface AssetsSources {
  env: Record<string, string | undefined>;
  embedded: EmbeddedAssets | null;
  /** Directories tried in order after the override and embedded assets. */
  candidates: readonly string[];
  /** Base for extracting embedded assets (defaults to `$XDG_CACHE_HOME` or `~/.cache`). */
  cacheDir?: string;
}

function defaultAssetsSources(env: Record<string, string | undefined> = process.env): AssetsSources {
  return {
    env,
    embedded: EMBEDDED_ASSETS,
    candidates: [join(import.meta.dir, "assets"), join(import.meta.dir, "..", "..", "assets")],
  };
}

export function resolveAssetsDir(src: AssetsSources): string {
  const override = src.env.NORN_ASSETS_DIR;
  if (override) {
    const dir = resolve(override);
    if (!existsSync(join(dir, MARKER))) throw new Error(`NORN_ASSETS_DIR=${override} has no ${MARKER}; point it at a norn assets directory`);
    return dir;
  }
  if (src.embedded) {
    const cache = src.cacheDir ?? (src.env.XDG_CACHE_HOME || join(src.env.HOME || homedir(), ".cache"));
    return extractEmbedded(src.embedded, join(cache, "norn", `assets-${src.embedded.hash}`));
  }
  const found = src.candidates.find((d) => existsSync(join(d, MARKER)));
  if (!found) throw new Error(`norn assets not found (tried ${src.candidates.join(", ")}); set NORN_ASSETS_DIR`);
  return found;
}

/** Extracts once per content hash; files are staged in a temp dir and renamed into place, so concurrent runs are safe. */
function extractEmbedded(embedded: EmbeddedAssets, dir: string): string {
  if (existsSync(join(dir, MARKER))) return dir;
  const tmp = `${dir}.tmp-${process.pid}`;
  rmSync(tmp, { recursive: true, force: true });
  for (const [rel, from] of embedded.files) {
    const dest = join(tmp, rel);
    mkdirSync(dirname(dest), { recursive: true });
    writeFileSync(dest, readFileSync(from));
  }
  try {
    renameSync(tmp, dir);
  } catch {
    rmSync(tmp, { recursive: true, force: true });
    if (!existsSync(join(dir, MARKER))) throw new Error(`could not extract norn assets into ${dir}`);
  }
  return dir;
}

let cached: string | undefined;

/** The assets dir for `env` (a command's `ctx.env`); without an override it is resolved once per process. */
export function assetsDir(env: Record<string, string | undefined> = process.env): string {
  if (env.NORN_ASSETS_DIR) return resolveAssetsDir(defaultAssetsSources(env));
  cached ??= resolveAssetsDir(defaultAssetsSources(env));
  return cached;
}
