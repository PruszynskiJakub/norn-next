/**
 * What `norn tidy` removes: the worktrees and local branches of stories whose every unit ended
 * (stuck, closed, done but left behind), which nothing else ever removes. A finished story removes
 * only the work of units that ended done; a stuck unit keeps its worktree for a person to look into,
 * and this is where the person says they are done looking.
 *
 * Nothing that holds unique work goes: a story under a live claim (a machine may act on it), a
 * story still in progress, a worktree with uncommitted changes, or a branch whose commits are on no
 * other branch is kept, each with the reason. The caller holds the tick lock, so no tick here makes
 * a worktree again while it is removed.
 */
import { ok, type PluginResult, parseUnitId } from "@norn/plugin-api";
import { branchHome, dropUnitBranch } from "./branch-cleanup.ts";
import type { RuntimeEnv } from "./env.ts";

export interface TidyRemoved {
  story: string;
  unit: string;
  /** whether a worktree was there to remove */
  worktree: boolean;
  /** the local branch deleted, null when there was none */
  branch: string | null;
}

export interface TidyKept {
  story: string;
  /** absent when the whole story is kept */
  unit?: string;
  reason: string;
}

export interface TidyReport {
  dry_run: boolean;
  removed: TidyRemoved[];
  kept: TidyKept[];
}

async function hasWorktree(env: RuntimeEnv, unit: string): Promise<boolean> {
  const path = env.slots.vcs.worktree.path(unit);
  const cut = path.lastIndexOf("/");
  return (await env.ctx.files.list(path.slice(0, cut))).includes(path.slice(cut + 1));
}

/** Why the story must stay as it is, or null when its units may be tidied. */
async function storyHold(env: RuntimeEnv, story: string, units: readonly string[]): Promise<PluginResult<string | null>> {
  const claim = await env.slots.store.claims.read(story);
  if (!claim.ok) return claim;
  if (claim.value && Date.parse(env.ctx.now()) < Date.parse(claim.value.expires_at)) return ok(`claim held by ${claim.value.holder} until ${claim.value.expires_at}`);
  const going: string[] = [];
  for (const unit of units) {
    const read = await env.journal.readUnit(unit);
    if (!read.ok) return read;
    const j = read.value;
    if (j.corrupt !== undefined) return ok(`${unit} is corrupt: ${j.corrupt}`);
    // a slice the slices step never started has nothing on disk; the story's own unit has a state once its round began
    if (j.state === null) {
      if (unit === story) going.push(`${unit} not started`);
      continue;
    }
    if (j.state.ended === undefined) going.push(`${unit} at ${j.state.step}`);
  }
  return ok(going.length ? `in progress: ${going.join(", ")}` : null);
}

/** Tidy one unit: its worktree and its branch go together or not at all, so a kept branch keeps the checkout a person would look into. */
async function tidyUnit(env: RuntimeEnv, story: string, unit: string, dryRun: boolean, out: TidyReport): Promise<PluginResult<void>> {
  const vcs = env.slots.vcs;
  const there = vcs.capabilities.worktrees && (await hasWorktree(env, unit));
  if (there && vcs.uncommitted) {
    const dirty = await vcs.uncommitted(vcs.worktree.path(unit));
    if (!dirty.ok) return dirty;
    if (dirty.value.length) {
      out.kept.push({ story, unit, reason: `its worktree holds uncommitted changes: ${dirty.value.join(", ")}` });
      return ok(undefined);
    }
  }
  const home = await branchHome(env, unit);
  if (!home.ok) return home;
  if (home.value && home.value.home === null) {
    out.kept.push({ story, unit, reason: home.value.reason });
    return ok(undefined);
  }
  if (!there && home.value === null) return ok(undefined);
  if (there && !dryRun) {
    const gone = await vcs.worktree.remove(unit);
    if (!gone.ok) return gone;
  }
  const fate = home.value === null ? null : await dropUnitBranch(env, unit, { dryRun });
  if (fate && !fate.ok) return fate;
  const branch = fate?.value?.deleted ? fate.value.branch : null;
  if (fate?.value && !fate.value.deleted) out.kept.push({ story, unit, reason: fate.value.reason });
  if (there || branch) out.removed.push({ story, unit, worktree: there, branch });
  return ok(undefined);
}

export async function tidy(env: RuntimeEnv, opts: { dryRun?: boolean } = {}): Promise<PluginResult<TidyReport>> {
  const dryRun = opts.dryRun === true;
  const out: TidyReport = { dry_run: dryRun, removed: [], kept: [] };
  const listed = await env.slots.store.listUnits();
  if (!listed.ok) return listed;
  const byStory = new Map<string, string[]>();
  for (const unit of listed.value) {
    const ref = parseUnitId(unit);
    if (!ref) continue;
    byStory.set(ref.story, [...(byStory.get(ref.story) ?? []), unit]);
  }
  for (const story of [...byStory.keys()].sort()) {
    const units = byStory.get(story) as string[];
    const hold = await storyHold(env, story, units);
    if (!hold.ok) return hold;
    if (hold.value !== null) {
      out.kept.push({ story, reason: hold.value });
      continue;
    }
    // slices before their story, whose branch is where an integrated slice's commits are found
    for (const unit of [...units].sort((a, b) => Number(a === story) - Number(b === story) || a.localeCompare(b))) {
      const done = await tidyUnit(env, story, unit, dryRun, out);
      if (!done.ok) return done;
    }
  }
  return ok(out);
}
