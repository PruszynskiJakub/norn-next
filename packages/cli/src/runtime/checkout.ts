/**
 * Story checkout: continue a story on this machine from git alone. The command is
 * `norn story checkout`; a later reopen restores through the same steps.
 *
 * One transaction: every check that needs the remote or can fail comes before
 * the claim, and after the claim only local steps, the take receipt first — so a refusal takes
 * nothing, and no failure leaves a held story a tick would start over or resume on a stale cursor.
 *
 * Before the claim (a refusal changes nothing here or on the remote):
 * 1. The claim as on the remote: held by another heartbeat and unexpired → refused "held by X
 *    since Y" unless `--force`.
 * 2. The story's record, `refs/norn/runs/<story>` alone: its objects fetched (no local ref
 *    yet) and staged beside its place in the machine dir with every file validated. A
 *    checkout that holds the claim and the run state already keeps its own (nothing staged), unless the
 *    remote record continues from the one it last had: then its copy is older. A local copy not kept
 *    is never replaced whole: in step 5 it is set aside as superseded, or removed quietly when it is
 *    a record this machine pushed.
 * 3. The story and slice branches fetched; a local story branch that diverged from the remote one is
 *    refused (norn never resets work). The record's `Norn-Branch-Commit` is checked against the story
 *    branch head: an ancestor continues, else the branch was rewritten and the step
 *    restarts as a new attempt, once per gone commit. A story without a branch skips it.
 *    No record at all — none on the ref, none of this checkout's own — for a story the branch shows
 *    started: the record is lost. The new round is read off the branch head here:
 *    the frontmatter's workflow (a missing or invalid one is refused) and the step its last boundary led to (`Norn-Next`).
 * Then:
 * 4. Claim by CAS (`--force` records `forced_from` in the claim blob); the remote record ref must
 *    still be the one staged (a still-running holder may have pushed): if it moved, the
 *    claim is given back and the command refused.
 * 5. Locally: the `take` trace event and receipt (carrying the rewrite), written into the staged
 *    record — with the record lost, into a new round staged empty: the workflow pinned from the branch,
 *    the take (`record_lost`), the state at the restart step, attempt 1, counters at zero — then the
 *    record renamed into place and the local record ref set to it (the lease of this checkout's next
 *    record push); then the worktrees with slots, `.env.norn` and `.norn-unit`, local branches only
 *    created or moved forward. A forced take is journaled in the claim blob and the take receipt.
 * 6. Print each unit's cursor, and its status as the next tick will have it above its handoff's
 *    written part. The next `norn tick` resumes from the run state.
 */
import { existsSync } from "node:fs";
import { join, relative } from "node:path";
import {
  applyReceipts,
  branchRewrittenLine,
  checkWorkflowLevel,
  cmd,
  type GitPort,
  type RemotePort,
  type Ports,
  initialState,
  recordLostLine,
  renderHandoffWithStatus,
  restartStepOf,
  rewriteRestart,
  sliceWorktreePath,
  storyWorktreePath,
} from "@norn/core";
import { ExitCode, headsRef, type ReceiptOf, recordRef, type RunStory, sliceBranch, sliceDirName, SPEC_FILE, specDir, STORY_UNIT_DIR, ulid, type UnitState, type Workflow } from "@norn/schema";
import {
  acquireClaim,
  appendReceipt,
  appendTrace,
  fetchRecordCommit,
  listRemoteRefs,
  handoffPath,
  listReceipts,
  loadStory,
  parseStoryFile,
  parseWorkflowText,
  pinWorkflow,
  newClaimBlob,
  readPinnedWorkflow,
  readState,
  readHandoff,
  heartbeatId,
  lastBoundary,
  writtenHere,
  machineHolder,
  traceEvent,
  readRecordRef,
  recordBranchCommit,
  releaseClaim,
  remoteRecordSha,
  runStateDir,
  runStateDirIn,
  runStateStartDirIn,
  setRecordRef,
  stageEmptyRecord,
  stageRecordSync,
  dropLocalRecord,
  localRecordOf,
  recordHolder,
  setAsideRecord,
  type StagedRecord,
  storyRunStateDir,
  WORKFLOW_EXT,
  WORKFLOWS_DIR,
  writeState,
  worktreesDir,
} from "@norn/store";
import type { Context } from "../context.ts";
import { claimHeld, corruptError, failure, refuse, withExit } from "../output.ts";
import { claimFor } from "./human.ts";
import { leaseLiveness } from "./leases.ts";
import { gitRemote } from "./observe/index.ts";
import { equipWorktree, syncLocalBranch, type WorktreeTarget } from "./worktrees.ts";

const storyBranchRe = (key: string) => new RegExp(`^${key}-[a-z0-9][a-z0-9-]*$`);

