/**
 * The workflows decide sees in one tick: the pack's by name, and by hash every workflow a unit has
 * pinned. A unit keeps running the document it pinned, which its run state carries flat, so it is
 * loaded from there rather than from the pack: a pack file that changed or broke since does not stop
 * a round already under way.
 */
import { type KernelWorkflows, type LoadedWorkflow, loadWorkflow, type PinnedWorkflow } from "@norn/kernel";
import type { RuntimeEnv } from "./env.ts";
import { signalDeclarations } from "./resolve.ts";

/** The workflow a unit pinned, loaded from its own flat document; null when it no longer loads to the same hash. */
export function loadPinned(env: RuntimeEnv, pinned: PinnedWorkflow): LoadedWorkflow | null {
  // without the host's input names: a revision pinned before an unknown name was refused keeps
  // loading, and the brief notes the name, rather than the unit losing its workflow mid-round
  const load = loadWorkflow(structuredClone(pinned.doc), { stepKinds: env.slots.stepKinds, sharedFiles: {}, config: env.config.kernel, signals: signalDeclarations(env.slots.signals) });
  if (!load.ok || load.workflow.pinned.hash !== pinned.hash) return null;
  return load.workflow;
}

/**
 * Every workflow `pinned` names, added to the pack's. One that fails to load is left out: decide then
 * marks the unit that pinned it corrupt by name, rather than the host guessing at its graph.
 */
export function tickWorkflows(env: RuntimeEnv, pinned: readonly PinnedWorkflow[]): KernelWorkflows {
  const byHash: Record<string, LoadedWorkflow> = {};
  for (const load of Object.values(env.workflows)) if (load.ok) byHash[load.workflow.pinned.hash] = load.workflow;
  for (const p of pinned) {
    if (byHash[p.hash]) continue;
    const loaded = loadPinned(env, p);
    if (loaded) byHash[p.hash] = loaded;
  }
  return { byName: env.workflows, byHash };
}
