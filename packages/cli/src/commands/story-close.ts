/**
 * `norn story close [<story>] [--yes]` (B35–B39, GR7): stop working on a story and clean up this
 * machine, keeping the record; the remote issue and PR are left alone.
 *
 * Refused first, before anything changes: a story already closed — its pushed `story.md` says
 * `dropped` (D5, B39); a claim another machine holds (B38). Then consent: `--yes`, or y at the
 * terminal (B36); without a terminal (no TTY, `--json`, an agent session) it is refused (B37).
 *
 * Order (nothing is lost): claim it if free (T7: only the holder pushes) → mark `story.md`
 * `status: dropped` and commit every unit worktree's changes → push story and slice branches
 * (as `story handoff` does) → then remove worktrees, local branches, leases and the claim ref.
 * The spec folder with `runs/` and `handoff.md` stays on the pushed story branch. Without a git
 * remote the local branches are the only copy, so they are kept.
 */
import { existsSync } from "node:fs";
import { join, relative } from "node:path";
import { type ClaimState, cmd } from "@norn/core";
import { specDir } from "@norn/schema";
import { acquireClaim, listLeases, newClaimBlob, parseStoryFile, patchStoryFile, releaseClaim, releaseLease, scanWorktrees, storyFile, writtenHere } from "@norn/store";
import { defineCommand, opt } from "../command.ts";
import type { Context } from "../context.ts";
import { failure, refuse } from "../output.ts";
import { findStoryBranch } from "../runtime/checkout.ts";
import { claimFor } from "../runtime/human.ts";
import { gitRemote, type Observed } from "../runtime/observe/index.ts";
import { withStory } from "../runtime/release.ts";
import { aStory, resolveStory } from "../runtime/target.ts";

/** B38: the refusal for a claim another machine holds (exit 3, unlike checkout's busy `claim_held`). */
function heldElsewhere(key: string, holder: { holder: string; acquired_at: string }) {
  return refuse(`${key} is held by ${holder.holder} since ${holder.acquired_at}`, cmd.storyCheckout(key), "claim_held");
}

/** B38: the remote's claim now — another machine's (or an unreadable one) is refused, never taken over here. */
async function refuseOthers(ctx: Context, key: string, remote?: string | null): Promise<ClaimState> {
  const c = await claimFor(ctx, key, remote !== undefined ? { remote } : {});
  if (c.state === "other") throw heldElsewhere(key, c.blob);
  if (c.state === "corrupt") throw claimCorrupt(key);
  return c;
}

const claimCorrupt = (key: string) => refuse(`claim ref of ${key} is unreadable`, cmd.storyCheckout(key, { force: true }), "claim_corrupt");

/**
 * Under the tick lock: read the remote claim again (B38) — the prompt may have stayed open while
 * another machine ran `story checkout --force`, and the local claim ref can be stale — then keep
 * this heartbeat's claim or take a free one (T7: only the holder pushes).
 */
async function claimIfFree(ctx: Context, obs: Observed, key: string): Promise<string> {
  const c = await refuseOthers(ctx, key, obs.remote);
  if ((c.state === "mine" || c.state === "expired") && writtenHere(c, obs.heartbeat_id)) return c.sha;
  const now = obs.facts.now;
  const blob = newClaimBlob({ story: key, holder: obs.facts.machine.holder, heartbeat_id: obs.heartbeat_id, now, lease: obs.config.claim.lease });
  const r = await acquireClaim(obs.root, obs.remote, blob, { now });
  if (!r.ok) {
    if (r.reason === "held") throw heldElsewhere(key, r.holder);
    if (r.reason === "corrupt") throw claimCorrupt(key);
    throw failure(`cannot claim ${key}: ${r.message}`, `retry: ${cmd.storyClose(key)}`, "claim_failed");
  }
  return r.sha;
}

