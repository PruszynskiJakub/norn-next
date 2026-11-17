/**
 * Building the tick host: resolve every slot by name, load the pack's workflows with every
 * registered step kind, and hand back a runtime whose `tick` runs one tick at a time.
 */
import { Journal } from "@norn/kernel";
import { ok, type PluginResult } from "@norn/plugin-api";
import type { RuntimeEnv } from "./env.ts";
import { loadPackWorkflows, resolveSlots } from "./resolve.ts";
import { newTickId, tick } from "./tick.ts";
import type { Runtime, RuntimeDeps } from "./types.ts";

/** What every tick works with, or the refusal naming the slot or workflow that does not resolve. */
export function createRuntimeEnv(deps: Omit<RuntimeDeps, "tickId">): PluginResult<RuntimeEnv> {
  const slots = resolveSlots(deps.ctx, deps.plugins, deps.config);
  if (!slots.ok) return slots;
  const workflows = loadPackWorkflows(slots.value.pack, slots.value.stepKinds, deps.config.kernel);
  if (!workflows.ok) return workflows;
  return ok({
    ctx: deps.ctx,
    config: deps.config,
    slots: slots.value,
    journal: new Journal(slots.value.store),
    launcher: deps.launcher,
    sessions: deps.sessions,
    workflows: workflows.value,
  });
}

export function createRuntime(deps: RuntimeDeps): PluginResult<Runtime> {
  const env = createRuntimeEnv(deps);
  if (!env.ok) return env;
  const nextId = deps.tickId ?? (() => newTickId(env.value.ctx.now()));
  return ok({ tick: () => tick(env.value, nextId()) });
}
