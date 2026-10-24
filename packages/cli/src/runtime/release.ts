/**
 * Claim release (T6): push the story and slice branches first, then delete the claim ref by
 * CAS. Edited handoff.md files are committed first. Used by a clean `watch` exit and `norn release <story>`.
 */
import { existsSync } from "node:fs";
import { join, relative } from "node:path";
import type { StoryFacts } from "@norn/core";
import { ulid } from "@norn/schema";
import { acquireTickLock, releaseClaim } from "@norn/store";
import type { Context } from "../context.ts";
import { busyError } from "../output.ts";
import { type Observed, observe } from "./observe.ts";

export interface ReleaseResult {
  story: string;
  ok: boolean;
  pushed: string[];
  error?: string;
}

/** A claim this heartbeat may release: held now, or expired but last written by this heartbeat. */
export function heldHere(obs: Observed, story: StoryFacts): boolean {
  const c = story.claim;
  return c.state === "mine" || (c.state === "expired" && c.blob.heartbeat_id === obs.heartbeat_id);
}

/** Commit edits to each unit's handoff.md (agents and people write Goal/Progress/Resume, S9) before a handoff point. */
export async function commitHandoffs(obs: Observed, story: StoryFacts): Promise<string[]> {
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
    const branches: Array<{ cwd: string; branch: string; force: boolean }> = [];
    const loc = obs.stories[story.key];
    if (loc?.worktree) branches.push({ cwd: loc.worktree, branch: loc.branch, force: false });
    for (const u of story.units) {
      const ul = obs.units[u.unit.key];
      if (u.unit.slice && ul?.worktree && u.worktree?.exists) branches.push({ cwd: ul.worktree, branch: ul.branch, force: true });
    }
    for (const b of branches) {
      const r = await git.push(b.cwd, obs.remote, `${b.force ? "+" : ""}refs/heads/${b.branch}:refs/heads/${b.branch}`);
      if (!r.ok) return { story: story.key, ok: false, pushed, error: `push ${b.branch} failed: ${r.message}` };
      pushed.push(b.branch);
    }
  }
  const r = await releaseClaim(obs.root, obs.remote, story.key, sha);
  return r.ok ? { story: story.key, ok: true, pushed } : { story: story.key, ok: false, pushed, error: r.message };
}

/** Release every claim this heartbeat holds (clean `watch` exit, T6). */
export async function releaseHeldClaims(ctx: Context): Promise<ReleaseResult[]> {
  const lock = await acquireTickLock(ctx.root, { note: "norn release", now: () => ctx.clock.iso() });
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
