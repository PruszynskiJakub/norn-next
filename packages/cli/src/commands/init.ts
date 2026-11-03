/**
 * `norn init` (A1, SK1, W1): repo config from the template if absent, workflow examples if
 * absent, the bundled skills into `.agents/skills/` (whole folders, the bundled version) linked
 * from each configured agent's skill folder, agent hooks (norn-owned, updated in place),
 * machine-local paths in .gitignore, and `runs/` marked generated in .gitattributes. Idempotent: re-running updates norn-owned files only.
 * gh-61 B1, B28 (D10): `norn_version` is recorded only in a repo that has none; on a repo set up
 * for another version, a differing bundled skill is left as it is and `norn upgrade` named instead.
 * Workflows created now get the repo's test command when its build files name one (`runtime/detect.ts`).
 * Prints a summary for a person, ending in the next steps to a first story; `--json` for data.
 */
import { existsSync, mkdirSync, readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { atomicWrite, installSkills, LOCAL_CONFIG_FILE, linkSkills, readText, REPO_CONFIG_FILE, repoConfigPath, SKILLS_DIR, skillsDrift, userConfigPath, WORKFLOWS_DIR, workflowsDir, writeConfigSchemas, writeNornVersion } from "@norn/store";
import { defineCommand, opt } from "../command.ts";
import type { Context } from "../context.ts";
import { rendered } from "../output.ts";
import { agentsInUse } from "../runtime/agents-in-use.ts";
import { assetsDir } from "../runtime/assets.ts";
import { detectTestCommand, gitRemoteUrl, TEMPLATE_TEST_COMMAND, withTestCommand } from "../runtime/detect.ts";
import { bundledSkills } from "../runtime/workflows.ts";
import { cmd } from "@norn/core";

/** Paths that must never be committed (§7.1, gh-64 B9); the machine-local files live outside the checkout (B5). */
const IGNORED = [".env.norn", ".norn-unit", LOCAL_CONFIG_FILE];

function ensureGitignore(root: string): string[] {
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
const GENERATED = [".agents/specs/*/runs/** linguist-generated=true gitlab-generated=true"];

function ensureGitattributes(root: string): string[] {
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
const DEFAULT_HOOK_COMMAND = '"${NORN_BIN:-norn}" hook';

export function hookCommand(ctx: Context, flag?: string): string {
  return flag ?? ctx.env.NORN_HOOK_COMMAND ?? DEFAULT_HOOK_COMMAND;
}

/** The binary a hook command runs, as the shell would pick it (`"${NORN_BIN:-norn}"` → NORN_BIN or norn). */
export function hookBinary(command: string, env: Record<string, string | undefined>): string {
  const first = command.trim().split(/\s+/)[0] ?? "";
  const m = /^"?\$\{NORN_BIN:-([^}]+)\}"?$/.exec(first);
  return m ? env.NORN_BIN || (m[1] as string) : first;
}

export interface InitReport {
  root: string;
  config: "exists" | "created";
  /** B49: `~/.norn/config.yaml` */
  user_config: "exists" | "created";
  /** B50, B55: schema copies written or refreshed */
  schemas: string[];
  workflows: { created: string[]; kept: string[] };
  skills: { dir: string; updated: string[]; unchanged: string[]; links: Array<{ agent: string; dir: string; linked: string[]; unchanged: string[]; kept: string[] }> };
  hooks: Array<{ agent: string; tier: string; changed: string[] }>;
  hook_command: string;
  gitignore: string[];
  gitattributes: string[];
  /** the git remote norn pushes to; `url: null` when the repository has none (nothing can sync or push) */
  remote: { provider: string; label: string; git_remote: string; url: string | null };
  /** the `test` check command written into the workflows created now (null when none were created) */
  test_command: { command: string; detected_from: string | null; set_in: string[] } | null;
  /**
   * gh-61 B1, B28 (D10): the repo's `norn_version` after init and the running norn's; `recorded`
   * when this init wrote it; `skills_kept`: bundled skills that differ and were left alone because
   * the repo is on another version (`norn upgrade` moves both)
   */
  norn_version: { repo: string; running: string; recorded: boolean; skills_kept: string[] };
}

/** `norn init`: what changed, one line per part; names are listed only for what changed. */
function formatInit(r: InitReport): string {
  const rel = (p: string) => relative(r.root, p) || ".";
  const count = (n: number, what: string) => `${n} ${what}`;
  const v = r.norn_version;
  const out = [`norn init in ${r.root}`, "", `norn version: ${v.repo}${v.recorded ? " (recorded)" : ""}`, ""];
  const row = (label: string, text: string) => out.push(`  ${label.padEnd(15)} ${text}`);
  row("config", `${REPO_CONFIG_FILE} ${r.config === "created" ? "created" : "kept (exists)"}`);
  row("user config", `~/.norn/config.yaml ${r.user_config === "created" ? "created" : "kept (exists)"}`);
  if (r.schemas.length) row("schemas", `wrote ${r.schemas.map((p) => (p.startsWith(r.root) ? rel(p) : p)).join(", ")}`);
  row("workflows", [r.workflows.created.length ? `created ${r.workflows.created.join(", ")}` : "", r.workflows.kept.length ? `kept ${r.workflows.kept.join(", ")}` : ""].filter(Boolean).join("; ") || "none");
  const sk = r.skills;
  const kept = v.skills_kept.length ? `; kept ${v.skills_kept.join(", ")} (norn ${v.repo}'s to change)` : "";
  row("skills", `${rel(sk.dir)}: ${sk.updated.length ? `updated ${sk.updated.join(", ")}` : "up to date"}${kept} (${count(sk.updated.length + sk.unchanged.length + v.skills_kept.length, "skills")})`);
  for (const l of sk.links) {
    const parts = [l.linked.length ? `linked ${l.linked.join(", ")}` : "", l.kept.length ? `not linked, a folder of yours is in the way: ${l.kept.join(", ")}` : ""].filter(Boolean);
    row("", `${l.agent} → ${rel(l.dir)}: ${parts.join("; ") || "all linked"}`);
  }
  for (const h of r.hooks) row("hooks", `${h.agent}: ${h.tier === "none" ? "none (adapter has no hooks)" : h.changed.length ? `installed in ${h.changed.map(rel).join(", ")}` : "up to date"}`);
  row("hook command", r.hook_command);
  row(".gitignore", r.gitignore.length ? `added ${r.gitignore.join(", ")}` : "up to date");
  row(".gitattributes", r.gitattributes.length ? `added ${r.gitattributes.join(", ")}` : "up to date");
  const changed = r.config === "created" || r.norn_version.recorded || r.schemas.some((p) => p.startsWith(r.root)) || r.workflows.created.length || sk.updated.length || sk.links.some((l) => l.linked.length) || r.hooks.some((h) => h.changed.length) || r.gitignore.length || r.gitattributes.length;
  if (r.test_command) row("test command", `${r.test_command.command} (${r.test_command.detected_from ? `from ${r.test_command.detected_from}` : "not detected: the template's default"})`);
  row("remote", r.remote.url ? `${r.remote.git_remote} → ${r.remote.url}` : `no git remote named ${r.remote.git_remote}`);
  if (v.repo !== v.running) {
    const differ = v.skills_kept.length ? `, with the bundled skills that differ: ${v.skills_kept.join(", ")}` : "";
    out.push("", `this repo is on norn ${v.repo}, you run ${v.running}: \`${cmd.upgrade()}\` moves it${differ}`);
  }
  if (!changed) out.push("", "Nothing changed: norn is set up here.");
  out.push("", "Next steps", ...nextSteps(r, !!changed).map((s, i) => `  ${i + 1}. ${s}`));
  return out.join("\n");
}

/** What a person does after `norn init` to get a first story going, in order. */
function nextSteps(r: InitReport, changed: boolean): string[] {
  const rel = (p: string) => relative(r.root, p) || ".";
  const steps: string[] = [];
  if (!r.remote.url) steps.push(`Add the remote norn syncs issues from and pushes branches to: \`git remote add ${r.remote.git_remote} <url>\`.`);
  const tc = r.test_command;
  if (tc && !tc.detected_from) steps.push(`Set your test command: the \`test\` steps in ${WORKFLOWS_DIR}/ run \`${tc.command}\` — change \`run:\` there.`);
  else if (tc) steps.push(`Check the test command \`${tc.command}\` in the \`test\` steps of ${WORKFLOWS_DIR}/ (detected from ${tc.detected_from}).`);
  if (changed) {
    // each agent folder whole (`.claude`, not `.claude/settings.json`): skills and hooks live there
    const top = (p: string) => rel(p).split("/")[0] as string;
    const paths = [".agents", ...r.skills.links.map((l) => top(l.dir)), ...r.hooks.flatMap((h) => h.changed.map(top)), ...(r.gitignore.length ? [".gitignore"] : []), ...(r.gitattributes.length ? [".gitattributes"] : [])];
    steps.push(`Commit and push the setup: \`git add ${[...new Set(paths)].join(" ")} && git commit -m "Set up norn" && git push\`.`);
  }
  steps.push(`Check this machine: \`${cmd.doctor()}\`.`);
  const label = r.remote.label;
  steps.push(
    r.remote.provider === "gh"
      ? `Make a first story: an issue labelled \`${label}\` and assigned to you, e.g. \`gh label create ${label}\` (once), then \`gh issue create --label ${label} --assignee @me --title "…"\`.`
      : `Make a first story: an issue labelled \`${label}\` and assigned to you.`,
  );
  steps.push(`Pick it up: \`${cmd.sync()}\`, then \`${cmd.status()}\` shows what needs you and the command for each item; \`${cmd.watch()}\` keeps norn working.`);
  return steps;
}

export const initCommand = defineCommand({
  name: "init",
  summary: "Set up norn in this repository: config, workflows, skills, hooks (A1, SK1, W1)",
  usage: "norn init [--json] [--hook-command <cmd>]",
  markdown: true,
  options: { "hook-command": { type: "string" } },
  async run(ctx, args) {
    const root = ctx.root;
    // B7: a config file with a problem refuses before init writes anything, so no half setup
    void ctx.config;

    const assets = assetsDir(ctx.env);
    const configPath = repoConfigPath(root);
    const config = existsSync(configPath) ? "exists" : (atomicWrite(configPath, readFileSync(join(assets, "config.yaml"), "utf8")), "created");
    // B49: the commented user file on a machine's first init, never overwritten
    const userPath = userConfigPath(ctx.home);
    const user_config = existsSync(userPath) ? "exists" : (atomicWrite(userPath, readFileSync(join(assets, "user-config.yaml"), "utf8")), "created");
    // B50, B55 (D14): the schema copies the starters' modelines point at
    const schemas = writeConfigSchemas({ repoRoot: root, home: ctx.home });

    // W1: the templates' `test` checks get the repo's own test command when its build files name one
    const detected = detectTestCommand(root);
    const testCommand = detected?.command ?? TEMPLATE_TEST_COMMAND;
    const workflows = { created: [] as string[], kept: [] as string[] };
    const setIn: string[] = [];
    mkdirSync(workflowsDir(root), { recursive: true });
    for (const f of readdirSync(join(assets, "workflows")).sort()) {
      const dest = join(workflowsDir(root), f);
      if (existsSync(dest)) workflows.kept.push(f);
      else {
        const template = readFileSync(join(assets, "workflows", f), "utf8");
        const text = detected ? withTestCommand(template, testCommand) : template;
        atomicWrite(dest, text);
        if (text.includes(detected ? JSON.stringify(testCommand) : `run: ${testCommand}`)) setIn.push(f);
        workflows.created.push(f);
      }
    }
    const test_command = workflows.created.length ? { command: testCommand, detected_from: detected?.from ?? null, set_in: setIn } : null;

    // B1 (D10): the version is written only into a repo that has none; init never moves it (B28)
    ctx.reload();
    const recorded = ctx.config.norn_version === null;
    if (recorded) {
      const w = writeNornVersion(root, ctx.version);
      if (!w.ok) throw new Error(`norn init: writing norn_version: ${w.error}`);
      ctx.reload();
    }
    const repoVersion = ctx.config.norn_version ?? ctx.version;
    const ports = await ctx.ports(); // validates the config again with the written files (exit 6 when invalid)
    const agents = agentsInUse(root, ctx.resolved, ports); // B1, B13
    const names = bundledSkills(ctx.env);
    // B28 (D10): on another version's repo, a missing skill is copied in and one that differs stays
    const source = join(assets, "skills");
    const skills_kept = repoVersion === ctx.version ? [] : skillsDrift(join(root, SKILLS_DIR), source, names);
    const installed = installSkills(root, source, names.filter((n) => !skills_kept.includes(n)));
    const links: Array<{ agent: string; dir: string; linked: string[]; unchanged: string[]; kept: string[] }> = [];
    const seen = new Set<string>();
    for (const [name, agent] of Object.entries(agents)) {
      const dir = agent.skillDir(root);
      if (seen.has(dir)) continue;
      seen.add(dir);
      links.push({ agent: name, ...linkSkills(root, dir, names) });
    }
    const skills = { ...installed, links };

    const command = hookCommand(ctx, opt.str(args, "hook-command"));
    const hooks: Array<{ agent: string; tier: string; changed: string[] }> = [];
    for (const [name, agent] of Object.entries(agents)) {
      const r = agent.tier === "none" ? { changed: [] } : await agent.installHooks(root, command, name);
      hooks.push({ agent: name, tier: agent.tier, changed: r.changed });
    }

    const report: InitReport = { root, config, user_config, schemas, workflows, skills, hooks, hook_command: command, gitignore: ensureGitignore(root), gitattributes: ensureGitattributes(root), remote: { provider: ctx.config.provider, label: ctx.config.label, git_remote: ctx.config.git_remote, url: gitRemoteUrl(root, ctx.config.git_remote) }, test_command, norn_version: { repo: repoVersion, running: ctx.version, recorded, skills_kept } };
    return rendered(report, formatInit(report));
  },
});
