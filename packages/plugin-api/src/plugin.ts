import type { ForgeFactory } from "./forge.ts";
import type { Harness } from "./harness.ts";
import { type Pack, packProblems } from "./pack.ts";
import { type StepKindDefinition, stepKindProblems } from "./step-kind.ts";
import type { RunnerFactory } from "./runner.ts";
import { type SignalSourceDefinition, signalSourceProblems } from "./signal.ts";
import type { StoreFactory } from "./store.ts";
import type { TrackerFactory } from "./tracker.ts";
import type { VcsFactory } from "./vcs.ts";
import { apiSatisfies, PLUGIN_API_VERSION } from "./version.ts";

/**
 * The slots a plugin fills, each keyed by the name a config selects it by. Slots join as optional
 * members, so a plugin written against an older 1.x stays valid.
 */
export interface PluginProvides {
  harness?: Record<string, Harness>;
  tracker?: Record<string, TrackerFactory>;
  forge?: Record<string, ForgeFactory>;
  store?: Record<string, StoreFactory>;
  /** workflow step kinds by head key (plugin API 1.3) */
  stepKinds?: Record<string, StepKindDefinition>;
  /** version control by name (plugin API 1.4) */
  vcs?: Record<string, VcsFactory>;
  /** workflows, shared files and skills shipped together, by pack name (plugin API 1.4) */
  packs?: Record<string, Pack>;
  /** where agent processes run (herdr, headless), by name (plugin API 1.5) */
  runners?: Record<string, RunnerFactory>;
  /** readers of the signals an `on:` block may route, by signal name (plugin API 1.19) */
  signals?: Record<string, SignalSourceDefinition>;
}

export interface NornPluginSpec {
  name: string;
  /** the plugin API range the plugin was written against, e.g. `^1` */
  api: string;
  provides: PluginProvides;
}

export interface NornPlugin {
  readonly name: string;
  readonly api: string;
  readonly provides: Readonly<{
    harness?: Readonly<Record<string, Harness>>;
    tracker?: Readonly<Record<string, TrackerFactory>>;
    forge?: Readonly<Record<string, ForgeFactory>>;
    store?: Readonly<Record<string, StoreFactory>>;
    stepKinds?: Readonly<Record<string, StepKindDefinition>>;
    vcs?: Readonly<Record<string, VcsFactory>>;
    packs?: Readonly<Record<string, Pack>>;
    runners?: Readonly<Record<string, RunnerFactory>>;
    signals?: Readonly<Record<string, SignalSourceDefinition>>;
  }>;
}

const HARNESS_METHODS = ["install", "uninstall", "launch", "normalize", "respond"] as const;

/**
 * Names that lead a workflow's surface names (`norn.each`, `vcs.update-branch`), so a plugin named so
 * would make `<plugin>.<kind>` mean two things.
 */
export const PLUGIN_NAMESPACES_RESERVED = ["norn", "vcs", "forge", "tracker", "store", "harness", "runner", "pack"] as const;
const RESERVED_NAMES: readonly string[] = PLUGIN_NAMESPACES_RESERVED;

function refuse(plugin: string, why: string): never {
  throw new Error(`norn plugin ${plugin || "(unnamed)"}: ${why}`);
}

function checkHarness(plugin: string, key: string, h: Harness): void {
  const missing = HARNESS_METHODS.filter((m) => typeof (h as unknown as Record<string, unknown>)?.[m] !== "function");
  if (missing.length > 0) refuse(plugin, `harness ${key} lacks ${missing.join(", ")}`);
  if (typeof h.name !== "string" || typeof h.capabilities !== "object" || h.capabilities === null)
    refuse(plugin, `harness ${key} needs a name and capabilities`);
}

/** A tracker, forge or store is made per repo from its config, so only the factory can be checked here. */
function checkFactory(slot: string): (plugin: string, key: string, f: TrackerFactory | ForgeFactory | StoreFactory | VcsFactory | RunnerFactory) => void {
  return (plugin, key, f) => {
    const loose = f as unknown as Record<string, unknown> | null;
    const schema = loose?.configSchema;
    if (schema === null || typeof schema !== "object") refuse(plugin, `${slot} ${key} needs a configSchema`);
    if (typeof loose?.create !== "function") refuse(plugin, `${slot} ${key} lacks create`);
  };
}

