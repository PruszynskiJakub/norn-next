/**
 * Claim release (T6): push the story and slice branches first, then delete the claim ref by
 * CAS. Only by the heartbeat holding the claim, and only fast-forward pushes (R3.3). Edited handoff.md files are committed first. Used by a clean `watch` exit and `norn story handoff` (B34).
 */
import { existsSync } from "node:fs";
import { join, relative } from "node:path";
import { cmd, type GitPort, type StoryFacts } from "@norn/core";
import { ulid } from "@norn/schema";
import { acquireTickLock, releaseClaim, writtenHere } from "@norn/store";
import type { Context } from "../context.ts";
import { busyError, refuse } from "../output.ts";
import { type Observed, observe } from "./observe/index.ts";

/** Observe under the tick lock (no remote sync) and find the story, or refuse. */
export async function withStory<T>(ctx: Context, key: string, note: string, f: (obs: Observed, story: Observed["facts"]["stories"][number]) => Promise<T>): Promise<T> {
  const lock = await acquireTickLock(ctx.root, { note, now: () => ctx.clock.iso() });
  if (!lock.ok) throw busyError(`a tick is running (pid ${lock.holder.holder.pid})`, `retry: ${note}`, "tick_locked");
  try {
    const obs = await observe(ctx, { tick_id: ulid(ctx.clock.now()), sync: "never" });
    const story = obs.facts.stories.find((s) => s.key === key);
    if (!story) throw refuse(`story ${key} is not checked out here`, cmd.storyCheckout(key), "unknown_story");
    return await f(obs, story);
  } finally {
    lock.release();
  }
}

export interface ReleaseResult {
  story: string;
  ok: boolean;
  pushed: string[];
  error?: string;
}

/** A claim this heartbeat may release: held now, or expired but last written by this heartbeat. */
export function heldHere(obs: Observed, story: StoryFacts): boolean {
  return writtenHere(story.claim, obs.heartbeat_id);
}

/** Commit edits to each unit's handoff.md (agents and people write Goal/Progress/Resume, S9) before a handoff point. */
async function commitHandoffs(obs: Observed, story: StoryFacts): Promise<string[]> {
  const out: string[] = [];
  for (const u of story.units) {
    const ul = obs.units[u.unit.key];
    const cwd = ul?.worktree;
    if (!ul || !cwd || !existsSync(join(ul.runsDir, "handoff.md"))) continue;
    const sha = await obs.ports.git.commit(cwd, {
      message: `norn: ${u.unit.key} handoff`,
      trailers: { "Norn-Story": story.key, ...(u.unit.slice ? { "Norn-Slice": u.unit.slice } : {}), "Norn-Step": ul.state?.step ?? "release", "Norn-Tick": obs.facts.tick_id },
      paths: [relative(cwd, join(ul.runsDir, "handoff.md"))],
    });
    if (sha) out.push(u.unit.key);
  }
  return out;
}

export async function releaseStory(obs: Observed, story: StoryFacts): Promise<ReleaseResult> {
  if (!heldHere(obs, story) || (story.claim.state !== "mine" && story.claim.state !== "expired")) return { story: story.key, ok: false, pushed: [], error: `claim is ${story.claim.state}, not held here` };
  const sha = story.claim.sha;
  const git = obs.ports.git;
  const pushed: string[] = [];
  await commitHandoffs(obs, story);
  if (obs.remote) {
    const remote = obs.remote;
    const branches: Array<{ cwd: string; branch: string }> = [];
    const loc = obs.stories[story.key];
    if (loc?.worktree) branches.push({ cwd: loc.worktree, branch: loc.branch });
    for (const u of story.units) {
      const ul = obs.units[u.unit.key];
      if (u.unit.slice && ul?.worktree && u.worktree?.exists) branches.push({ cwd: ul.worktree, branch: ul.branch });
    }
    // R3.3 (H6, A21): push only fast-forwards of the remote branches — a stale local branch never
    // replaces the record. Checked for every branch before anything is pushed or deleted.
    for (const b of branches) {
      const ff = await fastForwardOf(git, obs.root, remote, b.branch);
      if (!ff.ok) return { story: story.key, ok: false, pushed, error: `${b.branch} is not a fast-forward of ${remote}/${b.branch} (${ff.reason}); nothing pushed or released` };
    }
    for (const b of branches) {
      const r = await git.push(b.cwd, remote, `refs/heads/${b.branch}:refs/heads/${b.branch}`);
      if (!r.ok) return { story: story.key, ok: false, pushed, error: `push ${b.branch} failed: ${r.message}` };
      pushed.push(b.branch);
    }
  }
  const r = await releaseClaim(obs.root, obs.remote, story.key, sha);
  return r.ok ? { story: story.key, ok: true, pushed } : { story: story.key, ok: false, pushed, error: r.message };
}

/** R3.3: is local `branch` a fast-forward of the remote one (fetched now; absent remotely counts)? */
async function fastForwardOf(git: GitPort, root: string, remote: string, branch: string): Promise<{ ok: true } | { ok: false; reason: string }> {
  const tracking = `refs/remotes/${remote}/${branch}`;
  const failed = await git.fetch(root, remote, [`+refs/heads/${branch}:${tracking}`], { quiet: true }).then(
    () => null,
    (e: unknown) => (e instanceof Error ? e.message : String(e)),
  );
  // a branch missing on the remote (never pushed) is fine; any other fetch failure decides nothing
  if (failed !== null && !/couldn't find remote ref/i.test(failed)) return { ok: false, reason: failed };
  if (!(await git.hasRef(root, tracking))) return { ok: true };
  const anc = await git.isAncestor(root, tracking, `refs/heads/${branch}`).catch(() => false);
  return anc ? { ok: true } : { ok: false, reason: "the remote has commits this checkout does not" };
}

/** Release every claim this heartbeat holds (clean `watch` exit, T6). */
export async function releaseHeldClaims(ctx: Context): Promise<ReleaseResult[]> {
  const lock = await acquireTickLock(ctx.root, { note: "norn story handoff", now: () => ctx.clock.iso() });
  if (!lock.ok) throw busyError("a tick is running", "retry when it finishes", "tick_locked");
  try {
    const obs = await observe(ctx, { tick_id: ulid(ctx.clock.now()), sync: "never" });
    const out: ReleaseResult[] = [];
    for (const s of obs.facts.stories) if (s.claim.state === "mine") out.push(await releaseStory(obs, s));
    return out;
  } finally {
    lock.release();
  }
}
