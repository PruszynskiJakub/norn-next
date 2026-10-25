/**
 * `norn uninstall` (A1, SK1): remove norn-owned hooks and norn's skills — the bundled folders in
 * `.agents/skills/`, the links to them, and copies an older norn installed (marked). Config,
 * workflows, specs, run state and the repo's own skills stay.
 */
import type { AgentAdapter } from "@norn/core";
import { removeSkills } from "@norn/store";
import { defineCommand } from "../command.ts";
import { bundledSkills } from "../runtime/workflows.ts";

export const uninstallCommand = defineCommand({
  name: "uninstall",
  summary: "Remove norn-owned hooks and skills; keep config, workflows and specs",
  usage: "norn uninstall",
  async run(ctx) {
    const root = ctx.root;
    let agents: Record<string, AgentAdapter>;
    try {
      agents = (await ctx.ports()).agents;
    } catch {
      // config unreadable: fall back to every built-in agent adapter
      agents = Object.fromEntries(Object.entries(ctx.registry.agents).map(([n, f]) => [n, f(ctx.adapterContext())]));
    }
    const hooks: Array<{ agent: string; changed: string[] }> = [];
    for (const [name, agent] of Object.entries(agents)) hooks.push({ agent: name, changed: (await agent.uninstallHooks(root)).changed });
    const skills = removeSkills(root, bundledSkills(ctx.env), Object.values(agents).map((a) => a.skillDir(root)));
    return { root, hooks, skills_removed: skills.removed, kept_local: skills.kept };
  },
});
