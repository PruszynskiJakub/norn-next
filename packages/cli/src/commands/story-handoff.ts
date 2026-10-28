/**
 * `norn story handoff [<story>]` (B34, T6): hand a story over. Commits edited handoff.md files, pushes
 * the story and slice branches, then deletes the claim ref by CAS — in that order, so whoever checks
 * it out next (T5) finds everything in git. Refused when this heartbeat does not hold the claim.
 */
import { cmd } from "@norn/core";
import { defineCommand } from "../command.ts";
import { claimHeld, failure, refuse } from "../output.ts";
import { heldHere, releaseStory, withStory } from "../runtime/release.ts";
import { aStory, resolveStory } from "../runtime/target.ts";

export const storyHandoffCommand = defineCommand({
  name: "story handoff",
  summary: "Hand a story over: push branches and handoff, then delete the claim (B34, T6)",
  usage: "norn story handoff [<story>]",
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
      if (!r.ok) throw failure(`handoff failed: ${r.error}`, `fix the push problem, then ${cmd.storyHandoff(key)} (the claim is kept until the branches are pushed)`, "release_failed", { pushed: r.pushed });
      return { story: key, released: true, pushed: r.pushed, remote: obs.remote, next: `${cmd.storyCheckout(key)} (on the other machine)` };
    });
  },
});
