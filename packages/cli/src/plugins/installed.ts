/**
 * Loading the plugins a repo's lock pins from `<home>/plugins`, a bun project `norn plugin add`
 * installs into. A lock entry's `name` is the package name there; the package's module exports
 * exactly one NornPlugin, under any export name.
 */
import { join } from "node:path";
import { apiSatisfies, defineNornPlugin, type NornPlugin, type NornPluginSpec } from "@norn/plugin-api";
import type { LockEntry } from "./lock.ts";

/** Import a package by name from the plugins folder: injected so a unit test loads modules it builds in memory. */
export type PluginImporter = (name: string, pluginsDir: string) => Promise<Record<string, unknown>>;

/** Bun resolves the name as code in the plugins folder would, `exports` maps included. */
export const importFromPluginsDir: PluginImporter = async (name, pluginsDir) => {
  const entry = Bun.resolveSync(name, join(pluginsDir, "package.json"));
  return (await import(entry)) as Record<string, unknown>;
};

export type InstalledLoad =
  | { entry: LockEntry; ok: true; plugin: NornPlugin }
  /** `api`: the plugin wants another plugin API; `missing`: not installed; `invalid`: not a norn plugin */
  | { entry: LockEntry; ok: false; reason: "api" | "missing" | "invalid"; message: string; api?: string };

const looksLikePlugin = (v: unknown): v is NornPluginSpec =>
  typeof v === "object" && v !== null && typeof (v as NornPluginSpec).name === "string" && typeof (v as NornPluginSpec).api === "string" && typeof (v as NornPluginSpec).provides === "object";

const message = (e: unknown): string => (e instanceof Error ? e.message : String(e));

export async function loadInstalled(entry: LockEntry, pluginsDir: string, importer: PluginImporter, apiVersion: string): Promise<InstalledLoad> {
  let mod: Record<string, unknown>;
  try {
    mod = await importer(entry.name, pluginsDir);
  } catch (e) {
    return { entry, ok: false, reason: "missing", message: `plugin ${entry.name} is in the lock but cannot be loaded from ${pluginsDir}: ${message(e)}` };
  }
  const found = Object.values(mod).filter(looksLikePlugin);
  if (found.length !== 1)
    return { entry, ok: false, reason: "invalid", message: `plugin ${entry.name} exports ${found.length} norn plugins; it must export exactly one` };
  const spec = found[0] as NornPluginSpec;
  // checked before defineNornPlugin, which would refuse it too, so the refusal can say to update rather than that the plugin is broken
  if (!apiSatisfies(spec.api, apiVersion))
    return { entry, ok: false, reason: "api", api: spec.api, message: `plugin ${entry.name} wants plugin API ${spec.api}, but this norn implements ${apiVersion}` };
  try {
    return { entry, ok: true, plugin: defineNornPlugin(spec) };
  } catch (e) {
    return { entry, ok: false, reason: "invalid", message: message(e) };
  }
}
