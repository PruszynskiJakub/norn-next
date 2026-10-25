/**
 * `norn init` (A1, SK1, W1): repo config from the template if absent, workflow examples if
 * absent, the bundled skills into `.agents/skills/` (whole folders, always the bundled version)
 * linked from each configured agent's skill folder, agent hooks (norn-owned, updated in place),
 * machine-local paths in .gitignore, and `runs/` marked generated in .gitattributes. Idempotent: re-running updates norn-owned files only.
 */
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { atomicWrite, installSkills, linkSkills, readText, repoConfigPath, workflowsDir } from "@norn/store";
import { defineCommand, opt } from "../command.ts";
import type { Context } from "../context.ts";
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

/**
 * S10: `runs/` is committed machine state (§7.1, S8); marking it generated makes GitHub and GitLab
 * collapse it in PR diffs, so a review shows the work, not the receipts.
 */
export const GENERATED = [".agents/specs/*/runs/** linguist-generated=true gitlab-generated=true"];

export function ensureGitattributes(root: string): string[] {
  const path = join(root, ".gitattributes");
  const text = readText(path) ?? "";
  const lines = text.split("\n").map((l) => l.trim());
  const missing = GENERATED.filter((p) => !lines.includes(p));
  if (missing.length) atomicWrite(path, `${text}${text && !text.endsWith("\n") ? "\n" : ""}# norn (machine state, collapsed in diffs)\n${missing.join("\n")}\n`);
  return missing;
}

/**
 * R8.1: installed hooks run `$NORN_BIN` when set — the norn that launched the agent (act exports
 * it) — else the `norn` on PATH. Hooks run through `sh -c`, which expands it.
 */
export const DEFAULT_HOOK_COMMAND = '"${NORN_BIN:-norn}" hook';

export function hookCommand(ctx: Context, flag?: string): string {
  return flag ?? ctx.env.NORN_HOOK_COMMAND ?? DEFAULT_HOOK_COMMAND;
}

/** The binary a hook command runs, as the shell would pick it (`"${NORN_BIN:-norn}"` → NORN_BIN or norn). */
export function hookBinary(command: string, env: Record<string, string | undefined>): string {
  const first = command.trim().split(/\s+/)[0] ?? "";
  const m = /^"?\$\{NORN_BIN:-([^}]+)\}"?$/.exec(first);
  return m ? env.NORN_BIN || (m[1] as string) : first;
}

export const initCommand = defineCommand({
  name: "init",
  summary: "Set up norn in this repository: config, workflows, skills, hooks (A1, SK1, W1)",
  usage: "norn init [--hook-command <cmd>]",
  options: { "hook-command": { type: "string" } },
  async run(ctx, args) {
    const root = ctx.root;

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
    const names = bundledSkills(ctx.env);
    const installed = installSkills(root, join(assets, "skills"), names);
    const links: Array<{ agent: string; dir: string; linked: string[]; unchanged: string[]; kept: string[] }> = [];
    const seen = new Set<string>();
    for (const [name, agent] of Object.entries(ports.agents)) {
      const dir = agent.skillDir(root);
      if (seen.has(dir)) continue;
      seen.add(dir);
      links.push({ agent: name, ...linkSkills(root, dir, names) });
    }
    const skills = { ...installed, links };

    const command = hookCommand(ctx, opt.str(args, "hook-command"));
    const hooks: Array<{ agent: string; tier: string; changed: string[] }> = [];
    for (const [name, agent] of Object.entries(ports.agents)) {
      const r = agent.tier === "none" ? { changed: [] } : await agent.installHooks(root, command, name);
      hooks.push({ agent: name, tier: agent.tier, changed: r.changed });
    }

    return { root, config, workflows, skills, hooks, hook_command: command, gitignore: ensureGitignore(root), gitattributes: ensureGitattributes(root) };
  },
});
