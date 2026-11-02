/** `norn tick` (H1): one idempotent pass — lock → observe → decide → act → log. */
import { parseDuration } from "@norn/schema";
import { recordInterval } from "@norn/store";
import { defineCommand, opt } from "../command.ts";
import { usageError } from "../output.ts";
import { runTick } from "../runtime/tick.ts";
import { cmd } from "@norn/core";

export const tickCommand = defineCommand({
  name: "tick",
  summary: "One heartbeat pass: observe, decide, act, log (H1)",
  usage: "norn tick [--sync | --offline] [--interval 30s]",
  options: { sync: { type: "boolean" }, offline: { type: "boolean" }, interval: { type: "string" } },
  optionHelp: { "--interval": "how often this tick runs (cron): recorded for liveness and claim timing" }, // B34
  async run(ctx, args) {
    if (opt.bool(args, "sync") && opt.bool(args, "offline")) throw usageError("--sync and --offline exclude each other", cmd.tick());
    // B34 (D5): only an explicit --interval is recorded, so a tick run by hand keeps the interval cron recorded
    const interval = opt.str(args, "interval");
    if (interval !== undefined) {
      try {
        parseDuration(interval);
      } catch {
        throw usageError(`bad --interval '${interval}' (use e.g. 30s, 2m)`, cmd.tick());
      }
      recordInterval(ctx.root, interval);
      ctx.reload();
    }
    return runTick(ctx, { sync: opt.bool(args, "sync") ? "force" : opt.bool(args, "offline") ? "never" : "auto" });
  },
});
