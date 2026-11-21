/**
 * Turning the config's slot names into working providers. Every name is looked up across the
 * configured plugins, and a name no plugin provides is a refusal that names it, so a typo in the
 * config fails before the first tick rather than as a missing effect midway through a run.
 */
import { DEFAULT_KERNEL_CONFIG, type KernelWorkflows, loadWorkflow, type WorkflowError, type WorkflowLoad } from "@norn/kernel";
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
  type SignalDeclaration,
  type SignalSourceDefinition,
  type StepKindDefinition,
  type Store,
  type Tracker,
  type Vcs,
} from "@norn/plugin-api";
import { parse } from "yaml";
import { HOST_INPUTS, SPEC_FOLDER_FILES } from "./inputs.ts";
import type { RuntimeConfig } from "./types.ts";

export interface ResolvedSlots {
  tracker: Tracker;
  forge: Forge;
  store: Store;
  vcs: Vcs;
  executors: Readonly<Record<string, Harness>>;
  stepKinds: Readonly<Record<string, ProvidedStepKind>>;
  /** the signal sources the plugins provide, by signal name; the host's own (vcs, clock) are not among them */
  signals: Readonly<Record<string, ProvidedSignal>>;
  pack: Pack;
}

/** A plugin's step kind with the namespace a workflow file names it by (`vcs` in `vcs.update-branch`). */
export type ProvidedStepKind = StepKindDefinition & { namespace?: string };

/** A plugin's signal source with the plugin that provides it, the `source` its signals name. */
export interface ProvidedSignal {
  source: string;
  def: SignalSourceDefinition;
}

export type SlotName = "tracker" | "forge" | "store" | "vcs" | "harness" | "packs" | "runners";

const SLOT_NOUN: Partial<Record<SlotName, string>> = { packs: "pack", runners: "runner" };

/** The one plugin providing `name` in `slot`; two plugins offering the same name is a refusal, never a pick. */
export function findProvided<T>(plugins: readonly NornPlugin[], slot: SlotName, name: string): PluginResult<T> {
  const offering = plugins.filter((p) => (p.provides[slot] as Record<string, unknown> | undefined)?.[name] !== undefined);
  if (offering.length === 0) return fail("not_found", `no configured plugin provides ${SLOT_NOUN[slot] ?? slot} ${JSON.stringify(name)}`);
  if (offering.length > 1) return fail("invalid", `${slot} ${JSON.stringify(name)} is provided by ${offering.map((p) => p.name).join(" and ")}`);
  return ok((offering[0]?.provides[slot] as Record<string, T>)[name] as T);
}

/** Every step kind the plugins provide; two plugins giving one head key is a refusal, since a workflow could not say which it means. */
export function collectStepKinds(plugins: readonly NornPlugin[]): PluginResult<Readonly<Record<string, ProvidedStepKind>>> {
  const out: Record<string, ProvidedStepKind> = {};
  const by: Record<string, string> = {};
  for (const p of plugins) {
    for (const [key, kind] of Object.entries(p.provides.stepKinds ?? {})) {
      if (by[key] !== undefined) return fail("invalid", `step kind ${key} is provided by ${by[key]} and ${p.name}`);
      by[key] = p.name;
      // a kind over a slot is named by the slot, so a workflow moves between providers unchanged
      out[key] = { ...kind, namespace: kind.slot ?? p.name };
    }
  }
  return ok(out);
}

/** Every signal source the plugins provide; two plugins giving one signal name is a refusal, since an `on:` entry could not say which it means. */
export function collectSignals(plugins: readonly NornPlugin[]): PluginResult<Readonly<Record<string, ProvidedSignal>>> {
  const out: Record<string, ProvidedSignal> = {};
  for (const p of plugins) {
    for (const [key, def] of Object.entries(p.provides.signals ?? {})) {
      const had = out[key];
      if (had !== undefined) return fail("invalid", `signal ${key} is provided by ${had.source} and ${p.name}`);
      out[key] = { source: p.name, def };
    }
  }
  return ok(out);
}

/** What the workflow loader reads of the plugins' signals: each name, who reports it, and the parameters an `on:` entry may give it. */
export function signalDeclarations(signals: Readonly<Record<string, ProvidedSignal>>): Record<string, SignalDeclaration> {
  return Object.fromEntries(
    Object.entries(signals).map(([name, s]) => [name, { name, source: s.source, namespace: s.def.slot ?? s.source, ...(s.def.params !== undefined && { params: s.def.params }) }]),
  );
}

