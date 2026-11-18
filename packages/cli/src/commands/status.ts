/**
 * `norn status`: show every story and unit, read-only. Units waiting for a person come first, as the
 * list of what needs doing; then the rest of the stories, and the intake a tick has not taken yet.
 */
import { defineCommand } from "../command.ts";
import { gateNotes, type OpenNote } from "../notes.ts";
import { rendered } from "../output.ts";
import { loadProjectView, type ProjectView, storyHead, type StoryView, unitLine, type UnitView } from "../views.ts";

/** A gate's line names the notes still open on its unit, which a person reads before approving. */
function needsLine(s: StoryView, u: UnitView, notes: readonly OpenNote[]): string {
  const n = notes.filter((x) => x.unit === u.id).length;
  return `- ${unitLine(u)}${n > 0 ? ` (${n} open note${n === 1 ? "" : "s"}: norn story view ${s.key})` : ""}`;
}

function markdown(v: ProjectView, notes: readonly OpenNote[]): string {
  const out = ["# norn status", ""];
  const waiting = v.stories.flatMap((s) => s.units.filter((u) => u.waiting).map((u) => ({ s, u })));
  if (waiting.length) out.push("## Needs you", "", ...waiting.map(({ s, u }) => needsLine(s, u, notes)), "");
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
    const env = await ctx.runtimeEnv();
    const view = await loadProjectView(env);
    const notes: OpenNote[] = [];
    for (const s of view.stories) notes.push(...(await gateNotes(env, s)));
    return rendered({ ...view, notes }, markdown(view, notes));
  },
});
