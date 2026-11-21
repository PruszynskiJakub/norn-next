/**
 * The launcher a config's executors make: each executor's harness (resolved with the other slots)
 * paired with the runner its choice names, or the config's default runner. A runner no plugin
 * provides, or an executor with no runner at all, is a refusal naming it, before the first tick.
 */
import { createRunner, fail, type Harness, type HostContext, type NornPlugin, ok, type PluginResult, type Runner, type RunnerFactory } from "@norn/plugin-api";
import { type Executor, HarnessLauncher, type HarnessLauncherOptions } from "./launcher.ts";
import { findProvided } from "./resolve.ts";
import type { RuntimeConfig } from "./types.ts";

/** The hooks a launched agent runs, before the harness's name: the CLI's own `norn hook <harness>`. */
export const DEFAULT_HOOK_COMMAND: readonly string[] = Object.freeze(["norn", "hook"]);

export function resolveExecutors(ctx: HostContext, plugins: readonly NornPlugin[], config: RuntimeConfig, harnesses: Readonly<Record<string, Harness>>): PluginResult<Record<string, Executor>> {
  const out: Record<string, Executor> = {};
  // one instance per runner choice: an executor runs under a name per attendance, and a runner that
  // groups a story's runs (one Herdr workspace per story) must see every run it launched
  const made = new Map<string, Runner>();
  for (const [name, choice] of Object.entries(config.executors)) {
    const harness = harnesses[name];
    if (!harness) return fail("not_found", `executor ${JSON.stringify(name)} has no harness`, false);
    const runnerChoice = choice.runner ?? config.runner;
    if (!runnerChoice) return fail("invalid", `executor ${JSON.stringify(name)} names no runner and the config has no default runner`, false);
    const key = JSON.stringify([runnerChoice.name, runnerChoice.config ?? {}]);
    let runner = made.get(key);
    if (!runner) {
      const factory = findProvided<RunnerFactory>(plugins, "runners", runnerChoice.name);
      if (!factory.ok) return factory;
      const created = createRunner(factory.value, ctx, runnerChoice.config ?? {});
      if (!created.ok) return fail(created.failure.code, `executor ${JSON.stringify(name)}: runner ${JSON.stringify(runnerChoice.name)}: ${created.failure.message}`, created.failure.retryable);
      runner = created.value;
      made.set(key, runner);
    }
    out[name] = { harness, runner, ...(choice.model !== undefined && { model: choice.model }), ...(choice.args !== undefined && { args: [...choice.args] }) };
  }
  return ok(out);
}

export function createHarnessLauncher(
  ctx: HostContext,
  plugins: readonly NornPlugin[],
  config: RuntimeConfig,
  harnesses: Readonly<Record<string, Harness>>,
  opts: Omit<HarnessLauncherOptions, "ctx" | "executors">,
): PluginResult<HarnessLauncher> {
  const executors = resolveExecutors(ctx, plugins, config, harnesses);
  if (!executors.ok) return executors;
  return ok(new HarnessLauncher({ ctx, executors: executors.value, ...opts }));
}
