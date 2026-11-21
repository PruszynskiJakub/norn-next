/**
 * The runtime's config from the person's: snake_case knobs and durations become the kernel's
 * camelCase milliseconds, and each slot's `use` splits from the config its plugin validates.
 */
import { DEFAULT_KERNEL_CONFIG, type KernelConfig, launchTarget } from "@norn/kernel";
import { ATTENDANCE, type Attendance } from "@norn/schema";
import type { ExecutorChoice, RuntimeConfig, SlotChoice } from "@norn/runtime";
import type { LoadedConfig } from "./load.ts";
import { DEFAULT_RUNNERS, type NornConfig } from "./schema.ts";

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

function runnerChoice(runner: NonNullable<NornConfig["executors"][string]["runner"]>): SlotChoice {
  return typeof runner === "string" ? { name: runner } : slotChoice(runner);
}

/** The runner each attendance picks for an executor without its own, the defaults filled in. */
export function runnersOf(config: NornConfig): Partial<Record<Attendance, NonNullable<NornConfig["executors"][string]["runner"]>>> {
  return { ...DEFAULT_RUNNERS, ...config.runners };
}

const runnerName = (r: NonNullable<NornConfig["executors"][string]["runner"]>): string => (typeof r === "string" ? r : r.use);

/** Every runner the config runs an agent in, by the key that names it: an executor's own, and each attendance's when an executor has none. */
export function runnerPicks(config: NornConfig): Array<{ name: string; at: string }> {
  const out: Array<{ name: string; at: string }> = [];
  for (const [name, e] of Object.entries(config.executors)) if (e.runner !== undefined) out.push({ name: runnerName(e.runner), at: `executors.${name}.runner` });
  if (Object.values(config.executors).some((e) => e.runner === undefined)) {
    const runners = runnersOf(config);
    for (const a of ATTENDANCE) {
      const r = runners[a];
      if (r !== undefined) out.push({ name: runnerName(r), at: `runners.${a}` });
    }
  }
  return out;
}

/**
 * The launcher's executors: one with its own runner under its name, one without under one name per
 * attendance `runners` sets (`launchTarget`), so decide reads each runner's presence as a capability.
 */
function executorsOf(config: NornConfig): Record<string, ExecutorChoice> {
  const out: Record<string, ExecutorChoice> = {};
  const runners = runnersOf(config);
  for (const [name, e] of Object.entries(config.executors)) {
    const rest = { ...(e.model !== undefined && { model: e.model }), ...(e.args !== undefined && { args: [...e.args] }) };
    if (e.runner !== undefined) {
      out[name] = { name: e.harness, runner: runnerChoice(e.runner), ...rest };
      continue;
    }
    for (const a of ATTENDANCE) {
      const runner = runners[a];
      if (runner !== undefined) out[launchTarget(name, a)] = { name: e.harness, runner: runnerChoice(runner), ...rest };
    }
  }
  return out;
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
    ...(config.sources !== undefined && Object.keys(config.sources).length > 0 && { sources: { ...config.sources } }),
    ...(config.policy?.allow !== undefined && { capabilities: [...config.policy.allow] }),
    ...(config.bind !== undefined && Object.keys(config.bind).length > 0 && { bind: Object.fromEntries(Object.entries(config.bind).map(([k, b]) => [k, typeof b === "string" ? [b] : [...b]])) }),
  };
}

export function runtimeConfigOf(loaded: LoadedConfig, holder: string, formerHolders: readonly string[] = []): RuntimeConfig {
  const { config } = loaded;
  const effective = config.holder ?? holder;
  // a configured holder exists to tell this home apart from another on the same machine that claims as
  // the derived user@machine names, so none of them is evidence that a claim is this home's
  const former = config.holder === undefined ? formerHolders.filter((n) => n !== effective) : [];
  const executors = executorsOf(config);
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
    standIn: { gates: [...(config.policy?.stand_in?.gates ?? [])], attended: [...(config.policy?.stand_in?.attended ?? [])] },
  };
}
