import { fail, type PluginResult } from "@norn/plugin-api";
import type { MutateOptions } from "./cell.ts";
import type { Git } from "./git.ts";

/** What every part of the store shares: git, the host clock, the remote and commit messages. */
export interface RefsContext extends MutateOptions {
  git: Git;
  now: () => string;
  remote: string;
}

export function invalid<T>(why: string): PluginResult<T> {
  return fail("invalid", `refs store: ${why}`, false);
}

export function conflict<T>(why: string): PluginResult<T> {
  return fail("conflict", `refs store: ${why}`, false);
}

/** A record the store wrote that no longer reads back: the unit is corrupt, never guessed at. */
export function corrupt<T>(why: string): PluginResult<T> {
  return fail("invalid", `refs store: corrupt record: ${why}`, false);
}

/** The JSON text of a value the kernel handed over, or null when it has none (undefined, a function, a cycle, a bigint). */
export function toJson(data: unknown): string | null {
  try {
    return JSON.stringify(data) ?? null;
  } catch {
    return null;
  }
}
