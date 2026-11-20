/**
 * `await-merge`: wait for the story's change to merge. Answers `unpushed` when the branch holds
 * commits the change lacks beyond the story's spec folder, so the workflow can route it back; otherwise `waiting`, polled every tick.
 * `stale` is never answered here: whether a base move is stale depends on the workflow's `base.stale`
 * and `base.verify`, which the host reads as the `stale` signal and decide routes between polls under
 * the step's `on:`. Merged is asked first, so a change that merged ends the story whatever else moved.
 */
import { type ChangeRequest, fail, type HostContext, ok, type PluginResult, type StepKindDefinition, type StepKindInput, type StepKindOutcome } from "@norn/plugin-api";
import { Type } from "@sinclair/typebox";
import { specOnly } from "../spec-only.ts";
import { effectKey } from "./open-pr.ts";

export const AwaitMergeConfig = Type.Object({}, { additionalProperties: false });

type Answer = PluginResult<StepKindOutcome>;

async function run(input: StepKindInput<Record<string, never>>, _ctx: HostContext): Promise<Answer> {
  const forge = input.slots?.forge;
  if (!forge) return fail("invalid", "await-merge: the repo has no forge configured", false);
  const branch = input.branch;
  if (branch === undefined) return fail("invalid", "await-merge: the host passed no branch for the unit", false);
  const found = await forge.findChanges([branch]);
  if (!found.ok) return found;
  const change = found.value[branch] ?? null;
  const base = input.base?.branch;
  // a merge into another branch landed nothing on the story's base: the kernel parks the story for a person, and the step must not end it done
  if (change?.state === "merged" && base !== undefined && change.base_branch !== base)
    return ok({ outcome: "waiting", detail: { change, reason: `the change merged into ${change.base_branch}, not the story's base ${base}` } });
  if (change?.state === "merged") return ok({ outcome: "merged", detail: { change } });

  // a person closed the change: the kernel parks the story for them, and nothing here may send it on to open a new one
  if (change?.state === "closed") return ok({ outcome: "waiting", detail: { change, reason: "the change is closed" } });
  const vcs = input.slots?.vcs;
  if (!vcs) return ok({ outcome: "waiting", detail: { change } });
  const head = await vcs.head(branch);
  if (!head.ok) return head;
  if (head.value === null) return fail("not_found", `await-merge: no branch ${branch}`, false);

  if (change === null) return ok({ outcome: "unpushed", detail: { head: head.value, reason: "no change holds the branch" } });
  const holds = change.head_sha === head.value ? ok(true) : await vcs.isAncestor(head.value, change.head_sha);
  if (!holds.ok) return holds;
  if (holds.value) return waitReady(input, change, head.value);
  // commits past the change that touch only the story's spec folder go with its next code push
  const ahead = await vcs.isAncestor(change.head_sha, head.value);
  if (!ahead.ok) return ahead;
  if (ahead.value) {
    const notes = await specOnly(vcs, input.story, change.head_sha, head.value);
    if (!notes.ok) return notes;
    if (notes.value) return waitReady(input, change, head.value);
  }
  return ok({ outcome: "unpushed", detail: { head: head.value, change } });
}

/**
 * Wait on a change that holds the branch, marking a draft ready first: a story reaches this step only
 * past its ready gate, and a forge refuses to merge a draft, so leaving it would wait on a person's
 * click nobody asked for.
 */
async function waitReady(input: StepKindInput<Record<string, never>>, change: ChangeRequest, head: string): Promise<Answer> {
  const forge = input.slots?.forge;
  if (!change.draft || !forge?.capabilities.draft) return ok({ outcome: "waiting", detail: { change } });
  const readied = await forge.perform({ kind: "ready", id: change.id }, { receipt_id: effectKey(input, head) });
  if (!readied.ok) return readied;
  return ok({ outcome: "waiting", detail: { change: readied.value.change, effect: "ready" } });
}

export const awaitMerge: StepKindDefinition<typeof AwaitMergeConfig> = {
  name: "await-merge",
  configSchema: AwaitMergeConfig,
  outcomes: ["merged", "unpushed"],
  mode: "wait",
  run,
};
