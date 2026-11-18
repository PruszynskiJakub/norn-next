/**
 * Wire norn's hooks into one worktree's `.claude/settings.local.json`. Only the local file: the
 * committed `settings.json` is the project's, and hooks there would follow the branch into every
 * clone, where the hook command may not exist.
 */
import { join } from "node:path";
import type { InstallTarget, UninstallTarget } from "@norn/plugin-api";
import { readJson, removeFile, writeJsonAtomic } from "./files.ts";
import { isObject, type JsonObject } from "./payload.ts";
import { mergeNornHooks, removeNornHooks } from "./settings.ts";

export const settingsLocalPath = (worktree: string) => join(worktree, ".claude", "settings.local.json");

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
  if (before !== null && same(before, next)) return { changed: [] };
  writeJsonAtomic(path, next);
  return { changed: [path] };
}

/** A file left empty by the strip was norn's alone, so it is removed rather than left as `{}`. */
export async function uninstall(target: UninstallTarget): Promise<{ changed: string[] }> {
  const path = settingsLocalPath(target.worktree);
  const before = readSettings(path);
  if (before === null) return { changed: [] };
  const after = removeNornHooks(before);
  if (same(before, after)) return { changed: [] };
  if (Object.keys(after).length === 0) removeFile(path);
  else writeJsonAtomic(path, after);
  return { changed: [path] };
}