/** The story branch name: on the remote (truth for a take), else a local branch. */
export async function findStoryBranch(ctx: Context, key: string, remote: string | null): Promise<string | null> {
  const re = storyBranchRe(key);
  if (remote) {
    const listed = await ctx.git.remoteBranches(ctx.root, remote, `refs/heads/${key}-*`).catch((e: unknown) => e as Error);
    if (listed instanceof Error) throw failure(`cannot list ${remote} branches: ${listed.message}`, "check the network and git credentials, then retry", "network");
    const names = listed.filter((n) => re.test(n));
    if (names.length) return names.sort()[0] as string;
  }
  const local = (await (await ctx.ports()).git.listRefs(ctx.root, "refs/heads/")).map((r) => r.ref.slice("refs/heads/".length)).filter((n) => re.test(n));
  return local.sort()[0] ?? null;
}

type Rewritten = { gone: string; head: string };
type TakeFacts = { holder: string; now: string; previous_holder: string | null; previous_heartbeat_id: string | null; expired: boolean; forced: boolean };

/**
 * Write the `take` receipt on the story unit at its cursor (next free number) in `runsDir` — the
 * staged record (before it is placed) or the machine dir's. A story unit not started yet has no cursor
 * to put it on; the take is then only in the trace and the claim blob.
 */
function takeReceipt(runsDir: string, t: TakeFacts & { rewritten: Rewritten | null; record_lost: boolean }, at?: UnitState): { receipt: string | null; note?: string } {
  const st = at ? { ok: true as const, value: at } : readState(runsDir);
  if (!st.ok) return { receipt: null, note: st.reason === "missing" ? "story unit not started; the take is in the trace" : "story state unreadable; the take is in the trace" };
  const r: ReceiptOf<"take"> = {
    kind: "take",
    receipt_id: ulid(Date.parse(t.now)),
    run_id: st.value.run?.run_id ?? null,
    step: st.value.step,
    attempt: st.value.attempt,
    at: t.now,
    by: "human",
    who: t.holder,
    previous_holder: t.previous_holder,
    previous_heartbeat_id: t.previous_heartbeat_id,
    expired: t.expired,
    ...(t.forced ? { forced: true } : {}),
    ...(t.rewritten ? { rewritten: t.rewritten } : {}),
    record_lost: t.record_lost,
  };
  const w = appendReceipt(runsDir, r);
  return { receipt: w.file.split("/").at(-1) as string };
}

/**
 * The story unit as the next tick will have it — its receipts not applied yet,
 * the take last, applied as the tick does (core `applyReceipts`) — and, when that take restarts the step,
 * the line saying so. A pending `round` receipt is applied by the tick alone, and the receipts after it
 * (the take among them) are rejected into the trace: the round it starts is fresh, nothing to restart.
 */
function nextCursor(runsDir: string, gone: string | null): { state: UnitState | null; restarted: string | null } {
  const st = readState(runsDir);
  const wf = readPinnedWorkflow(runsDir);
  if (!st.ok) return { state: null, restarted: null };
  const listed = listReceipts(runsDir, { after: st.value.applied_through });
  if (!wf.ok || listed.errors.length || listed.receipts.some((r) => r.receipt.kind === "round")) return { state: st.value, restarted: null };
  const ctx = { workflow: wf.value.workflow, now: st.value.updated_at };
  const take = listed.receipts.at(-1);
  const before = applyReceipts(st.value, listed.receipts.slice(0, -1), ctx).state;
  const after = applyReceipts(before, take ? [take] : [], ctx).state;
  const restarts = gone !== null && take?.receipt.kind === "take" && rewriteRestart(before, take.receipt, wf.value.workflow) !== null;
  return { state: after, restarted: restarts && gone ? branchRewrittenLine(st.value.story, gone, after.step, after.attempt) : null };
}

/** What checkout takes of the story's record. */
interface TakenRecord {
  /** the record commit on `refs/norn/runs/<story>` */
  sha: string;
  /** its `Norn-Branch-Commit`; null = recorded without a branch */
  branch_commit: string | null;
  /** unpacked into the machine dir (false: this checkout holds the claim and keeps its own run state) */
  unpacked: boolean;
}
type Staged = Extract<StagedRecord, { ok: true }>;

/**
 * Before anything is taken, the story's record —
 * `refs/norn/runs/<story>` fetched from `remote` alone (objects only, no local ref yet; without a remote
 * this checkout's own ref) — and, unless `keepLocal`, staged beside its place with every file validated.
 * Null = no record ref. A record that cannot be fetched or does not validate is
 * refused here, with no claim taken and nothing changed.
 */
async function prepareRecord(ctx: Context, remote: string | null, story: RunStory, keepLocal: boolean): Promise<{ taken: TakenRecord; staged: Staged | null } | null> {
  const key = story.key;
  const sha = remote
    ? await fetchRecordCommit(ctx.root, remote, key).catch((e: unknown) => {
        throw failure(`cannot fetch ${recordRef(key)}: ${(e as Error).message}; nothing was taken`, `check the network, then ${cmd.storyCheckout(key)} again`, "network");
      })
    : ((await readRecordRef(ctx.root, key))?.sha ?? null);
  if (!sha) return null;
  let staged: Staged | null = null;
  if (!keepLocal) {
    const r = stageRecordSync(ctx.root, sha, storyRunStateDir(ctx.root, story));
    if (!r.ok)
      throw failure(
        `${recordRef(key)} at ${sha} does not unpack: ${r.errors.map((e) => `${e.file}: ${e.errors.map((x) => x.message).join(", ")}`).join("; ")}; nothing was taken`,
        `fix or delete ${recordRef(key)} on ${remote ?? "this checkout"}, then ${cmd.storyCheckout(key)} again`,
        "record_corrupt",
      );
    staged = r;
  }
  return { taken: { sha, branch_commit: await recordBranchCommit(ctx.root, sha), unpacked: !keepLocal }, staged };
}

