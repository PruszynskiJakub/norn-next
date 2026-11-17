/**
 * Turning a factory and a config into a working tracker, forge or store. The host goes through here rather
 * than calling `create` itself, so a bad config or a plugin that hands back half an object fails
 * once, as a PluginResult, before any effect is asked of it.
 */
import { check } from "@norn/schema";
import type { Forge, ForgeFactory } from "./forge.ts";
import type { HostContext } from "./host.ts";
import { fail, ok, type PluginResult } from "./result.ts";
import type { Store, StoreFactory } from "./store.ts";
import { isKeyPrefix } from "./story-key.ts";
import type { Tracker, TrackerFactory } from "./tracker.ts";

const TRACKER_CAPABILITIES = ["assign", "labels", "comment", "create", "close"] as const;
const TRACKER_METHODS = ["whoami", "intake", "get", "perform"] as const;
const FORGE_CAPABILITIES = ["draft", "checks", "raw_urls"] as const;
const FORGE_METHODS = ["findChanges", "checks", "perform"] as const;
const STORE_METHODS = ["listUnits", "readUnit", "appendReceipt", "commitState", "archive"] as const;
const STORE_PARTS = {
  claims: ["read", "acquire", "renew", "release"],
  mailbox: ["send", "receive", "ack"],
  artifacts: ["read", "write", "list", "remove"],
} as const;

type Loose = Record<string, unknown>;

function shapeProblems(value: unknown, capabilities: readonly string[], methods: readonly string[]): string[] {
  if (value === null || typeof value !== "object") return ["is not an object"];
  const v = value as Loose;
  const out: string[] = [];
  if (typeof v.name !== "string" || !v.name) out.push("needs a name");
  const missing = methods.filter((m) => typeof v[m] !== "function");
  if (missing.length > 0) out.push(`lacks ${missing.join(", ")}`);
  const caps = v.capabilities;
  if (caps === null || typeof caps !== "object") out.push("needs capabilities");
  else {
    const bad = capabilities.filter((c) => typeof (caps as Loose)[c] !== "boolean");
    if (bad.length > 0) out.push(`capabilities ${bad.join(", ")} must be booleans`);
  }
  return out;
}

/** What is wrong with a value offered as a tracker; empty when it fits the contract. */
export function trackerProblems(value: unknown): string[] {
  const out = shapeProblems(value, TRACKER_CAPABILITIES, TRACKER_METHODS);
  if (value !== null && typeof value === "object" && !isKeyPrefix((value as Loose).keyPrefix))
    out.push(`keyPrefix ${JSON.stringify((value as Loose).keyPrefix)} must match ^[a-z][a-z0-9]{0,7}$`);
  return out;
}

/** What is wrong with a value offered as a forge; empty when it fits the contract. */
export function forgeProblems(value: unknown): string[] {
  return shapeProblems(value, FORGE_CAPABILITIES, FORGE_METHODS);
}

function partProblems(v: Loose, part: keyof typeof STORE_PARTS): string[] {
  const given = v[part];
  if (given === null || typeof given !== "object") return [`needs ${part}`];
  const missing = STORE_PARTS[part].filter((m) => typeof (given as Loose)[m] !== "function");
  return missing.length > 0 ? [`${part} lacks ${missing.join(", ")}`] : [];
}

/**
 * What is wrong with a value offered as a store; empty when it fits the contract. A capability and
 * the part it names must agree both ways: the kernel reads the capability, never probes the part.
 */
export function storeProblems(value: unknown): string[] {
  if (value === null || typeof value !== "object") return ["is not an object"];
  const v = value as Loose;
  const out: string[] = [];
  if (typeof v.name !== "string" || !v.name) out.push("needs a name");
  const missing = STORE_METHODS.filter((m) => typeof v[m] !== "function");
  if (missing.length > 0) out.push(`lacks ${missing.join(", ")}`);
  out.push(...partProblems(v, "claims"));
  const caps = v.capabilities as Loose | null | undefined;
  if (caps === null || typeof caps !== "object") return [...out, "needs capabilities"];
  const bad = (["shared", "mailbox", "artifacts"] as const).filter((c) => typeof caps[c] !== "boolean");
  if (bad.length > 0) out.push(`capabilities ${bad.join(", ")} must be booleans`);
  if (caps.claims !== "local" && caps.claims !== "distributed") out.push('capability claims must be "local" or "distributed"');
  for (const part of ["mailbox", "artifacts"] as const) {
    if (caps[part] === true) out.push(...partProblems(v, part));
    else if (caps[part] === false && v[part] !== undefined) out.push(`offers ${part} its capabilities deny`);
  }
  for (const m of ["sync", "flush"] as const) {
    if (v[m] !== undefined && typeof v[m] !== "function") out.push(`${m} must be a function`);
    else if (caps.shared === true && typeof v[m] !== "function") out.push(`a shared store lacks ${m}`);
  }
  return out;
}

function instantiate<T>(
  what: string,
  factory: { configSchema: unknown; create(ctx: HostContext, config: never): unknown },
  ctx: HostContext,
  config: unknown,
  problems: (v: unknown) => string[],
): PluginResult<T> {
  const r = check(factory.configSchema as Parameters<typeof check>[0], config);
  if (!r.ok) return fail("invalid", `${what} config: ${r.errors.map((e) => `${e.path || "/"} ${e.message}`).join("; ")}`, false);
  let made: unknown;
  try {
    made = factory.create(ctx, r.value as never);
  } catch (e) {
    // a factory throwing is a plugin defect; it still comes back as a failure so the host never crashes on load
    return fail("invalid", `${what}: create threw (${e instanceof Error ? e.message : String(e)})`, false);
  }
  const found = problems(made);
  if (found.length > 0) return fail("invalid", `${what} ${found.join("; ")}`, false);
  return ok(made as T);
}

export function createTracker(factory: TrackerFactory, ctx: HostContext, config: unknown): PluginResult<Tracker> {
  return instantiate<Tracker>("tracker", factory, ctx, config, trackerProblems);
}

export function createForge(factory: ForgeFactory, ctx: HostContext, config: unknown): PluginResult<Forge> {
  return instantiate<Forge>("forge", factory, ctx, config, forgeProblems);
}

export function createStore(factory: StoreFactory, ctx: HostContext, config: unknown): PluginResult<Store> {
  return instantiate<Store>("store", factory, ctx, config, storeProblems);
}
