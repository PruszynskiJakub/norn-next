/**
 * Removing a unit's local branch. A branch goes only once every commit on it is somewhere else: its
 * story's branch (a slice integrated there), the base, or the remote's copy of it. One whose work
 * lives only on this machine is kept and said why, so tidying never loses a commit. A branch some
 * worktree still has checked out cannot go, so the caller removes the worktree first.
 */
import { ok, type PluginResult, parseUnitId } from "@norn/plugin-api";
import { baseRefOf, branchOf } from "./branches.ts";
import type { RuntimeEnv } from "./env.ts";

export type BranchFate = { branch: string; deleted: true; held_by: string } | { branch: string; deleted: false; reason: string };

/** The ref that holds every commit on the unit's branch, or why none does; null when the branch is gone already. */
export async function branchHome(env: RuntimeEnv, unit: string): Promise<PluginResult<{ branch: string; head: string; home: string | null; reason: string } | null>> {
  const vcs = env.slots.vcs;
  const branch = branchOf(unit);
  const head = await vcs.head(branch);
  if (!head.ok) return head;
  if (head.value === null) return ok(null);
  const ref = parseUnitId(unit);
  const base = await baseRefOf(env);
  const homes: Array<{ ref: string; name: string }> = [];
  if (ref && ref.slice !== null) homes.push({ ref: branchOf(ref.story), name: `the story's branch (${branchOf(ref.story)})` });
  homes.push({ ref: base, name: `the base (${base})` });
  const remote = await vcs.remoteRef?.(branch);
  if (remote?.ok && remote.value !== null) homes.push({ ref: remote.value, name: `its remote copy (${remote.value})` });
  for (const h of homes) {
    const at = await vcs.head(h.ref);
    if (!at.ok) return at;
    if (at.value === null) continue;
    const within = await vcs.isAncestor(head.value, at.value);
    if (!within.ok) return within;
    if (within.value) return ok({ branch, head: head.value, home: h.ref, reason: "" });
  }
  const names = homes.filter((h) => !h.name.startsWith("its remote copy")).map((h) => h.name);
  return ok({ branch, head: head.value, home: null, reason: `its head ${head.value.slice(0, 12)} is on neither ${names.join(", ")} nor a remote copy` });
}

/**
 * Delete the unit's local branch when its commits are kept elsewhere. Null when there is nothing to
 * do: the branch is gone, or the vcs cannot delete one.
 */
export async function dropUnitBranch(env: RuntimeEnv, unit: string, opts: { dryRun?: boolean } = {}): Promise<PluginResult<BranchFate | null>> {
  const vcs = env.slots.vcs;
  if (!vcs.deleteBranch) return ok(null);
  const found = await branchHome(env, unit);
  if (!found.ok || found.value === null) return found.ok ? ok(null) : found;
  const { branch, home, reason } = found.value;
  if (home === null) return ok({ branch, deleted: false, reason });
  if (!opts.dryRun) {
    const gone = await vcs.deleteBranch(branch);
    if (!gone.ok) return gone;
  }
  return ok({ branch, deleted: true, held_by: home });
}
