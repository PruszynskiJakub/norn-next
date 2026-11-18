/**
 * Where a unit's work lives in version control. Branch names follow from the unit id alone, so any
 * machine reading a shared store finds the same branch without a record of it, and a story's branch
 * and its slices' never nest (`norn/gh-12` beside `norn/gh-12-03`, which git could not hold as
 * `norn/gh-12` beside `norn/gh-12/03`).
 */
import { ok, type PluginResult, parseUnitId } from "@norn/plugin-api";
import type { RuntimeEnv } from "./env.ts";

export function branchOf(unit: string): string {
  const ref = parseUnitId(unit);
  if (!ref) throw new RangeError(`not a unit id: ${JSON.stringify(unit)}`);
  return ref.slice === null ? `norn/${ref.story}` : `norn/${ref.story}-${ref.slice}`;
}

/** What the unit's branch is cut from: a story's from the base, a slice's from its story's branch. */
export function cutFrom(unit: string, base: string): string {
  const ref = parseUnitId(unit);
  if (!ref) throw new RangeError(`not a unit id: ${JSON.stringify(unit)}`);
  return ref.slice === null ? base : branchOf(ref.story);
}

/**
 * The ref the base is measured at: `base_ref` when the config names one, else the remote's fetched
 * copy of the base, else the local base. Never the local base while a remote copy exists: the person's
 * checkout moves only when they pull, so measuring at it would cut, sync and judge staleness against
 * a base older than the one the change will merge into. A vcs that cannot answer leaves the local base.
 */
export async function baseRefOf(env: RuntimeEnv): Promise<string> {
  const { base, baseRef } = env.config;
  if (baseRef !== undefined) return baseRef;
  const remote = await env.slots.vcs.remoteRef?.(base);
  return remote?.ok && remote.value !== null ? remote.value : base;
}

/**
 * The unit's checkout, made when missing. A vcs without worktrees runs every unit in the repo's own
 * checkout. Ensuring is idempotent, so every run asks again rather than trusting a folder made earlier.
 */
export async function ensureWorktree(env: RuntimeEnv, unit: string): Promise<PluginResult<string>> {
  const vcs = env.slots.vcs;
  if (!vcs.capabilities.worktrees) return ok(env.ctx.repo.root);
  const made = await vcs.worktree.ensure(unit, branchOf(unit), cutFrom(unit, await baseRefOf(env)));
  return made.ok ? ok(made.value.path) : made;
}
