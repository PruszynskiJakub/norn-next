/**
 * `norn trace <unit> [--text] [--limit N]` (O4): the unit's receipts and trace events merged in
 * time order (newest N with --limit), from @norn/view (X1). JSON unless `--text`.
 */
import { formatTimeline } from "@norn/view";
import { defineCommand, opt } from "../command.ts";
import { refuse, textOutput, usageError } from "../output.ts";
import { parseUnitKey, projectView } from "../runtime/human.ts";

export const traceCommand = defineCommand({
  name: "trace",
  summary: "Timeline of a unit: receipts, ticks, hooks, rejections (O4)",
  usage: "norn trace <unit> [--text] [--limit N]",
  options: { text: { type: "boolean" }, limit: { type: "string" } },
  positionals: { min: 1, max: 1 },
  async run(ctx, args) {
    const { key } = parseUnitKey(args.positionals[0] as string);
    const rawLimit = opt.str(args, "limit");
    const limit = rawLimit === undefined ? null : Number(rawLimit);
    if (limit !== null && !(Number.isInteger(limit) && limit > 0)) throw usageError(`bad --limit '${rawLimit}'`, `norn trace ${key} --limit 20`);
    const view = await projectView(ctx);
    const all = view.timeline[key];
    if (!all) throw refuse(`unknown unit ${key}`, "norn status", "unknown_unit");
    const entries = limit === null ? all : all.slice(-limit);
    if (opt.bool(args, "text")) return textOutput(formatTimeline(entries));
    return { unit: key, total: all.length, entries };
  },
});
