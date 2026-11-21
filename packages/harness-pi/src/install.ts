/**
 * Install norn's extension in one worktree's `.pi/extensions/norn/`, a folder norn owns whole: pi
 * discovers `<folder>/index.ts` there, and the folder's own `.gitignore` keeps both files out of the
 * branch, where an agent's `git add -A` would otherwise commit a hook command that a clone may not have.
 */
import { dirname, join } from "node:path";
import type { InstallTarget, UninstallTarget } from "@norn/plugin-api";
import { EXTENSION_MARKER, extensionSource } from "./extension.ts";
import { readText, removeFile, removeIfEmpty, writeTextAtomic } from "./files.ts";

export const extensionDir = (worktree: string) => join(worktree, ".pi", "extensions", "norn");
export const extensionPath = (worktree: string) => join(extensionDir(worktree), "index.ts");
export const gitignorePath = (worktree: string) => join(extensionDir(worktree), ".gitignore");

// ignores itself too, so the folder leaves the worktree clean
const GITIGNORE = "# norn-owned: the pi extension norn installs stays out of git\n*\n";

const isNorns = (text: string | null): boolean => text !== null && text.startsWith(EXTENSION_MARKER);

/** norn's extension is the agent's hooks whole, so its text is what a run pins. */
export async function hookConfig(worktree: string): Promise<string | null> {
  return readText(extensionPath(worktree));
}

/** A file there that norn did not write is a person's extension: refused, never overwritten. */
function ownedOrAbsent(path: string, text: string | null, owned: boolean): void {
  if (text !== null && !owned) throw new Error(`${path} exists and is not norn's; move it out of .pi/extensions/norn`);
}

export async function install(target: InstallTarget): Promise<{ changed: string[] }> {
  const ext = extensionPath(target.worktree);
  const ignore = gitignorePath(target.worktree);
  const extText = readText(ext);
  const ignoreText = readText(ignore);
  ownedOrAbsent(ext, extText, isNorns(extText));
  ownedOrAbsent(ignore, ignoreText, ignoreText === GITIGNORE);
  const changed: string[] = [];
  // the ignore file first: an extension that lands before it would show as a change to commit
  if (ignoreText !== GITIGNORE) {
    writeTextAtomic(ignore, GITIGNORE);
    changed.push(ignore);
  }
  const source = extensionSource(target.hookCommand);
  if (extText !== source) {
    writeTextAtomic(ext, source);
    changed.push(ext);
  }
  return { changed };
}

/** Removes norn's two files, then each folder they leave empty; a person's file keeps its folder. */
export async function uninstall(target: UninstallTarget): Promise<{ changed: string[] }> {
  const ext = extensionPath(target.worktree);
  const ignore = gitignorePath(target.worktree);
  const changed: string[] = [];
  if (isNorns(readText(ext))) {
    removeFile(ext);
    changed.push(ext);
  }
  if (readText(ignore) === GITIGNORE) {
    removeFile(ignore);
    changed.push(ignore);
  }
  if (changed.length === 0) return { changed };
  const dir = extensionDir(target.worktree);
  removeIfEmpty(dir);
  removeIfEmpty(dirname(dir));
  removeIfEmpty(dirname(dirname(dir)));
  return { changed };
}
