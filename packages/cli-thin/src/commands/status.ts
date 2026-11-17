/**
 * `norn status`: show every story and unit, read-only. Units waiting for a person come first, as the
 * list of what needs doing; then the rest of the stories, and the intake a tick has not taken yet.
 */
import { defineCommand } from "../command.ts";
import { rendered } from "../output.ts";
import { loadProjectView, type ProjectView, storyHead, unitLine } from "../views.ts";

function markdown(v: ProjectView): string {
  const out = ["# norn status", ""];
  const waiting = v.stories.flatMap((s) => s.units.filter((u) => u.waiting).map((u) => ({ s, u })));
  if (waiting.length) out.push("## Needs you", "", ...waiting.map(({ u }) => `- ${unitLine(u)}`), "");
  out.push("## Stories", "");
  if (v.stories.length === 0) out.push("No stories yet.");
  for (const s of v.stories) out.push(`- ${storyHead(s)}`, ...s.units.map((u) => `  - ${unitLine(u)}`));
  if (v.intake.length) out.push("", "## Intake", "", ...v.intake.map((i) => `- ${i.key} ${i.title}`));
  if (v.problems.length) out.push("", "## Problems", "", ...v.problems.map((p) => `- ${p}`));
  return out.join("\n");
}

export const statusCommand = defineCommand({
  name: "status",
  summary: "Show every story and unit, read-only",
  usage: "norn status",
  async run(ctx) {
    const view = await loadProjectView(await ctx.runtimeEnv());
    return rendered(view, markdown(view));
  },
});
