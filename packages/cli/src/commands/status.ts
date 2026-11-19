/**
 * `norn status`: show every story and unit, read-only. Units waiting for a person come first, as the
 * list of what needs doing, after any story whose run data here and on the remote diverged; then the rest of the stories, and the intake a tick has not taken yet.
 * A finished story (every unit ended done, nothing waiting on its record) is one line under Finished
 * while its item is open, and leaves the markdown once the item closed; `--json` lists every story.
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

function finished(s: StoryView): boolean {
  return s.units.length > 0 && s.unsynced === undefined && s.units.every((u) => u.ended === "done" && u.pending_receipts === 0);
}

function markdown(v: ProjectView, notes: readonly OpenNote[]): string {
  const out = ["# norn status", ""];
  const waiting = v.stories.flatMap((s) => s.units.filter((u) => u.waiting).map((u) => ({ s, u })));
  const unsynced = v.stories.filter((s) => s.unsynced?.waiting);
  if (waiting.length || unsynced.length)
    out.push("## Needs you", "", ...unsynced.map((s) => `- ${s.key}: run data unsynced: ${s.unsynced?.text} → ${s.unsynced?.next}`), ...waiting.map(({ s, u }) => needsLine(s, u, notes)), "");
  const done = v.stories.filter(finished);
  const going = v.stories.filter((s) => !finished(s));
  out.push("## Stories", "");
  if (going.length === 0) out.push(done.length === 0 ? "No stories yet." : "None in progress.");
  for (const s of going) out.push(`- ${storyHead(s)}`, ...s.units.map((u) => `  - ${unitLine(u)}`));
  const shown = done.filter((s) => s.open !== false);
  if (shown.length) out.push("", "## Finished", "", ...shown.map((s) => `- ${storyHead(s)}`));
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
