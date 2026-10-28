/** act: unit and story lifecycle — start, done, rejected receipts, claims, intake, mirror, merged clean-up and base records. */
import { existsSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { type Action, type ActionResult, nornTrailers, type UnitRef, type WorktreeSpec } from "@norn/core";
import { parseDuration, STORY_UNIT_DIR } from "@norn/schema";
import {
  acquireClaim,
  deleteMailbox,
  listLeases,
  patchSliceFile,
  patchStoryFile,
  pinWorkflow,
  releaseClaim,
  releaseLease,
  renewClaim,
  sliceFile as sliceFilePath,
  storyFile,
  writeStoryFile,
  type PendingRecord,
  readPendingRecords,
  writePendingRecords,
} from "@norn/store";
import { integrate } from "../integrate.ts";
import { markStoryOnBase, mergeFacts, type RecordResult } from "../record.ts";
import { equipWorktree } from "../worktrees.ts";
import { type ActEnv, claimLost } from "./env.ts";

/** Create a unit worktree (K4, K5): branch, worktree, slot lease, `.env.norn`, `.norn-unit`. */
async function ensureWorktree(act: ActEnv, spec: WorktreeSpec, unit: UnitRef, spec_dir: string): Promise<{ created: boolean; slot: number | null }> {
  let created = false;
  if (!existsSync(spec.path)) {
    const exists = await act.git.branchExists(act.root, spec.branch);
    // F33: a new story branch starts from the fetched base (`<remote>/<base>`), not a stale local `main`
    const tracking = act.obs.remote && spec.from === act.obs.facts.repo.default_branch ? `refs/remotes/${act.obs.remote}/${spec.from}` : null;
    // (by sha: a remote-tracking start point would make it the new branch's upstream)
    const from = (tracking ? await act.git.readRef(act.root, tracking).catch(() => null) : null) ?? spec.from;
    await act.git.worktreeAdd(act.root, spec.path, spec.branch, exists ? undefined : { from });
    created = true;
  }
  const slot = await equipWorktree(
    { root: act.root, home: act.ctx.home, config: act.config, now: act.nowIso(), liveness: act.liveness(), preferredSlot: spec.slot !== null ? { slot: spec.slot, env: spec.env } : null },
    { path: spec.path, branch: spec.branch, story: unit.story, slice: unit.slice, unit: unit.dir, spec_dir },
  );
  return { created, slot };
}

export async function startUnit(act: ActEnv, a: Extract<Action, { kind: "start_unit" }>): Promise<ActionResult> {
  const story = act.storyLoc(a.unit.story);
  const detail: Record<string, unknown> = {};
  if (a.slice_status && a.unit.slice) {
    // planned → active on the story branch first, so the slice branch is cut with it
    const nn = a.unit.dir.split("-")[0] as string;
    const slug = a.unit.dir.slice(nn.length + 1);
    const storyWt = story.worktree ?? story.root;
    const file = sliceFilePath(join(storyWt, story.spec_dir), nn, slug);
    const r = patchSliceFile(file, { status: a.slice_status }, storyWt);
    if (!r.ok) throw new Error(`cannot set ${relative(storyWt, file)} status: ${r.reason}`);
    detail.slice_status = await act.git.commit(storyWt, {
      message: `norn: ${a.unit.key} ${a.slice_status}`,
      trailers: { "Norn-Story": a.unit.story, "Norn-Slice": a.unit.slice, "Norn-Step": a.state?.step ?? "start", "Norn-Tick": act.tick },
      paths: [relative(storyWt, file)],
    });
  }
  let wtPath = story.worktree;
  if (a.worktree) {
    detail.worktree = await ensureWorktree(act, a.worktree, a.unit, story.spec_dir);
    wtPath = a.worktree.path;
  }
  if (!wtPath) throw new Error(`no worktree for ${a.unit.key}`);
  const runsDir = join(wtPath, story.spec_dir, "runs", a.unit.dir);
  const pin = pinWorkflow(runsDir, a.workflow_source);
  if (!pin.ok) throw new Error(`runs/${a.unit.dir}/workflow.yaml is already pinned with different content (S7)`);
  act.obs.units[a.unit.key] = {
    unit: a.unit,
    story: a.unit.story,
    root: wtPath,
    runsDir,
    worktree: wtPath,
    branch: a.worktree?.branch ?? story.branch,
    state: null,
    workflow: null,
  };
  act.writeReceipts(runsDir, a.receipts);
  if (a.state) act.writeUnitState(a.unit, runsDir, a.state);
  if (a.unit.slice === null) {
    const r = patchStoryFile(storyFile(join(wtPath, story.spec_dir)), { status: "active" }, wtPath);
    detail.story_status = r.ok ? "active" : r.reason;
  }
  detail.commit = await act.commit(a.commit, a.unit, a.state, `${a.rule}: ${a.workflow} at ${a.state?.step ?? "?"}`);
  return { ok: true, detail };
}

export async function markDone(act: ActEnv, a: Extract<Action, { kind: "mark_done" }>): Promise<ActionResult> {
  const story = act.storyLoc(a.unit.story);
  const storyWt = story.worktree;
  const detail: Record<string, unknown> = {};
  const loc = act.unitLoc(a.unit);
  act.writeReceipts(loc.runsDir, a.receipts);
  if (a.state) act.writeUnitState(a.unit, loc.runsDir, a.state);
  const wt = a.cleanup.worktree;
  if (wt && existsSync(wt) && a.unit.slice) {
    // the slice's final state commit ($done) lands after integration: bring it into the story branch
    const res = await integrate(act.git, { sliceCwd: wt, storyBranch: story.branch, ...(storyWt ? { storyCwd: storyWt } : {}) });
    if (res.outcome === "conflict") throw new Error(`cannot bring ${a.unit.key}'s final state into ${story.branch}: conflict in ${res.files.join(", ")}`);
  }
  if (a.slice_status && a.unit.slice && storyWt) {
    const nn = a.unit.dir.split("-")[0] as string;
    const file = sliceFilePath(join(storyWt, story.spec_dir), nn, a.unit.dir.slice(nn.length + 1));
    const r = patchSliceFile(file, { status: a.slice_status }, storyWt);
    if (!r.ok) throw new Error(`cannot set ${relative(storyWt, file)} status: ${r.reason}`);
    detail.commit = await act.commit(
      { cwd: storyWt, branch: story.branch, message: `norn: ${a.unit.key} ${a.slice_status}`, trailers: nornTrailers(act.tick, a.unit.story, a.unit.slice, "$done"), push: true },
      null,
      null,
      null,
      [relative(storyWt, file)],
    );
  }
  if (wt && existsSync(wt)) {
    await act.git.worktreeRemove(act.root, wt).catch(() => act.git.worktreeRemove(act.root, wt, { force: true }));
    detail.worktree_removed = wt;
  }
  if (a.cleanup.release_slot) detail.released = await act.releaseRunLeases(a.unit, ["slot", "agent", "check"]);
  // decide names the branch only when it is in the story branch (or the integration above put it there)
  const b = a.cleanup.branch_local;
  if (b && (await act.git.branchExists(act.root, b))) {
    await act.git.deleteBranch(act.root, b, { force: true });
    detail.branch_deleted = b;
  } else if (a.cleanup.branch_kept) detail.branch_kept = a.cleanup.branch_kept;
  if (a.commit) detail.unit_commit = await act.commit(a.commit, a.unit, a.state, `${a.rule}`);
  return { ok: true, detail };
}

export async function rejectReceipt(act: ActEnv, a: Extract<Action, { kind: "reject_receipt" }>): Promise<ActionResult> {
  if ("ref" in a.source) {
    const res = await deleteMailbox(act.root, act.obs.remote, a.source.ref, a.source.sha);
    act.traceReject(a.unit.key, a.source.ref, a.reason, { sha: a.source.sha });
    return { ok: true, detail: { deleted: res.ok } };
  }
  const loc = act.unitLoc(a.unit);
  if (a.state) act.writeUnitState(a.unit, loc.runsDir, a.state);
  act.traceReject(a.unit.key, `receipt ${a.source.n}`, a.reason);
  return { ok: true };
}

// ------------------------------------------------------------ claims (T3–T6)

export async function claim(act: ActEnv, a: Extract<Action, { kind: "claim" }>): Promise<ActionResult> {
  const story = a.unit.story;
  const remote = act.obs.remote;
  if (a.op === "release") {
    const r = await releaseClaim(act.root, remote, story, a.expected ?? "");
    return r.ok ? { ok: true } : { ok: false, error: r.message };
  }
  if (!a.blob) throw new Error("claim without blob");
  const r = a.op === "acquire" ? await acquireClaim(act.root, remote, a.blob, { now: act.obs.facts.now }) : await renewClaim(act.root, remote, a.blob, a.expected ?? "");
  if (r.ok) act.claimed.set(story, { blob: a.blob, sha: r.sha });
  if (r.ok) return { ok: true, detail: { sha: r.sha } };
  const detail: Record<string, unknown> = { reason: r.reason };
  // R3.1 (H6): the intake race is lost — undo what the intake made here, unless it holds work
  if (a.rule === "claim.acquire.intake" && claimLost({ ok: false, detail })) detail.intake = await dropLostIntake(act, story, a.lost_intake).catch((e: Error) => ({ kept: `clean-up failed: ${e.message}` }));
  return { ok: false, error: r.message, detail };
}

/**
 * R3.1: after losing `claim.acquire.intake`, remove what decide said holds nothing beyond the
 * intake (`lost_intake.drop`): the story worktree, its local branch (and the spec folder in it) and
 * its slot. Otherwise keep everything; observe then reports the local work (R2.3).
 */
async function dropLostIntake(act: ActEnv, story: string, lost: Extract<Action, { kind: "claim" }>["lost_intake"]): Promise<{ removed: string[] } | { kept: string }> {
  if (!lost) return { kept: "not decided: the intake branch was not observed" };
  if ("keep" in lost) return { kept: lost.keep };
  const wt = lost.drop.worktree;
  const removed: string[] = [];
  if (wt && existsSync(wt)) {
    await act.git.worktreeRemove(act.root, wt, { force: true });
    removed.push(wt);
  }
  if (await act.git.branchExists(act.root, lost.drop.branch)) {
    await act.git.deleteBranch(act.root, lost.drop.branch, { force: true });
    removed.push(lost.drop.branch);
  }
  const listing = await listLeases(act.ctx.home, () => true);
  for (const e of listing.live) if (e.lease.repo === act.root && e.lease.story === story && releaseLease(act.ctx.home, e.file)) removed.push(e.file);
  return { removed };
}

// ------------------------------------------------------------ remote lifecycle (GR2, GR6, GR8)

export async function intake(act: ActEnv, a: Extract<Action, { kind: "intake_story" }>): Promise<ActionResult> {
  const unit: UnitRef = { story: a.key, slice: null, dir: STORY_UNIT_DIR, key: a.key };
  const specDir = dirname(a.story_file);
  // T5/T10: a story already intaken elsewhere (its branch is on the remote) is continued by take, never re-intaken
  if (act.obs.remote && !existsSync(a.worktree.path) && !(await act.git.branchExists(act.root, a.worktree.branch)) && (await act.git.branchExists(act.root, a.worktree.branch, "remote", act.obs.remote)))
    return { ok: true, detail: { skipped: `${a.worktree.branch} already exists on ${act.obs.remote}`, do_instead: `norn take ${a.key}` } };
  const wt = await ensureWorktree(act, a.worktree, unit, specDir);
  // GR2: a folder an older norn intook keeps its story.md (storyFile reads it), so it is never written twice
  const file = join(a.worktree.path, a.story_file);
  const written = !existsSync(storyFile(dirname(file)));
  if (written) writeStoryFile(file, a.frontmatter, a.body.endsWith("\n") || !a.body ? `\n${a.body}` : `\n${a.body}\n`);
  const committed = await act.commit(a.commit, null, null, null);
  return { ok: true, detail: { worktree: a.worktree.path, ...wt, story_file: written ? a.story_file : "exists", ...committed } };
}

export async function mirror(act: ActEnv, a: Extract<Action, { kind: "update_story_mirror" }>): Promise<ActionResult> {
  const story = act.storyLoc(a.unit.story);
  if (!story.worktree) return { ok: true, detail: { skipped: "no story worktree; spec.md is never written in the main checkout" } };
  const r = patchStoryFile(storyFile(join(story.worktree, story.spec_dir)), a.fields, story.worktree);
  if (!r.ok) throw new Error(`cannot update spec.md: ${r.reason}`);
  await act.notify(a.notify);
  return { ok: true, detail: await act.commit(a.commit, null, null, null) };
}

export async function cleanupMerged(act: ActEnv, a: Extract<Action, { kind: "cleanup_merged_story" }>): Promise<ActionResult> {
  const detail: Record<string, unknown> = {};
  const errors: string[] = [];
  act.cleaned.add(a.unit.story);
  const tryDo = async (what: string, f: () => Promise<unknown>) => {
    try {
      await f();
    } catch (e) {
      errors.push(`${what}: ${(e as Error).message}`);
    }
  };
  // slice worktrees first, the story worktree last
  for (const wt of [...a.worktrees].reverse()) if (existsSync(wt)) await tryDo(`remove ${wt}`, () => act.git.worktreeRemove(act.root, wt, { force: true }));
  const listing = await listLeases(act.ctx.home, () => true);
  for (const e of listing.live) if (e.lease.repo === act.root && e.lease.story === a.unit.story) releaseLease(act.ctx.home, e.file);
  for (const b of a.local_branches) if (await act.git.branchExists(act.root, b)) await tryDo(`delete ${b}`, () => act.git.deleteBranch(act.root, b, { force: true }));
  if (act.obs.remote) for (const b of a.remote_branches) await tryDo(`delete remote ${b}`, () => act.git.deleteRemoteBranch(act.root, act.obs.remote as string, b));
  for (const ref of a.refs) {
    await tryDo(`delete ${ref}`, async () => {
      await act.git.updateRef(act.root, { ref, sha: null });
      if (act.obs.remote) await act.git.pushRef(act.root, act.obs.remote, { ref, sha: null });
    });
  }
  // the record stays on the base branch (GR6): mark spec.md done there (record.ts; never forced).
  // Deferred (merge not on the base yet) or failed → owed; later ticks retry it (retryRecords).
  // GR6 done record: how the PR landed (merge commit, merged_by, merged_at; P2 ancestry) goes into
  // spec.md `merge:` on the base with the status (record.ts), and is kept in records.json while owed
  const story = act.storyLoc(a.unit.story);
  const facts = act.obs.facts.stories.find((s) => s.key === a.unit.story);
  const merge = facts ? await mergeFacts({ root: act.root, remote: act.obs.remote, git: act.git, base: act.obs.facts.repo.default_branch, story: facts }).catch(() => undefined) : undefined;
  if (merge) detail.merge = merge;
  detail.record = await record(act, { story: a.unit.story, spec_dir: story.spec_dir, status: a.story_status, attempted_at: 0, attempts: 0, reason: "", ...(merge ? { merge } : {}) });
  return errors.length ? { ok: false, error: errors.join("; "), detail } : { ok: true, detail };
}

/** One attempt at a GR6 record; keeps it in `records.json` until it lands (idempotent: `unchanged` counts). */
async function record(act: ActEnv, p: PendingRecord): Promise<RecordResult | { state: "failed"; reason: string }> {
  const res = await markStoryOnBase({
    root: act.root,
    remote: act.obs.remote,
    git: act.git,
    base: act.obs.facts.repo.default_branch,
    spec_dir: p.spec_dir,
    story: p.story,
    status: p.status,
    trailers: { "Norn-Story": p.story, "Norn-Tick": act.tick },
    ...(p.merge ? { merge: p.merge } : {}),
  }).catch((e: Error) => ({ state: "failed" as const, reason: e.message }));
  const rest = readPendingRecords(act.root).filter((r) => r.story !== p.story);
  if (res.state === "deferred" || res.state === "failed") rest.push({ ...p, attempted_at: act.ctx.clock.now(), attempts: p.attempts + 1, reason: res.reason });
  writePendingRecords(act.root, rest);
  return res;
}

/** GR6: retry owed base-branch records, at most once per `remote.sync_interval` each (H5). */
export async function retryRecords(act: ActEnv): Promise<Array<{ story: string; state: string; reason?: string }>> {
  const every = parseDuration(act.config.remote.sync_interval);
  const now = act.ctx.clock.now();
  const out: Array<{ story: string; state: string; reason?: string }> = [];
  for (const p of readPendingRecords(act.root)) {
    if (now - p.attempted_at < every) continue;
    const r = await record(act, p);
    out.push({ story: p.story, state: r.state, ...("reason" in r ? { reason: r.reason } : {}) });
  }
  return out;
}
