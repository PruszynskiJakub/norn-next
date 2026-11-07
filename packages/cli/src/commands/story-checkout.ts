/** `norn story checkout [<story>] [--force]`: continue a story on this machine from git alone (`runtime/checkout.ts`). */
import { cmd } from "@norn/core";
import { defineCommand, opt } from "../command.ts";
import { waitForTickLock } from "../runtime/tick-lock.ts";
import { checkoutStory } from "../runtime/checkout.ts";
import { aStory, resolveStory } from "../runtime/target.ts";

export const storyCheckoutCommand = defineCommand({
  name: "story checkout",
  version: "acts",
  summary: "Take a story over on this machine: claim it, check out its branches, print the handoff",
  usage: "norn story checkout [<story>] [--force]",
  options: { force: { type: "boolean" } },
  optionHelp: { "--force": "take over a claim another machine still holds (journaled in the claim and the handoff)" },
  positionals: { max: 1 },
  async run(ctx, args) {
    const key = await resolveStory(ctx, args.positionals[0], args.json === true, aStory("story checkout", cmd.storyCheckout));
    const force = opt.bool(args, "force");
    const lock = await waitForTickLock(ctx, "norn story checkout", `retry: ${cmd.storyCheckout(key)}`);
    try {
      return await checkoutStory(ctx, key, force);
    } finally {
      lock.release();
    }
  },
});
