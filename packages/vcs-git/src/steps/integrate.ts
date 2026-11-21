/**
 * `integrate`: merge a finished slice's branch into its story branch, in the story's worktree, never
 * rebasing the slice: a rebase would linearise a resolution the slice already made and bring its
 * conflict back. `conflict` aborts the merge and names the story branch's commit it could not take
 * and the paths, as a base update names its base, so the slice's resolver merges that commit into
 * the slice and the next integrate merges cleanly. A slice whose commits left a
 * conflict unresolved is refused before anything merges.
 */
import { fail, type HostContext, ok, type PluginResult, type StepKindDefinition, type StepKindInput, type StepKindOutcome } from "@norn/plugin-api";
import { mergeInto } from "../merge.ts";
import { currentBranch, isAncestor, revParse } from "../refs.ts";
import { worktreePath } from "../worktree.ts";
import { Type } from "@sinclair/typebox";
import { stepPlace, unresolvedConflicts } from "./common.ts";

/** Nothing to set: the slice and the story are the unit's, and nothing reaches the remote. */
export const IntegrateConfig = Type.Object({}, { additionalProperties: false });

async function run(input: StepKindInput<Record<string, never>>, ctx: HostContext): Promise<PluginResult<StepKindOutcome>> {
  if (input.unit === input.story) return fail("invalid", `integrate: ${input.unit} is a story; only a slice integrates into its story`, false);
  const place = await stepPlace(ctx, input);
  if (!place.ok) return place;
  const slice = place.value;
  const storyCwd = input.slots?.vcs?.worktree.path(input.story) ?? worktreePath(ctx, input.story);
  const storyBranch = await currentBranch(ctx, storyCwd);
  if (!storyBranch.ok) return storyBranch;
  if (storyBranch.value === null) return fail("invalid", `integrate: the worktree of ${input.story} at ${storyCwd} has no branch checked out`, false);
  const sliceHead = await revParse(ctx, slice.cwd, "HEAD");
  if (!sliceHead.ok) return sliceHead;
  if (sliceHead.value === null) return fail("invalid", `integrate: ${slice.branch} has no commit`, false);

  // a slice integrated before a crash cut its receipt short is integrated: run again, it changes nothing
  const already = await isAncestor(ctx, storyCwd, sliceHead.value, "HEAD");
  if (!already.ok) return already;
  if (already.value) {
    const head = await revParse(ctx, storyCwd, "HEAD");
    if (!head.ok) return head;
    return ok({ outcome: "done", detail: { story_branch: storyBranch.value, head: head.value, merged: false } });
  }
  const storyHead = await revParse(ctx, storyCwd, "HEAD");
  if (!storyHead.ok) return storyHead;
  if (storyHead.value === null) return fail("invalid", `integrate: ${storyBranch.value} has no commit`, false);
  const clean = await unresolvedConflicts(ctx, slice.cwd, "integrate", storyBranch.value, sliceHead.value, "Nothing was merged");
  if (!clean.ok) return clean;
  const m = await mergeInto(ctx, storyCwd, sliceHead.value, { message: `Integrate ${input.unit} (${slice.branch}) into ${storyBranch.value}` });
  if (!m.ok) return m;
  if ("conflict" in m.value) return ok({ outcome: "conflict", detail: { story_branch: storyBranch.value, slice_head: sliceHead.value, base: { ref: storyBranch.value, sha: storyHead.value }, conflicts: m.value.conflict.files } });
  return ok({ outcome: "done", detail: { story_branch: storyBranch.value, head: m.value.head, merged: m.value.merged } });
}

export const integrate: StepKindDefinition<typeof IntegrateConfig> = {
  name: "integrate",
  configSchema: IntegrateConfig,
  outcomes: ["done", "conflict"],
  mode: "effect",
  slot: "vcs",
  run,
};
