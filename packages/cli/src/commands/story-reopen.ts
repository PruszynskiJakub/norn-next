/**
 * `norn story reopen [<story>]` (B40–B42, D4, D5): undo a close. Re-claim the story here, restore
 * its worktrees from the pushed branches (`runtime/checkout.ts`, as `story checkout` does) and set
 * `spec.md` back to `active`, in one commit on the story branch with the take receipt, pushed. Each
 * unit is back at the step it was at; a unit that was running at close gets a `stuck` receipt by the
 * person with reason `reopened` (B41), so the next tick parks it under Unblock instead of starting
 * it, and `norn run rerun` resumes it. A moved base is left to the next tick's base sync.
 *
 * Refused before anything changes (B42, exit 3): a story that is not closed; issue #N closed on the
 * remote; the story branch or a started slice's branch missing from the remote.
 */
import { existsSync } from "node:fs";
import { join, relative } from "node:path";
import { cmd } from "@norn/core";
import { parseStoryKey, recordRef, STORY_UNIT_DIR, slugify, storyBranch } from "@norn/schema";
import { appendReceipt, fetchRecords, patchStoryFile, readRecordRef, readState, runStateDir, storyFile, storyRunStateDir, unpackRecord } from "@norn/store";
import { defineCommand } from "../command.ts";
import type { Context } from "../context.ts";
import { type CliFailure, failure, refuse } from "../output.ts";
import { waitForTickLock } from "../runtime/tick-lock.ts";
import { checkoutStory } from "../runtime/checkout.ts";
import { closedStories, isClosed, type PushedStory, pushedStory, startedSliceBranches } from "../runtime/closed.ts";
import { humanReceipt } from "../runtime/human.ts";
import { gitRemote } from "../runtime/observe/index.ts";
import { resolveStory } from "../runtime/target.ts";

const REOPEN_REASON = "reopened";

/** B42: the closed story's pushed record, or a refusal saying what keeps it from being restored — checked before any change. */
async function restorable(ctx: Context, key: string): Promise<PushedStory> {
  const s = await pushedStory(ctx, key, cmd.storyReopen(key));
  if (!s) throw await noStoryBranch(ctx, key);
  if (!isClosed(s)) throw refuse(`${key} is not closed (spec.md says ${s.frontmatter.status})`, cmd.storyView(key), "not_closed");
  const remote = (await ctx.ports()).remote;
  const issue = remote ? await remote.getIssue(s.frontmatter.number).catch((e: unknown) => {
    throw failure(`cannot read issue #${s.frontmatter.number}: ${(e as Error).message}`, `retry: ${cmd.storyReopen(key)}`, "network");
  }) : null;
  if (issue && issue.state !== "open") throw refuse(`issue #${s.frontmatter.number} of ${key} is closed`, "reopen the issue first", "issue_closed");
  const origin = await gitRemote(ctx.git, ctx.root, ctx.config.git_remote);
  if (!origin) return s;
  const listed = await ctx.git.remoteBranches(ctx.root, origin, `refs/heads/${key}/*`).catch((e: unknown) => {
    throw failure(`cannot list ${origin} branches: ${(e as Error).message}`, `retry: ${cmd.storyReopen(key)}`, "network");
  });
  for (const b of await startedSliceBranches(ctx, s))
    if (!listed.includes(b.branch)) throw refuse(`${b.key}'s branch ${b.branch} is missing from ${origin}`, `push ${b.branch} to ${origin}, or mark ${b.key} dropped on ${s.branch}, then ${cmd.storyReopen(key)}`, "branch_missing");
  return s;
}

/**
 * B42: no story branch on the remote or here. The issue still names it: intake made the branch from
 * the issue title (`storyBranch(key, slugify(title))`), so the refusal says which branch is gone.
 * Without a remote or an issue there is nothing to name; then the key itself is the likely mistake.
 */
