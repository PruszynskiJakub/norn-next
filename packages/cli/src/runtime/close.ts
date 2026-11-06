/**
 * What closing a story does to the world (GR7, B35; spec gh-71 prefactor 2; the GR6b `close_story` action calls it too, B22):
 * the effects `norn story close` runs once it holds the claim, in one function a tick action can
 * call too. Refusals, consent and claiming stay with the caller.
 *
 * Order (nothing is lost, T6/GR7): stop this machine's live sessions → commit every unit
 * worktree's changes and mark `spec.md` `status: dropped` → push the story and slice branches → push
 * the story's record to its ref (gh-195 B15) → only then remove worktrees, local branches, leases and
 * the claim ref. A failure before the removals returns with everything still in place (B16). Without
 * a git remote the local branches are the only copy of the work, so they are kept.
 */
import { existsSync } from "node:fs";
import { join, relative } from "node:path";
import type { StoryFacts } from "@norn/core";
import { recordRef } from "@norn/schema";
import { listLeases, patchStoryFile, pushRecord, readRecordRef, type RecordPushResult, releaseClaim, releaseLease, storyFile } from "@norn/store";
import { refuse } from "../output.ts";
import type { Observed } from "./observe/index.ts";
import { runnerFor } from "../wiring.ts";

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
  | { ok: false; reason: "push_failed"; story: string; branch: string; push_reason: string; message: string; pushed: string[] }
  | { ok: false; reason: "record_push_failed"; story: string; ref: string; push_reason: string; message: string; pushed: string[] };

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
    const runner = runnerFor(obs.ports, s);
    if (s && runner) {
      await runner.kill(s).catch(() => undefined);
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

  // 3b. gh-195 D15 (B29): the final record on its archive ref, its `Norn-Branch-Commit` the story branch
  // as pushed; a failed push stops here with everything still in place
  const record = await pushHeldRecord(obs, key, loc?.branch ?? null);
  if (!record.ok) return { ok: false, reason: "record_push_failed", story: key, ref: recordRef(key), push_reason: record.reason, message: record.message, pushed };

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

/**
 * gh-195 D4, D15 (B15, B16, B29, B33): push the story's record to `refs/norn/runs/<story>` with a lease
 * on the sha this checkout last saw (D2), its `Norn-Branch-Commit` the story branch as the remote has
 * it (the local one without a remote; none without a branch, B33). The one push every claim release
 * (`story handoff`, a clean `watch` exit: runtime/release.ts) and every cleanup (GR6
 * `cleanup_merged_story`; closing, `closeStory`: GR6b and `story close`) makes after the branches and
 * before the claim or anything else goes; an unchanged or empty record pushes nothing. Once pushed,
 * the local ref and the local run-state folder pack to the same tree: a clean release (gh-195/14).
 */
export async function pushHeldRecord(obs: Observed, key: string, branch: string | null): Promise<RecordPushResult & { branch_commit: string | null }> {
  const git = obs.ports.git;
  const loc = obs.stories[key];
  const remoteHead = branch && obs.remote ? await git.revParse(obs.root, `refs/remotes/${obs.remote}/${branch}`) : null;
  const head = remoteHead ?? (branch ? await git.revParse(obs.root, `refs/heads/${branch}`) : null);
  const expected = (await readRecordRef(obs.root, key))?.sha ?? null;
  const spec_dir = loc?.spec_dir ?? obs.facts.stories.find((s) => s.key === key)?.spec_dir ?? "";
  const r = await pushRecord(obs.root, obs.remote, { key, spec_dir }, { expected, holder: obs.facts.machine.holder, branch_commit: head, at: new Date(obs.facts.now).toISOString() });
  return { ...r, branch_commit: head };
}

/** B16: why a record push failed, the same words for every release and cleanup. */
export const recordPushError = (key: string, reason: string, message: string): string => `record push to ${recordRef(key)} failed (${reason}): ${message}`;

/** B16: the one refusal (exit 3) of a command whose record push failed; nothing was released or removed. */
export const recordPushRefused = (error: string, retry: string, pushed: string[]) => refuse(error, `check the remote, then run ${retry} again`, "record_push_failed", { pushed });