/**
 * The record's branch commit `gone` is gone when it is not here or not an ancestor of the
 * story branch `head`. Once per gone commit: a take of this record that already carries the
 * same rewrite (a checkout retried after a failure, or run again by the holder) is not repeated.
 */
async function rewrittenSince(git: GitPort, root: string, gone: string | null, head: string | null, storyRuns: string): Promise<Rewritten | null> {
  if (!gone || !head) return null;
  if ((await git.revParse(root, `${gone}^{commit}`)) && (await git.isAncestor(root, gone, head))) return null;
  const seen = listReceipts(storyRuns).receipts.some(({ receipt: r }) => r.kind === "take" && r.rewritten?.gone === gone);
  return seen ? null : { gone, head };
}

/** What a takeover with the record lost starts: a new round read off the story branch head. */
interface LostRecord {
  workflow: { name: string; source: string; workflow: Workflow };
  step: string;
  /** the claim's holder the record was on; null when the claim was free */
  holder: string | null;
  line: string;
}

/**
 * With no record to take over, the round a takeover starts from the branch `head`
 * (`headRef`, its ref) — or null when there is nothing to restart: the story not started on the branch
 * (its frontmatter not `active`: the tick starts it as any new story). The frontmatter's workflow pinned fresh from the branch; a
 * missing or invalid one refuses before anything is taken. The step: `restartStepOf` the story unit's
 * last boundary on the branch (its `Norn-Next`).
 */
async function lostRecord(git: GitPort, root: string, story: RunStory, branch: string, head: string, headRef: string, holder: string | null): Promise<LostRecord | null> {
  const key = story.key;
  const file = `${story.spec_dir}/${SPEC_FILE}`;
  const raw = await git.show(root, head, file);
  if (raw === null) return null;
  const fm = parseStoryFile(raw, file);
  // A story file that fails validation is refused, never read as "not started"
  if (!fm.ok)
    throw corruptError(
      `the record of ${key} is lost and ${file} on ${branch} ${fm.reason === "corrupt" ? `fails validation (${fm.error.errors.map((e) => e.message).join(", ")})` : "cannot be read"}; nothing was taken`,
      `fix ${file} on ${branch}, then ${cmd.storyCheckout(key)} again`,
      fm.reason === "corrupt" ? [fm.error] : undefined,
    );
  if (fm.value.frontmatter.status !== "active") return null;
  const name = fm.value.frontmatter.workflow;
  const again = cmd.storyCheckout(key);
  let found: { path: string; source: string } | null = null;
  for (const ext of WORKFLOW_EXT) {
    const path = `${WORKFLOWS_DIR}/${name}${ext}`;
    const source = await git.show(root, head, path);
    if (source !== null) {
      found = { path, source };
      break;
    }
  }
  if (!found) throw refuse(`the record of ${key} is lost and ${branch} has no workflow '${name}' to restart it with; nothing was taken`, `add ${WORKFLOWS_DIR}/${name}.yaml to ${branch}, then ${again} again`, "workflow_invalid");
  const parsed = parseWorkflowText(found.source, found.path);
  const issues = parsed.ok ? checkWorkflowLevel(parsed.value, "story").map((i) => i.message) : [parsed.reason === "corrupt" ? parsed.error.errors.map((e) => e.message).join(", ") : parsed.reason];
  if (!parsed.ok || issues.length || parsed.value.name !== name)
    throw refuse(
      `the record of ${key} is lost and workflow '${name}' on ${branch} is invalid (${issues.join("; ") || `its name is not '${name}'`}); nothing was taken`,
      `fix ${found.path} on ${branch}, then ${again} again`,
      "workflow_invalid",
    );
  const last = await lastBoundary(root, headRef, key, null, { strict: true }).catch((e: unknown) => {
    throw failure(`the record of ${key} is lost and ${branch}'s boundaries cannot be read: ${(e as Error).message}; nothing was taken`, `check the repository, then ${again} again`, "git_failed");
  });
  const step = restartStepOf(parsed.value, last);
  return { workflow: { name, source: found.source, workflow: parsed.value }, step, holder, line: recordLostLine(key, holder, step) };
}

/**
 * The new round of a lost record, written into `base` (a story's run-state folder staged
 * empty): its workflow pinned, the take receipt first, then the state at the restart step — round 1
 * of the record that starts here, attempt 1, counters at zero — last. The tick applies the take.
 */
function writeLostRound(base: string, key: string, lost: LostRecord, take: TakeFacts & { rewritten: null; record_lost: true }): { receipt: string | null } {
  const dir = runStateStartDirIn(base, STORY_UNIT_DIR, lost.workflow.name);
  const pin = pinWorkflow(dir, lost.workflow.source);
  const state = initialState({ unit: { story: key, slice: null, dir: STORY_UNIT_DIR, key }, workflow: lost.workflow.workflow, workflowName: lost.workflow.name, workflowHash: pin.hash, now: take.now, at: lost.step });
  const r = takeReceipt(dir, take, state);
  writeState(dir, state);
  return r;
}

