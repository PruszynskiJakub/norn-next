/** `norn story checkout [<story>] [--force]` (B33, T5, M3): continue a story on this machine from git alone (`runtime/checkout.ts`). */
import { cmd } from "@norn/core";
import { acquireTickLock } from "@norn/store";
import { defineCommand, opt } from "../command.ts";
import { busyError } from "../output.ts";
import { checkoutStory } from "../runtime/checkout.ts";
import { aStory, resolveStory } from "../runtime/target.ts";

export const storyCheckoutCommand = defineCommand({
  name: "story checkout",
  summary: "Take a story over on this machine: claim it, check out its branches, print the handoff (B33, T5)",
  usage: "norn story checkout [<story>] [--force]",
  options: { force: { type: "boolean" } },
  optionHelp: { "--force": "take over a claim another machine still holds (journaled in the claim and the handoff)" },
  positionals: { max: 1 },
  async run(ctx, args) {
    const key = await resolveStory(ctx, args.positionals[0], args.json === true, aStory("story checkout", cmd.storyCheckout));
    const force = opt.bool(args, "force");
    const lock = await acquireTickLock(ctx.root, { note: "norn story checkout", now: () => ctx.clock.iso() });
    if (!lock.ok) throw busyError(`a tick is running (pid ${lock.holder.holder.pid})`, `retry: ${cmd.storyCheckout(key)}`, "tick_locked");
    try {
      return await checkoutStory(ctx, key, force);
    } finally {
      lock.release();
    }
  },
});
