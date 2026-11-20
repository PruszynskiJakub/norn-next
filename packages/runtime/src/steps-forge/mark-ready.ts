/**
 * `mark-ready`: mark the story's open draft change ready for review, once, under the step's receipt:
 * a forge merges no draft, and a story reaches this step only past its ready gate. A change already
 * ready, none at all, or a forge without drafts answers `done` with nothing performed.
 */
import { fail, type HostContext, ok, type PluginResult, type StepKindDefinition, type StepKindInput, type StepKindOutcome } from "@norn/plugin-api";
import { Type } from "@sinclair/typebox";
import { effectKey } from "./open-pr.ts";

export const MarkReadyConfig = Type.Object({}, { additionalProperties: false });

async function run(input: StepKindInput<Record<string, never>>, _ctx: HostContext): Promise<PluginResult<StepKindOutcome>> {
  const forge = input.slots?.forge;
  if (!forge?.capabilities.draft) return ok({ outcome: "done", detail: { reason: "the forge has no draft changes" } });
  const branch = input.branch;
  if (branch === undefined) return fail("invalid", "mark-ready: the host passed no branch for the unit", false);
  const found = await forge.findChanges([branch]);
  if (!found.ok) return found;
  const change = found.value[branch] ?? null;
  if (change?.state !== "open" || !change.draft) return ok({ outcome: "done", detail: { reason: "no open draft change" } });
  const readied = await forge.perform({ kind: "ready", id: change.id }, { receipt_id: effectKey(input, change.head_sha) });
  if (!readied.ok) return readied;
  return ok({ outcome: "done", detail: { change: readied.value.change, effect: "ready" } });
}

export const markReady: StepKindDefinition<typeof MarkReadyConfig> = {
  name: "mark-ready",
  configSchema: MarkReadyConfig,
  outcomes: ["done"],
  mode: "effect",
  run,
};
