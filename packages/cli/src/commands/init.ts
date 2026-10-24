/**
 * `norn init` (A1, SK1, W1): repo config from the template if absent, workflow examples if
 * absent, skills into each configured agent's skill location (norn-owned markers; local
 * overrides win), agent hooks (norn-owned, updated in place), and machine-local paths in
 * .gitignore. Idempotent: re-running updates norn-owned files only.
 */
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { claude } from "@norn/adapters";
import { atomicWrite, readText, repoConfigPath, workflowsDir } from "@norn/store";
import { defineCommand, opt } from "../command.ts";
import type { Context } from "../context.ts";
import { usageError } from "../output.ts";
import { assetsDir } from "../runtime/assets.ts";
import { bundledSkills } from "../runtime/workflows.ts";

/** Paths that must never be committed (§7.1). */
export const IGNORED = [".agents/norn/trace/", ".env.norn", ".norn-unit"];

export function ensureGitignore(root: string): string[] {
  const path = join(root, ".gitignore");
  const text = readText(path) ?? "";
  const lines = text.split("\n").map((l) => l.trim());
  const missing = IGNORED.filter((p) => !lines.includes(p));
  if (missing.length) atomicWrite(path, `${text}${text && !text.endsWith("\n") ? "\n" : ""}# norn (machine-local)\n${missing.join("\n")}\n`);
  return missing;
}

export function hookCommand(ctx: Context, flag?: string): string {
  return flag ?? ctx.env.NORN_HOOK_COMMAND ?? "norn hook";
}

export const initCommand = defineCommand({
  name: "init",
  summary: "Set up norn in this repository: config, workflows, skills, hooks (A1, SK1, W1)",
  usage: "norn init [--hook-command 'norn hook'] [--skills repo|user]",
  options: { "hook-command": { type: "string" }, skills: { type: "string" } },
  async run(ctx, args) {
    const root = ctx.root;
    const scope = opt.str(args, "skills") ?? "repo";
    if (scope !== "repo" && scope !== "user") throw usageError(`--skills must be repo or user, got '${scope}'`, "norn init --skills repo");

    const assets = assetsDir(ctx.env);
    const configPath = repoConfigPath(root);
    const config = existsSync(configPath) ? "exists" : (atomicWrite(configPath, readFileSync(join(assets, "config.yaml"), "utf8")), "created");

    const workflows = { created: [] as string[], kept: [] as string[] };
    mkdirSync(workflowsDir(root), { recursive: true });
    for (const f of readdirSync(join(assets, "workflows")).sort()) {
      const dest = join(workflowsDir(root), f);
      if (existsSync(dest)) workflows.kept.push(f);
      else {
        copyFileSync(join(assets, "workflows", f), dest);
        workflows.created.push(f);
      }
    }

    ctx.reload();
    const ports = await ctx.ports(); // validates the config (exit 4 when invalid)
    const skills: Array<{ agent: string; dir: string; written: string[]; unchanged: string[]; kept_local: string[] }> = [];
    const seen = new Set<string>();
    for (const [name, agent] of Object.entries(ports.agents)) {
      const dir = agent.skillDir(scope, root, ctx.home);
      if (seen.has(dir)) continue;
      seen.add(dir);
      const r = { agent: name, dir, written: [] as string[], unchanged: [] as string[], kept_local: [] as string[] };
      for (const s of bundledSkills(ctx.env)) {
        const res = claude.installSkill(dir, s, readFileSync(join(assets, "skills", s, "SKILL.md"), "utf8"));
        r[res.result].push(s);
      }
      skills.push(r);
    }

    const command = hookCommand(ctx, opt.str(args, "hook-command"));
    const hooks: Array<{ agent: string; tier: string; changed: string[] }> = [];
    for (const [name, agent] of Object.entries(ports.agents)) {
      const r = agent.tier === "none" ? { changed: [] } : await agent.installHooks(root, command, name);
      hooks.push({ agent: name, tier: agent.tier, changed: r.changed });
    }

    return { root, config, workflows, skills, hooks, hook_command: command, gitignore: ensureGitignore(root) };
  },
});
