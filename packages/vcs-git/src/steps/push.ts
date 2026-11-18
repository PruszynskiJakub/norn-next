/**
 * `push`: push the unit's branch to the remote fast-forward only, so a push never overwrites what a
 * person pushed since; that refusal fails the step rather than losing work. No lease: the tick fetches
 * before every step, so the remote-tracking ref already holds a person's commits and a lease on it
 * would force over them. The story branch only ever takes merges, never a rebase, so its own pushes
 * are always fast-forwards. A repo without the remote has nothing to push to, and the step is done.
 */
import { type HostContext, ok, type PluginResult, type StepKindDefinition, type StepKindInput, type StepKindOutcome } from "@norn/plugin-api";
import { pushBranch } from "../push.ts";
import { revParse } from "../refs.ts";
import { GitStepKeys, stepPlace } from "./common.ts";
import { Type } from "@sinclair/typebox";

export const PushConfig = Type.Object({ remote: GitStepKeys.remote }, { additionalProperties: false });

async function run(input: StepKindInput<{ remote?: string }>, ctx: HostContext): Promise<PluginResult<StepKindOutcome>> {
  const place = await stepPlace(ctx, input);
  if (!place.ok) return place;
  const p = place.value;
  const pushed = await pushBranch(ctx, p.cwd, p.remote, p.branch);
  if (!pushed.ok) return pushed;
  const head = await revParse(ctx, p.cwd, "HEAD");
  if (!head.ok) return head;
  return ok({ outcome: "done", detail: { branch: p.branch, head: head.value, ...(pushed.value.pushed ? { remote: p.remote } : { skipped: `no remote ${p.remote}` }) } });
}

export const push: StepKindDefinition<typeof PushConfig> = {
  name: "push",
  configSchema: PushConfig,
  outcomes: ["done"],
  mode: "effect",
  run,
};
