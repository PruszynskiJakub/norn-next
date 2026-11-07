/**
 * `norn story reset [<story>] [--yes] [--force]`: take a story back to before intake —
 * remove its worktrees, its local and remote branches (the record goes with them), leases, mailbox
 * refs and the claim. The remote issue is left alone, so the next sync takes it in again from the current base
 * while it is assigned and labelled.
 *
 * Refused first, before anything changes: a claim another machine holds; work a reset would
 * delete — a PR, a started slice, changes outside the spec folder (`resetBlockers`) — unless
 * `--force`. Then consent: `--yes`, or y at the terminal; without a terminal it is refused.
 *
 * Order: claim it if free → delete the remote branches, stopping on the first failure with
 * everything here still in place → remove worktrees, local branches, leases → delete the mailbox
 * refs → delete the claim ref.
 */
import { existsSync } from "node:fs";
import { cmd } from "@norn/core";
import { deleteMailbox, fetchNornRefs, listMailbox, releaseClaim, releaseStoryLeases, scanWorktrees } from "@norn/store";
import { defineCommand, opt } from "../command.ts";
import { failure, refuse } from "../output.ts";
import { killLocalSessions } from "../runtime/close.ts";
import { withStory } from "../runtime/release.ts";
import { resetBlockers } from "../runtime/reset.ts";
import { aStory, resolveStory } from "../runtime/target.ts";
import { claimIfFree, refuseOthers } from "./story-close.ts";

export const storyResetCommand = defineCommand({
  name: "story reset",
  version: "acts",
  summary: "Reset a story to before intake: remove its worktrees, local and remote branches, record and claim; the issue stays",
  usage: "norn story reset [<story>] [--yes] [--force]",
  options: { yes: { type: "boolean" }, force: { type: "boolean" } },
  optionHelp: {
    "--yes": "reset without asking (needed under --json or without a terminal)",
    "--force": "reset a story that holds work: a PR, started slices or changes outside its spec folder",
  },
  positionals: { max: 1 },
  async run(ctx, args) {
    const json = args.json === true;
    const force = opt.bool(args, "force");
    const key = await resolveStory(ctx, args.positionals[0], json, aStory("story reset", cmd.storyReset));
    await refuseOthers(ctx, key);
    const blocked = async (blockers: string[]) => {
      if (blockers.length && !force) throw refuse(`${key} holds work a reset would delete: ${blockers.join("; ")}`, `${cmd.storyClose(key)} keeps it; ${cmd.storyReset(key, { force: true })} deletes it`, "has_work", { blockers });
    };
    await withStory(ctx, key, cmd.storyReset(key), async (obs, story) => blocked(await resetBlockers(obs, story)));
    // Ask before taking the tick lock again, so an open prompt never blocks tick or watch
    if (!opt.bool(args, "yes")) {
      const terminal = ctx.terminal(json);
      if (!terminal) throw refuse(`resetting ${key} deletes its branches and record; there is no terminal to ask in`, "pass --yes", "confirm_required");
      const wts = scanWorktrees(ctx.root);
      const count = (wts.stories.has(key) ? 1 : 0) + [...wts.slices.keys()].filter((s) => s.startsWith(`${key}/`)).length;
      if (!(await terminal.confirm(`Reset ${key}? Worktrees for ${count} units, its branches here and on the remote and its record will be deleted [y/N]`))) return { story: key, reset: false };
    }
    return withStory(ctx, key, cmd.storyReset(key), async (obs, story) => {
      await blocked(await resetBlockers(obs, story)); // again under the lock: the story may have moved on while the question was open
      const git = obs.ports.git;
      const loc = obs.stories[key];
      const claimSha = await claimIfFree(ctx, obs, key);

      // 1. stop live sessions this machine runs (best effort)
      const killed = await killLocalSessions(obs, story);

      const sliceWts = story.units.flatMap((u) => {
        const ul = obs.units[u.unit.key];
        return u.unit.slice && ul ? [{ path: ul.worktree && existsSync(ul.worktree) ? ul.worktree : null, branch: ul.branch }] : [];
      });
      const branches = [...(loc ? [loc.branch] : []), ...sliceWts.map((w) => w.branch)];

      // 2. the remote branches first; stop on any failure with everything here still in place
      const remoteDeleted: string[] = [];
      if (obs.remote) {
        const onRemote = new Set([...(await git.remoteBranches(obs.root, obs.remote, `refs/heads/${key}-*`)), ...(await git.remoteBranches(obs.root, obs.remote, `refs/heads/${key}/*`))]);
        for (const b of [...new Set([...branches, ...[...onRemote].filter((b) => b.startsWith(`${key}/`))])].filter((b) => onRemote.has(b))) {
          const r = await git.deleteRemoteBranch(obs.root, obs.remote, b);
          if (!r.ok) throw failure(`deleting ${obs.remote}/${b} failed (${r.reason}): ${r.message}`, `fix the push problem, then ${cmd.storyReset(key, { yes: true })} again`, "push_failed", { remote_branches_deleted: remoteDeleted });
          remoteDeleted.push(b);
        }
      }

      // 3. clean up this machine
      const removed: string[] = [];
      for (const w of [...sliceWts.flatMap((x) => (x.path ? [x.path] : [])), ...(loc?.worktree && existsSync(loc.worktree) ? [loc.worktree] : [])]) {
        await git.worktreeRemove(obs.root, w, { force: true });
        removed.push(w);
      }
      const deleted: string[] = [];
      for (const b of branches) {
        if (!(await git.branchExists(obs.root, b))) continue;
        await git.deleteBranch(obs.root, b, { force: true });
        deleted.push(b);
      }
      const leases = await releaseStoryLeases(ctx.home, obs.root, key);
      // a receipt left for the old run would only be rejected later; delete it with the claim
      if (obs.remote) await fetchNornRefs(obs.root, obs.remote).catch(() => undefined);
      const mailbox: string[] = [];
      for (const m of await listMailbox(obs.root, key).catch(() => [])) if ((await deleteMailbox(obs.root, obs.remote, m.ref, m.sha)).ok) mailbox.push(m.ref);
      const rel = await releaseClaim(obs.root, obs.remote, key, claimSha);

      return {
        story: key,
        reset: true,
        killed,
        worktrees_removed: removed,
        branches_deleted: deleted,
        remote_branches_deleted: remoteDeleted,
        leases_released: leases,
        mailbox_deleted: mailbox,
        claim_deleted: rel.ok,
        ...(rel.ok ? {} : { claim_error: rel.message }),
      };
    });
  },
});
