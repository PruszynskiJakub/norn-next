/**
 * Story checkout (T5, M3): continue a story on this machine from git alone. The command is
 * `norn story checkout`; a later reopen restores through the same steps.
 *
 * 1. Claim by CAS (T3): free or expired → acquire; held by another heartbeat and unexpired →
 *    refused "held by X since Y" unless `--force`, which records `forced_from` in the claim blob
 *    and a Progress line in the story handoff, committed and pushed (journaled).
 * 2. Fetch the story branch and its slice branches; check them out into worktrees here with
 *    slots, `.env.norn` and `.norn-unit` (K4, A3). Local branches are only created or moved
 *    forward, never reset.
 * 3. Fetch the story's record from `refs/norn/runs/<story>` alone (gh-195 D6) into the same local ref, so
 *    this checkout's next record push leases on what it unpacked, and unpack it into the machine dir
 *    (hostile entries refused, every file validated, then renamed into place: S1, S2). A checkout
 *    that already holds the claim and the run state keeps its own. The record's `Norn-Branch-Commit`
 *    must be an ancestor of the story branch head (T5a, B23); when it is not (the branch was
 *    rewritten, B24) the take receipt says so and the step restarts as a new attempt when the tick
 *    applies it. A story without a branch skips the check (B33).
 * 4. Print each unit's cursor, and its status (S9, rendered from state.json) above its handoff's
 *    written part (gh-195 D9, B7). The next `norn tick` resumes from the run state.
 */
import { existsSync } from "node:fs";
import { join, relative } from "node:path";
import { applyReceipts, branchRewrittenLine, cmd, rewriteRestarts, type GitPort, renderHandoffWithStatus, sliceWorktreePath, storyWorktreePath } from "@norn/core";
import { ExitCode, type ReceiptOf, type UnitState, recordRef, type RunStory, sliceBranch, specDir, STORY_UNIT_DIR, ulid } from "@norn/schema";
import {
  acquireClaim,
  appendReceipt,
  appendTrace,
  fetchRecordCommit,
  handoffPath,
  listReceipts,
  loadStory,
  newClaimBlob,
  readPinnedWorkflow,
  readState,
  readHandoff,
  heartbeatId,
  writtenHere,
  machineHolder,
  traceEvent,
  readRecordRef,
  recordBranchCommit,
  runStateDir,
  setRecordRef,
  stageRecordSync,
  type StagedRecord,
  storyRunStateDir,
} from "@norn/store";
import type { Context } from "../context.ts";
import { claimHeld, corruptError, failure, refuse, withExit } from "../output.ts";
import { claimFor } from "./human.ts";
import { appendProgress } from "./report.ts";
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

/**
 * R10.1: write the `take` receipt on the story unit at its cursor (next free number). A story unit
 * not started yet has no cursor to put it on; the take is then only in the trace and the claim blob.
 */
function takeReceipt(
  runsDir: string,
  t: { holder: string; now: string; previous_holder: string | null; previous_heartbeat_id: string | null; expired: boolean; forced: boolean; rewritten: { gone: string; head: string } | null },
): { receipt: string | null; note?: string; restarted?: string } {
  const st = readState(runsDir);
  if (!st.ok) return { receipt: null, note: st.reason === "missing" ? "story unit not started; the take is in the trace" : "story state unreadable (S2); the take is in the trace" };
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
  };
  if (t.rewritten) r.rewritten = t.rewritten;
  const w = appendReceipt(runsDir, r);
  return { receipt: w.file.split("/").at(-1) as string, ...(t.rewritten ? restartOf(runsDir, st.value, t.rewritten.gone) : {}) };
}

/**
 * T5a (review F3): what the tick will restart once it applies the take — the cursor after the record's
 * receipts not applied yet, the take included (core `applyReceipts`, as the tick does), when the step
 * can be entered again. Nothing when it cannot (a finished or stuck unit keeps its cursor).
 */
function restartOf(runsDir: string, st: UnitState, gone: string): { restarted?: string } {
  const wf = readPinnedWorkflow(runsDir);
  const listed = listReceipts(runsDir, { after: st.applied_through });
  if (!wf.ok || listed.errors.length) return {};
  const res = applyReceipts(st, listed.receipts, { workflow: wf.value.workflow, now: st.updated_at });
  const take = listed.receipts.at(-1)?.receipt;
  const before = listed.receipts.length > 1 ? applyReceipts(st, listed.receipts.slice(0, -1), { workflow: wf.value.workflow, now: st.updated_at }).state : st;
  if (!take || !rewriteRestarts(before, take, wf.value.workflow)) return {};
  return { restarted: branchRewrittenLine(st.story, gone, res.state.step, res.state.attempt) };
}

