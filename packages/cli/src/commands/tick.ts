/** `norn tick` (H1): one idempotent pass — lock → observe → decide → act → log. */
import { defineCommand, opt } from "../command.ts";
import { usageError } from "../output.ts";
import { runTick } from "../runtime/tick.ts";
import { cmd } from "@norn/core";

export const tickCommand = defineCommand({
  name: "tick",
  summary: "One heartbeat pass: observe, decide, act, log (H1)",
  usage: "norn tick [--sync | --offline]",
  options: { sync: { type: "boolean" }, offline: { type: "boolean" } },
  async run(ctx, args) {
    if (opt.bool(args, "sync") && opt.bool(args, "offline")) throw usageError("--sync and --offline exclude each other", cmd.tick());
    return runTick(ctx, { sync: opt.bool(args, "sync") ? "force" : opt.bool(args, "offline") ? "never" : "auto" });
  },
});
