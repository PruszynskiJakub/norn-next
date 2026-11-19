/**
 * The runtime's config from the person's: snake_case knobs and durations become the kernel's
 * camelCase milliseconds, and each slot's `use` splits from the config its plugin validates.
 */
import { DEFAULT_KERNEL_CONFIG, type KernelConfig } from "@norn/kernel";
import type { ExecutorChoice, RuntimeConfig, SlotChoice } from "@norn/runtime";
import type { LoadedConfig } from "./load.ts";
import type { NornConfig } from "./schema.ts";

const UNIT_MS = { ms: 1, s: 1_000, m: 60_000, h: 3_600_000, d: 86_400_000 } as const;

/** `15m` → 900000. The schema admits only what this reads. */
export function durationMs(text: string): number {
  const m = /^([1-9][0-9]*)(ms|s|m|h|d)$/.exec(text);
  if (!m) throw new RangeError(`not a duration: ${text}`);
  return Number(m[1]) * UNIT_MS[m[2] as keyof typeof UNIT_MS];
}

/** A slot's `use` apart from its plugin's own keys; `drop` names norn's keys that are not the plugin's. */
export function slotChoice(slot: { use: string } & Record<string, unknown>, drop: readonly string[] = []): SlotChoice {
  const { use, ...rest } = slot;
  for (const k of drop) delete rest[k];
  return Object.keys(rest).length > 0 ? { name: use, config: rest } : { name: use };
}

function runnerChoice(runner: NornConfig["executors"][string]["runner"]): SlotChoice {
  return typeof runner === "string" ? { name: runner } : slotChoice(runner);
}

export function kernelConfigOf(config: NornConfig, executor: string): KernelConfig {
  const k = config.kernel ?? {};
  const c = k.counters ?? {};
  const d = DEFAULT_KERNEL_CONFIG;
  return {
    counterDefaults: {
      checkFail: c.check_fail ?? d.counterDefaults.checkFail,
      gateReject: c.gate_reject ?? d.counterDefaults.gateReject,
      conflict: c.conflict ?? d.counterDefaults.conflict,
      stale: c.stale ?? d.counterDefaults.stale,
      agentBack: c.agent_back ?? d.counterDefaults.agentBack,
    },
    silentAfterMs: k.silent_after ? durationMs(k.silent_after) : d.silentAfterMs,
    maxNudges: k.max_nudges ?? d.maxNudges,
    maxRetries: k.max_retries ?? d.maxRetries,
    deadlineMs: k.deadline === "none" ? null : k.deadline ? durationMs(k.deadline) : d.deadlineMs,
    mode: k.mode ?? d.mode,
    executor,
    workflow: k.workflow ?? d.workflow,
    ...(k.intake_workflow_label_prefix ?? d.intakeWorkflowLabelPrefix ? { intakeWorkflowLabelPrefix: k.intake_workflow_label_prefix ?? d.intakeWorkflowLabelPrefix } : {}),
    sliceWorkflow: k.slice_workflow ?? d.sliceWorkflow,
    base: config.base,
    claimTtlMs: k.claim_ttl ? durationMs(k.claim_ttl) : d.claimTtlMs,
    claimRenewBeforeMs: k.claim_renew_before ? durationMs(k.claim_renew_before) : d.claimRenewBeforeMs,
  };
}

export function runtimeConfigOf(loaded: LoadedConfig, holder: string, formerHolders: readonly string[] = []): RuntimeConfig {
  const { config } = loaded;
  const effective = config.holder ?? holder;
  // the derived name stays this machine's when the config names another: a claim taken under it is not stranded
  const former = [...new Set([holder, ...formerHolders])].filter((n) => n !== effective);
  const executors: Record<string, ExecutorChoice> = {};
  for (const [name, e] of Object.entries(config.executors))
    executors[name] = { name: e.harness, runner: runnerChoice(e.runner), ...(e.model !== undefined && { model: e.model }), ...(e.args !== undefined && { args: [...e.args] }) };
  const lockStale = config.kernel?.lock_stale;
  const retain = config.trace?.retain;
  return {
    tracker: slotChoice(config.tracker, ["intake"]),
    forge: slotChoice(config.forge),
    store: slotChoice(config.store),
    vcs: slotChoice(config.vcs),
    executors,
    pack: config.packs[0] as string,
    kernel: kernelConfigOf(config, loaded.executor),
    intake: { label: config.tracker.intake.label, assignee: config.tracker.intake.assignee === undefined ? "me" : config.tracker.intake.assignee },
    base: config.base,
    ...(config.base_ref ? { baseRef: config.base_ref } : {}),
    holder: effective,
    ...(former.length > 0 ? { formerHolders: former } : {}),
    ...(lockStale ? { lockStaleMs: durationMs(lockStale) } : {}),
    ...(retain ? { traceRetainMs: retain === "keep" ? null : durationMs(retain) } : {}),
    ...(config.checks ? { checks: { ...config.checks } } : {}),
  };
}
