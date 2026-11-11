/**
 * Claim release: push the story and slice branches first, through the one push path (a person's
 * push to the story branch is merged in, never rebased: runtime/push.ts), then the story's record to
 * its ref (under either policy), then delete the claim ref by CAS. Only by the heartbeat holding
 * the claim. Edited handoff.md files are committed first. A failed
 * record push releases nothing. Used by a clean `watch` exit and `norn story handoff`;
 * `norn story close`, the merged-story cleanup and the closed-issue close make the same push
 * (`pushHeldRecord`, runtime/close.ts).
 */
import { existsSync } from "node:fs";
import { join, relative } from "node:path";
import { askingMidMerge, cmd, prOpen, type StoryFacts } from "@norn/core";
import { headsRef, ulid } from "@norn/schema";
import { releaseClaim, writtenHere } from "@norn/store";
import type { Context } from "../context.ts";
import { refuse } from "../output.ts";
import { pushHeldRecord, recordPushError } from "./close.ts";
import { pushBranch } from "./push.ts";
import { waitForTickLock } from "./tick-lock.ts";
import { type Observed, observe } from "./observe/index.ts";

/** Observe under the tick lock (no remote sync) and find the story, or refuse. */
export async function withStory<T>(ctx: Context, key: string, note: string, f: (obs: Observed, story: Observed["facts"]["stories"][number]) => Promise<T>): Promise<T> {
  const lock = await waitForTickLock(ctx, note, `retry: ${note}`);
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
  /** the record on the story's ref once released: its commit and the story branch commit it matches (null: no branch); null: no run state */
  record?: { sha: string; branch_commit: string | null } | null;
  /** `record`: the record push failed, so the claim is kept */
  failed?: "record";
  /** `merge_in_progress`: a resolve waits at an ask mid-merge, so the claim is kept on purpose (ok: nothing failed) */
  kept?: "merge_in_progress";
  error?: string;
}

/** A claim this heartbeat may release: held now, or expired but last written by this heartbeat. */
export function heldHere(obs: Observed, story: StoryFacts): boolean {
  return writtenHere(story.claim, obs.heartbeat_id);
}

/** Commit edits to each unit's handoff (agents and people write it; norn never does) before a handoff point. */
async function commitHandoffs(obs: Observed, story: StoryFacts): Promise<string[]> {
  const out: string[] = [];
  for (const u of story.units) {
    const ul = obs.units[u.unit.key];
    const cwd = ul?.worktree;
    if (!ul || !cwd || !existsSync(ul.handoffFile)) continue;
    const sha = await obs.ports.git.commit(cwd, {
      message: `norn: ${u.unit.key} handoff`,
      trailers: { "Norn-Story": story.key, ...(u.unit.slice ? { "Norn-Slice": u.unit.slice } : {}), "Norn-Step": ul.state?.step ?? "release", "Norn-Tick": obs.facts.tick_id },
      paths: [relative(cwd, ul.handoffFile)],
    });
    if (sha) out.push(u.unit.key);
  }
  return out;
}

/** Trailers of the merge commit a release makes when it takes in a person's push. */
function releaseTrailers(key: string, slice: string | null, obs: Observed): Record<string, string> {
  return { "Norn-Story": key, ...(slice ? { "Norn-Slice": slice } : {}), "Norn-Step": "release", "Norn-Tick": obs.facts.tick_id };
}

export async function releaseStory(obs: Observed, story: StoryFacts): Promise<ReleaseResult> {
  if (!heldHere(obs, story) || (story.claim.state !== "mine" && story.claim.state !== "expired")) return { story: story.key, ok: false, pushed: [], error: `claim is ${story.claim.state}, not held here` };
  const sha = story.claim.sha;
  const git = obs.ports.git;
  const pushed: string[] = [];
  await commitHandoffs(obs, story);
  if (obs.remote) {
    const remote = obs.remote;
    const branches: Array<{ cwd: string; branch: string; slice: string | null }> = [];
    const loc = obs.stories[story.key];
    if (loc?.worktree) branches.push({ cwd: loc.worktree, branch: loc.branch, slice: null });
    for (const u of story.units) {
      const ul = obs.units[u.unit.key];
      if (u.unit.slice && ul?.worktree && u.worktree?.exists) branches.push({ cwd: ul.worktree, branch: ul.branch, slice: u.unit.slice });
    }
    // While the PR is open the story's latest boundary goes to its heads ref: the PR head stays the commit CI ran on
    const heads = prOpen(story);
    // Stop at the first failed push: the record and the claim wait for every branch
    for (const b of branches) {
      const headsOnly = heads && b.slice === null;
      const r = await pushBranch(git, { cwd: b.cwd, remote, branch: b.branch, trailers: releaseTrailers(story.key, b.slice, obs), tick: obs.facts.tick_id, heads: headsOnly });
      if (!r.ok) return { story: story.key, ok: false, pushed, error: `push ${b.branch} failed: ${r.message}; the claim is kept` };
      pushed.push(headsOnly ? headsRef(story.key) : b.branch);
    }
  }
  // The record goes before the claim; a failed push keeps the claim and deletes nothing
  const rec = await pushHeldRecord(obs, story.key, obs.stories[story.key]?.branch ?? story.branch);
  if (!rec.ok) return { story: story.key, ok: false, pushed, failed: "record", error: `${recordPushError(story.key, rec.reason, rec.message)}; the claim is kept` };
  const record = rec.sha === null ? null : { sha: rec.sha, branch_commit: rec.branch_commit };
  const r = await releaseClaim(obs.root, obs.remote, story.key, sha);
  return r.ok ? { story: story.key, ok: true, pushed, record } : { story: story.key, ok: false, pushed, record, error: r.message };
}

/** Release every claim this heartbeat holds (clean `watch` exit), but a story asking mid-merge. */
export async function releaseHeldClaims(ctx: Context): Promise<ReleaseResult[]> {
  // The clean-exit release waits for a running tick too; its abort signal has already fired
  const lock = await waitForTickLock(ctx, "norn story handoff", "retry when it finishes", null);
  try {
    const obs = await observe(ctx, { tick_id: ulid(ctx.clock.now()), sync: "never" });
    const out: ReleaseResult[] = [];
    for (const s of obs.facts.stories) {
      if (s.claim.state !== "mine") continue;
      // The partial resolution lives only in this worktree: keep the claim so a restart here resumes it
      if (askingMidMerge(s)) out.push({ story: s.key, ok: true, pushed: [], kept: "merge_in_progress" });
      else out.push(await releaseStory(obs, s));
    }
    return out;
  } finally {
    lock.release();
  }
}
