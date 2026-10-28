/** `norn take <story> [--force]` (T5, M3): continue a story on this machine from git alone (`runtime/checkout.ts`). */
import { cmd } from "@norn/core";
import { acquireTickLock } from "@norn/store";
import { defineCommand, opt } from "../command.ts";
import { busyError } from "../output.ts";
import { storyArg } from "../runtime/args.ts";
import { checkoutStory } from "../runtime/checkout.ts";

export const takeCommand = defineCommand({
  name: "take",
  summary: "Take over a story on this machine: claim it, check out its branches, print the handoff (T5)",
  usage: "norn take <story> [--force]",
  options: { force: { type: "boolean" } },
  positionals: { min: 1, max: 1 },
  async run(ctx, args) {
    const key = storyArg(args.positionals[0] as string, "take");
    const force = opt.bool(args, "force");
    const lock = await acquireTickLock(ctx.root, { note: "norn take", now: () => ctx.clock.iso() });
    if (!lock.ok) throw busyError(`a tick is running (pid ${lock.holder.holder.pid})`, `retry: ${cmd.take(key)}`, "tick_locked");
    try {
      return await checkoutStory(ctx, key, force);
    } finally {
      lock.release();
    }
  },
});

