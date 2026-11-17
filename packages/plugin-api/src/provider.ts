/**
 * Turning a factory and a config into a working tracker or forge. The host goes through here rather
 * than calling `create` itself, so a bad config or a plugin that hands back half an object fails
 * once, as a PluginResult, before any effect is asked of it.
 */
import { check } from "@norn/schema";
import type { Forge, ForgeFactory } from "./forge.ts";
import type { HostContext } from "./host.ts";
import { fail, ok, type PluginResult } from "./result.ts";
import { isKeyPrefix } from "./story-key.ts";
import type { Tracker, TrackerFactory } from "./tracker.ts";

const TRACKER_CAPABILITIES = ["assign", "labels", "comment", "create", "close"] as const;
const TRACKER_METHODS = ["whoami", "intake", "get", "perform"] as const;
const FORGE_CAPABILITIES = ["draft", "checks", "raw_urls"] as const;
const FORGE_METHODS = ["findChanges", "checks", "perform"] as const;

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