/** What checkout did with the story's record (T5, T5a). */
interface TakenRecord {
  /** the record commit on `refs/norn/runs/<story>` */
  sha: string;
  /** its `Norn-Branch-Commit`; null = recorded without a branch (B33) */
  branch_commit: string | null;
  /** unpacked into the machine dir (false: this checkout holds the claim and keeps its own run state) */
  unpacked: boolean;
}

/**
 * gh-195 D6, D10 (B22, B33; review F1, S2): before anything is taken, the story's record —
 * `refs/norn/runs/<story>` fetched from `remote` alone (objects only, no local ref yet; without a remote
 * this checkout's own ref) — and, unless `keepLocal` and the machine dir already holds the story's run
 * state, staged beside it with every file validated (S1, S2). Null = no record ref (gh-195/11). A
 * record that cannot be fetched or does not validate is refused here, with no claim taken and nothing
 * changed: checkout never leaves a held story without its record, which a tick would start over.
 */
async function prepareRecord(ctx: Context, remote: string | null, story: RunStory, keepLocal: boolean): Promise<{ taken: TakenRecord; staged: Extract<StagedRecord, { ok: true }> | null } | null> {
  const key = story.key;
  const sha = remote
    ? await fetchRecordCommit(ctx.root, remote, key).catch((e: unknown) => {
        throw failure(`cannot fetch ${recordRef(key)}: ${(e as Error).message}; nothing was taken`, `check the network, then ${cmd.storyCheckout(key)} again`, "network");
      })
    : ((await readRecordRef(ctx.root, key))?.sha ?? null);
  if (!sha) return null;
  const dir = storyRunStateDir(ctx.root, story);
  const unpacked = !(keepLocal && existsSync(dir));
  let staged: Extract<StagedRecord, { ok: true }> | null = null;
  if (unpacked) {
    const r = stageRecordSync(ctx.root, sha, dir);
    if (!r.ok)
      throw failure(
        `${recordRef(key)} at ${sha} does not unpack: ${r.errors.map((e) => `${e.file}: ${e.errors.map((x) => x.message).join(", ")}`).join("; ")}; nothing was taken`,
        `fix or delete ${recordRef(key)} on ${remote ?? "this checkout"}, then ${cmd.storyCheckout(key)} again`,
        "record_corrupt",
      );
    staged = r;
  }
  return { taken: { sha, branch_commit: await recordBranchCommit(ctx.root, sha), unpacked }, staged };
}

