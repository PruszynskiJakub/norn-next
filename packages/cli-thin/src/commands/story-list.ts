/**
 * `norn story list`: list the stories norn tracks, one line each, read-only.
 */
import { defineCommand } from "../command.ts";
import { rendered, tableCell } from "../output.ts";
import { loadProjectView, type StoryView } from "../views.ts";

const where = (s: StoryView): string => {
  const own = s.units.find((u) => u.id === s.key) ?? s.units[0];
  if (!own?.step) return "not started";
  return own.ended ? `ended ${own.ended}` : own.step;
};

export const storyListCommand = defineCommand({
  name: "story list",
  summary: "List the stories norn tracks",
  usage: "norn story list",
  async run(ctx) {
    const { stories, problems } = await loadProjectView(await ctx.runtimeEnv());
    const list = stories.map((s) => ({
      key: s.key,
      title: s.title,
      step: where(s),
      units: s.units.length,
      waiting: s.units.filter((u) => u.waiting).length,
      claim: s.claim?.holder ?? null,
      change: s.change,
    }));
    const md =
      list.length === 0
        ? "No stories yet."
        : ["| story | title | step | waiting | claim |", "| --- | --- | --- | --- | --- |", ...list.map((s) => `| ${s.key} | ${tableCell(s.title ?? "")} | ${s.step} | ${s.waiting} | ${s.claim ?? ""} |`)].join("\n");
    return rendered({ stories: list, problems }, md);
  },
});