export function resolveSlots(ctx: HostContext, plugins: readonly NornPlugin[], config: RuntimeConfig): PluginResult<ResolvedSlots> {
  const trackerF = findProvided<Parameters<typeof createTracker>[0]>(plugins, "tracker", config.tracker.name);
  if (!trackerF.ok) return trackerF;
  const forgeF = findProvided<Parameters<typeof createForge>[0]>(plugins, "forge", config.forge.name);
  if (!forgeF.ok) return forgeF;
  const storeF = findProvided<Parameters<typeof createStore>[0]>(plugins, "store", config.store.name);
  if (!storeF.ok) return storeF;
  const vcsF = findProvided<Parameters<typeof createVcs>[0]>(plugins, "vcs", config.vcs.name);
  if (!vcsF.ok) return vcsF;
  const pack = findProvided<Pack>(plugins, "packs", config.pack);
  if (!pack.ok) return pack;
  const executors: Record<string, Harness> = {};
  // an executor is the name a step's `by:` selects; the harness it runs on is the one its choice names
  for (const [executor, choice] of Object.entries(config.executors)) {
    const h = findProvided<Harness>(plugins, "harness", choice.name);
    if (!h.ok) return h;
    executors[executor] = h.value;
  }
  const stepKinds = collectStepKinds(plugins);
  if (!stepKinds.ok) return stepKinds;
  const signals = collectSignals(plugins);
  if (!signals.ok) return signals;
  const tracker = createTracker(trackerF.value, ctx, config.tracker.config ?? {});
  if (!tracker.ok) return tracker;
  const forge = createForge(forgeF.value, ctx, config.forge.config ?? {});
  if (!forge.ok) return forge;
  const store = createStore(storeF.value, ctx, config.store.config ?? {});
  if (!store.ok) return store;
  const vcs = createVcs(vcsF.value, ctx, config.vcs.config ?? {});
  if (!vcs.ok) return vcs;
  return ok({ tracker: tracker.value, forge: forge.value, store: store.value, vcs: vcs.value, executors, stepKinds: stepKinds.value, signals: signals.value, pack: pack.value });
}

function parseYaml(text: string): { ok: true; value: unknown } | { ok: false; message: string } {
  try {
    return { ok: true, value: parse(text) as unknown };
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : String(e) };
  }
}

/**
 * Load every workflow of a pack by its file name without the extension. A workflow that fails to load
 * is kept as its failure, not dropped, and so is one whose file does not parse: decide parks a story
 * that asks for it and says why, and the host names the file to the person rather than refusing every
 * command over one file. A shared file that does not parse is named in the failure of every workflow
 * that does not load without it.
 */
export function loadPackWorkflows(
  pack: Pack,
  stepKinds: Readonly<Record<string, ProvidedStepKind>>,
  config: Pick<RuntimeConfig["kernel"], "counterDefaults" | "maxNudges" | "maxRetries" | "deadlineMs"> = DEFAULT_KERNEL_CONFIG,
  signals: Readonly<Record<string, SignalDeclaration>> = {},
): PluginResult<KernelWorkflows["byName"]> {
  const sharedFiles: Record<string, unknown> = {};
  const sharedBroken: WorkflowError[] = [];
  for (const [file, text] of Object.entries(pack.shared)) {
    const doc = parseYaml(text);
    if (doc.ok) sharedFiles[file.replace(/\.ya?ml$/, "")] = doc.value;
    else sharedBroken.push({ path: "", message: `shared/${file} does not parse: ${doc.message}`, shared: file.replace(/\.ya?ml$/, "") });
  }
  const byName: Record<string, WorkflowLoad> = {};
  for (const [file, text] of Object.entries(pack.workflows)) {
    const name = file.replace(/\.ya?ml$/, "");
    const doc = parseYaml(text);
    if (!doc.ok) {
      byName[name] = { ok: false, errors: [{ path: "", message: `${file} does not parse: ${doc.message}` }] };
      continue;
    }
    const load = loadWorkflow(doc.value, { stepKinds, sharedFiles, config, signals, inputs: HOST_INPUTS, specFiles: SPEC_FOLDER_FILES });
    byName[name] = load.ok || sharedBroken.length === 0 ? load : { ok: false, errors: [...sharedBroken, ...load.errors] };
  }
  return ok(byName);
}
