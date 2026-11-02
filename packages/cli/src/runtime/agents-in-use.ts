/**
 * B1, B13: wiring builds every built-in agent so a step may name any of them; what a person sets up
 * (`norn init`'s hooks and skills) and checks (`norn doctor`) covers only the agents in use: the
 * default agent, each agent entry a config file sets (not the built-in ones) and each agent a repo
 * workflow step names. An agent nobody uses is never installed nor failed for being absent.
 */
import type { AgentAdapter, Ports } from "@norn/core";
import type { ConfigEntry, ResolvedConfig } from "@norn/schema";
import { loadWorkflows } from "@norn/store";

export function agentsInUse(root: string, resolved: { config: ResolvedConfig; entries: readonly ConfigEntry[] }, ports: Ports): Record<string, AgentAdapter> {
  const names = new Set<string>([resolved.config.agent]);
  for (const e of resolved.entries) {
    const m = /^agents\.([^.]+)/.exec(e.key);
    if (m && (e.source === "user" || e.source === "local" || e.source === "repo")) names.add(m[1] as string);
  }
  for (const wf of Object.values(loadWorkflows(root).workflows))
    for (const step of Object.values(wf.workflow.steps)) if (step.type === "agent" && step.agent) names.add(step.agent);
  return Object.fromEntries(Object.entries(ports.agents).filter(([n]) => names.has(n)));
}
