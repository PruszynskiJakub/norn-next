/**
 * `norn drop <story>` (GR7): stop working on a story and clean up this machine, keeping the record.
 *
 * Order (nothing is lost): claim it if free (T7: only the holder pushes) → mark `story.md`
 * `status: dropped` and commit every unit worktree's changes → push story and slice branches
 * (as `release` does) → then remove worktrees, local branches, leases and the claim ref.
 * The spec folder with `runs/` and `handoff.md` stays on the pushed story branch. Without a git
 * remote the local branches are the only copy, so they are kept.
 */
import { existsSync } from "node:fs";
import { join, relative } from "node:path";
import type { StoryFacts } from "@norn/core";
import { acquireClaim, listLeases, newClaimBlob, patchStoryFile, releaseClaim, releaseLease, storyFile } from "@norn/store";
import { defineCommand } from "../command.ts";
import { claimHeld, failure, refuse } from "../output.ts";
import type { Observed } from "../runtime/observe.ts";
import { heldHere } from "../runtime/release.ts";
import { withStory } from "./release.ts";
import { storyArg } from "./take.ts";

async function claimIfFree(obs: Observed, story: StoryFacts): Promise<string> {
  const c = story.claim;
  if (heldHere(obs, story) && (c.state === "mine" || c.state === "expired")) return c.sha;
  if (c.state === "other") throw claimHeld(c.blob, `the holder drops it, or norn take ${story.key} --force first`);
  if (c.state === "corrupt") throw refuse(`claim ref of ${story.key} is unreadable`, `norn take ${story.key} --force`, "claim_corrupt");
  const now = obs.facts.now;
  const blob = newClaimBlob({ story: story.key, holder: obs.facts.machine.holder, heartbeat_id: obs.heartbeat_id, now, lease: obs.config.claim.lease });
  const r = await acquireClaim(obs.root, obs.remote, blob, { now });
  if (!r.ok) {
    if (r.reason === "held") throw claimHeld(r.holder, `the holder drops it, or norn take ${story.key} --force first`);
    throw failure(`cannot claim ${story.key}: ${r.message}`, `retry: norn drop ${story.key}`, "claim_failed");
  }
  return r.sha;
}

export const dropCommand = defineCommand({
  name: "drop",
  summary: "Drop a story: push its branches, then remove worktrees, local branches and the claim; the record stays (GR7)",
  usage: "norn drop <story>",
  positionals: { min: 1, max: 1 },
  async run(ctx, args) {
    const key = storyArg(args.positionals[0] as string, "drop");
    return withStory(ctx, key, `norn drop ${key}`, async (obs, story) => {
      const git = obs.ports.git;
      const claimSha = await claimIfFree(obs, story);
      const loc = obs.stories[key];
      const tick = obs.facts.tick_id;
      const trailers = (unit: string | null, step: string) => ({ "Norn-Story": key, ...(unit ? { "Norn-Slice": unit } : {}), "Norn-Step": step, "Norn-Tick": tick });

      // 1. stop live sessions this machine runs (best effort; their work is committed below)
      const killed: string[] = [];
      for (const u of story.units) {
        const s = u.state?.status === "running" ? u.run?.session : null;
        if (s && obs.ports.runner && s.runner === obs.ports.runner.name) {
          await obs.ports.runner.kill(s).catch(() => undefined);
          killed.push(u.unit.key);
        }
      }

      // 2. record + every change committed (GR7: never delete work)
      const committed: string[] = [];
      const sliceWts: Array<{ unit: string; path: string; branch: string }> = [];
      for (const u of story.units) {
        const ul = obs.units[u.unit.key];
        if (u.unit.slice && ul?.worktree && existsSync(ul.worktree)) sliceWts.push({ unit: u.unit.key, path: ul.worktree, branch: ul.branch });
      }
      for (const w of sliceWts) if (await git.commit(w.path, { message: `norn: ${w.unit} dropped (work kept)`, trailers: trailers(w.unit, "drop") })) committed.push(w.unit);
      const storyWt = loc?.worktree && existsSync(loc.worktree) ? loc.worktree : null;
      if (storyWt) {
        const file = storyFile(join(storyWt, loc?.spec_dir ?? ""));
        const p = patchStoryFile(file, { status: "dropped" }, storyWt);
        if (!p.ok) throw failure(`cannot mark ${relative(storyWt, file)} dropped: ${p.reason}`, "fix story.md, then norn drop again", "story_corrupt");
        if (await git.commit(storyWt, { message: `norn: ${key} dropped`, trailers: trailers(null, "drop") })) committed.push(key);
      }

      // 3. push first (T6/GR7); stop on any failure with everything still in place
      const pushed: string[] = [];
      if (obs.remote) {
        const branches = [...(storyWt && loc ? [{ cwd: storyWt, branch: loc.branch, force: false }] : []), ...sliceWts.map((w) => ({ cwd: w.path, branch: w.branch, force: true }))];
        for (const b of branches) {
          const r = await git.push(b.cwd, obs.remote, `${b.force ? "+" : ""}refs/heads/${b.branch}:refs/heads/${b.branch}`);
          if (!r.ok) throw failure(`push ${b.branch} failed (${r.reason}): ${r.message}`, `fix the push problem, then norn drop ${key} again; nothing was removed`, "push_failed", { pushed });
          pushed.push(b.branch);
        }
      }

      // 4. clean up this machine
      const removed: string[] = [];
      for (const w of [...sliceWts.map((x) => x.path), ...(storyWt ? [storyWt] : [])]) {
        await git.worktreeRemove(obs.root, w, { force: true });
        removed.push(w);
      }
      const deleted: string[] = [];
      const kept: string[] = [];
      const localBranches = [...sliceWts.map((w) => w.branch), ...(loc ? [loc.branch] : [])];
      for (const b of localBranches) {
        if (!(await git.branchExists(obs.root, b))) continue;
        if (!obs.remote) {
          kept.push(b); // no remote: the local branch is the only copy of the record
          continue;
        }
        await git.deleteBranch(obs.root, b, { force: true });
        deleted.push(b);
      }
      const leases: string[] = [];
      for (const e of (await listLeases(ctx.home, () => true)).live)
        if (e.lease.repo === obs.root && e.lease.story === key && releaseLease(ctx.home, e.file)) leases.push(e.file);
      const rel = await releaseClaim(obs.root, obs.remote, key, claimSha);

      return {
        story: key,
        dropped: true,
        killed,
        committed,
        pushed,
        worktrees_removed: removed,
        branches_deleted: deleted,
        ...(kept.length ? { branches_kept: kept } : {}),
        leases_released: leases,
        claim_deleted: rel.ok,
        ...(rel.ok ? {} : { claim_error: rel.message }),
        record: obs.remote && loc ? `${obs.remote}/${loc.branch}` : (loc?.branch ?? null),
      };
    });
  },
});
