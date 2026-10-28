/**
 * `norn run list <unit> [--json] [--full] [--events] [--all] [--story-only] [--limit N]` (O4): the
 * unit's step timeline from @norn/view (X1) — one row per (step, attempt) with entry, exit,
 * duration, outcome, who and the reason; a story shows its slices interleaved plus totals
 * (wall-clock intake → $done → merge, time per step type, human wait). No-op ticks are hidden
 * unless `--all`; `--events` attaches the remaining events to each row. Text for a person, `--json` for data;
 * `--full` keeps reasons whole in text (JSON is never cut). Paths are absolute.
 */
import { formatStepTimeline, loadTraceView } from "@norn/view";
import { defineCommand, opt } from "../command.ts";
import { refuse, rendered, usageError } from "../output.ts";
import { parseUnitKey } from "../runtime/args.ts";
import { hasRun, resolveTarget } from "../runtime/target.ts";
import { cmd } from "@norn/core";

export const runListCommand = defineCommand({
  name: "run list",
  summary: "Step timeline of a unit: durations, outcomes, who, reasons; a story with its slices (O4)",
  usage: "norn run list [<unit>] [--json] [--full] [--events] [--all] [--story-only] [--limit N]",
  markdown: true,
  optionHelp: {
    "--full": "keep reasons whole and list briefings and receipts",
    "--events": "attach the unit's events to each step",
    "--all": "with --events, no-op ticks too",
    "--story-only": "a story without its slices",
    "--limit N": "only the last N steps",
  },
  options: {
    full: { type: "boolean" },
    events: { type: "boolean" },
    all: { type: "boolean" },
    "story-only": { type: "boolean" },
    limit: { type: "string" },
  },
  positionals: { max: 1 },
  async run(ctx, args) {
    const { key } = parseUnitKey(await resolveTarget(ctx, args.positionals[0], args.json === true, hasRun(ctx, "run list", cmd.runList)));
    const rawLimit = opt.str(args, "limit");
    const limit = rawLimit === undefined ? null : Number(rawLimit);
    if (limit !== null && !(Number.isInteger(limit) && limit > 0)) throw usageError(`bad --limit '${rawLimit}'`, cmd.runList(key, { limit: 20 }));
    const view = loadTraceView({
      repoRoot: ctx.root,
      home: ctx.home,
      env: ctx.env,
      now: ctx.clock.now(),
      key,
      events: opt.bool(args, "events"),
      all: opt.bool(args, "all"),
      storyOnly: opt.bool(args, "story-only"),
    });
    if (!view) throw refuse(`unknown unit ${key}`, cmd.status(), "unknown_unit");
    const out = { ...view, total: view.steps.length, steps: limit === null ? view.steps : view.steps.slice(-limit) };
    return rendered(out, formatStepTimeline(out, { full: opt.bool(args, "full") }));
  },
});