/**
 * How the heads ref `ref` stands to the remote branch `base`: `ahead` (commits `base` lacks, none
 * it lacks), `diverged` (each has commits the other lacks), or `behind` (nothing `base` lacks).
 */
async function headsVersus(git: GitPort, root: string, ref: string, base: string): Promise<"ahead" | "diverged" | "behind"> {
  const a = await git.readRef(root, ref);
  const b = await git.readRef(root, base);
  if (!a || a === b) return "behind";
  if (!b || (await git.isAncestor(root, b, a))) return "ahead";
  return (await git.isAncestor(root, a, b)) ? "behind" : "diverged";
}

/** The story branch's PR is open on the remote; a provider failure refuses before anything is taken. */
async function prOpen(remote: RemotePort | null, branch: string, again: string): Promise<boolean> {
  if (!remote) return false;
  const pr = await remote.findPullRequest(branch).catch((e: unknown) => {
    throw failure(`cannot read the pull request of ${branch}: ${(e as Error).message}; nothing was taken`, `check the network, then ${again} again`, "network");
  });
  return pr?.state === "open";
}

/** A local branch that has commits its remote branch does not, and the other way round (norn never resets work). */
async function divergedFrom(git: GitPort, root: string, branch: string, upstream: string): Promise<boolean> {
  const cur = await git.readRef(root, `refs/heads/${branch}`);
  const up = await git.readRef(root, upstream);
  if (!cur || !up || cur === up) return false;
  return !(await git.isAncestor(root, cur, up)) && !(await git.isAncestor(root, up, cur));
}

interface UnitView {
  unit: string;
  worktree: string | null;
  step: string | null;
  status: string | null;
  park: unknown;
  handoff: string | null;
}

/**
 * More of the record a caller writes once the worktrees are back (`story reopen`), committed with the
 * take receipt in the one story-branch commit: its paths relative to the story worktree, the commit
 * message, and what to add to the printed value.
 */
export type CheckoutRecord = (restored: { storyWt: string; spec_dir: string; worktrees: ReadonlyArray<{ unit: string; path: string; branch: string }> }) => {
  paths: string[];
  message: string;
  value: Record<string, unknown>;
};

/** Step 1: the claim as on the remote; held by another heartbeat or unreadable is refused unless `force`. */
async function claimAsOnRemote(ctx: Context, key: string, force: boolean, remote: string | null, hb: string) {
  const cur = await claimFor(ctx, key, { remote, unreadable: (e) => failure(`cannot read the claim: ${e.message}`, "check the network, then retry", "network") });
  if (cur.state === "corrupt" && !force) throw corruptError(`claim ref of ${key} is unreadable`, cmd.storyCheckout(key, { force: true }), cur.error);
  if (cur.state === "other" && !force)
    throw claimHeld(cur.blob, `wait until ${cur.blob.expires_at}, ask ${cur.blob.holder} to run ${cmd.storyHandoff(key)}, or ${cmd.storyCheckout(key, { force: true })}`);
  const mine = writtenHere(cur, hb);
  const forced = force && (cur.state === "other" || cur.state === "corrupt");
  const prev = cur.state === "none" || cur.state === "corrupt" ? null : cur.blob;
  return { cur, mine, forced, prev };
}

/**
 * Step 2: the record, fetched and staged; the holder keeps its own run state unless the
 * remote record is newer than it, so an older copy a crashed or failed checkout left behind
 * is never pushed over a newer record. Newer: the remote record continues from the record ref this
 * checkout last had, or this checkout had none and the remote now has one (someone else pushed it:
 * the copy here is set aside as superseded in step 5, never lost). A ref moved off the holder's line
 * (not a descendant of its own) is not newer: the holder's run state is kept, its next push on top.
 * `record: false`: the caller restores the record itself, so nothing is prepared.
 */
async function planRecord(ctx: Context, git: GitPort, remote: string | null, run: RunStory, o: { mine: boolean; holder: string; record: boolean }) {
  const { root } = ctx;
  const { key } = run;
  const { mine, holder, record } = o;
  const again = cmd.storyCheckout(key);
  const localCopy = existsSync(storyRunStateDir(root, run));
  const ownRef = mine && localCopy ? await readRecordRef(root, key) : null;
  const remoteSha =
    mine && localCopy && remote
      ? await fetchRecordCommit(root, remote, key).catch((e: unknown) => {
          throw failure(`cannot fetch ${recordRef(key)}: ${(e as Error).message}; nothing was taken`, `check the network, then ${again} again`, "network");
        })
      : null;
  const continues = async (own: string, theirs: string): Promise<boolean> => {
    try {
      return await git.isAncestor(root, own, theirs);
    } catch (e) {
      // a git failure is no answer: refused before the claim, never read as "not newer"
      throw failure(`cannot tell whether ${recordRef(key)} on ${remote} continues from ${own.slice(0, 12)}: ${(e as Error).message}; nothing was taken`, `retry: ${again}`, "git_failed");
    }
  };
  const newer = remoteSha !== null && remoteSha !== (ownRef?.sha ?? null) && (ownRef === null || (await continues(ownRef.sha, remoteSha)));
  const keepLocal = mine && localCopy && !newer;
  const before = keepLocal ? ownRef : null;
  // A local copy not kept is never replaced whole: set aside as
  // superseded once the take is in, or removed quietly when it is a record this machine pushed (on the ref)
  const setAside = localCopy && !keepLocal ? await localRecordOf(root, run, holder) : null;
  const prepared = record ? await prepareRecord(ctx, remote, run, keepLocal) : null;
  return { keepLocal, before, setAside, prepared };
}

