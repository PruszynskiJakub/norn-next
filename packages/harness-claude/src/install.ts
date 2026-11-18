/**
 * Wire norn's hooks into one worktree's `.claude/settings.local.json`. Only the local file: the
 * committed `settings.json` is the project's, and hooks there would follow the branch into every
 * clone, where the hook command may not exist.
 *
 * Git sees the local file as untracked unless something ignores it, and an untracked file makes the
 * worktree dirty (a branch update refuses it) and lets an agent's `git add -A` commit norn's hooks.
 * So `.claude/` gets a `.gitignore` under OWNER_MARK naming the local file and itself. A
 * `.gitignore` there without the mark is the repo's and is never rewritten.
 */
import { dirname, join } from "node:path";
import type { InstallTarget, UninstallTarget } from "@norn/plugin-api";
import { readJson, readText, removeFile, removeIfEmpty, writeJsonAtomic, writeTextAtomic } from "./files.ts";
import { isObject, type JsonObject } from "./payload.ts";
import { mergeNornHooks, removeNornHooks } from "./settings.ts";

/** the settings file norn wires hooks into, relative to a worktree */
export const LOCAL_SETTINGS = ".claude/settings.local.json";
export const settingsLocalPath = (worktree: string) => join(worktree, LOCAL_SETTINGS);
export const gitignorePath = (worktree: string) => join(worktree, ".claude", ".gitignore");

const OWNER_MARK = "# norn: keeps the hooks norn wires into settings.local.json out of git";
const GITIGNORE = `${OWNER_MARK}\n/.gitignore\n/settings.local.json\n`;

const ownedOrAbsent = (text: string | null): boolean => text === null || text.startsWith(OWNER_MARK);

/** The ignore goes in before the settings: a settings file landing first would show as a change to commit. */
function ignoreSettings(worktree: string, changed: string[]): void {
  const path = gitignorePath(worktree);
  const text = readText(path);
  if (text === GITIGNORE || !ownedOrAbsent(text)) return;
  writeTextAtomic(path, GITIGNORE);
  changed.push(path);
}

/** A file that is not a JSON object is refused, never overwritten: it holds a person's settings. */
function readSettings(path: string): JsonObject | null {
  const value = readJson(path);
  if (value === null || value === undefined) return null;
  if (!isObject(value)) throw new Error(`${path} does not hold a JSON object; fix or remove it`);
  return value;
}

const same = (a: JsonObject, b: JsonObject) => JSON.stringify(a) === JSON.stringify(b);

export async function install(target: InstallTarget): Promise<{ changed: string[] }> {
  const path = settingsLocalPath(target.worktree);
  const before = readSettings(path);
  const next = mergeNornHooks(before ?? {}, target.hookCommand);
  const changed: string[] = [];
  ignoreSettings(target.worktree, changed);
  if (before !== null && same(before, next)) return { changed };
  writeJsonAtomic(path, next);
  changed.push(path);
  return { changed };
}

/**
 * A file left empty by the strip was norn's alone, so it is removed rather than left as `{}`. norn's
 * ignore stays while a local file is there, as it is what keeps a person's settings out of the branch.
 */
export async function uninstall(target: UninstallTarget): Promise<{ changed: string[] }> {
  const path = settingsLocalPath(target.worktree);
  const before = readSettings(path);
  const changed: string[] = [];
  if (before !== null) {
    const after = removeNornHooks(before);
    if (!same(before, after)) {
      if (Object.keys(after).length === 0) removeFile(path);
      else writeJsonAtomic(path, after);
      changed.push(path);
    }
  }
  const ignore = gitignorePath(target.worktree);
  const ignoreText = readText(ignore);
  if (ignoreText !== null && ownedOrAbsent(ignoreText) && readText(path) === null) {
    removeFile(ignore);
    changed.push(ignore);
  }
  if (changed.length > 0) removeIfEmpty(dirname(path));
  return { changed };
}
