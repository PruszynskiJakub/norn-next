/**
 * Which plugins a command runs with, checked before any of them is asked to do anything: every
 * configured plugin installed and on this norn's plugin API, and every name the config picks
 * provided by exactly one of them. Each refusal names the command that fixes it.
 */
import type { WorkflowLoad } from "@norn/kernel";
import type { NornPlugin } from "@norn/plugin-api";
import { runnerPicks } from "../config/derive.ts";
import type { NornConfig } from "../config/schema.ts";
import { type CliFailure, refuse } from "../output.ts";
import type { InstalledLoad } from "./installed.ts";
import type { PluginLock } from "./lock.ts";

type ProvidesKey = keyof NornPlugin["provides"];

/** What the config picks, by the slot that provides it. */
export function picks(config: NornConfig): Array<{ slot: ProvidesKey; noun: string; name: string; at: string }> {
  const out: Array<{ slot: ProvidesKey; noun: string; name: string; at: string }> = [
    { slot: "tracker", noun: "tracker", name: config.tracker.use, at: "tracker.use" },
    { slot: "forge", noun: "forge", name: config.forge.use, at: "forge.use" },
    { slot: "store", noun: "store", name: config.store.use, at: "store.use" },
    { slot: "vcs", noun: "vcs", name: config.vcs.use, at: "vcs.use" },
  ];
  for (const [name, e] of Object.entries(config.executors)) out.push({ slot: "harness", noun: "harness", name: e.harness, at: `executors.${name}.harness` });
  for (const r of runnerPicks(config)) out.push({ slot: "runners", noun: "runner", ...r });
  for (const pack of config.packs) out.push({ slot: "packs", noun: "pack", name: pack, at: "packs" });
  return out;
}

const offered = (plugins: readonly NornPlugin[], slot: ProvidesKey): string[] =>
  [...new Set(plugins.flatMap((p) => Object.keys((p.provides[slot] as Record<string, unknown> | undefined) ?? {})))].sort();

export interface ResolveInput {
  config: NornConfig;
  bundled: readonly NornPlugin[];
  lock: PluginLock;
  installed: readonly InstalledLoad[];
}

export type Resolution = { ok: true; plugins: NornPlugin[] } | { ok: false; failure: CliFailure };

const no = (failure: CliFailure): Resolution => ({ ok: false, failure });

export function resolvePlugins({ config, bundled, lock, installed }: ResolveInput): Resolution {
  const bundledNames = new Set(bundled.map((p) => p.name));
  for (const [name, spec] of Object.entries(config.plugins)) {
    if (bundledNames.has(name)) return no(refuse(`plugin ${name} is bundled with norn; \`plugins.${name}\` would replace it`, `norn config set plugins.${name} --unset`, "plugin_bundled"));
    if (!lock.plugins.some((e) => e.name === name)) return no(refuse(`plugin ${name} is configured but not installed`, `norn plugin add ${spec}`, "plugin_missing"));
  }
  const plugins: NornPlugin[] = [...bundled];
  for (const load of installed) {
    if (!load.ok) {
      if (load.reason === "api") return no(refuse(load.message, `norn plugin update ${load.entry.name}`, "plugin_api", { plugin: load.entry.name, wants: load.api }));
      if (load.reason === "missing") return no(refuse(load.message, `norn plugin add ${load.entry.spec}`, "plugin_missing", { plugin: load.entry.name }));
      return no(refuse(load.message, `norn plugin remove ${load.entry.name}`, "plugin_invalid", { plugin: load.entry.name }));
    }
    const clash = plugins.find((p) => p.name === load.plugin.name);
    if (clash) return no(refuse(`two plugins are named ${clash.name}`, `norn plugin remove ${load.entry.name}`, "plugin_clash"));
    plugins.push(load.plugin);
  }
  for (const pick of picks(config)) {
    const by = plugins.filter((p) => (p.provides[pick.slot] as Record<string, unknown> | undefined)?.[pick.name] !== undefined);
    if (by.length === 1) continue;
    if (by.length > 1)
      return no(refuse(`${pick.noun} ${pick.name} is provided by ${by.map((p) => p.name).join(" and ")}`, `norn plugin remove <one of ${by.map((p) => p.name).join(", ")}>`, "plugin_clash"));
    const have = offered(plugins, pick.slot);
    return no(
      refuse(
        `no plugin provides ${pick.noun} ${pick.name} (\`${pick.at}\`)${have.length ? `; available: ${have.join(", ")}` : ""}`,
        `norn plugin add <the plugin that provides ${pick.noun} ${pick.name}>, or norn config set ${pick.at} <one of ${have.join(", ") || "none"}>`,
        "slot_unresolved",
        { slot: pick.noun, name: pick.name, available: have },
      ),
    );
  }
  return { ok: true, plugins };
}

/** A workflow naming a step kind no plugin provides: a refusal naming the kind and the workflow, so a person knows what to add. */
export function missingStepKinds(byName: Readonly<Record<string, WorkflowLoad>>): CliFailure | null {
  const missing: Array<{ workflow: string; kind: string }> = [];
  for (const [workflow, load] of Object.entries(byName)) {
    if (load.ok) continue;
    for (const e of load.errors) if (e.missing_kind) missing.push({ workflow, kind: e.missing_kind });
  }
  if (missing.length === 0) return null;
  const kinds = [...new Set(missing.map((m) => m.kind))];
  return refuse(
    `${missing.map((m) => `workflow ${m.workflow} uses step kind ${m.kind}`).join("; ")}, which no configured plugin provides`,
    `norn plugin add <the plugin that provides step kind ${kinds.join(", ")}>`,
    "step_kind_missing",
    { missing },
  );
}
