/**
 * `norn story update-branch [<story>]`: send a waiting story back through its base update — re-enter the
 * step named by the workflow's `base.step` (default: the first `git: update` step). Allowed when the
 * story unit is done with its PR unmerged, parked at a gate, or stuck, and only for the heartbeat
 * that holds the claim; never through the mailbox. Writes an `update` receipt; the tick
 * applies it. The tick never moves a done unit by itself — only a person does, with this verb.
 * Without a story: the worktree's story, a slice worktree's too, else a pick of the waiting stories.
 */
import { cmd, baseUpdateStep, waitsForBaseUpdate } from "@norn/core";
import { isClosedStatus } from "@norn/schema";
import { defineCommand } from "../command.ts";
import { refuse } from "../output.ts";
import { at, humanReceipt, resolveTarget, runHumanVerb } from "../runtime/human.ts";
import { storyArg } from "../runtime/args.ts";
import { targetKey, type TargetRule } from "../runtime/target.ts";

/** The stories the pick offers — waiting and not finished. */
const updatable: TargetRule = {
  verb: "story update-branch",
  story: true,
  none: "No story waits for a base update (done with an unmerged PR, at a gate, or stuck)",
  command: (k) => cmd.storyUpdateBranch(k),
  applies: (_key, u) =>
    // the view carries no skills drift: a unit held by it is not offered
    u?.slice === null && !isClosedStatus(u.story_status) && u.pr?.state !== "merged" && waitsForBaseUpdate(u, false),
};

export const storyUpdateBranchCommand = defineCommand({
  name: "story update-branch",
  version: "acts",
  summary: "Send a waiting story back through its base update: done with an unmerged PR, at a gate, or stuck",
  usage: "norn story update-branch [<story>]",
  positionals: { max: 1 },
  async run(ctx, args) {
    const key = storyArg(await targetKey(ctx, args.positionals[0], args.json === true, updatable), "story update-branch");
    const t = await resolveTarget(ctx, key);
    if (t.slice !== null) throw refuse(`${t.key} is a slice; ${cmd.storyUpdateBranch()} re-enters the story unit`, cmd.storyUpdateBranch(t.story), "not_a_story");
    let to = "";
    const out = await runHumanVerb(ctx, t, {
      verb: "story update-branch",
      // Only the claim holder writes receipts for the story; never through the mailbox
      mailbox: false,
      requireHolder: "only the holder updates a story",
      check(t, st) {
        const sf = t.story_facts;
        // not in this checkout (another checkout holds it): only the holder updates a story
        if (t.source === "remote") throw refuse(`${t.story} is not in this checkout; only the claim holder updates a story`, cmd.storyCheckout(t.story), "story_not_local");
        // A merged story is finished — nothing to update
        const fm = sf?.frontmatter;
        if (fm?.status === "done" || sf?.pr?.state === "merged" || sf?.merged_by_ancestry)
          throw refuse(`${t.story} is merged; nothing to update`, cmd.storyView(t.story), "story_merged");
        if (fm?.status === "dropped") throw refuse(`${t.story} is dropped`, cmd.storyView(t.story), "story_dropped");
        // Skills drift (`false`) holds no unit, so only done, a gate or stuck waits
        if (!waitsForBaseUpdate(st, false))
          throw refuse(`${t.story} is not waiting: it is at ${at(st)}; update re-enters a story that is done, at a gate or stuck`, cmd.storyView(t.story), "not_waiting");
        const wf = t.workflow;
        if (!wf) throw refuse(`${t.story} has no readable pinned workflow`, cmd.runView(t.story, { why: true }), "workflow_missing");
        const step = baseUpdateStep(wf);
        if (!step) throw refuse(`workflow ${wf.name} of ${t.story} has no base update step (no \`git: update\` step, no base.step)`, cmd.storyEdit(t.story, { workflow: "<name>", at: "<step>" }), "no_update_step");
        to = step;
      },
      // The receipt first; the tick applies it and writes state.json last
      build: (t, st) => humanReceipt(ctx, t, st, "update", { from: st.step, to, reason: "person" }),
    });
    return { unit: t.story, receipt: out.receipt, delivered: out.delivered, next: out.next };
  },
});
