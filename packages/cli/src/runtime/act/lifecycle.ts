/** act: unit and story lifecycle — start, done, rejected receipts, claims, intake, mirror, merged clean-up and base records. */
import { existsSync, mkdirSync, readdirSync, rmSync, statSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { cmd, type Action, type ActionResult, nornTrailers, recordOnBase, recordRetryDue, recordStopsAt, type UnitRef, type WorktreeSpec } from "@norn/core";
import { type ClaimBlob, headsRef, parseDuration, recordRef, ROUNDS_DIR, STORY_UNIT_DIR } from "@norn/schema";
import {
  acquireClaim,
  addRejectedReceipt,
  dropLocalRecord,
  setAsideRecord,
  pushRecord as pushStoryRecord,
  type ClaimWriteResult,
  deleteMailbox,
  patchSliceFile,
  patchStoryFile,
  pinWorkflow,
  releaseClaim,
  releaseStoryLeases,
  renewClaims,
  sliceFile as sliceFilePath,
  storyFile,
  writeStoryFile,
  type PendingRecord,
  readPendingRecords,
  writePendingRecords,
  moveFile,
  handoffPath,
  runStateFile,
  runStateRecord,
  runStateStartDir,
  writeState,
} from "@norn/store";
import { closeStory, pushHeldRecord, recordPushError } from "../close.ts";
import { integrate } from "../integrate.ts";
import { markStoryOnBase, mergeFacts, type RecordResult } from "../record.ts";
import { equipWorktree } from "../worktrees.ts";
import { type ActEnv, claimLost } from "./env.ts";
import type { UnitLoc } from "../observe/index.ts";

/** Create a unit worktree: branch, worktree, slot lease, `.env.norn`, `.norn-unit`. */
async function ensureWorktree(act: ActEnv, spec: WorktreeSpec, unit: UnitRef, spec_dir: string): Promise<{ created: boolean; slot: number | null }> {
  let created = false;
  if (!existsSync(spec.path)) {
    const exists = await act.git.branchExists(act.root, spec.branch);
    // A new story branch starts from the fetched base (`<remote>/<base>`), not a stale local `main`
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
  const run = { key: a.unit.story, spec_dir: story.spec_dir };
  const runsDir = runStateStartDir(wtPath, run, a.unit.dir, a.workflow);
  const pin = pinWorkflow(runsDir, a.workflow_source);
  if (!pin.ok) throw new Error(`${runStateRecord(wtPath, run, runsDir)}/workflow.yaml is already pinned with different content`);
  const loc: UnitLoc = (act.obs.units[a.unit.key] = {
    unit: a.unit,
    story: a.unit.story,
    root: wtPath,
    runsDir,
    handoffFile: handoffPath(join(wtPath, story.spec_dir), a.unit.dir),
    worktree: wtPath,
    branch: a.worktree?.branch ?? story.branch,
    state: null,
    workflow: null,
  });
  act.writeReceipts(loc, a.receipts);
  if (a.state) act.writeUnitState(a.unit, runsDir, a.state);
  if (a.story_status) {
    const r = patchStoryFile(storyFile(join(wtPath, story.spec_dir)), { status: a.story_status }, wtPath);
    detail.story_status = r.ok ? a.story_status : r.reason;
  }
  detail.commit = await act.commit(a.commit, a.unit, a.state);
  return { ok: true, detail };
}

export async function markDone(act: ActEnv, a: Extract<Action, { kind: "mark_done" }>): Promise<ActionResult> {
  const story = act.storyLoc(a.unit.story);
  const storyWt = story.worktree;
  const detail: Record<string, unknown> = {};
  const loc = act.unitLoc(a.unit);
  act.writeReceipts(loc, a.receipts);
  if (a.state) act.writeUnitState(a.unit, loc.runsDir, a.state);
  const wt = a.cleanup.worktree;
  if (wt && existsSync(wt) && a.unit.slice) {
    // the slice's final state commit ($done) lands after integration: bring it into the story branch
    const res = await integrate(act.git, { sliceCwd: wt, storyBranch: story.branch, trailers: nornTrailers(act.tick, a.unit.story, a.unit.slice, "$done"), ...(storyWt ? { storyCwd: storyWt } : {}) });
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
  if (a.commit) detail.unit_commit = await act.commit(a.commit, a.unit, a.state);
  return { ok: true, detail };
}

export async function rejectReceipt(act: ActEnv, a: Extract<Action, { kind: "reject_receipt" }>): Promise<ActionResult> {
  if ("ref" in a.source) {
    // Kept before the ref goes, so a failed keep leaves the receipt for the next tick
    // (kept once per receipt id); kept after, a failure would lose it for good
    if (a.keep) await addRejectedReceipt(act.root, a.keep);
    const res = await deleteMailbox(act.root, act.obs.remote, a.source.ref, a.source.sha);
    act.traceReject(a.unit.key, a.source.ref, a.reason, { sha: a.source.sha });
    return { ok: true, detail: { deleted: res.ok } };
  }
  const loc = act.unitLoc(a.unit);
  if (a.state) act.writeUnitState(a.unit, loc.runsDir, a.state);
  act.traceReject(a.unit.key, `receipt ${a.source.n}`, a.reason);
  return { ok: true };
}

export async function claim(act: ActEnv, a: Extract<Action, { kind: "claim" }>): Promise<ActionResult> {
  const story = a.unit.story;
  const remote = act.obs.remote;
  if (a.op === "release") {
    const r = await releaseClaim(act.root, remote, story, a.expected ?? "");
    return r.ok ? { ok: true } : { ok: false, error: r.message };
  }
  if (!a.blob) throw new Error("claim without blob");
  if (a.op === "renew") return (await renewAll(act, [a]))[0] as ActionResult;
  const r = await acquireClaim(act.root, remote, a.blob, { now: act.obs.facts.now });
  const res = claimed(act, a, r);
  // The intake race is lost — undo what the intake made here, unless it holds work
  if (a.lost_intake && !res.ok && claimLost(res)) (res.detail as Record<string, unknown>).intake = await dropLostIntake(act, story, a.lost_intake).catch((e: Error) => ({ kept: `clean-up failed: ${e.message}` }));
  return res;
}

/**
 * Renew every claim due this tick in one CAS batch (one push to the remote), one result
 * per action in order. A lost CAS fails only its own story.
 */
export async function renewAll(act: ActEnv, as: ReadonlyArray<Extract<Action, { kind: "claim" }>>): Promise<ActionResult[]> {
  const rs = await renewClaims(
    act.root,
    act.obs.remote,
    as.map((a) => {
      if (!a.blob) throw new Error("claim without blob");
      return { blob: a.blob, expected: a.expected ?? "" };
    }),
  );
  return rs.map((r, i) => claimed(act, as[i] as Extract<Action, { kind: "claim" }>, r));
}

function claimed(act: ActEnv, a: Extract<Action, { kind: "claim" }>, r: ClaimWriteResult): ActionResult {
  if (!r.ok) return { ok: false, error: r.message, detail: { reason: r.reason } };
  act.claimed.set(a.unit.story, { blob: a.blob as ClaimBlob, sha: r.sha });
  return { ok: true, detail: { sha: r.sha } };
}

/**
 * After losing an intake's acquire, remove what decide said holds nothing beyond the
 * intake (`lost_intake.drop`): the story worktree, its local branch (and the spec folder in it) and
 * its slot. Otherwise keep everything: the branch and worktree stay for a person to look at.
 */
async function dropLostIntake(act: ActEnv, story: string, lost: NonNullable<Extract<Action, { kind: "claim" }>["lost_intake"]>): Promise<{ removed: string[] } | { kept: string }> {
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
  removed.push(...(await releaseStoryLeases(act.ctx.home, act.root, story)));
  return { removed };
}

export async function intake(act: ActEnv, a: Extract<Action, { kind: "intake_story" }>): Promise<ActionResult> {
  const unit: UnitRef = { story: a.key, slice: null, dir: STORY_UNIT_DIR, key: a.key };
  const specDir = dirname(a.story_file);
  // A story already intaken elsewhere (its branch is on the remote) is continued by take, never re-intaken
  // (a local branch with no worktree too: a wiped machine dir takes the worktree and leaves the branch)
  if (act.obs.remote && !existsSync(a.worktree.path) && (await act.git.branchExists(act.root, a.worktree.branch, "remote", act.obs.remote)))
    return { ok: true, detail: { skipped: `${a.worktree.branch} already exists on ${act.obs.remote}`, do_instead: cmd.storyCheckout(a.key) } };
  const wt = await ensureWorktree(act, a.worktree, unit, specDir);
  // A folder an older norn intook keeps its story.md (storyFile reads it), so it is never written twice
  const file = join(a.worktree.path, a.story_file);
  const written = !existsSync(storyFile(dirname(file)));
  if (written) writeStoryFile(file, a.frontmatter, a.body.endsWith("\n") || !a.body ? `\n${a.body}` : `\n${a.body}\n`);
  const committed = await act.commit(a.commit, null, null);
  return { ok: true, detail: { worktree: a.worktree.path, ...wt, story_file: written ? a.story_file : "exists", ...committed } };
}

export async function mirror(act: ActEnv, a: Extract<Action, { kind: "update_story_mirror" }>): Promise<ActionResult> {
  const story = act.storyLoc(a.unit.story);
  if (!story.worktree) return { ok: true, detail: { skipped: "no story worktree; spec.md is never written in the main checkout" } };
  const r = patchStoryFile(storyFile(join(story.worktree, story.spec_dir)), a.fields, story.worktree);
  if (!r.ok) throw new Error(`cannot update spec.md: ${r.reason}`);
  await act.notify(a.notify);
  return { ok: true, detail: await act.commit(a.commit, null, null) };
}

export async function retitlePr(act: ActEnv, a: Extract<Action, { kind: "retitle_pr" }>): Promise<ActionResult> {
  const remote = act.obs.ports.remote;
  if (!remote) throw new Error("no remote provider configured");
  await remote.editPullRequestTitle(a.number, a.title);
  return { ok: true, detail: { pr: a.number, title: a.title } };
}

/** The archive push (`pushHeldRecord`, the one closing and every claim release make too) before any cleanup; a failure says why the cleanup waits. */
async function archiveRecord(act: ActEnv, key: string): Promise<{ archive: Record<string, unknown> } | { error: string; detail: Record<string, unknown> }> {
  const branch = act.obs.facts.stories.find((s) => s.key === key)?.branch ?? null;
  const r = await pushHeldRecord(act.obs, key, branch);
  if (r.ok) return { archive: { ref: recordRef(key), ...r } };
  return {
    error: `archive ${recordRef(key)} on ${act.obs.remote ?? "this checkout"} failed (${r.reason}): ${r.message}; nothing was cleaned up, the next tick tries again`,
    detail: { archive: { ref: recordRef(key), reason: r.reason, message: r.message } },
  };
}

export async function cleanupMerged(act: ActEnv, a: Extract<Action, { kind: "cleanup_merged_story" }>): Promise<ActionResult> {
  // The merge is the final outcome; each unfinished unit is recorded done first, so the
  // archive below carries it and nothing parked at merge time stays in the inbox. A failed archive
  // leaves the cleanup owed: the next tick decides it again and writes the same states.
  for (const f of a.finish) act.writeUnitState(f.unit, act.unitLoc(f.unit).runsDir, f.state);
  // The final record is on its archive ref before anything is removed; a failed push leaves the cleanup owed
  const archived = await archiveRecord(act, a.unit.story);
  if ("error" in archived) return { ok: false, error: archived.error, detail: archived.detail };
  const detail: Record<string, unknown> = { ...archived };
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
  await releaseStoryLeases(act.ctx.home, act.root, a.unit.story);
  for (const b of a.local_branches) if (await act.git.branchExists(act.root, b)) await tryDo(`delete ${b}`, () => act.git.deleteBranch(act.root, b, { force: true }));
  if (act.obs.remote) for (const b of a.remote_branches) await tryDo(`delete remote ${b}`, () => act.git.deleteRemoteBranch(act.root, act.obs.remote as string, b));
  for (const ref of a.refs) {
    await tryDo(`delete ${ref}`, async () => {
      await act.git.updateRef(act.root, { ref, sha: null });
      if (act.obs.remote) await act.git.pushRef(act.root, act.obs.remote, { ref, sha: null });
    });
  }
  // the record stays on the base branch: mark spec.md done there (record.ts; never forced).
  // Deferred (merge not on the base yet) or failed → owed; later ticks retry it (retryRecords).
  // The done record: how the PR landed (merge commit, merged_by, merged_at, by ancestry) goes into
  // spec.md `merge:` on the base with the status (record.ts), and is kept in records.json while owed
  const story = act.storyLoc(a.unit.story);
  const facts = act.obs.facts.stories.find((s) => s.key === a.unit.story);
  const merge = facts ? await mergeFacts({ root: act.root, remote: act.obs.remote, git: act.git, base: act.obs.facts.repo.default_branch, story: facts }).catch(() => undefined) : undefined;
  if (merge) detail.merge = merge;
  detail.record = await record(act, { story: a.unit.story, spec_dir: story.spec_dir, status: a.story_status, attempted_at: 0, attempts: 0, reason: "", ...(merge ? { merge } : {}) });
  return errors.length ? { ok: false, error: errors.join("; "), detail } : { ok: true, detail };
}

/**
 * The issue closed on a finished round with no PR — the effects of `norn story
 * close` (runtime/close.ts: push first, then remove worktrees, local branches, leases and the claim),
 * then the mailbox refs. A failure before the removals leaves everything in place; the next tick re-decides.
 */
export async function closeClosedIssueStory(act: ActEnv, a: Extract<Action, { kind: "close_story" }>): Promise<ActionResult> {
  const key = a.unit.story;
  const story = act.obs.facts.stories.find((s) => s.key === key);
  const claimSha = act.claimed.get(key)?.sha ?? (story?.claim.state === "mine" ? story.claim.sha : null);
  if (!story || !claimSha) throw new Error(`${key} is not held here; nothing closed`);
  // closeStory pushes the final record to its archive ref before it removes anything
  const r = await closeStory(act.obs, story, { home: act.ctx.home, claimSha });
  if (!r.ok) {
    const error =
      r.reason === "push_failed"
        ? `push ${r.branch} failed (${r.push_reason}): ${r.message}; nothing was removed`
        : r.reason === "record_push_failed"
          ? `${recordPushError(key, r.push_reason, r.message)}; nothing was removed, the next tick tries again`
          : `cannot mark ${r.file} dropped: ${r.message}`;
    return { ok: false, error, detail: r };
  }
  act.cleaned.add(key);
  const deleted: string[] = [];
  for (const m of a.refs) if ((await deleteMailbox(act.root, act.obs.remote, m.ref, m.sha)).ok) deleted.push(m.ref);
  const { ok: _ok, story: _story, ...effects } = r;
  return { ok: true, detail: { ...effects, mailbox_deleted: deleted } };
}

/** One attempt at a base-branch done record; keeps it in `records.json` until it lands (idempotent: `unchanged` counts). */
async function record(act: ActEnv, p: PendingRecord): Promise<RecordResult & { stopped?: true }> {
  const res: RecordResult = await markStoryOnBase({
    root: act.root,
    remote: act.obs.remote,
    git: act.git,
    base: act.obs.facts.repo.default_branch,
    spec_dir: p.spec_dir,
    story: p.story,
    status: p.status,
    trailers: { "Norn-Story": p.story, "Norn-Tick": act.tick },
    ...(p.merge ? { merge: p.merge } : {}),
  }).catch((e: Error) => ({ state: "failed" as const, branch: act.obs.facts.repo.default_branch, reason: e.message, kind: "waiting" as const }));
  const rest = readPendingRecords(act.root).filter((r) => r.story !== p.story);
  let stopped = false;
  if (res.state === "deferred" || res.state === "failed") {
    const refusals = (p.refusals ?? 0) + (res.kind === "refused" ? 1 : 0);
    const now = act.ctx.clock.now();
    const stopped_at = recordStopsAt(refusals, p.stopped_at, now);
    stopped = stopped_at !== undefined && p.stopped_at === undefined;
    rest.push({ ...p, attempted_at: now, attempts: p.attempts + 1, reason: res.reason, ...(refusals ? { refusals } : {}), ...(stopped_at !== undefined ? { stopped_at } : {}) });
  }
  writePendingRecords(act.root, rest);
  return stopped ? { ...res, stopped: true } : res;
}

export type RecordRetry = { story: string; state: string; reason?: string; stopped?: true };

/**
 * Retry owed base-branch records, at most once per `remote.sync_interval` each, until the base
 * refuses RECORD_REFUSALS times; a record the base already reads closed is dropped without a push.
 */
export async function retryRecords(act: ActEnv): Promise<RecordRetry[]> {
  const every = parseDuration(act.config.sync_interval);
  const now = act.ctx.clock.now();
  const out: RecordRetry[] = [];
  for (const p of readPendingRecords(act.root)) {
    // before the throttle and for stopped records too: a landed PR or another checkout's record
    // clears it from facts already observed, with no fetch and no push
    const story = act.obs.facts.stories.find((s) => s.key === p.story);
    if (recordOnBase(story, !act.obs.remote)) {
      writePendingRecords(act.root, readPendingRecords(act.root).filter((r) => r.story !== p.story));
      out.push({ story: p.story, state: "unchanged" });
      continue;
    }
    if (!recordRetryDue(p, now, every)) continue;
    const r = await record(act, p);
    out.push({ story: p.story, state: r.state, ...("reason" in r ? { reason: r.reason } : {}), ...(r.stopped ? { stopped: true as const } : {}) });
  }
  return out;
}

/**
 * A flat story record moves into round 1 — every entry of `_story/` but `rounds/` —
 * inside the machine dir, so nothing is committed: the worktree holds only the handoff,
 * which stays where it is. Receipt paths are relative to the round, so they still resolve; slice folders
 * are not touched. Resumable: `state.json` moves last, so a move that stops partway still reads as
 * flat and the next round.migrate moves what is left; an entry already in the round is merged into,
 * entry by entry.
 */
export async function roundMigrate(act: ActEnv, a: Extract<Action, { kind: "round_migrate" }>): Promise<ActionResult> {
  const from = runStateFile(act.root, a.from);
  const to = runStateFile(act.root, a.to);
  mkdirSync(to, { recursive: true });
  const moved = readdirSync(from)
    .filter((n) => n !== ROUNDS_DIR)
    .sort((x, y) => Number(x === "state.json") - Number(y === "state.json") || x.localeCompare(y));
  for (const name of moved) migrateEntry(join(from, name), join(to, name), `${a.to}/${name}`);
  const loc = act.obs.units[a.unit.key];
  if (loc) loc.runsDir = to;
  return { ok: true, detail: { moved, to: a.to } };
}

/**
 * This checkout's own record of a story another heartbeat holds leaves
 * `runs/<story>/` in one rename: set aside whole under `superseded/<name>/` with its
 * `superseded.json`, or, already on the ref after a clean release, removed quietly. Nothing is pushed.
 */
export async function setAsideRecordAct(act: ActEnv, a: Extract<Action, { kind: "set_aside_record" }>): Promise<ActionResult> {
  const story = act.storyLoc(a.unit.story);
  const run = { key: story.key, spec_dir: story.spec_dir };
  if (!a.superseded) {
    dropLocalRecord(act.root, run, act.obs.facts.tick_id);
    return { ok: true, detail: { removed: true } };
  }
  const dir = setAsideRecord(act.root, run, a.superseded.name, { story: story.key, holder: a.superseded.holder, last_receipt: a.superseded.last_receipt, superseded_at: new Date(act.obs.facts.now).toISOString() });
  return { ok: true, detail: { superseded: dir } };
}

/** Move one record entry to the round; into a folder already there (an earlier move that stopped partway), child by child. */
function migrateEntry(from: string, target: string, name: string): void {
  if (existsSync(target)) {
    if (!statSync(target).isDirectory() || !statSync(from).isDirectory()) throw new Error(`round.migrate: ${name} already exists`);
    for (const child of readdirSync(from).sort()) migrateEntry(join(from, child), join(target, child), `${name}/${child}`);
    rmSync(from, { recursive: true, force: true });
    return;
  }
  moveFile(from, target);
}

/**
 * End the old round in its own folder (its state with the round receipt
 * applied), then create the new round's folder — workflow pinned, first state written last —
 * set the story's `workflow:`, and commit the shared handoff and spec.md in one commit (the round
 * folders are in the machine dir).
 */
export async function roundStart(act: ActEnv, a: Extract<Action, { kind: "round_start" }>): Promise<ActionResult> {
  const loc = act.unitLoc(a.unit);
  const story = act.storyLoc(a.unit.story);
  const wt = a.commit?.cwd ?? loc.worktree;
  if (!wt) throw new Error(`no worktree for ${a.unit.key}`);
  const oldDir = loc.runsDir;
  const dir = runStateFile(act.root, a.round.dir);
  const pin = pinWorkflow(dir, a.workflow_source);
  if (!pin.ok) throw new Error(`${a.round.dir}/workflow.yaml is already pinned with different content`);
  // The new round's state is the commit point — a round folder without state.json is not the current
  // round (store currentRound), so before it the old round stays the record and the next tick applies
  // the round receipt again; once it exists the story is in round N, whatever happens to the old state after
  act.obs.units[a.unit.key] = { ...loc, runsDir: dir, state: null, workflow: null };
  act.writeUnitState(a.unit, dir, a.state);
  writeState(oldDir, a.ended);
  for (const r of a.rejected) act.traceReject(a.unit.key, `receipt ${r.n}`, r.reason, { receipt_id: r.receipt_id });
  const fm = patchStoryFile(storyFile(join(wt, story.spec_dir)), { workflow: a.round.workflow }, wt);
  const commit = await act.commit(a.commit, a.unit, a.state);
  const label = await swapRoundLabel(act, a.label);
  return { ok: true, detail: { round: a.round, story_file: fm.ok ? "updated" : fm.reason, commit, ...(label.swapped ? { label: a.label } : {}) }, ...(label.warning ? { warnings: [label.warning] } : {}) };
}

/** Swap the issue's workflow label after the round started; a failure is only a warning. */
async function swapRoundLabel(act: ActEnv, label: Extract<Action, { kind: "round_start" }>["label"]): Promise<{ swapped: boolean; warning?: string }> {
  if (!label) return { swapped: false };
  const remote = act.obs.ports.remote;
  const what = `issue #${label.number} label ${label.remove} → ${label.add}`;
  if (!remote) return { swapped: false, warning: `${what} not updated: no remote provider configured` };
  try {
    await remote.replaceIssueLabel(label.number, { remove: label.remove, add: label.add });
    return { swapped: true };
  } catch (e) {
    return { swapped: false, warning: `${what} not updated: ${(e as Error).message}` };
  }
}

/**
 * Push the story's record to `refs/norn/runs/<story>` after the tick's branch pushes, its
 * `Norn-Branch-Commit` the story's heads ref as pushed (the local head without a remote). While the
 * heads ref does not hold the story branch as it is here (its push failed this tick, or has not happened yet), the
 * record waits: it would describe work the remote does not hold. A lease that no longer holds
 * (another checkout pushed the ref) or a rejected push leaves the record owed, the reason in the
 * trace: the next tick tries again.
 */
export async function pushRecord(act: ActEnv, a: Extract<Action, { kind: "push_record" }>): Promise<ActionResult> {
  const story = act.storyLoc(a.unit.story);
  const remote = act.obs.remote;
  const local = await act.git.revParse(act.root, `refs/heads/${a.branch}`);
  const head = remote ? await act.git.revParse(act.root, headsRef(a.unit.story)) : local;
  if (local !== null && head !== local)
    return { ok: false, error: `record push for ${a.unit.story} waits: ${a.branch} is not on ${remote} as it is here (${headsRef(a.unit.story)} has ${head ?? "nothing"}); the next tick pushes it after the branch` };
  const r = await pushStoryRecord(act.root, remote, story, { expected: a.expected, holder: a.holder, branch_commit: head, at: act.nowIso() });
  if (r.ok) return { ok: true, detail: r };
  const why =
    r.reason === "stale" || r.reason === "rejected"
      ? `${recordRef(a.unit.story)} on ${remote} is not the record this checkout last saw (${a.expected ?? "none"}): another checkout pushed it, or the remote refused it; nothing overwritten`
      : `${r.reason}: ${r.message}`;
  return { ok: false, error: `record push for ${a.unit.story} failed, owed to the next tick: ${why}`, detail: { reason: r.reason, message: r.message } };
}
