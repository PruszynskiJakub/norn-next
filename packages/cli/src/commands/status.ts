/**
 * `norn status [--text] [<story|unit>]` (§15, MO2): stories, slices, runs and recently done units
 * from @norn/view (X1). With a key: that story (or slice) only. JSON unless `--text`.
 */
import { formatStatus, type ProjectView } from "@norn/view";
import { defineCommand, opt } from "../command.ts";
import { refuse, textOutput } from "../output.ts";
import { parseUnitKey, projectView } from "../runtime/human.ts";

export const statusCommand = defineCommand({
  name: "status",
  summary: "Stories, slices, runs and claims at a glance",
  usage: "norn status [--text] [<story|unit>]",
  options: { text: { type: "boolean" } },
  positionals: { max: 1 },
  async run(ctx, args) {
    const view = await projectView(ctx);
    const text = opt.bool(args, "text");
    const raw = args.positionals[0];
    if (!raw) {
      if (text) return textOutput(formatStatus(view));
      const { timeline: _timeline, ...rest } = view;
      return rest;
    }
    const key = parseUnitKey(raw);
    const story = view.stories.find((s) => s.key === key.story);
    if (!story) throw refuse(`unknown story ${key.story}`, "norn status", "unknown_unit");
    const slice = key.slice ? story.slices.find((s) => s.key === key.slice) : null;
    if (key.slice && !slice) throw refuse(`no slice ${key.slice} in story ${key.story}`, `norn status ${key.story}`, "unknown_unit");
    const units = new Set([story.key, ...story.slices.map((s) => s.key)]);
    const filtered: ProjectView = {
      ...view,
      stories: [slice ? { ...story, slices: [slice] } : story],
      runs: view.runs.filter((r) => units.has(r.unit) && (!slice || r.unit === slice.key)),
      recently_done: view.recently_done.filter((d) => units.has(d.unit)),
      timeline: {},
    };
    if (text) return textOutput(formatStatus(filtered));
    return slice ?? story;
  },
});