async function noStoryBranch(ctx: Context, key: string): Promise<CliFailure> {
  const unknown = refuse(`no story branch for ${key}`, "check the story key", "unknown_story");
  const n = parseStoryKey(key)?.number;
  const remote = (await ctx.ports()).remote;
  const origin = await gitRemote(ctx.git, ctx.root, ctx.config.git_remote);
  if (n == null || !remote || !origin) return unknown;
  const issue = await remote.getIssue(n).catch(() => null);
  if (!issue) return unknown;
  const branch = storyBranch(key, slugify(issue.title));
  return refuse(`${key}'s story branch ${branch} is missing from ${origin}`, `push ${branch} to ${origin}, then ${cmd.storyReopen(key)}`, "branch_missing");
}

/**
 * gh-195 B32 (D6, D15): on a clone whose machine dir holds no run state of the story, its record is
 * fetched from the archive ref `refs/norn/runs/<story>` alone and unpacked into the machine dir
 * (hostile entries refused, every file validated, then renamed into place: S1, S2), so each unit is
 * back where the close left it. A clone that holds the run state keeps its own; a record that does not
 * unpack is refused with nothing changed.
 */
async function restoreRecord(ctx: Context, key: string, spec_dir: string): Promise<void> {
  const dir = storyRunStateDir(ctx.root, { key, spec_dir });
  if (existsSync(dir)) return;
  const origin = await gitRemote(ctx.git, ctx.root, ctx.config.git_remote);
  if (origin)
    await fetchRecords(ctx.root, origin, [key]).catch((e: unknown) => {
      throw failure(`cannot fetch ${recordRef(key)}: ${(e as Error).message}`, `retry: ${cmd.storyReopen(key)}`, "network");
    });
  const ref = await readRecordRef(ctx.root, key);
  if (!ref) return;
  const r = unpackRecord(ctx.root, ref.sha, dir);
  if (!r.ok)
    throw failure(
      `${recordRef(key)} at ${ref.sha} does not unpack: ${r.errors.map((e) => `${e.file}: ${e.errors.map((x) => x.message).join(", ")}`).join("; ")}`,
      `fix or delete ${recordRef(key)} on ${origin ?? "this checkout"}, then ${cmd.storyReopen(key)}`,
      "record_corrupt",
    );
}

export const storyReopenCommand = defineCommand({
  name: "story reopen",
  version: "acts",
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
    const lock = await waitForTickLock(ctx, "norn story reopen", `retry: ${cmd.storyReopen(key)}`);
    try {
      await restoreRecord(ctx, key, record.spec_dir);
      return await checkoutStory(ctx, key, false, ({ storyWt, spec_dir, worktrees }) => {
        const file = storyFile(join(storyWt, spec_dir));
        const p = patchStoryFile(file, { status: "active" }, storyWt);
        if (!p.ok) throw failure(`cannot mark ${relative(storyWt, file)} active: ${p.reason}`, `fix ${relative(storyWt, file)} on ${record.branch}, then ${cmd.storyReopen(key)} again`, "story_corrupt");
        const paths = [relative(storyWt, file)];
        // B41, D4: a unit that was running comes back stuck; the next tick parks it, never starts it
        const stuck: string[] = [];
        for (const w of worktrees) {
          const slice = w.unit === key ? null : w.unit;
          const runsDir = runStateDir(w.path, { key, spec_dir }, slice ? w.branch.slice(key.length + 1) : STORY_UNIT_DIR);
          const st = readState(runsDir);
          if (!st.ok || st.value.status !== "running" || !st.value.run) continue;
          // S12 (gh-195 D8): the stuck receipt stays in the machine dir, never in the reopen commit
          appendReceipt(runsDir, humanReceipt(ctx, { slice }, st.value, "stuck", { reason: REOPEN_REASON }));
          stuck.push(w.unit);
        }
        return { paths, message: `norn: ${key} reopened`, value: { reopened: true, stuck } };
        // B32: the record was restored above (a clone holding the run state keeps its own)
      }, { record: false });
    } finally {
      lock.release();
    }
  },
});
