/**
 * `norn story handoff [<story>]`: hand a story over. Commits edited handoff.md files, pushes
 * the story and slice branches, then the story's record to its ref, then deletes the claim
 * ref by CAS — in that order, so whoever checks it out next finds everything on the remote. A
 * rejected record push releases nothing and is refused. Refused when this heartbeat does not
 * hold the claim.
 */
import { cmd } from "@norn/core";
import { defineCommand } from "../command.ts";
import { claimHeld, failure, refuse, rendered } from "../output.ts";
import { recordPushRefused } from "../runtime/close.ts";
import { heldHere, releaseStory, withStory } from "../runtime/release.ts";
import { aStory, resolveStory } from "../runtime/target.ts";

export const storyHandoffCommand = defineCommand({
  name: "story handoff",
  version: "acts",
  summary: "Hand a story over: push branches, handoff and the record, then delete the claim",
  usage: "norn story handoff [<story>]",
  markdown: true,
  positionals: { max: 1 },
  async run(ctx, args) {
    const key = await resolveStory(ctx, args.positionals[0], args.json === true, aStory("story handoff", cmd.storyHandoff));
    return withStory(ctx, key, cmd.storyHandoff(key), async (obs, story) => {
      const c = story.claim;
      if (!heldHere(obs, story)) {
        if (c.state === "other") throw claimHeld(c.blob, `only the holder hands it over; or ${cmd.storyCheckout(key, { force: true })}`);
        throw refuse(`${key} is not claimed by this machine (claim: ${c.state})`, null, "not_held");
      }
      const r = await releaseStory(obs, story);
      // The remote refused the record, so the claim is kept and nothing deleted
      if (!r.ok && r.failed === "record") throw recordPushRefused(r.error ?? "record push failed", cmd.storyHandoff(key), r.pushed);
      if (!r.ok) throw failure(`handoff failed: ${r.error}`, `fix the push problem, then ${cmd.storyHandoff(key)} (the claim is kept until the branches are pushed)`, "release_failed", { pushed: r.pushed });
      const record = r.record ?? null;
      const value = { story: key, released: true, pushed: r.pushed, record, remote: obs.remote, next: `${cmd.storyCheckout(key)} (on the other machine)` };
      const at = !record ? "no run state to record" : `record at ${record.sha}, ${record.branch_commit ? `matches story branch ${record.branch_commit}` : "with no story branch"}`;
      return rendered(value, `handed over ${key}: ${at}\n\nNext: \`${cmd.storyCheckout(key)}\` on the other machine.\n`);
    });
  },
});