/** T5a (B23, B24): the record's branch commit is gone when it is not here or not an ancestor of the story branch `head`. */
async function rewrittenSince(git: GitPort, root: string, taken: TakenRecord | null, head: string | null): Promise<{ gone: string; head: string } | null> {
  const gone = taken?.branch_commit;
  // B33: no branch, no check; a checkout keeping its own run state judges nothing
  if (!taken?.unpacked || !gone || !head) return null;
  const known = await git.revParse(root, `${gone}^{commit}`);
  return known && (await git.isAncestor(root, gone, head)) ? null : { gone, head };
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

/**
 * T5: claim `key` here (`force` takes a live claim over), restore its worktrees from the pushed branches
 * and its record from its ref. `record: false`: the caller restored the record itself (`story reopen`).
 */
export async function checkoutStory(ctx: Context, key: string, force: boolean, more?: CheckoutRecord, opts: { record?: boolean } = {}) {
  const root = ctx.root;
  const config = ctx.config;
  const ports = await ctx.ports();
  const git = ports.git;
  const now = ctx.clock.now();
  const nowIso = ctx.clock.iso();
  const remote = await gitRemote(ctx.git, ctx.root, ctx.config.git_remote);

  const branch = await findStoryBranch(ctx, key, remote);
  const spec_dir = branch ? specDir(key, branch.slice(key.length + 1)) : "";
  const run = { key, spec_dir };

  // ---- 1. claim (T3, T5)
  const hb = heartbeatId(root, now);
  const holder = machineHolder(ctx.env);
  const cur = await claimFor(ctx, key, { remote, unreadable: (e) => failure(`cannot read the claim: ${e.message}`, "check the network, then retry", "network") });
  if (cur.state === "corrupt" && !force) throw corruptError(`claim ref of ${key} is unreadable`, cmd.storyCheckout(key, { force: true }), cur.error);
  if (cur.state === "other" && !force)
    throw claimHeld(cur.blob, `wait until ${cur.blob.expires_at}, ask ${cur.blob.holder} to run ${cmd.storyHandoff(key)}, or ${cmd.storyCheckout(key, { force: true })}`);
  const mine = writtenHere(cur, hb);
  // ---- 1b. the record, fetched and validated before anything is taken (review F1)
  const prepared = opts.record === false ? null : await prepareRecord(ctx, remote, run, mine);
  // B33: a story without a branch is taken over from its record alone
  if (!branch && !prepared) throw refuse(`no story branch for ${key}${remote ? ` on ${remote}` : ""}`, `${cmd.sync()} (intake creates it) or check the story key`, "unknown_story");
  try {
    const forced = force && (cur.state === "other" || cur.state === "corrupt");
    const prev = cur.state === "none" || cur.state === "corrupt" ? null : cur.blob;
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
      throw failure(`claim failed (${claimed.reason}): ${claimed.message}`, `retry: ${cmd.storyCheckout(key)}`, "claim_failed");
    }
    // R10.1 (M8, A17): every take is in the record — the trace event first; the `take` receipt on the
    // story unit as soon as the story branch is checked out (it lives on that branch), before anything else
    const expired = cur.state === "expired";
    const takeFacts = { previous_holder: prev?.holder ?? null, previous_heartbeat_id: prev?.heartbeat_id ?? null, expired, forced };
    appendTrace(root, traceEvent("take", now, { at: nowIso, unit: key, holder, heartbeat_id: hb, ...takeFacts }));
    // the record into place as soon as the claim is this checkout's, and its ref the lease of this
    // checkout's next record push (09-F4)
    prepared?.staged?.place();
    if (prepared) await setRecordRef(root, key, prepared.taken.sha);
    const taken = prepared?.taken ?? null;

    // ---- 2. branches → worktrees (T5, K4)
    const problems: string[] = [];
    if (remote && branch) {
      const f = await git
        .fetch(root, remote, [`+refs/heads/${branch}:refs/remotes/${remote}/${branch}`, `+refs/heads/${key}/*:refs/remotes/${remote}/${key}/*`], { quiet: true })
        .catch((e: unknown) => e as Error);
      if (f instanceof Error) throw failure(`fetch failed: ${f.message}`, `retry: ${cmd.storyCheckout(key)} (the claim is held by you now)`, "network");
    }
    const wtByBranch = new Map((await git.worktreeList(root)).filter((w) => w.branch).map((w) => [w.branch as string, w.path]));
    const equip = { root, home: ctx.home, config, now: nowIso, liveness: leaseLiveness((p) => ports.process.isAlive(p)) };
    const worktrees: Array<{ unit: string; path: string; branch: string; local: string; created: boolean; slot: number | null }> = [];

    const checkout = async (t: WorktreeTarget, unitKey: string): Promise<boolean> => {
      const existing = wtByBranch.get(t.branch) ?? null;
      const path = existing ?? t.path;
      const synced = remote ? await syncLocalBranch(git, root, t.branch, `refs/remotes/${remote}/${t.branch}`, existing) : { ok: true as const, local: "up-to-date" as const };
      if (!synced.ok) {
        problems.push(`${unitKey}: ${synced.error}`);
        return false;
      }
      let created = false;
      if (!existsSync(path)) {
        if (existing) await git.worktreePrune(root).catch(() => undefined);
        await git.worktreeAdd(root, path, t.branch);
        created = true;
      }
      const slot = await equipWorktree(equip, { ...t, path });
      worktrees.push({ unit: unitKey, path, branch: t.branch, local: synced.local, created, slot });
      return true;
    };

    const storyWt = branch ? (wtByBranch.get(branch) ?? storyWorktreePath(root, key, branch.slice(key.length + 1))) : null;
    if (branch && storyWt && !(await checkout({ path: storyWt, branch, story: key, slice: null, unit: STORY_UNIT_DIR, spec_dir }, key)))
      throw failure(problems.join("; "), `fix the story branch, then ${cmd.storyCheckout(key)} again (the claim is held by you now)`, "branch_diverged", { claim: blob });

    // ---- 3. T5a (gh-195 D10): the record's branch commit against the story branch, then the take receipt in the record
    const head = branch ? await git.revParse(root, remote ? `refs/remotes/${remote}/${branch}` : `refs/heads/${branch}`) : null;
    const storyRuns = runStateDir(root, run, STORY_UNIT_DIR);
    const record = takeReceipt(storyRuns, { holder, now: nowIso, ...takeFacts, rewritten: await rewrittenSince(git, root, taken, head) });

    const snapshot = storyWt ? loadStory(storyWt, join(storyWt, spec_dir)) : null;
    const units: UnitView[] = [];
    const view = (unit: string, wt: string | null, runsDir: string, handoff: string | null): UnitView => {
      const st = readState(runsDir);
      const wf = readPinnedWorkflow(runsDir);
      const prose = handoff ? (readHandoff(handoff)?.body ?? null) : null;
      return {
        unit,
        worktree: wt,
        step: st.ok ? st.value.step : null,
        status: st.ok ? st.value.status : null,
        park: st.ok ? (st.value.park ?? null) : null,
        // B7: the status the handoff's generated header used to carry, above its written part
        handoff: st.ok ? renderHandoffWithStatus(st.value, prose, { workflow: wf.ok ? wf.value.workflow : null }) : prose,
      };
    };
    const storyHandoff = storyWt ? handoffPath(join(storyWt, spec_dir), STORY_UNIT_DIR) : null;
    units.push(view(key, storyWt, storyRuns, storyHandoff));
    const sliceRefs = new Set(
      (await git.listRefs(root, remote ? `refs/remotes/${remote}/${key}/` : `refs/heads/${key}/`)).map((r) => r.ref.replace(remote ? `refs/remotes/${remote}/` : "refs/heads/", "")),
    );
    for (const s of snapshot?.slices ?? []) {
      const sb = sliceBranch(key, s.nn, s.slug);
      const dir = `${s.nn}-${s.slug}`;
      const status = s.frontmatter?.status;
      let wt: string | null = null;
      if (storyWt && sliceRefs.has(sb) && status !== "integrated" && status !== "dropped") {
        const path = wtByBranch.get(sb) ?? sliceWorktreePath(storyWt, s.nn, s.slug);
        if (await checkout({ path, branch: sb, story: key, slice: s.key, unit: dir, spec_dir }, s.key)) wt = wtByBranch.get(sb) ?? path;
      }
      const runs = runStateDir(root, run, dir);
      const handoffRoot = wt ?? storyWt;
      if (existsSync(runs)) units.push(view(s.key, wt, runs, handoffRoot ? handoffPath(join(handoffRoot, spec_dir), dir) : null));
    }

    // ---- commit the take receipt (R10.1) and journal a forced take (T5): claim blob `forced_from` +
    // a Progress line in the story's handoff (gh-195 B6: prose, no heartbeat block), in the same commit, pushed
    let journal: unknown = null;
    let committed: { commit: string | null; pushed: boolean | null } | null = null;
    const line = forced ? `${nowIso} take --force by ${holder} from ${blob.forced_from}` : null;
    // gh-195/05 (S12): the forced take is journaled in the story's handoff when the branch has one (its run
    // state may be on another machine), and the take receipt stays in the machine dir (D8)
    const journaled = line !== null && storyHandoff !== null && existsSync(storyHandoff);
    if (journaled) appendProgress(storyHandoff, line);
    const extra = storyWt ? more?.({ storyWt, spec_dir, worktrees }) : undefined;
    if (storyWt && branch && (journaled || extra?.paths.length)) {
      const paths = [...(journaled && storyHandoff ? [relative(storyWt, storyHandoff)] : []), ...(extra?.paths ?? [])];
      const message = extra?.message ?? (forced ? `norn: ${key} taken with --force by ${holder}` : `norn: ${key} taken by ${holder}`);
      const sha = await git.commit(storyWt, { message, trailers: { "Norn-Story": key, "Norn-Step": "take", "Norn-Tick": ulid(now) }, paths });
      const pushed = remote && sha ? await git.push(storyWt, remote, `refs/heads/${branch}:refs/heads/${branch}`) : null;
      committed = { commit: sha, pushed: pushed ? pushed.ok : null };
    }
    if (line) journal = journaled ? { line, ...committed } : { line, commit: null, note: "story has no handoff yet; journaled in the claim blob (forced_from)" };

    const value = {
      story: key,
      branch,
      claim: { holder: blob.holder, heartbeat_id: blob.heartbeat_id, acquired_at: blob.acquired_at, expires_at: blob.expires_at, ...(blob.forced_from ? { forced_from: blob.forced_from } : {}) },
      taken_from: prev && !mine ? { holder: prev.holder, since: prev.acquired_at, expires_at: prev.expires_at, expired: Date.parse(prev.expires_at) <= now } : null,
      forced,
      journal,
      // S12: the take receipt is in the machine dir, never committed or pushed (D8)
      receipt: record.receipt ? { file: record.receipt } : { file: null, note: record.note },
      // T5 (gh-195 D10): the record taken over from its ref; T5a: why the step restarts, when it does
      record: taken ? { ref: recordRef(key), sha: taken.sha, branch_commit: taken.branch_commit, unpacked: taken.unpacked } : null,
      ...(record.restarted ? { restarted: record.restarted } : {}),
      worktrees,
      units,
      ...(problems.length ? { problems } : {}),
      ...extra?.value,
      next: cmd.tick(),
    };
    return problems.length ? withExit(value, ExitCode.error) : value;
  } finally {
    // a take that failed before the record went into place leaves nothing staged
    prepared?.staged?.discard();
  }
}
