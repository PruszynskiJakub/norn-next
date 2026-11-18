/**
 * `norn story view <key>`: show one story: its units, runs, gates and asks, read-only. A key no store
 * holds is refused, naming where to look; a story with a corrupt unit is a corrupt error (exit 4).
 */
import { defineCommand } from "../command.ts";
import { corruptError, refuse, rendered } from "../output.ts";
import { loadProjectView, type StoryView, storyHead, unitLine } from "../views.ts";

function markdown(s: StoryView): string {
  const out = [`# ${storyHead(s)}`, ""];
  if (s.url) out.push(`Item: ${s.url}`);
  if (s.change?.url) out.push(`Change: ${s.change.url}`);
  if (s.url || s.change?.url) out.push("");
  out.push("## Units", "", ...s.units.map((u) => `- ${unitLine(u)}${u.pending_receipts ? ` (${u.pending_receipts} receipts not applied yet)` : ""}`));
  return out.join("\n");
}

export const storyViewCommand = defineCommand({
  name: "story view",
  summary: "Show one story: its units, runs, gates and asks",
  usage: "norn story view <key>",
  positionals: { min: 1, max: 1 },
  async run(ctx, args) {
    const key = args.positionals[0] as string;
    const view = await loadProjectView(await ctx.runtimeEnv());
    const story = view.stories.find((s) => s.key === key);
    if (!story) {
      const queued = view.intake.find((i) => i.key === key);
      throw queued
        ? refuse(`${key} is in the intake but no tick has taken it yet`, "norn tick", "story_not_started", { key })
        : refuse(`no story ${key}`, "norn story list", "story_not_found", { key });
    }
    const corrupt = story.units.filter((u) => u.corrupt !== undefined);
    // a record that fails validation is shown as what it is, never as a story at some step
    if (corrupt.length > 0)
      throw corruptError(
        `${key} is corrupt: ${corrupt.map((u) => `${u.id}: ${u.corrupt}`).join("; ")}`,
        "a person restores or removes the unit's run state; norn never repairs it",
        { story },
      );
    return rendered({ ...story, problems: view.problems.filter((p) => p.startsWith(`${key}:`) || p.startsWith(`${key} `)) }, markdown(story));
  },
});
