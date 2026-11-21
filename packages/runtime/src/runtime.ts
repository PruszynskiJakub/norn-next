/**
 * Building the tick host: resolve every slot by name, load the pack's workflows with every
 * registered step kind, build the launcher from the executors' harnesses and runners unless one is
 * given, and hand back a runtime whose `tick` runs one tick at a time.
 */
import { Journal, renderBrief } from "@norn/kernel";
import { fail, ok, type PluginResult } from "@norn/plugin-api";
import { briefRenderInput } from "./brief-context.ts";
import type { RuntimeEnv } from "./env.ts";
import { createHarnessLauncher, DEFAULT_HOOK_COMMAND } from "./executors.ts";
import { NO_REPO_WORKFLOWS, overlayRepoWorkflows } from "./repo-workflows.ts";
import { loadPackWorkflows, type ResolvedSlots, resolveSlots, signalDeclarations } from "./resolve.ts";
import { newTickId, tick } from "./tick.ts";
import type { AgentLauncher, AgentRunRequest, Runtime, RuntimeDeps } from "./types.ts";
import { newWakeWriter, stampingReceipts } from "./wake.ts";

const message = (e: unknown): string => (e instanceof Error ? e.message : String(e));

/** The brief a launch sends, rendered from the env once it exists: the launcher is built before it. */
function briefRenderer(envOf: () => RuntimeEnv | undefined) {
  return async (run: AgentRunRequest): Promise<PluginResult<string>> => {
    const env = envOf();
    if (!env) return fail("unavailable", "the runtime env is not ready", false);
    const input = await briefRenderInput(env, run.unit, run.brief, run.run_id, run.worktree);
    if (!input.ok) return input;
    try {
      return ok(renderBrief(input.value));
    } catch (e) {
      return fail("invalid", `the brief of ${run.unit} could not be rendered: ${message(e)}`, false);
    }
  };
}

function launcherOf(deps: Omit<RuntimeDeps, "tickId">, slots: ResolvedSlots, envOf: () => RuntimeEnv | undefined): PluginResult<AgentLauncher> {
  if (deps.launcher) return ok(deps.launcher);
  return createHarnessLauncher(deps.ctx, deps.plugins, deps.config, slots.executors, {
    hookCommand: deps.hookCommand ?? DEFAULT_HOOK_COMMAND,
    ...(deps.hostPath !== undefined ? { hostPath: deps.hostPath } : {}),
    ...(deps.agentEnv !== undefined ? { agentEnv: deps.agentEnv } : {}),
    silentAfterMs: deps.config.kernel.silentAfterMs,
    skills: slots.pack.skills,
    renderBrief: briefRenderer(envOf),
  });
}

/** What every tick works with, or the refusal naming the slot, runner or workflow that does not resolve. */
export function createRuntimeEnv(deps: Omit<RuntimeDeps, "tickId">): PluginResult<RuntimeEnv> {
  const slots = resolveSlots(deps.ctx, deps.plugins, deps.config);
  if (!slots.ok) return slots;
  const repoWorkflows = deps.repoWorkflows ?? NO_REPO_WORKFLOWS;
  const workflows = loadPackWorkflows(overlayRepoWorkflows(slots.value.pack, repoWorkflows), slots.value.stepKinds, deps.config.kernel, signalDeclarations(slots.value.signals), deps.config.standIn);
  if (!workflows.ok) return workflows;
  let env: RuntimeEnv | undefined;
  const launcher = launcherOf(deps, slots.value, () => env);
  if (!launcher.ok) return launcher;
  const sessions = typeof deps.sessions === "function" ? deps.sessions(launcher.value) : deps.sessions;
  const wakeBy = newWakeWriter(deps.ctx.now());
  env = {
    ctx: deps.ctx,
    config: deps.config,
    slots: slots.value,
    journal: new Journal(stampingReceipts(slots.value.store, deps.ctx, wakeBy)),
    wakeBy,
    launcher: launcher.value,
    sessions,
    workflows: workflows.value,
    repoWorkflows,
  };
  return ok(env);
}

export function createRuntime(deps: RuntimeDeps): PluginResult<Runtime> {
  const env = createRuntimeEnv(deps);
  if (!env.ok) return env;
  const nextId = deps.tickId ?? (() => newTickId(env.value.ctx.now()));
  return ok({ tick: () => tick(env.value, nextId()) });
}