/** D5, B39: closed = `story.md` on the pushed story branch (the local one without a remote) says `dropped`. */
async function isClosed(ctx: Context, key: string): Promise<boolean> {
  const remote = await gitRemote(ctx.git, ctx.root, ctx.config.remote.git_remote);
  const branch = await findStoryBranch(ctx, key, remote);
  if (!branch) return false;
  const git = ctx.git;
  let rev = `refs/heads/${branch}`;
  if (remote) {
    const f = await git.fetch(ctx.root, remote, [`+refs/heads/${branch}:refs/remotes/${remote}/${branch}`], { quiet: true }).catch((e: unknown) => e as Error);
    if (f instanceof Error) throw failure(`fetch failed: ${f.message}`, `retry: ${cmd.storyClose(key)}`, "network");
    rev = `refs/remotes/${remote}/${branch}`;
  }
  const path = `${specDir(key, branch.slice(key.length + 1))}/story.md`;
  const text = await git.show(ctx.root, rev, path);
  if (text === null) return false;
  const doc = parseStoryFile(text, `${rev}:${path}`);
  // S2: an unreadable record is never guessed open
  if (!doc.ok) throw failure(`${rev}:${path} is unreadable (${doc.reason})`, `fix story.md on ${branch}, then ${cmd.storyClose(key)} again`, "story_corrupt");
  return doc.value.frontmatter.status === "dropped";
}

export const storyCloseCommand = defineCommand({
  name: "story close",
  summary: "Close a story: push its branches, then remove worktrees, local branches and the claim; the record, issue and PR stay (B35, GR7)",
  usage: "norn story close [<story>] [--yes]",
  options: { yes: { type: "boolean" } },
  optionHelp: { "--yes": "close without asking (needed under --json or without a terminal)" },
  positionals: { max: 1 },
  async run(ctx, args) {
    const json = args.json === true;
    const key = await resolveStory(ctx, args.positionals[0], json, aStory("story close", cmd.storyClose));
    if (await isClosed(ctx, key)) throw refuse(`${key} is already closed`, null, "already_closed");
    await refuseOthers(ctx, key);
    // B36: ask before taking the tick lock, so an open prompt never blocks tick or watch
    if (!opt.bool(args, "yes")) {
      const terminal = ctx.terminal(json);
      if (!terminal) throw refuse(`closing ${key} removes its worktrees; there is no terminal to ask in`, "pass --yes", "confirm_required");
      const wts = scanWorktrees(ctx.root);
      const count = (wts.stories.has(key) ? 1 : 0) + [...wts.slices.keys()].filter((s) => s.startsWith(`${key}/`)).length;
      if (!(await terminal.confirm(`Close ${key}? Worktrees for ${count} units will be removed [y/N]`))) return { story: key, dropped: false };
    }
    return withStory(ctx, key, cmd.storyClose(key), async (obs, story) => {
      const git = obs.ports.git;
      const loc = obs.stories[key];
      const claimSha = await claimIfFree(ctx, obs, key);
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
        if (!p.ok) throw failure(`cannot mark ${relative(storyWt, file)} dropped: ${p.reason}`, `fix story.md, then ${cmd.storyClose(key)} again`, "story_corrupt");
        if (await git.commit(storyWt, { message: `norn: ${key} dropped`, trailers: trailers(null, "drop") })) committed.push(key);
      }

      // 3. push first (T6/GR7); stop on any failure with everything still in place
      const pushed: string[] = [];
      if (obs.remote) {
        const branches = [...(storyWt && loc ? [{ cwd: storyWt, branch: loc.branch, force: false }] : []), ...sliceWts.map((w) => ({ cwd: w.path, branch: w.branch, force: true }))];
        for (const b of branches) {
          const r = await git.push(b.cwd, obs.remote, `${b.force ? "+" : ""}refs/heads/${b.branch}:refs/heads/${b.branch}`);
          if (!r.ok) throw failure(`push ${b.branch} failed (${r.reason}): ${r.message}`, `fix the push problem, then ${cmd.storyClose(key, { yes: true })} again; nothing was removed`, "push_failed", { pushed });
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
