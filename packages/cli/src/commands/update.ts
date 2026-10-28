/**
 * `norn update <story>` (BS9): send a waiting story back through its base update — re-enter the
 * step named by the workflow's `base.step` (default: the first `git: update` step). Allowed when the
 * story unit is done with its PR unmerged, parked at a gate, or stuck, and only for the heartbeat
 * that holds the claim (T7); never through the mailbox. Writes an `update` receipt (P6); the tick
 * applies it (S5). The tick never moves a done unit by itself — only a person does, with this verb.
 */
import { cmd, baseUpdateStep, storyUnit } from "@norn/core";
import type { UnitState } from "@norn/schema";
import { defineCommand } from "../command.ts";
import { refuse } from "../output.ts";
import { at, humanReceipt, resolveTarget, runHumanVerb } from "../runtime/human.ts";
import { storyArg } from "../runtime/args.ts";

/** BS9: done (PR unmerged), at a gate, or stuck. */
const waiting = (st: UnitState) => st.status === "done" || st.status === "stuck" || (st.status === "parked" && st.park?.kind === "gate");

export const updateCommand = defineCommand({
  name: "update",
  summary: "Send a waiting story back through its base update: done with an unmerged PR, at a gate, or stuck (BS9)",
  usage: "norn update <story>",
  positionals: { min: 1, max: 1 },
  async run(ctx, args) {
    const key = storyArg(args.positionals[0] as string, "update");
    const t = await resolveTarget(ctx, key);
    if (t.slice !== null) throw refuse(`${t.key} is a slice; ${cmd.update()} re-enters the story unit`, cmd.update(t.story), "not_a_story");
    let to = "";
    const out = await runHumanVerb(ctx, t, {
      verb: "update",
      // T7: only the claim holder writes receipts for the story; never through the mailbox
      mailbox: false,
      requireHolder: "only the holder updates a story (T7)",
      check(t, st) {
        const sf = t.story_facts;
        // not in this checkout (another checkout holds it): only the holder updates a story (T7)
        if (t.source === "remote") throw refuse(`${t.story} is not in this checkout; only the claim holder updates a story (T7)`, cmd.storyCheckout(t.story), "story_not_local");
        // BS9: a merged story is finished (GR6) — nothing to update
        const fm = sf?.frontmatter;
        if (fm?.status === "done" || sf?.pr?.state === "merged" || sf?.merged_by_ancestry)
          throw refuse(`${t.story} is merged; nothing to update`, cmd.status(t.story), "story_merged");
        if (fm?.status === "dropped") throw refuse(`${t.story} is dropped`, cmd.status(t.story), "story_dropped");
        if (!waiting(st))
          throw refuse(`${t.story} is not waiting: it is at ${at(st)}; update re-enters a story that is done, at a gate or stuck`, cmd.status(t.story), "not_waiting");
        const wf = t.workflow;
        if (!wf) throw refuse(`${t.story} has no readable pinned workflow`, cmd.why(t.story), "workflow_missing");
        const step = baseUpdateStep(wf);
        if (!step) throw refuse(`workflow ${wf.name} of ${t.story} has no base update step (no \`git: update\` step, no base.step)`, cmd.workflow(t.story, "<name>", { to: "<step>" }), "no_update_step");
        to = step;
      },
      // any unapplied update of the story, whatever step it was recorded at
      refuseDuplicate(t) {
        const pending = (t.story_facts ? storyUnit(t.story_facts) : null)?.unapplied.find((r) => r.receipt.kind === "update");
        if (pending) throw refuse(`an update of ${t.story} is already recorded (${pending.file}) and not applied yet`, cmd.tick(), "already_recorded");
      },
      // P6: the receipt first; the tick applies it and writes state.json last (S5)
      build: (t, st) => humanReceipt(ctx, t, st, "update", { from: st.step, to, reason: "person" }),
    });
    return { unit: t.story, receipt: out.receipt, delivered: out.delivered, next: out.next };
  },
});
