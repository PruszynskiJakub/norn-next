/**
 * The repo root: the nearest folder above this file whose package.json declares workspaces. Test
 * helpers name their pinned outputs from it, not from their own folder, so a helper and its outputs
 * can move apart and stay byte-identical (gh-118 B18, B19).
 */
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";

function findRoot(from: string): string {
  for (let dir = from; ; dir = dirname(dir)) {
    const manifest = join(dir, "package.json");
    if (existsSync(manifest) && "workspaces" in JSON.parse(readFileSync(manifest, "utf8"))) return dir;
    if (dirname(dir) === dir) throw new Error(`no workspace root above ${from}`);
  }
}

export const REPO_ROOT = findRoot(import.meta.dir);
