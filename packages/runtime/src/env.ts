/**
 * What one tick works with: the host, the resolved providers, the ports and the loaded workflows.
 * Built once by `createRuntime` and handed to facts, act and tick, so none of them resolves anything.
 */
import type { Journal, KernelFacts, KernelWorkflows } from "@norn/kernel";
import type { HostContext } from "@norn/plugin-api";
import type { HeldWorkflow } from "./confirm.ts";
import type { RepoWorkflows } from "./repo-workflows.ts";
import type { ResolvedSlots } from "./resolve.ts";
import type { AgentLauncher, RuntimeConfig, SessionSource } from "./types.ts";

export interface RuntimeEnv {
  ctx: HostContext;
  config: RuntimeConfig;
  slots: ResolvedSlots;
  journal: Journal;
  /** the writer every receipt this env records stamps the wake file as */
  wakeBy: string;
  launcher: AgentLauncher;
  sessions: SessionSource;
  /** the pack's workflows by name, the repo's laid over them; pinned ones a unit runs under are added per tick from its state */
  workflows: KernelWorkflows["byName"];
  /** the repo files the workflows were laid over with, so a failure names the repo's file rather than the pack's */
  repoWorkflows: RepoWorkflows;
  /** the repo's workflows held for the person's confirmation, by name; `workflows` holds what new rounds run instead */
  held: Readonly<Record<string, HeldWorkflow>>;
}

/** One tick as act sees it: the facts decide read, so an act checks the record against what was decided from. */
export interface TickContext {
  env: RuntimeEnv;
  tickId: string;
  facts: KernelFacts;
  workflows: KernelWorkflows;
  /** where an act puts what went wrong without failing its decision, such as logs left behind; the tick reports them */
  problems?: string[];
}
