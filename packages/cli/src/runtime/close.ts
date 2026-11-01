/**
 * What closing a story does to the world (GR7, B35; spec gh-71 prefactor 2, for B22's GR6b later):
 * the effects `norn story close` runs once it holds the claim, in one function a tick action can
 * call too. Refusals, consent and claiming stay with the caller.
 *
 * Order (nothing is lost, T6/GR7): stop this machine's live sessions → commit every unit
 * worktree's changes and mark `spec.md` `status: dropped` → push the story and slice branches →
 * only then remove worktrees, local branches, leases and the claim ref. A failure before the
 * removals returns with everything still in place. Without a git remote the local branches are
 * the only copy of the record, so they are kept.
 */
import { existsSync } from "node:fs";
import { join, relative } from "node:path";
import type { StoryFacts } from "@norn/core";
import { listLeases, patchStoryFile, releaseClaim, releaseLease, storyFile } from "@norn/store";
import type { Observed } from "./observe/index.ts";

export interface StoryClosed {
  ok: true;
  story: string;
  killed: string[];
  committed: string[];
  pushed: string[];
  worktrees_removed: string[];
  branches_deleted: string[];
  branches_kept: string[];
  leases_released: string[];
  claim_deleted: boolean;
  claim_error?: string;
  /** where the record lives now: `<remote>/<branch>`, the local branch without a remote */
  record: string | null;
}

/** Why closing stopped; nothing was removed. */
export type StoryCloseFailure =
  | { ok: false; reason: "spec_corrupt"; story: string; file: string; message: string; committed: string[] }
  | { ok: false; reason: "push_failed"; story: string; branch: string; push_reason: string; message: string; pushed: string[] };

export interface CloseStoryOptions {
  /** the norn home whose lease files are released */
  home: string;
  /** the claim ref sha this heartbeat holds; released last */
  claimSha: string;
}

/** Close `story` on this machine (see the header for the order). The caller holds the claim and the tick lock. */
export async function closeStory(obs: Observed, story: StoryFacts, opts: CloseStoryOptions): Promise<StoryClosed | StoryCloseFailure> {
  const key = story.key;
  const git = obs.ports.git;
  const loc = obs.stories[key];
  const tick = obs.facts.tick_id;
  const trailers = (unit: string | null, step: string) => ({ "Norn-Story": key, ...(unit ? { "Norn-Slice": unit } : {}), "Norn-Step": step, "Norn-Tick": tick });

  // 1. stop live sessions this machine runs (best effort; their work is committed below)
  const killed: string[] = [];
  for (const u of story.units) {
    const s = u.state?.status === "running" ? u.run?.session : null;
    if (s && obs.ports.runner && s.runner === obs.ports.runner.name) {
      await obs.ports.runner.kill(s).catch(() => undefined);
      killed.push(u.unit.key);
    }
  }

  // 2. record + every change committed (GR7: never delete work)
  const committed: string[] = [];
  const sliceWts: Array<{ unit: string; path: string; branch: string }> = [];
  for (const u of story.units) {
    const ul = obs.units[u.unit.key];
    if (u.unit.slice && ul?.worktree && existsSync(ul.worktree)) sliceWts.push({ unit: u.unit.key, path: ul.worktree, branch: ul.branch });
  }
  for (const w of sliceWts) if (await git.commit(w.path, { message: `norn: ${w.unit} dropped (work kept)`, trailers: trailers(w.unit, "drop") })) committed.push(w.unit);
  const storyWt = loc?.worktree && existsSync(loc.worktree) ? loc.worktree : null;
  if (storyWt) {
    const file = storyFile(join(storyWt, loc?.spec_dir ?? ""));
    const p = patchStoryFile(file, { status: "dropped" }, storyWt);
    if (!p.ok) return { ok: false, reason: "spec_corrupt", story: key, file: relative(storyWt, file), message: p.reason, committed };
    if (await git.commit(storyWt, { message: `norn: ${key} dropped`, trailers: trailers(null, "drop") })) committed.push(key);
  }

  // 3. push first (T6/GR7); stop on any failure with everything still in place
  const pushed: string[] = [];
  if (obs.remote) {
    const branches = [...(storyWt && loc ? [{ cwd: storyWt, branch: loc.branch, force: false }] : []), ...sliceWts.map((w) => ({ cwd: w.path, branch: w.branch, force: true }))];
    for (const b of branches) {
      const r = await git.push(b.cwd, obs.remote, `${b.force ? "+" : ""}refs/heads/${b.branch}:refs/heads/${b.branch}`);
      if (!r.ok) return { ok: false, reason: "push_failed", story: key, branch: b.branch, push_reason: r.reason, message: r.message, pushed };
      pushed.push(b.branch);
    }
  }

  // 4. clean up this machine
  const removed: string[] = [];
  for (const w of [...sliceWts.map((x) => x.path), ...(storyWt ? [storyWt] : [])]) {
    await git.worktreeRemove(obs.root, w, { force: true });
    removed.push(w);
  }
  const deleted: string[] = [];
  const kept: string[] = [];
  const localBranches = [...sliceWts.map((w) => w.branch), ...(loc ? [loc.branch] : [])];
  for (const b of localBranches) {
    if (!(await git.branchExists(obs.root, b))) continue;
    if (!obs.remote) {
      kept.push(b); // no remote: the local branch is the only copy of the record
      continue;
    }
    await git.deleteBranch(obs.root, b, { force: true });
    deleted.push(b);
  }
  const leases: string[] = [];
  for (const e of (await listLeases(opts.home, () => true)).live)
    if (e.lease.repo === obs.root && e.lease.story === key && releaseLease(opts.home, e.file)) leases.push(e.file);
  const rel = await releaseClaim(obs.root, obs.remote, key, opts.claimSha);

  return {
    ok: true,
    story: key,
    killed,
    committed,
    pushed,
    worktrees_removed: removed,
    branches_deleted: deleted,
    branches_kept: kept,
    leases_released: leases,
    claim_deleted: rel.ok,
    ...(rel.ok ? {} : { claim_error: rel.message }),
    record: obs.remote && loc ? `${obs.remote}/${loc.branch}` : (loc?.branch ?? null),
  };
}
