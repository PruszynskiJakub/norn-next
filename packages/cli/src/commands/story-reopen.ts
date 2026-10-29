/**
 * `norn story reopen [<story>]` (B40–B42, D4, D5): undo a close. Re-claim the story here, restore
 * its worktrees from the pushed branches (`runtime/checkout.ts`, as `story checkout` does) and set
 * `spec.md` back to `active`, in one commit on the story branch with the take receipt, pushed. Each
 * unit is back at the step it was at; a unit that was running at close gets a `stuck` receipt by the
 * person with reason `reopened` (B41), so the next tick parks it under Unblock instead of starting
 * it, and `norn run rerun` resumes it. A moved base is left to the next tick's base sync.
 *
 * Refused before anything changes (B42, exit 3): a story that is not closed; issue #N closed on the
 * remote; a started slice whose branch is missing from the remote.
 */
import { join, relative } from "node:path";
import { cmd } from "@norn/core";
import { STORY_UNIT_DIR } from "@norn/schema";
import { acquireTickLock, appendReceipt, patchStoryFile, readState, storyFile } from "@norn/store";
import { defineCommand } from "../command.ts";
import type { Context } from "../context.ts";
import { busyError, failure, refuse } from "../output.ts";
import { checkoutStory } from "../runtime/checkout.ts";
import { closedStories, isClosed, type PushedStory, pushedStory, startedSliceBranches } from "../runtime/closed.ts";
import { humanReceipt } from "../runtime/human.ts";
import { gitRemote } from "../runtime/observe/index.ts";
import { resolveStory } from "../runtime/target.ts";

const REOPEN_REASON = "reopened";

/** B42: the closed story's pushed record, or a refusal saying what keeps it from being restored — checked before any change. */
async function restorable(ctx: Context, key: string): Promise<PushedStory> {
  const s = await pushedStory(ctx, key, cmd.storyReopen(key));
  if (!s) throw refuse(`no story branch for ${key}`, "check the story key", "unknown_story");
  if (!isClosed(s)) throw refuse(`${key} is not closed (spec.md says ${s.frontmatter.status})`, cmd.storyView(key), "not_closed");
  const remote = (await ctx.ports()).remote;
  const issue = remote ? await remote.getIssue(s.frontmatter.number).catch((e: unknown) => {
    throw failure(`cannot read issue #${s.frontmatter.number}: ${(e as Error).message}`, `retry: ${cmd.storyReopen(key)}`, "network");
  }) : null;
  if (issue && issue.state !== "open") throw refuse(`issue #${s.frontmatter.number} of ${key} is closed`, "reopen the issue first", "issue_closed");
  const origin = await gitRemote(ctx.git, ctx.root, ctx.config.remote.git_remote);
  if (!origin) return s;
  const listed = await ctx.git.remoteBranches(ctx.root, origin, `refs/heads/${key}/*`).catch((e: unknown) => {
    throw failure(`cannot list ${origin} branches: ${(e as Error).message}`, `retry: ${cmd.storyReopen(key)}`, "network");
  });
  for (const b of await startedSliceBranches(ctx, s))
    if (!listed.includes(b.branch)) throw refuse(`${b.key}'s branch ${b.branch} is missing from ${origin}`, `push ${b.branch} to ${origin}, or mark ${b.key} dropped on ${s.branch}, then ${cmd.storyReopen(key)}`, "branch_missing");
  return s;
}

export const storyReopenCommand = defineCommand({
  name: "story reopen",
  summary: "Undo a close: claim the story here, restore its worktrees and put each unit back at its step (B40)",
  usage: "norn story reopen [<story>]",
  positionals: { max: 1 },
  async run(ctx, args) {
    const key = await resolveStory(ctx, args.positionals[0], args.json === true, {
      verb: "story reopen",
      command: cmd.storyReopen,
      none: "No story is closed",
      story: true,
      // B55: only closed stories are offered; they have no worktree, so the read model does not list them
      candidates: async () => (await closedStories(ctx, cmd.storyReopen)).map((k) => ({ value: k, label: k })),
      applies: () => false,
    });
    const record = await restorable(ctx, key);
    const lock = await acquireTickLock(ctx.root, { note: "norn story reopen", now: () => ctx.clock.iso() });
    if (!lock.ok) throw busyError(`a tick is running (pid ${lock.holder.holder.pid})`, `retry: ${cmd.storyReopen(key)}`, "tick_locked");
    try {
      return await checkoutStory(ctx, key, false, ({ storyWt, spec_dir, worktrees }) => {
        const file = storyFile(join(storyWt, spec_dir));
        const p = patchStoryFile(file, { status: "active" }, storyWt);
        if (!p.ok) throw failure(`cannot mark ${relative(storyWt, file)} active: ${p.reason}`, `fix ${relative(storyWt, file)} on ${record.branch}, then ${cmd.storyReopen(key)} again`, "story_corrupt");
        const paths = [relative(storyWt, file)];
        // B41, D4: a unit that was running comes back stuck; the next tick parks it, never starts it
        const stuck: string[] = [];
        for (const w of worktrees) {
          const slice = w.unit === key ? null : w.unit;
          const runsDir = join(w.path, spec_dir, "runs", slice ? w.branch.slice(key.length + 1) : STORY_UNIT_DIR);
          const st = readState(runsDir);
          if (!st.ok || st.value.status !== "running" || !st.value.run) continue;
          const written = appendReceipt(runsDir, humanReceipt(ctx, { slice }, st.value, "stuck", { reason: REOPEN_REASON }));
          if (!slice) paths.push(relative(storyWt, written.file));
          stuck.push(w.unit);
        }
        return { paths, message: `norn: ${key} reopened`, value: { reopened: true, stuck } };
      });
    } finally {
      lock.release();
    }
  },
});
