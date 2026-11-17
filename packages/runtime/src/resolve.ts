/**
 * Turning the config's slot names into working providers. Every name is looked up across the
 * configured plugins, and a name no plugin provides is a refusal that names it, so a typo in the
 * config fails before the first tick rather than as a missing effect midway through a run.
 */
import { DEFAULT_KERNEL_CONFIG, type KernelWorkflows, loadWorkflow, type WorkflowLoad } from "@norn/kernel";
import {
  createForge,
  createStore,
  createTracker,
  createVcs,
  fail,
  type Forge,
  type Harness,
  type HostContext,
  type NornPlugin,
  ok,
  type Pack,
  type PluginResult,
  type StepKindDefinition,
  type Store,
  type Tracker,
  type Vcs,
} from "@norn/plugin-api";
import { parse } from "yaml";
import type { RuntimeConfig } from "./types.ts";

export interface ResolvedSlots {
  tracker: Tracker;
  forge: Forge;
  store: Store;
  vcs: Vcs;
  executors: Readonly<Record<string, Harness>>;
  stepKinds: Readonly<Record<string, StepKindDefinition>>;
  pack: Pack;
}

type SlotName = "tracker" | "forge" | "store" | "vcs" | "harness" | "packs";

/** The one plugin providing `name` in `slot`; two plugins offering the same name is a refusal, never a pick. */
function find<T>(plugins: readonly NornPlugin[], slot: SlotName, name: string): PluginResult<T> {
  const offering = plugins.filter((p) => (p.provides[slot] as Record<string, unknown> | undefined)?.[name] !== undefined);
  if (offering.length === 0) return fail("not_found", `no configured plugin provides ${slot === "packs" ? "pack" : slot} ${JSON.stringify(name)}`);
  if (offering.length > 1) return fail("invalid", `${slot} ${JSON.stringify(name)} is provided by ${offering.map((p) => p.name).join(" and ")}`);
  return ok((offering[0]?.provides[slot] as Record<string, T>)[name] as T);
}

/** Every step kind the plugins provide; two plugins giving one head key is a refusal, since a workflow could not say which it means. */
export function collectStepKinds(plugins: readonly NornPlugin[]): PluginResult<Readonly<Record<string, StepKindDefinition>>> {
  const out: Record<string, StepKindDefinition> = {};
  const by: Record<string, string> = {};
  for (const p of plugins) {
    for (const [key, kind] of Object.entries(p.provides.stepKinds ?? {})) {
      if (by[key] !== undefined) return fail("invalid", `step kind ${key} is provided by ${by[key]} and ${p.name}`);
      by[key] = p.name;
      out[key] = kind;
    }
  }
  return ok(out);
}

export function resolveSlots(ctx: HostContext, plugins: readonly NornPlugin[], config: RuntimeConfig): PluginResult<ResolvedSlots> {
  const trackerF = find<Parameters<typeof createTracker>[0]>(plugins, "tracker", config.tracker.name);
  if (!trackerF.ok) return trackerF;
  const forgeF = find<Parameters<typeof createForge>[0]>(plugins, "forge", config.forge.name);
  if (!forgeF.ok) return forgeF;
  const storeF = find<Parameters<typeof createStore>[0]>(plugins, "store", config.store.name);
  if (!storeF.ok) return storeF;
  const vcsF = find<Parameters<typeof createVcs>[0]>(plugins, "vcs", config.vcs.name);
  if (!vcsF.ok) return vcsF;
  const pack = find<Pack>(plugins, "packs", config.pack);
  if (!pack.ok) return pack;
  const executors: Record<string, Harness> = {};
  // an executor is the name a step's `by:` selects; the harness it runs on is the one its choice names
  for (const [executor, choice] of Object.entries(config.executors)) {
    const h = find<Harness>(plugins, "harness", choice.name);
    if (!h.ok) return h;
    executors[executor] = h.value;
  }
  const stepKinds = collectStepKinds(plugins);
  if (!stepKinds.ok) return stepKinds;
  const tracker = createTracker(trackerF.value, ctx, config.tracker.config ?? {});
  if (!tracker.ok) return tracker;
  const forge = createForge(forgeF.value, ctx, config.forge.config ?? {});
  if (!forge.ok) return forge;
  const store = createStore(storeF.value, ctx, config.store.config ?? {});
  if (!store.ok) return store;
  const vcs = createVcs(vcsF.value, ctx, config.vcs.config ?? {});
  if (!vcs.ok) return vcs;
  return ok({ tracker: tracker.value, forge: forge.value, store: store.value, vcs: vcs.value, executors, stepKinds: stepKinds.value, pack: pack.value });
}

function parseYaml(file: string, text: string): PluginResult<unknown> {
  try {
    return ok(parse(text) as unknown);
  } catch (e) {
    return fail("invalid", `${file}: ${e instanceof Error ? e.message : String(e)}`, false);
  }
}

/**
 * Load every workflow of a pack by its file name without the extension. A workflow that fails to load
 * is kept as its failure, not dropped: decide parks a story that asks for it and says why.
 */
export function loadPackWorkflows(
  pack: Pack,
  stepKinds: Readonly<Record<string, StepKindDefinition>>,
  config: Pick<RuntimeConfig["kernel"], "counterDefaults" | "maxNudges" | "maxRetries" | "deadlineMs"> = DEFAULT_KERNEL_CONFIG,
): PluginResult<KernelWorkflows["byName"]> {
  const sharedFiles: Record<string, unknown> = {};
  for (const [file, text] of Object.entries(pack.shared)) {
    const doc = parseYaml(`shared/${file}`, text);
    if (!doc.ok) return doc;
    sharedFiles[file.replace(/\.ya?ml$/, "")] = doc.value;
  }
  const byName: Record<string, WorkflowLoad> = {};
  for (const [file, text] of Object.entries(pack.workflows)) {
    const doc = parseYaml(file, text);
    if (!doc.ok) return doc;
    byName[file.replace(/\.ya?ml$/, "")] = loadWorkflow(doc.value, { stepKinds, sharedFiles, config });
  }
  return ok(byName);
}
