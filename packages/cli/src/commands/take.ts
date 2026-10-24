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
import { type ClaimBlob, ExitCode, isStoryKey, parseSliceKey, parseDuration, sliceBranch, specDir, STORY_UNIT_DIR, ulid } from "@norn/schema";
import {
  acquireClaim,
  acquireTickLock,
  appendHandoffHeartbeat,
  git as rawGit,
  handoffPath,
  loadStory,
  readClaim,
  readState,
  readText,
} from "@norn/store";
import { defineCommand, opt } from "../command.ts";
import type { Context } from "../context.ts";
import { busyError, claimHeld, corruptError, failure, refuse, usageError, withExit } from "../output.ts";
import { leaseLiveness } from "../runtime/leases.ts";
import { heartbeatId } from "../runtime/local.ts";
import { machineHolder } from "../runtime/observe.ts";
import { equipWorktree, syncLocalBranch, type WorktreeTarget } from "../runtime/worktrees.ts";

/** Story key from `gh-7` or a unit key `gh-7/01` (claims are per story, T1). */
export function storyArg(raw: string, command: string): string {
  const key = parseSliceKey(raw)?.story ?? raw;
  if (!isStoryKey(key)) throw usageError(`not a story key: '${raw}' (expected e.g. gh-123)`, `norn ${command} <story>`);
  return key;
}

export async function gitRemote(ctx: Context): Promise<string | null> {
  const name = ctx.config.remote.git_remote;
  const r = await rawGit(ctx.root, ["remote"]);
  return r.code === 0 && r.stdout.split("\n").some((l) => l.trim() === name) ? name : null;
}

const storyBranchRe = (key: string) => new RegExp(`^${key}-[a-z0-9][a-z0-9-]*$`);

/** The story branch name: on the remote (truth for a take), else a local branch. */
async function findStoryBranch(ctx: Context, key: string, remote: string | null): Promise<string | null> {
  const re = storyBranchRe(key);
  if (remote) {
    const r = await rawGit(ctx.root, ["ls-remote", "--heads", remote, `refs/heads/${key}-*`]);
    if (r.code !== 0) throw failure(`cannot list ${remote} branches: ${r.stderr.trim()}`, "check the network and git credentials, then retry", "network");
    const names = r.stdout
      .split("\n")
      .map((l) => l.split("\t")[1]?.replace(/^refs\/heads\//, "") ?? "")
      .filter((n) => re.test(n));
    if (names.length) return names.sort()[0] as string;
  }
  const local = (await (await ctx.ports()).git.listRefs(ctx.root, "refs/heads/")).map((r) => r.ref.slice("refs/heads/".length)).filter((n) => re.test(n));
  return local.sort()[0] ?? null;
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
  const remote = await gitRemote(ctx);

  const branch = await findStoryBranch(ctx, key, remote);
  if (!branch) throw refuse(`no story branch for ${key}${remote ? ` on ${remote}` : ""}`, "norn sync (intake creates it) or check the story key", "unknown_story");
  const slug = branch.slice(key.length + 1);
  const spec_dir = specDir(key, slug);

  // ---- 1. claim (T3, T5)
  const hb = heartbeatId(root, now);
  const holder = machineHolder(ctx.env);
  const cur = await readClaim(root, remote, key).catch((e: Error) => {
    throw failure(`cannot read the claim: ${e.message}`, "check the network, then retry", "network");
  });
  if (cur.state === "corrupt" && !force) throw corruptError(`claim ref of ${key} is unreadable`, `norn take ${key} --force`, cur.error);
  const live = cur.state === "present" && Date.parse(cur.blob.expires_at) > now;
  const mine = cur.state === "present" && cur.blob.heartbeat_id === hb;
  if (live && !mine && !force)
    throw claimHeld(cur.blob, `wait until ${cur.blob.expires_at}, ask ${cur.blob.holder} to run norn release ${key}, or norn take ${key} --force`);
  const forced = force && ((live && !mine) || cur.state === "corrupt");
  const prev = cur.state === "present" ? cur.blob : null;
  const blob: ClaimBlob = {
    version: 1,
    story: key,
    holder,
    heartbeat_id: hb,
    acquired_at: mine && prev ? prev.acquired_at : nowIso,
    renewed_at: nowIso,
    expires_at: new Date(now + parseDuration(config.claim.lease)).toISOString(),
    last_tick_id: null,
    ...(forced ? { forced_from: prev ? `${prev.holder} (heartbeat ${prev.heartbeat_id}, expires ${prev.expires_at})` : "corrupt claim" } : {}),
  };
  const claimed = await acquireClaim(root, remote, blob, { now, force: forced });
  if (!claimed.ok) {
    if (claimed.reason === "held") throw claimHeld(claimed.holder, `wait until ${claimed.holder.expires_at} or norn take ${key} --force`);
    throw failure(`claim failed (${claimed.reason}): ${claimed.message}`, `retry: norn take ${key}`, "claim_failed");
  }

  // ---- 2. branches → worktrees (T5, K4)
  const problems: string[] = [];
  if (remote) {
    const f = await rawGit(root, ["fetch", "--quiet", "--no-tags", remote, `+refs/heads/${branch}:refs/remotes/${remote}/${branch}`, `+refs/heads/${key}/*:refs/remotes/${remote}/${key}/*`]);
    if (f.code !== 0) throw failure(`fetch failed: ${f.stderr.trim()}`, `retry: norn take ${key} (the claim is held by you now)`, "network");
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
      if (existing) await rawGit(root, ["worktree", "prune"]);
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

  // ---- journal a forced take (T5): claim blob `forced_from` + a committed handoff heartbeat line
  let journal: unknown = null;
  if (forced) {
    const runsDir = join(storyWt, spec_dir, "runs", STORY_UNIT_DIR);
    const line = `- ${nowIso} take --force by ${holder} from ${blob.forced_from}`;
    if (existsSync(runsDir)) {
      appendHandoffHeartbeat(runsDir, line);
      const sha = await git.commit(storyWt, { message: `norn: ${key} taken with --force by ${holder}`, trailers: { "Norn-Story": key, "Norn-Step": "take", "Norn-Tick": ulid(now) }, paths: [relative(storyWt, handoffPath(runsDir))] });
      const pushed = remote && sha ? await git.push(storyWt, remote, `refs/heads/${branch}:refs/heads/${branch}`) : null;
      journal = { line, commit: sha, pushed: pushed ? pushed.ok : null };
    } else journal = { line, commit: null, note: "story unit not started; journaled in the claim blob (forced_from)" };
  }

  const value = {
    story: key,
    branch,
    claim: { holder: blob.holder, heartbeat_id: blob.heartbeat_id, acquired_at: blob.acquired_at, expires_at: blob.expires_at, ...(blob.forced_from ? { forced_from: blob.forced_from } : {}) },
    taken_from: prev && !mine ? { holder: prev.holder, since: prev.acquired_at, expires_at: prev.expires_at, expired: Date.parse(prev.expires_at) <= now } : null,
    forced,
    journal,
    worktrees,
    units,
    ...(problems.length ? { problems } : {}),
    next: "norn tick",
  };
  return problems.length ? withExit(value, ExitCode.error) : value;
}
