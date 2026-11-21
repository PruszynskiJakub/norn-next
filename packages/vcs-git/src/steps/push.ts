/**
 * `push`: push the unit's branch to the remote fast-forward only, so a push never overwrites what a
 * person pushed since. Commits a person pushed to the branch are taken in first (a merge commit when
 * the two diverged, never a rebase), so the push that follows is a fast-forward; a merge of the two
 * that conflicts is refused for a person rather than losing either side. No lease: the tick fetches
 * before every step, so the remote-tracking ref already holds a person's commits and a lease on it
 * would force over them. A repo without the remote has nothing to push to, and the step is done. A
 * branch whose commits since its base left a conflict unresolved is never pushed.
 */
import { type HostContext, ok, type PluginResult, type StepKindDefinition, type StepKindInput, type StepKindOutcome } from "@norn/plugin-api";
import { pushBranch } from "../push.ts";
import { revParse } from "../refs.ts";
import { GitStepKeys, resolveBase, stepPlace, syncRemote, unresolvedConflicts } from "./common.ts";
import { Type } from "@sinclair/typebox";

export const PushConfig = Type.Object({ remote: GitStepKeys.remote }, { additionalProperties: false });

async function run(input: StepKindInput<{ remote?: string }>, ctx: HostContext): Promise<PluginResult<StepKindOutcome>> {
  const place = await stepPlace(ctx, input);
  if (!place.ok) return place;
  const p = place.value;
  const sync = await syncRemote(ctx, p);
  if (!sync.ok) return sync;
  const base = await resolveBase(ctx, p.cwd, { ...input, config: {} }, p.remote);
  // with no base to measure from there are no commits of the branch's own to read, and the push goes ahead as it always did
  if (!base.ok && base.failure.code !== "not_found") return base;
  if (base.ok) {
    const clean = await unresolvedConflicts(ctx, p.cwd, input.step, base.value.ref, "HEAD", "Nothing was pushed");
    if (!clean.ok) return clean;
  }
  const pushed = await pushBranch(ctx, p.cwd, p.remote, p.branch);
  if (!pushed.ok) return pushed;
  const head = await revParse(ctx, p.cwd, "HEAD");
  if (!head.ok) return head;
  const took = sync.value.took ? { took_remote: sync.value.tracking } : {};
  return ok({ outcome: "done", detail: { branch: p.branch, head: head.value, ...took, ...(pushed.value.pushed ? { remote: p.remote } : { skipped: `no remote ${p.remote}` }) } });
}

export const push: StepKindDefinition<typeof PushConfig> = {
  name: "push",
  configSchema: PushConfig,
  outcomes: ["done"],
  mode: "effect",
  slot: "vcs",
  run,
};
