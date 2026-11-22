/**
 * `await-checks`: wait for the checks on the story's change to settle. `pass` when they all passed,
 * or when the forge reports none (a forge without checks at once, else after `appear` with no check
 * showing up: the repo runs no CI); `fail` when one failed, naming each failed check and where its run
 * is, which becomes `last_check` for the step that reworks it, or when they are still pending after
 * `settle`; `stale` when the change conflicts with its base, since a forge that runs no checks on
 * such a change would leave the step waiting for good. Written over the Forge slot, so every forge
 * gets the same step.
 */
import { type ChangeRequest, type ChecksReport, FailedCheck, fail, type Forge, type HostContext, ok, type PluginResult, type StepKindDefinition, type StepKindInput, type StepKindOutcome } from "@norn/plugin-api";
import { check, Duration, parseDuration } from "@norn/schema";
import { type Static, Type } from "@sinclair/typebox";

export const AwaitChecksConfig = Type.Object(
  {
    /** how long the change may show no check at all before the step takes it for a repo without CI */
    appear: Type.Optional(Duration),
    /** how long the checks may stay pending before the step fails */
    settle: Type.Optional(Duration),
  },
  { additionalProperties: false },
);
export type AwaitChecksConfig = Static<typeof AwaitChecksConfig>;

/** The kind's name, which its settled outcomes' receipts carry as their `step_kind`. */
export const AWAIT_CHECKS = "await-checks";

export const DEFAULT_APPEAR = "5m";
export const DEFAULT_SETTLE = "30m";

/** What a settled `await-checks` records with its outcome, for the brief and `last_check` of the step after it. */
export const ChecksDetail = Type.Object({
  change: Type.Integer({ minimum: 1 }),
  url: Type.Optional(Type.String()),
  failed: Type.Array(FailedCheck),
  reason: Type.String(),
});
export type ChecksDetail = Static<typeof ChecksDetail>;

type Answer = PluginResult<StepKindOutcome>;

/** The forge's report: its own with the failures' whereabouts, else its summary alone. */
async function reportOf(forge: Forge, id: number): Promise<PluginResult<ChecksReport>> {
  if (forge.checkReport) return forge.checkReport(id);
  const summary = await forge.checks(id);
  return summary.ok ? ok({ summary: summary.value, failed: [] }) : summary;
}

const settled = (outcome: "pass" | "fail" | "stale", change: ChangeRequest, reason: string, failed: ChecksReport["failed"] = []): Answer => {
  const detail: ChecksDetail = { change: change.id, ...(change.url !== undefined ? { url: change.url } : {}), failed, reason };
  return ok({ outcome, detail });
};

const elapsed = (input: StepKindInput<AwaitChecksConfig>, ctx: HostContext): number => {
  const since = input.started_at === undefined ? Number.NaN : Date.parse(input.started_at);
  return Number.isNaN(since) ? 0 : Date.parse(ctx.now()) - since;
};

async function run(input: StepKindInput<AwaitChecksConfig>, ctx: HostContext): Promise<Answer> {
  const forge = input.slots?.forge;
  if (!forge) return fail("invalid", "await-checks: the repo has no forge configured", false);
  const branch = input.branch;
  if (branch === undefined) return fail("invalid", "await-checks: the host passed no branch for the unit", false);
  const found = await forge.findChanges([branch]);
  if (!found.ok) return found;
  const change = found.value[branch] ?? null;
  if (change === null) return fail("not_found", `await-checks: no change holds ${branch}; open-pr opens it`, false);
  if (!forge.capabilities.checks) return settled("pass", change, `forge ${forge.name} runs no checks`);
  if (change.state === "merged") return settled("pass", change, "the change is already merged");
  const report = await reportOf(forge, change.id);
  if (!report.ok) return report;
  const { summary, failed, conflicts } = report.value;
  if (conflicts === true) return settled("stale", change, `change ${change.id} conflicts with its base, so no checks run on it until the branch takes the base`);
  if (summary === "failure") return settled("fail", change, `checks failed on change ${change.id}`, failed);
  if (summary === "success") return settled("pass", change, `every check passed on change ${change.id}`);
  const waited = elapsed(input, ctx);
  if (summary === "none") {
    const appear = input.config.appear ?? DEFAULT_APPEAR;
    if (waited >= parseDuration(appear)) return settled("pass", change, `no check showed up on change ${change.id} within ${appear}: nothing to wait for`);
    return ok({ outcome: "waiting", detail: { change: change.id, summary } });
  }
  const settle = input.config.settle ?? DEFAULT_SETTLE;
  if (waited >= parseDuration(settle)) return settled("fail", change, `the checks on change ${change.id} were still pending after ${settle}`);
  return ok({ outcome: "waiting", detail: { change: change.id, summary } });
}

/**
 * The text a settled `await-checks` gives the step after it: why it ended and each failed check with
 * its link, never a log, which buries the failure in passing output. Null when `detail` is not one.
 */
export function checksText(step: string, outcome: string, detail: unknown): string | null {
  const v = check(ChecksDetail, detail);
  if (!v.ok) return null;
  const d = v.value;
  const head = `Check \`${step}\` ended \`${outcome}\`: ${d.reason}${d.url ? ` (${d.url})` : ""}.`;
  if (d.failed.length === 0) return head;
  const lines = d.failed.map((f) => `- ${f.name}${f.url ? `: ${f.url}` : ""}`);
  return `${head}\n\nFailed checks:\n\n${lines.join("\n")}\n\nRead each failed check's own report at its link first (the file, line and message it names), and its full log only when that is not enough.`;
}

export const awaitChecks: StepKindDefinition<typeof AwaitChecksConfig> = {
  name: AWAIT_CHECKS,
  configSchema: AwaitChecksConfig,
  outcomes: ["pass", "fail", "stale"],
  mode: "wait",
  slot: "forge",
  run,
};
