/**
 * `norn uninstall` (A1, SK1): remove norn-owned hooks and norn-owned skills (files still
 * carrying the marker). Config, workflows, specs and run state are the repo's and stay.
 */
import { readdirSync, rmdirSync, unlinkSync } from "node:fs";
import { dirname, join } from "node:path";
import { claude } from "@norn/adapters";
import type { AgentAdapter } from "@norn/core";
import { readText } from "@norn/store";
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
    const skills: string[] = [];
    const kept: string[] = [];
    const seen = new Set<string>();
    const bundled = bundledSkills(ctx.env);
    for (const [name, agent] of Object.entries(agents)) {
      hooks.push({ agent: name, changed: (await agent.uninstallHooks(root)).changed });
      for (const scope of ["repo", "user"] as const) {
        const dir = agent.skillDir(scope, root, ctx.home);
        if (seen.has(dir)) continue;
        seen.add(dir);
        for (const s of bundled) {
          const file = join(dir, s, "SKILL.md");
          const text = readText(file);
          if (text === null) continue;
          if (!text.includes(claude.shared.NORN_SKILL_MARKER)) {
            kept.push(file);
            continue;
          }
          unlinkSync(file);
          try {
            if (readdirSync(dirname(file)).length === 0) rmdirSync(dirname(file));
          } catch {
            /* not empty */
          }
          skills.push(file);
        }
      }
    }
    return { root, hooks, skills_removed: skills, kept_local: kept };
  },
});