interface WorktreeRestore {
  git: GitPort;
  root: string;
  remote: string | null;
  wtByBranch: ReadonlyMap<string, string>;
  equip: Parameters<typeof equipWorktree>[0];
  problems: string[];
  worktrees: Array<{ unit: string; path: string; branch: string; local: string; created: boolean; slot: number | null }>;
}

/** One unit's branch brought here (only created or moved forward) and its worktree equipped; false, with a problem noted, when the branch cannot be. */
async function checkoutWorktree(w: WorktreeRestore, t: WorktreeTarget, unitKey: string, upstream?: string | null): Promise<boolean> {
  const { git, root, remote } = w;
  const existing = w.wtByBranch.get(t.branch) ?? null;
  const path = existing ?? t.path;
  const synced = remote ? await syncLocalBranch(git, root, t.branch, upstream ?? `refs/remotes/${remote}/${t.branch}`, existing) : { ok: true as const, local: "up-to-date" as const };
  if (!synced.ok) {
    w.problems.push(`${unitKey}: ${synced.error}`);
    return false;
  }
  let created = false;
  if (!existsSync(path)) {
    if (existing) await git.worktreePrune(root).catch(() => undefined);
    await git.worktreeAdd(root, path, t.branch);
    created = true;
  }
  const slot = await equipWorktree(w.equip, { ...t, path });
  w.worktrees.push({ unit: unitKey, path, branch: t.branch, local: synced.local, created, slot });
  return true;
}

/** A unit's cursor as printed, with its status above its handoff's written part; `at` is the state the next tick will have. */
function unitView(unit: string, wt: string | null, runsDir: string, handoff: string | null, at?: UnitState | null): UnitView {
  const read = readState(runsDir);
  const st = at ?? (read.ok ? read.value : null);
  const wf = readPinnedWorkflow(runsDir);
  const prose = handoff ? (readHandoff(handoff)?.body ?? null) : null;
  return {
    unit,
    worktree: wt,
    step: st ? st.step : null,
    status: st ? st.status : null,
    park: st ? (st.park ?? null) : null,
    // The unit's status, above the handoff's written part
    handoff: st ? renderHandoffWithStatus(st, prose, { workflow: wf.ok ? wf.value.workflow : null }) : prose,
  };
}

/**
 * Step 5b: the story and slice branches → worktrees, and each unit's view. A story branch
 * that cannot be brought here throws `onStoryFailed`'s failure; a slice's problem is noted and skipped.
 */
async function restoreWorktrees(
  ctx: Context,
  ports: Ports,
  remote: string | null,
  run: RunStory,
  branch: string | null,
  o: { storyUpstream: string | null; mergeIn: { rev: string; message: string; trailers: Record<string, string> } | null; placedRuns: string; storyState: UnitState | null; nowIso: string; onStoryFailed: (problems: string[]) => Error },
) {
  const root = ctx.root;
  const git = ports.git;
  const { key, spec_dir } = run;
  const w: WorktreeRestore = {
    git,
    root,
    remote,
    wtByBranch: new Map((await git.worktreeList(root)).filter((x) => x.branch).map((x) => [x.branch as string, x.path])),
    equip: { root, home: ctx.home, config: ctx.config, now: o.nowIso, liveness: leaseLiveness((p) => ports.process.isAlive(p)) },
    problems: [],
    worktrees: [],
  };
  const wtByBranch = w.wtByBranch;

  const storyWt = branch ? (wtByBranch.get(branch) ?? storyWorktreePath(worktreesDir(root), key, branch.slice(key.length + 1))) : null;
  if (branch && storyWt && !(await checkoutWorktree(w, { path: storyWt, branch, story: key, slice: null, unit: STORY_UNIT_DIR, spec_dir }, key, o.storyUpstream))) throw o.onStoryFailed(w.problems);
  if (storyWt && o.mergeIn) {
    // the merge was checked clean before the claim; a failure here is a worktree that changed meanwhile
    const m = await git.merge(storyWt, o.mergeIn.rev, { message: o.mergeIn.message, trailers: o.mergeIn.trailers }).catch((e: unknown) => ({ ok: false as const, error: (e as Error).message }));
    if (!m.ok) throw o.onStoryFailed([`${key}: cannot merge ${o.mergeIn.rev} into ${branch}: ${"files" in m ? `conflicts in ${m.files.join(", ")}` : m.error}`]);
  }

  const snapshot = storyWt ? loadStory(storyWt, join(storyWt, spec_dir)) : null;
  const units: UnitView[] = [];
  const storyHandoff = storyWt ? handoffPath(join(storyWt, spec_dir), STORY_UNIT_DIR) : null;
  // The story unit as the next tick will have it (the take applied)
  units.push(unitView(key, storyWt, o.placedRuns, storyHandoff, o.storyState));
  const sliceRefs = new Set(
    (await git.listRefs(root, remote ? `refs/remotes/${remote}/${key}/` : `refs/heads/${key}/`)).map((r) => r.ref.replace(remote ? `refs/remotes/${remote}/` : "refs/heads/", "")),
  );
  for (const s of snapshot?.slices ?? []) {
    const sb = sliceBranch(key, s.nn, s.slug);
    const dir = sliceDirName(s.nn, s.slug);
    const status = s.frontmatter?.status;
    let wt: string | null = null;
    if (storyWt && sliceRefs.has(sb) && status !== "integrated" && status !== "dropped") {
      const path = wtByBranch.get(sb) ?? sliceWorktreePath(storyWt, s.nn, s.slug);
      if (await checkoutWorktree(w, { path, branch: sb, story: key, slice: s.key, unit: dir, spec_dir }, s.key)) wt = wtByBranch.get(sb) ?? path;
    }
    const runs = runStateDir(root, run, dir);
    const handoffRoot = wt ?? storyWt;
    if (existsSync(runs)) units.push(unitView(s.key, wt, runs, handoffRoot ? handoffPath(join(handoffRoot, spec_dir), dir) : null));
  }
  return { problems: w.problems, worktrees: w.worktrees, units, storyWt, storyHandoff };
}

