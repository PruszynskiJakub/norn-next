/**
 * The plugin lock: which installed plugins a repo runs, at which version, and the API range each was
 * written against. A bad lock is corrupt (exit 4), never read past: running a plugin the lock does
 * not pin is how two machines end up on different code.
 */
import { type HostFiles, parseJson } from "@norn/plugin-api";
import { NonEmpty } from "@norn/schema";
import { type Static, Type } from "@sinclair/typebox";
import { corruptError } from "../output.ts";

export const LockEntry = Type.Object(
  {
    name: NonEmpty,
    /** what `norn plugin add` was given: an npm spec, a git URL, or a local path */
    spec: NonEmpty,
    /** the version that spec resolved to when it was installed */
    version: NonEmpty,
    /** the plugin's own API range, as it declared it */
    api: NonEmpty,
  },
  { additionalProperties: false },
);
export type LockEntry = Static<typeof LockEntry>;

export const PluginLock = Type.Object({ format: Type.Literal(1), plugins: Type.Array(LockEntry) }, { additionalProperties: false, title: "PluginLock" });
export type PluginLock = Static<typeof PluginLock>;

export const EMPTY_LOCK: PluginLock = { format: 1, plugins: [] };

export async function readLock(files: HostFiles, path: string): Promise<PluginLock> {
  const text = await files.read(path);
  if (text === null) return EMPTY_LOCK;
  const r = parseJson(PluginLock, text, path);
  if (!r.ok) throw corruptError(`the plugin lock is unreadable: ${r.failure.message}`, "norn plugin list", undefined, "lock_corrupt");
  return r.value;
}

/** Sorted by name, so the committed lock of team mode diffs only where a plugin changed. */
export function renderLock(lock: PluginLock): string {
  const plugins = [...lock.plugins].sort((a, b) => a.name.localeCompare(b.name));
  return `${JSON.stringify({ format: 1, plugins }, null, 2)}\n`;
}

export async function writeLock(files: HostFiles, path: string, lock: PluginLock): Promise<void> {
  await files.write(path, renderLock(lock));
}

/** The lock with `entry` in place of any entry of its name. */
export function withEntry(lock: PluginLock, entry: LockEntry): PluginLock {
  return { format: 1, plugins: [...lock.plugins.filter((p) => p.name !== entry.name), entry] };
}

export function withoutEntry(lock: PluginLock, name: string): PluginLock {
  return { format: 1, plugins: lock.plugins.filter((p) => p.name !== name) };
}
