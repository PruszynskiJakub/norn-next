/**
 * Unit worktrees outside the tick (T5 take): check a fetched branch out into a worktree on this
 * machine and give it a slot (K3, K4) with `.env.norn` and the `.norn-unit` marker (A3) — the same
 * layout the tick creates at intake / slice start.
 */
import { existsSync } from "node:fs";
import type { GitPort } from "@norn/core";
import type { ResolvedConfig } from "@norn/schema";
import { acquireLease, ensureExcluded, type LeaseLiveness, slotEnv, writeEnvNorn, writeUnitMarker } from "@norn/store";

export interface WorktreeTarget {
  path: string;
  branch: string;
  story: string;
  slice: string | null;
  /** runs/ dir name: `_story` or `<nn>-<slug>` */
  unit: string;
  spec_dir: string;
}

/** A slot to try first (K4): the one decide chose, with the `.env.norn` it computed for it. */
export interface PreferredSlot {
  slot: number;
  env: Record<string, string>;
}

/**
 * Slot lease + `.env.norn` + `.norn-unit` for an existing worktree (K4, A3), after excluding both
 * files from commits. `preferredSlot` is tried first; any free slot in range otherwise.
 */
export async function equipWorktree(
  opts: { root: string; home: string; config: ResolvedConfig; now: string; liveness: LeaseLiveness; preferredSlot?: PreferredSlot | null },
  t: WorktreeTarget,
): Promise<number | null> {
  await ensureExcluded(opts.root);
  const slots = opts.config.slots;
  const req = {
    kind: "slot" as const,
    repo: opts.root,
    story: t.story,
    slice: t.slice,
    run_id: null,
    worktree: t.path,
    portBase: (n: number) => slots.port_base + n * slots.ports_per_slot,
    now: opts.now,
    liveness: opts.liveness,
  };
  const preferred = opts.preferredSlot ?? null;
  let lease = preferred ? await acquireLease(opts.home, { ...req, range: { min: preferred.slot, max: preferred.slot } }) : null;
  if (!lease?.ok) lease = await acquireLease(opts.home, { ...req, range: { min: slots.min, max: slots.max } });
  const slot = lease.ok ? lease.entry.n : null;
  writeEnvNorn(t.path, slot === null ? {} : slot === preferred?.slot ? preferred.env : slotEnv(slot, slots));
  writeUnitMarker(t.path, { repo: opts.root, story: t.story, slice: t.slice, unit: t.unit, spec_dir: t.spec_dir });
  return slot;
}

export type SyncBranchResult = { ok: true; local: "created" | "fast-forwarded" | "up-to-date" | "ahead" } | { ok: false; error: string };

/**
 * Bring local `branch` to the fetched `upstream` (a remote-tracking ref): create it, or move it
 * forward when it is behind. A branch ahead keeps its commits (pushed later by the holder, T7);
 * a diverged branch is refused, never reset.
 */
export async function syncLocalBranch(git: GitPort, root: string, branch: string, upstream: string, worktree: string | null): Promise<SyncBranchResult> {
  const local = `refs/heads/${branch}`;
  const cur = await git.readRef(root, local);
  const up = await git.readRef(root, upstream);
  if (!up) return cur ? { ok: true, local: "ahead" } : { ok: false, error: `${upstream} not found` };
  if (!cur) {
    await git.createBranch(root, branch, upstream);
    return { ok: true, local: "created" };
  }
  if (cur === up) return { ok: true, local: "up-to-date" };
  if (await git.isAncestor(root, cur, up)) {
    if (worktree && existsSync(worktree)) {
      const ff = await git.fastForward(worktree, up);
      if (!ff.ok) return { ok: false, error: `cannot fast-forward ${branch} in ${worktree} (uncommitted changes?)` };
    } else if (!(await git.updateRef(root, { ref: local, sha: up, expected: cur }))) return { ok: false, error: `cannot move ${branch}` };
    return { ok: true, local: "fast-forwarded" };
  }
  if (await git.isAncestor(root, up, cur)) return { ok: true, local: "ahead" };
  return { ok: false, error: `${branch} has diverged from ${upstream}; reconcile it by hand (norn never resets work)` };
}