/**
 * Journal a take. A forced one is in the claim blob (`forced_from`) and the take receipt, which the
 * brief's History shows; the handoff is the unit's state, so it gets no line. What `more` adds is
 * committed and pushed on the story branch.
 */
async function journalTake(
  git: GitPort,
  remote: string | null,
  run: RunStory,
  o: {
    branch: string | null;
    holder: string;
    now: number;
    nowIso: string;
    /** set on a forced take */
    forced_from: string | null;
    storyWt: string | null;
    worktrees: ReadonlyArray<{ unit: string; path: string; branch: string }>;
    more: CheckoutRecord | undefined;
    /** the take receipt was written (the story unit has state) */
    receipted: boolean;
  },
) {
  const { key, spec_dir } = run;
  const { branch, holder, storyWt } = o;
  const forced = o.forced_from !== null;
  let journal: unknown = null;
  let committed: { commit: string | null; pushed: boolean | null } | null = null;
  const line = forced ? `${o.nowIso} take --force by ${holder} from ${o.forced_from}` : null;
  const extra = storyWt ? o.more?.({ storyWt, spec_dir, worktrees: o.worktrees }) : undefined;
  if (storyWt && branch && extra?.paths.length) {
    const paths = [...extra.paths];
    const message = extra?.message ?? (forced ? `norn: ${key} taken with --force by ${holder}` : `norn: ${key} taken by ${holder}`);
    const sha = await git.commit(storyWt, { message, trailers: { "Norn-Story": key, "Norn-Step": "take", "Norn-Tick": ulid(o.now) }, paths });
    const pushed = remote && sha ? await git.push(storyWt, remote, `refs/heads/${branch}:refs/heads/${branch}`) : null;
    committed = { commit: sha, pushed: pushed ? pushed.ok : null };
  }
  // A forced take commits nothing of its own: the journal names where it is recorded
  if (line) journal = { line, commit: null, pushed: null, note: `journaled in the claim blob (forced_from) and ${o.receipted ? "the take receipt" : "the trace"}` };
  return { journal, extra, committed };
}

/**
 * Claim `key` here (`force` takes a live claim over), restore its record from its ref and its
 * worktrees from the pushed branches (the order is in the header). `record: false`: the caller restored
 * the record itself (`story reopen`).
 */
