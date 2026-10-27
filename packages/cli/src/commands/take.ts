/**
 * `norn take <story> [--force]` (T5, M3): continue a story on this machine from git alone.
 *
 * 1. Claim by CAS (T3): free or expired → acquire; held by another heartbeat and unexpired →
 *    refused "held by X since Y" unless `--force`, which records `forced_from` in the claim blob
 *    and a heartbeat line in the story handoff, committed and pushed (journaled).
 * 2. Fetch the story branch and its slice branches; check them out into worktrees here with
 *    slots, `.env.norn` and `.norn-unit` (K4, A3). Local branches are only created or moved
 *    forward, never reset.
 * 3. Print each unit's cursor and `handoff.md` (S9). The next `norn tick` resumes from `runs/`.
 */
import { existsSync } from "node:fs";
import { join, relative } from "node:path";
import { sliceWorktreePath, storyWorktreePath } from "@norn/core";
import { ExitCode, type ReceiptOf, sliceBranch, specDir, STORY_UNIT_DIR, ulid } from "@norn/schema";
import {
  acquireClaim,
  acquireTickLock,
  appendHandoffHeartbeat,
  appendReceipt,
  appendTrace,
  handoffPath,
  loadStory,
  newClaimBlob,
  readState,
  readText,
  heartbeatId,
  writtenHere,
  machineHolder,
} from "@norn/store";
import { defineCommand, opt } from "../command.ts";
import type { Context } from "../context.ts";
import { busyError, claimHeld, corruptError, failure, refuse, withExit } from "../output.ts";
import { storyArg } from "../runtime/args.ts";
import { claimFor } from "../runtime/human.ts";
import { leaseLiveness } from "../runtime/leases.ts";
import { gitRemote } from "../runtime/observe/index.ts";
import { equipWorktree, syncLocalBranch, type WorktreeTarget } from "../runtime/worktrees.ts";

const storyBranchRe = (key: string) => new RegExp(`^${key}-[a-z0-9][a-z0-9-]*$`);

/** The story branch name: on the remote (truth for a take), else a local branch. */
async function findStoryBranch(ctx: Context, key: string, remote: string | null): Promise<string | null> {
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
  t: { holder: string; now: string; previous_holder: string | null; previous_heartbeat_id: string | null; expired: boolean; forced: boolean },
): { receipt: string | null; note?: string } {
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
  const w = appendReceipt(runsDir, r);
  return { receipt: w.file.split("/").at(-1) as string };
}

interface UnitView {
  unit: string;
  worktree: string | null;
  step: string | null;
  status: string | null;
  park: unknown;
  handoff: string | null;
}

export const takeCommand = defineCommand({
  name: "take",
  summary: "Take over a story on this machine: claim it, check out its branches, print the handoff (T5)",
  usage: "norn take <story> [--force]",
  options: { force: { type: "boolean" } },
  positionals: { min: 1, max: 1 },
  async run(ctx, args) {
    const key = storyArg(args.positionals[0] as string, "take");
    const force = opt.bool(args, "force");
    const lock = await acquireTickLock(ctx.root, { note: "norn take", now: () => ctx.clock.iso() });
    if (!lock.ok) throw busyError(`a tick is running (pid ${lock.holder.holder.pid})`, `retry: norn take ${key}`, "tick_locked");
    try {
      return await take(ctx, key, force);
    } finally {
      lock.release();
    }
  },
});

