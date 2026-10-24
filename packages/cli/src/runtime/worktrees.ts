/**
 * Unit worktrees outside the tick (T5 take): check a fetched branch out into a worktree on this
 * machine and give it a slot (K3, K4) with `.env.norn` and the `.norn-unit` marker (A3) — the same
 * layout the tick creates at intake / slice start.
 */
import { appendFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import type { GitPort } from "@norn/core";
import type { ResolvedConfig } from "@norn/schema";
import { acquireLease, git as rawGit, type LeaseLiveness, writeEnvNorn, writeUnitMarker, slotEnv } from "@norn/store";

export interface WorktreeTarget {
  path: string;
  branch: string;
  story: string;
  slice: string | null;
  /** runs/ dir name: `_story` or `<nn>-<slug>` */
  unit: string;
  spec_dir: string;
}

/** `.env.norn` and `.norn-unit` are machine-local: excluded via the shared info/exclude. */
export async function ensureExcluded(root: string): Promise<void> {
  const r = await rawGit(root, ["rev-parse", "--path-format=absolute", "--git-common-dir"]);
  if (r.code !== 0) return;
  const path = join(r.stdout.trim(), "info", "exclude");
  let text = "";
  try {
    text = readFileSync(path, "utf8");
  } catch {
    /* none yet */
  }
  const missing = [".env.norn", ".norn-unit"].filter((p) => !text.split("\n").includes(p));
  if (!missing.length) return;
  mkdirSync(dirname(path), { recursive: true });
  appendFileSync(path, `${text && !text.endsWith("\n") ? "\n" : ""}# norn (machine-local worktree files)\n${missing.join("\n")}\n`);
}

/** Slot lease + `.env.norn` + `.norn-unit` for an existing worktree (K4, A3). */
export async function equipWorktree(opts: { root: string; home: string; config: ResolvedConfig; now: string; liveness: LeaseLiveness }, t: WorktreeTarget): Promise<number | null> {
  const slots = opts.config.slots;
  const lease = await acquireLease(opts.home, {
    kind: "slot",
    range: { min: slots.min, max: slots.max },
    repo: opts.root,
    story: t.story,
    slice: t.slice,
    run_id: null,
    worktree: t.path,
    portBase: (n) => slots.port_base + n * slots.ports_per_slot,
    now: opts.now,
    liveness: opts.liveness,
  });
  const slot = lease.ok ? lease.entry.n : null;
  writeEnvNorn(t.path, slot === null ? {} : slotEnv(slot, slots));
  writeUnitMarker(t.path, { repo: opts.root, story: t.story, slice: t.slice, unit: t.unit, spec_dir: t.spec_dir });
  await ensureExcluded(opts.root);
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
