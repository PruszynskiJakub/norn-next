/**
 * The effective grant of an agent step: the capabilities its role may be granted, narrowed by the
 * step's `allow:`, capped by the person's policy. Granting is a decision, so it is computed here from
 * the pinned step and the kernel config, never by a host; the launcher, the brief and the detection at
 * `norn done` read what decide computed.
 */
import { CAPABILITIES, type Capability } from "@norn/plugin-api";
import { Type } from "@sinclair/typebox";

export const CapabilitySchema = Type.Union(
  CAPABILITIES.map((c) => Type.Literal(c)),
  { title: "Capability" },
);

/** What a step may do to the code it runs on: change and keep it, change it for the run alone, or only read it. */
export type CodeLevel = "read" | "scratch" | "write";

export interface GrantStep {
  role?: string;
  allow?: readonly Capability[];
}

export interface GrantConfig {
  /** each role → the capabilities it may be granted; absent, roles narrow nothing */
  roles?: Readonly<Record<string, readonly Capability[]>>;
  /** the capabilities the person's policy lets any step have; absent, every one */
  capabilities?: readonly Capability[];
}

/**
 * The step's effective grant, in the role's order, or null when nothing narrows it: a step in the
 * older form names no role, and a host with no role registry keeps today's trust. A role the registry
 * does not hold grants nothing, so an unclear role fails closed.
 */
export function grantOf(step: GrantStep, config: GrantConfig): Capability[] | null {
  if (step.role === undefined || config.roles === undefined) return null;
  const base = config.roles[step.role] ?? [];
  return base.filter((c) => (step.allow === undefined || step.allow.includes(c)) && (config.capabilities === undefined || config.capabilities.includes(c)));
}

/** The strongest code level a grant names; a grant naming none may only read, and no grant leaves today's write. */
export function codeLevelOf(grant: readonly Capability[] | null): CodeLevel {
  if (grant === null || grant.includes("code:write")) return "write";
  return grant.includes("code:scratch") ? "scratch" : "read";
}

/**
 * Whether the hook guard holds the step to its documents: a grant that may only read code. A scratch
 * grant may change code for the run, which detection resets at `norn done`, so the guard leaves it.
 */
export function docsOnlyGrant(grant: readonly Capability[] | null): boolean {
  return codeLevelOf(grant) === "read";
}