async function take(ctx: Context, key: string, force: boolean) {
  const root = ctx.root;
  const config = ctx.config;
  const ports = await ctx.ports();
  const git = ports.git;
  const now = ctx.clock.now();
  const nowIso = ctx.clock.iso();
  const remote = await gitRemote(ctx.git, ctx.root, ctx.config.remote.git_remote);

  const branch = await findStoryBranch(ctx, key, remote);
  if (!branch) throw refuse(`no story branch for ${key}${remote ? ` on ${remote}` : ""}`, "norn sync (intake creates it) or check the story key", "unknown_story");
  const slug = branch.slice(key.length + 1);
  const spec_dir = specDir(key, slug);

  // ---- 1. claim (T3, T5)
  const hb = heartbeatId(root, now);
  const holder = machineHolder(ctx.env);
  const cur = await claimFor(ctx, key, { remote, unreadable: (e) => failure(`cannot read the claim: ${e.message}`, "check the network, then retry", "network") });
  if (cur.state === "corrupt" && !force) throw corruptError(`claim ref of ${key} is unreadable`, `norn take ${key} --force`, cur.error);
  if (cur.state === "other" && !force)
    throw claimHeld(cur.blob, `wait until ${cur.blob.expires_at}, ask ${cur.blob.holder} to run norn release ${key}, or norn take ${key} --force`);
  const mine = writtenHere(cur, hb);
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
    if (claimed.reason === "held") throw claimHeld(claimed.holder, `wait until ${claimed.holder.expires_at} or norn take ${key} --force`);
    throw failure(`claim failed (${claimed.reason}): ${claimed.message}`, `retry: norn take ${key}`, "claim_failed");
  }
  // R10.1 (M8, A17): every take is in the record — the trace event first; the `take` receipt on the
  // story unit as soon as the story branch is checked out (it lives on that branch), before anything else
  const expired = cur.state === "expired";
  const takeFacts = { previous_holder: prev?.holder ?? null, previous_heartbeat_id: prev?.heartbeat_id ?? null, expired, forced };
  appendTrace(root, { type: "take", id: ulid(now), at: nowIso, unit: key, holder, heartbeat_id: hb, ...takeFacts });

  // ---- 2. branches → worktrees (T5, K4)
  const problems: string[] = [];
  if (remote) {
    const f = await git
      .fetch(root, remote, [`+refs/heads/${branch}:refs/remotes/${remote}/${branch}`, `+refs/heads/${key}/*:refs/remotes/${remote}/${key}/*`], { quiet: true })
      .catch((e: unknown) => e as Error);
    if (f instanceof Error) throw failure(`fetch failed: ${f.message}`, `retry: norn take ${key} (the claim is held by you now)`, "network");
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

  const storyWt = wtByBranch.get(branch) ?? storyWorktreePath(root, key, slug);
  if (!(await checkout({ path: storyWt, branch, story: key, slice: null, unit: STORY_UNIT_DIR, spec_dir }, key)))
    throw failure(problems.join("; "), `fix the story branch, then norn take ${key} again (the claim is held by you now)`, "branch_diverged", { claim: blob });

  const storyRuns = join(storyWt, spec_dir, "runs", STORY_UNIT_DIR);
  const record = takeReceipt(storyRuns, { holder, now: nowIso, ...takeFacts });

  const snapshot = loadStory(storyWt, join(storyWt, spec_dir));
  const units: UnitView[] = [];
  const view = (unit: string, wt: string | null, runsDir: string): UnitView => {
    const st = readState(runsDir);
    return {
      unit,
      worktree: wt,
      step: st.ok ? st.value.step : null,
      status: st.ok ? st.value.status : null,
      park: st.ok ? (st.value.park ?? null) : null,
      handoff: readText(handoffPath(runsDir)),
    };
  };
  units.push(view(key, storyWt, join(storyWt, spec_dir, "runs", STORY_UNIT_DIR)));
  const sliceRefs = new Set(
    (await git.listRefs(root, remote ? `refs/remotes/${remote}/${key}/` : `refs/heads/${key}/`)).map((r) => r.ref.replace(remote ? `refs/remotes/${remote}/` : "refs/heads/", "")),
  );
  for (const s of snapshot?.slices ?? []) {
    const sb = sliceBranch(key, s.nn, s.slug);
    const dir = `${s.nn}-${s.slug}`;
    const status = s.frontmatter?.status;
    let wt: string | null = null;
    if (sliceRefs.has(sb) && status !== "integrated" && status !== "dropped") {
      const path = wtByBranch.get(sb) ?? sliceWorktreePath(storyWt, s.nn, s.slug);
      if (await checkout({ path, branch: sb, story: key, slice: s.key, unit: dir, spec_dir }, s.key)) wt = wtByBranch.get(sb) ?? path;
    }
    const runs = join(wt ?? storyWt, spec_dir, "runs", dir);
    if (existsSync(runs)) units.push(view(s.key, wt, runs));
  }

  // ---- commit the take receipt (R10.1) and journal a forced take (T5): claim blob `forced_from` +
  // a handoff heartbeat line, in the same commit, pushed (this heartbeat holds the claim now)
  let journal: unknown = null;
  let committed: { commit: string | null; pushed: boolean | null } | null = null;
  const runsDir = storyRuns;
  const line = forced ? `- ${nowIso} take --force by ${holder} from ${blob.forced_from}` : null;
  if (line && existsSync(runsDir)) appendHandoffHeartbeat(runsDir, line);
  if (record.receipt || (line && existsSync(runsDir))) {
    const paths = [...(record.receipt ? [relative(storyWt, join(runsDir, "receipts", record.receipt))] : []), ...(line ? [relative(storyWt, handoffPath(runsDir))] : [])];
    const sha = await git.commit(storyWt, { message: forced ? `norn: ${key} taken with --force by ${holder}` : `norn: ${key} taken by ${holder}`, trailers: { "Norn-Story": key, "Norn-Step": "take", "Norn-Tick": ulid(now) }, paths });
    const pushed = remote && sha ? await git.push(storyWt, remote, `refs/heads/${branch}:refs/heads/${branch}`) : null;
    committed = { commit: sha, pushed: pushed ? pushed.ok : null };
  }
  if (line) journal = existsSync(runsDir) ? { line, ...committed } : { line, commit: null, note: "story unit not started; journaled in the claim blob (forced_from)" };

  const value = {
    story: key,
    branch,
    claim: { holder: blob.holder, heartbeat_id: blob.heartbeat_id, acquired_at: blob.acquired_at, expires_at: blob.expires_at, ...(blob.forced_from ? { forced_from: blob.forced_from } : {}) },
    taken_from: prev && !mine ? { holder: prev.holder, since: prev.acquired_at, expires_at: prev.expires_at, expired: Date.parse(prev.expires_at) <= now } : null,
    forced,
    journal,
    receipt: record.receipt ? { file: record.receipt, ...committed } : { file: null, note: record.note },
    worktrees,
    units,
    ...(problems.length ? { problems } : {}),
    next: "norn tick",
  };
  return problems.length ? withExit(value, ExitCode.error) : value;
}