export async function checkoutStory(ctx: Context, key: string, force: boolean, more?: CheckoutRecord, opts: { record?: boolean } = {}) {
  const root = ctx.root;
  const config = ctx.config;
  const ports = await ctx.ports();
  const git = ports.git;
  const now = ctx.clock.now();
  const nowIso = ctx.clock.iso();
  const remote = await gitRemote(ctx.git, ctx.root, ctx.config.git_remote);
  const again = cmd.storyCheckout(key);
  const held = `the claim is held by you now; run ${again} again`;

  const branch = await findStoryBranch(ctx, key, remote);
  const spec_dir = branch ? specDir(key, branch.slice(key.length + 1)) : "";
  const run = { key, spec_dir };

  // 1. the claim as on the remote
  const hb = heartbeatId(root, now);
  const holder = machineHolder(ctx.env);
  const { cur, mine, forced, prev } = await claimAsOnRemote(ctx, key, force, remote, hb);

  // 2. the record, fetched and staged
  const { keepLocal, before, setAside, prepared } = await planRecord(ctx, git, remote, run, { mine, holder, record: opts.record !== false });
  // A story without a branch is taken over from its record alone
  if (!branch && !prepared) throw refuse(`no story branch for ${key}${remote ? ` on ${remote}` : ""}`, `${cmd.sync()} (intake creates it) or check the story key`, "unknown_story");
  const staged = prepared?.staged ?? null;
  try {
    // 3. the branches, then the record's branch commit against the story branch
    // The story's heads ref holds its real last boundary, which the remote branch may lack (a holder
    // that crashed before pushing the branch); the take resumes from it
    let heads = false;
    // the remote branch to merge into the story worktree once it is here (diverged from the heads ref)
    let mergeIn: string | null = null;
    if (remote && branch) {
      const listed = await listRemoteRefs(root, remote, headsRef(key)).catch((e: unknown) => e as Error);
      if (listed instanceof Error) throw failure(`cannot list ${headsRef(key)} on ${remote}: ${listed.message}; nothing was taken`, `check the network, then ${again} again`, "network");
      heads = listed.some((r) => r.ref === headsRef(key));
      const f = await git
        .fetch(root, remote, [`+refs/heads/${branch}:refs/remotes/${remote}/${branch}`, `+refs/heads/${key}/*:refs/remotes/${remote}/${key}/*`, ...(heads ? [`+${headsRef(key)}:${headsRef(key)}`] : [])], { quiet: true })
        .catch((e: unknown) => e as Error);
      if (f instanceof Error) throw failure(`fetch failed: ${f.message}; nothing was taken`, `check the network, then ${again} again`, "network");
      // Only a heads ref the branch does not contain holds boundaries the branch lacks. The heads ref
      // moves alone only while the PR is open, so a divergence then is a person's push onto the PR
      // branch: merged into the heads ref once the worktree is here, neither side dropped or
      // rewritten, and a merge that would conflict refused before anything is taken. With no PR open
      // the two move in one push: a divergence is a rewrite of the branch, which is taken as it is
      const tracking = `refs/remotes/${remote}/${branch}`;
      let stand = heads ? await headsVersus(git, root, headsRef(key), tracking) : "behind";
      if (stand === "diverged" && !(await prOpen(ports.remote, branch, again))) stand = "behind";
      heads = stand !== "behind";
      if (stand === "diverged") {
        const clash = await git.mergeTree(root, headsRef(key), tracking);
        if (clash.length)
          throw failure(
            `${headsRef(key)} (the story's last boundary) and ${remote}/${branch} have diverged and merging them conflicts in ${clash.join(", ")}; nothing was taken`,
            `merge ${headsRef(key)} into ${branch} by hand and push it, then ${again} again`,
            "branch_diverged",
          );
        mergeIn = tracking;
      }
      const upstream = heads ? headsRef(key) : `refs/remotes/${remote}/${branch}`;
      if (await divergedFrom(git, root, branch, upstream))
        throw failure(`${branch} has diverged from ${heads ? headsRef(key) : `${remote}/${branch}`}; nothing was taken`, `reconcile ${branch} by hand (norn never resets work), then ${again} again`, "branch_diverged");
    }
    // the story branch as taken: the heads ref, else the remote branch, else the local one
    const headRef = branch ? (remote ? (heads ? headsRef(key) : `refs/remotes/${remote}/${branch}`) : `refs/heads/${branch}`) : null;
    // No record on the ref and none of this checkout's own: the record may be lost
    const maybeLost = !prepared && !keepLocal && opts.record !== false;
    const head = headRef && (prepared || maybeLost) ? await git.revParse(root, headRef) : null;
    // the story unit's run state the take goes into: the staged record, or the machine dir's
    const storyRuns = staged ? runStateDirIn(staged.dir, STORY_UNIT_DIR) : runStateDir(root, run, STORY_UNIT_DIR);
    // the holder's own run state matches the record it last pushed (its local ref before this checkout)
    const gone = prepared ? (prepared.taken.unpacked ? prepared.taken.branch_commit : before ? await recordBranchCommit(root, before.sha) : null) : null;
    const rewritten = await rewrittenSince(git, root, gone, head, storyRuns);
    const lost = maybeLost && branch && headRef && head ? await lostRecord(git, root, run, branch, head, headRef, prev?.holder ?? null) : null;

    // 4. claim by CAS, then the remote record ref must still be the one staged
    const blob = newClaimBlob({
      story: key,
      holder,
      heartbeat_id: hb,
      now,
      at: nowIso,
      lease: config.claim.lease,
      ...(mine && prev ? { acquired_at: prev.acquired_at } : {}),
      ...(forced ? { forced_from: prev ? `${prev.holder} (heartbeat ${prev.heartbeat_id}, expires ${prev.expires_at})` : "corrupt claim" } : {}),
    });
    const claimed = await acquireClaim(root, remote, blob, { now, force: forced });
    if (!claimed.ok) {
      if (claimed.reason === "held") throw claimHeld(claimed.holder, `wait until ${claimed.holder.expires_at} or ${cmd.storyCheckout(key, { force: true })}`);
      throw failure(`claim failed (${claimed.reason}): ${claimed.message}`, `retry: ${again}`, "claim_failed");
    }
    // With the record lost, the ref must still be absent — a holder that pushed its record
    // meanwhile (a handoff, a `remote` boundary) has a record no new round may hide
    const expected = staged && prepared ? prepared.taken.sha : lost ? null : undefined;
    if (remote && expected !== undefined) {
      const now2 = await remoteRecordSha(root, remote, key).catch((e: unknown) => e as Error);
      if (now2 !== expected) {
        // a claim this checkout did not hold before goes back; its own stays
        const back = mine ? null : await releaseClaim(root, remote, key, claimed.sha);
        const why =
          now2 instanceof Error
            ? `cannot re-read ${recordRef(key)}: ${now2.message}`
            : `${recordRef(key)} moved on ${remote} while the claim was taken (${expected ?? "none"} → ${now2 ?? "deleted"}): its holder may still be running`;
        const gave = back === null ? "" : back.ok ? "; the claim was given back, nothing was taken" : `; the claim could not be given back (${back.message})`;
        throw failure(`${why}${gave}`, `make sure the previous holder stopped, then ${again} again`, "record_moved");
      }
    }

    // 5. locally: the take first (trace event, receipt into the record), then the record into place
    const expired = cur.state === "expired";
    const takeFacts = { previous_holder: prev?.holder ?? null, previous_heartbeat_id: prev?.heartbeat_id ?? null, expired, forced };
    appendTrace(root, traceEvent("take", now, { at: nowIso, unit: key, holder, heartbeat_id: hb, ...takeFacts }));
    let record: { receipt: string | null; note?: string };
    let superseded: string | null = null;
    try {
      if (setAside && (staged || lost) && existsSync(storyRunStateDir(root, run))) {
        if (setAside.on_ref) dropLocalRecord(root, run, ulid(now));
        else {
          const by = (prepared ? await recordHolder(root, prepared.taken.sha) : null) ?? holder;
          superseded = setAsideRecord(root, run, `${key}-${ulid(now)}`, { story: key, holder: by, last_receipt: setAside.last_receipt, superseded_at: nowIso });
        }
      }
      if (lost) {
        const fresh = stageEmptyRecord(storyRunStateDir(root, run));
        try {
          record = writeLostRound(fresh.dir, key, lost, { holder, now: nowIso, ...takeFacts, rewritten: null, record_lost: true });
          fresh.place();
        } finally {
          fresh.discard();
        }
      } else record = takeReceipt(storyRuns, { holder, now: nowIso, ...takeFacts, rewritten, record_lost: false });
      staged?.place();
      if (prepared) await setRecordRef(root, key, prepared.taken.sha);
    } catch (e) {
      throw failure(`cannot put the record of ${key} in place: ${(e as Error).message}`, held, "record_place_failed");
    }
    const taken = prepared?.taken ?? null;
    const placedRuns = runStateDir(root, run, STORY_UNIT_DIR);
    const next = nextCursor(placedRuns, rewritten?.gone ?? null);

    // 5b. branches → worktrees
    const { problems, worktrees, units, storyWt } = await restoreWorktrees(ctx, ports, remote, run, branch, {
      storyUpstream: headRef,
      mergeIn: mergeIn ? { rev: mergeIn, message: `norn: ${key} take merges ${branch} into its last boundary`, trailers: { "Norn-Story": key, "Norn-Step": "take", "Norn-Tick": ulid(now) } } : null,
      placedRuns,
      storyState: next.state,
      nowIso,
      onStoryFailed: (problems) => failure(`${problems.join("; ")}; ${held}`, `fix the story branch, then ${again} again`, "branch_diverged", { claim: blob }),
    });

    const { journal, extra, committed } = await journalTake(git, remote, run, { branch, holder, now, nowIso, forced_from: forced ? (blob.forced_from ?? null) : null, storyWt, worktrees, more, receipted: record.receipt !== null });

    const value = {
      story: key,
      branch,
      claim: { holder: blob.holder, heartbeat_id: blob.heartbeat_id, acquired_at: blob.acquired_at, expires_at: blob.expires_at, ...(blob.forced_from ? { forced_from: blob.forced_from } : {}) },
      taken_from: prev && !mine ? { holder: prev.holder, since: prev.acquired_at, expires_at: prev.expires_at, expired: Date.parse(prev.expires_at) <= now } : null,
      forced,
      journal,
      // What `more` committed on the story branch, and whether it was pushed
      ...(committed ? { committed } : {}),
      // The take receipt is in the machine dir, never committed or pushed
      receipt: record.receipt ? { file: record.receipt } : { file: null, note: record.note },
      // The record taken over from its ref; why the step restarts, when it does
      record: taken ? { ref: recordRef(key), sha: taken.sha, branch_commit: taken.branch_commit, unpacked: taken.unpacked } : null,
      // No record to take over: a new round from the branch
      record_lost: lost !== null,
      // This checkout's own older copy, set aside rather than replaced
      ...(superseded ? { superseded } : {}),
      ...(lost ? { restarted: lost.line } : next.restarted ? { restarted: next.restarted } : {}),
      worktrees,
      units,
      ...(problems.length ? { problems } : {}),
      ...extra?.value,
      next: cmd.tick(),
    };
    return problems.length ? withExit(value, ExitCode.error) : value;
  } finally {
    // a take refused before the record went into place leaves nothing staged
    staged?.discard();
  }
}
