/**
 * `norn update <story>` (BS9): send a waiting story back through its base update — re-enter the
 * step named by the workflow's `base.step` (default: the first `git: update` step). Allowed when the
 * story unit is done with its PR unmerged, parked at a gate, or stuck, and only for the heartbeat
 * that holds the claim (T7); never through the mailbox. Writes an `update` receipt (P6); the tick
 * applies it (S5). The tick never moves a done unit by itself — only a person does, with this verb.
 */
import { baseUpdateStep, storyUnit } from "@norn/core";
import type { UnitState } from "@norn/schema";
import { readClaim, heartbeatId } from "@norn/store";
import { defineCommand } from "../command.ts";
import { failure, refuse } from "../output.ts";
import { at, deliver, gitRemote, humanReceipt, resolveTarget, started } from "../runtime/human.ts";
import { storyArg } from "./take.ts";

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
    if (t.slice !== null) throw refuse(`${t.key} is a slice; norn update re-enters the story unit`, `norn update ${t.story}`, "not_a_story");
    const st = started(t);
    const sf = t.story_facts;
    // not in this checkout (another checkout holds it): only the holder updates a story (T7)
    if (t.source === "remote") throw refuse(`${t.story} is not in this checkout; only the claim holder updates a story (T7)`, `norn take ${t.story}`, "story_not_local");
    // BS9: a merged story is finished (GR6) — nothing to update
    const fm = sf?.frontmatter;
    if (fm?.status === "done" || sf?.pr?.state === "merged" || sf?.merged_by_ancestry)
      throw refuse(`${t.story} is merged; nothing to update`, `norn status ${t.story}`, "story_merged");
    if (fm?.status === "dropped") throw refuse(`${t.story} is dropped`, `norn status ${t.story}`, "story_dropped");
    if (!waiting(st))
      throw refuse(`${t.story} is not waiting: it is at ${at(st)}; update re-enters a story that is done, at a gate or stuck`, `norn status ${t.story}`, "not_waiting");
    const wf = t.workflow;
    if (!wf) throw refuse(`${t.story} has no readable pinned workflow`, `norn why ${t.story}`, "workflow_missing");
    const to = baseUpdateStep(wf);
    if (!to) throw refuse(`workflow ${wf.name} of ${t.story} has no base update step (no \`git: update\` step, no base.step)`, `norn workflow ${t.story} <name> --to <step>`, "no_update_step");

    // T7: only the claim holder writes receipts for the story; never through the mailbox
    let claim;
    try {
      claim = await readClaim(ctx.root, await gitRemote(ctx), t.story);
    } catch (e) {
      throw failure(`cannot read the claim of ${t.story}: ${(e as Error).message}`, "check the network and retry", "claim_unreadable");
    }
    const now = ctx.clock.now();
    const mine = claim.state === "present" && Date.parse(claim.blob.expires_at) > now && claim.blob.heartbeat_id === heartbeatId(ctx.root, now);
    if (!mine || !t.runsDir) {
      const who = claim.state === "present" && Date.parse(claim.blob.expires_at) > now ? `held by ${claim.blob.holder}` : "not held by this checkout";
      throw refuse(`${t.story}'s claim is ${who}; only the holder updates a story (T7)`, claim.state === "present" && Date.parse(claim.blob.expires_at) > now ? `ask ${claim.blob.holder} to run norn update ${t.story}, or norn take ${t.story} --force` : `norn take ${t.story}`, "not_holder");
    }
    const pending = (sf ? storyUnit(sf) : null)?.unapplied.find((r) => r.receipt.kind === "update");
    if (pending) throw refuse(`an update of ${t.story} is already recorded (${pending.file}) and not applied yet`, "norn tick", "already_recorded");

    // P6: the receipt first; the tick applies it and writes state.json last (S5)
    const receipt = humanReceipt(ctx, t, st, "update", { from: st.step, to, reason: "person" });
    const delivered = await deliver(ctx, t, { via: "local", claim: "mine" }, receipt);
    return { unit: t.story, receipt, delivered, next: "norn tick" };
  },
});
