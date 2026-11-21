/**
 * The effects an installed plugin's step kinds declare, as the person accepted them at `norn plugin
 * add` (or `update`). The floor a workflow loads on reads a kind's effects from its plugin, so a plugin
 * that later declared fewer would quietly move the person's step away from what reaches past the
 * repo; a plugin whose kinds declare other effects than the person accepted is refused until they
 * accept them again. Kept in the norn home, which no worktree or committed file reaches. The kinds
 * over a slot are not the plugin's to declare: the core fixes theirs.
 */
import { join } from "node:path";
import { type HostFiles, KIND_EFFECTS, type KindEffect, type NornPlugin, parseJson } from "@norn/plugin-api";
import { NonEmpty } from "@norn/schema";
import { type Static, Type } from "@sinclair/typebox";
import { homePaths } from "../home.ts";
import { corruptError, refuse } from "../output.ts";
import type { LockEntry } from "./lock.ts";

export const AcceptedPlugin = Type.Object(
  {
    format: Type.Literal(1),
    /** the plugin's own name, which names its kinds (`vercel.preview`) */
    plugin: NonEmpty,
    version: NonEmpty,
    /** each kind the plugin names itself → the effects it declared */
    effects: Type.Record(NonEmpty, Type.Array(Type.Union(KIND_EFFECTS.map((e) => Type.Literal(e))))),
  },
  { additionalProperties: false, title: "AcceptedPlugin" },
);
export type AcceptedPlugin = Static<typeof AcceptedPlugin>;

/** Where the person's acceptance of a plugin lives; a package name may hold a scope's `/`. */
export const acceptedPluginPath = (home: string, name: string): string => join(homePaths(home).plugins, "accepted", `${encodeURIComponent(name)}.json`);

/** Each kind the plugin names by itself → its declared effects, sorted, so equal declarations compare equal. */
export function pluginEffects(plugin: NornPlugin): Record<string, KindEffect[]> {
  const out: Record<string, KindEffect[]> = {};
  for (const [key, kind] of Object.entries(plugin.provides.stepKinds ?? {})) {
    if (kind.slot !== undefined) continue;
    out[`${plugin.name}.${key}`] = [...(kind.effects ?? [])].sort();
  }
  return out;
}

/** `vercel.preview: outward; vercel.bill: cost, outward`, or `none` when no kind declares an effect. */
export function effectsText(effects: Readonly<Record<string, readonly KindEffect[]>>): string {
  const named = Object.entries(effects).filter(([, e]) => e.length > 0);
  return named.length === 0 ? "none" : named.map(([k, e]) => `${k}: ${e.join(", ")}`).join("; ");
}

export async function readAccepted(files: HostFiles, home: string, name: string): Promise<AcceptedPlugin | null> {
  const path = acceptedPluginPath(home, name);
  const text = await files.read(path);
  if (text === null) return null;
  const r = parseJson(AcceptedPlugin, text, path);
  if (!r.ok) throw corruptError(`the accepted effects of plugin ${name} are unreadable: ${r.failure.message}`, `norn plugin update ${name}`, undefined, "plugin_accepted_corrupt");
  return r.value;
}

export async function writeAccepted(files: HostFiles, home: string, entry: LockEntry, plugin: NornPlugin): Promise<AcceptedPlugin> {
  const record: AcceptedPlugin = { format: 1, plugin: plugin.name, version: entry.version, effects: pluginEffects(plugin) };
  await files.write(acceptedPluginPath(home, entry.name), `${JSON.stringify(record, null, 2)}\n`);
  return record;
}

function differences(accepted: Readonly<Record<string, readonly KindEffect[]>>, now: Readonly<Record<string, readonly KindEffect[]>>): string[] {
  const words = (e: readonly KindEffect[] | undefined) => (e === undefined || e.length === 0 ? "no effects" : e.join(", "));
  const out: string[] = [];
  for (const kind of [...new Set([...Object.keys(accepted), ...Object.keys(now)])].sort()) {
    const was = accepted[kind] ?? [];
    const is = now[kind] ?? [];
    if (was.join() !== is.join()) out.push(`${kind} declares ${is.length === 0 ? "no effects" : is.join(", ")}, where you accepted ${words(was)}`);
  }
  return out;
}

/**
 * Refuses an installed plugin whose kinds declare other effects than the person accepted. One added
 * before acceptance was recorded loads while its kinds declare none, as it changes nothing a floor
 * reads; once one declares an effect, the person accepts it first.
 */
export async function checkAccepted(files: HostFiles, home: string, entry: LockEntry, plugin: NornPlugin): Promise<void> {
  const now = pluginEffects(plugin);
  const accepted = await readAccepted(files, home, entry.name);
  const diff = accepted === null ? differences({}, now).filter((d) => !d.includes(" declares no effects,")) : differences(accepted.effects, now);
  if (diff.length === 0) return;
  throw refuse(
    `plugin ${entry.name}'s step kinds declare effects you have not accepted: ${diff.join("; ")}`,
    `norn plugin update ${entry.name}`,
    "plugin_effects",
    { plugin: entry.name },
  );
}