function checkStepKind(plugin: string, key: string, k: StepKindDefinition): void {
  const found = stepKindProblems(key, k);
  if (found.length > 0) refuse(plugin, `step kind ${key} ${found.join("; ")}`);
}

function checkSignal(plugin: string, key: string, s: SignalSourceDefinition): void {
  const found = signalSourceProblems(key, s);
  if (found.length > 0) refuse(plugin, `signal ${key} ${found.join("; ")}`);
}

function checkPack(plugin: string, key: string, p: Pack): void {
  const found = packProblems(p);
  if (found.length > 0) refuse(plugin, `pack ${key} ${found.join("; ")}`);
}

/** A pack is frozen to its leaves, so no holder of the plugin can change a workflow another holder loads. */
function freezePack(p: Pack): Pack {
  const copy = (r: Record<string, string>) => Object.freeze({ ...r });
  const skills: Record<string, Readonly<Record<string, string>>> = {};
  for (const [name, files] of Object.entries(p.skills)) skills[name] = copy(files);
  const roles = p.roles && Object.freeze(Object.fromEntries(Object.entries(p.roles).map(([n, r]) => [n, Object.freeze({ ...r, allow: Object.freeze([...r.allow]) })])));
  return Object.freeze({ workflows: copy(p.workflows), shared: copy(p.shared), skills: Object.freeze(skills), ...(roles && { roles }) });
}

function slot<T>(plugin: string, name: string, given: Record<string, T> | undefined, checkOne: (plugin: string, key: string, v: T) => void): Readonly<Record<string, T>> | undefined {
  if (given === undefined) return undefined;
  const out: Record<string, T> = {};
  for (const [key, v] of Object.entries(given)) {
    if (!key) refuse(plugin, `provides a ${name} with an empty key`);
    checkOne(plugin, key, v);
    out[key] = v;
  }
  return Object.freeze(out);
}

/**
 * Check and freeze a plugin. It refuses at definition time, not at first use, so a plugin that
 * cannot work fails when it loads rather than midway through a run.
 */
export function defineNornPlugin(spec: NornPluginSpec): NornPlugin {
  const name = typeof spec?.name === "string" ? spec.name.trim() : "";
  if (!name) refuse(name, "needs a non-empty name");
  if (RESERVED_NAMES.includes(name)) refuse(name, `is named like the ${name === "norn" ? "core" : "slot"} ${name}, which leads a surface name`);
  if (typeof spec.api !== "string" || !apiSatisfies(spec.api))
    refuse(name, `wants plugin API ${JSON.stringify(spec.api)}, but this norn implements ${PLUGIN_API_VERSION}`);
  const harness = slot(name, "harness", spec.provides?.harness, checkHarness);
  const tracker = slot(name, "tracker", spec.provides?.tracker, checkFactory("tracker"));
  const forge = slot(name, "forge", spec.provides?.forge, checkFactory("forge"));
  const store = slot(name, "store", spec.provides?.store, checkFactory("store"));
  const stepKinds = slot(name, "step kind", spec.provides?.stepKinds, checkStepKind);
  const vcs = slot(name, "vcs", spec.provides?.vcs, checkFactory("vcs"));
  const packs = slot(name, "pack", spec.provides?.packs, checkPack);
  const runners = slot(name, "runner", spec.provides?.runners, checkFactory("runner"));
  const signals = slot(name, "signal", spec.provides?.signals, checkSignal);
  const provides: NornPlugin["provides"] = {
    ...(harness && { harness }),
    ...(tracker && { tracker }),
    ...(forge && { forge }),
    ...(store && { store }),
    ...(stepKinds && { stepKinds }),
    ...(vcs && { vcs }),
    ...(packs && { packs: Object.freeze(Object.fromEntries(Object.entries(packs).map(([k, p]) => [k, freezePack(p)]))) }),
    ...(runners && { runners }),
    ...(signals && { signals }),
  };
  return Object.freeze({ name, api: spec.api, provides: Object.freeze(provides) });
}
