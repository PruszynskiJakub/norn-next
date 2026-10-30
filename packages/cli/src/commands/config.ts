/**
 * `norn config <verb>` (K2, B61–B68): `list` the resolved config, each setting with the layer it
 * came from (built-in, `~/.norn/config.yaml` or `.agents/norn.config.yaml`), grouped by who it
 * belongs to; `get <key>` that setting, or every setting under it (`limits`, `agents`); `set` and
 * `unset` one value in the user or repo file (`config-edit.ts`).
 */
import { existsSync } from "node:fs";
import { relative } from "node:path";
import { type ConfigEntry, type ConfigGroup, explainConfig, type ResolvedConfig } from "@norn/schema";
import { type LoadedConfig, repoConfigPath, userConfigPath } from "@norn/store";
import { defineCommand, defineNoun } from "../command.ts";
import type { Context } from "../context.ts";
import { rendered, usageError } from "../output.ts";
import { cmd } from "@norn/core";
import { configSetCommand, configUnsetCommand } from "./config-edit.ts";

const GROUPS: Array<{ group: ConfigGroup; title: string; file: "user" | "repo" }> = [
  { group: "machine", title: "This machine", file: "user" },
  { group: "person", title: "You", file: "user" },
  { group: "team", title: "The team", file: "repo" },
];

const configListCommand = defineCommand({
  name: "config list",
  summary: "Show the resolved config and which file set each value",
  usage: "norn config list [--json]",
  markdown: true,
  run: async (ctx) => showConfig(ctx),
});

const configGetCommand = defineCommand({
  name: "config get",
  summary: "Show one setting, or every setting under a key, and which file set it",
  usage: "norn config get <key> [--json]",
  markdown: true,
  positionals: { min: 1, max: 1 },
  run: async (ctx, args) => showConfig(ctx, args.positionals[0]),
});

export const configNoun = defineNoun({
  name: "config",
  summary: "Show the resolved config; set or unset one value in the user or repo file",
  verbs: [configListCommand, configGetCommand, configSetCommand, configUnsetCommand],
});

function showConfig(ctx: Context, key?: string) {
  const config = ctx.config; // refuses a corrupt layer (S2), so the load below is ok
  const loaded = ctx.loaded as Extract<LoadedConfig, { ok: true }>;
  const files = {
    user: { path: userConfigPath(ctx.home), exists: existsSync(userConfigPath(ctx.home)) },
    repo: { path: repoConfigPath(ctx.root), exists: existsSync(repoConfigPath(ctx.root)) },
  };
  const all = explainConfig(loaded.user, loaded.repo);
  let entries = all;
  if (key) {
    entries = all.filter((e) => e.key === key || e.key.startsWith(`${key}.`));
    if (!entries.length) entries = within(all, key);
    if (!entries.length) throw usageError(`no setting '${key}'`, cmd.config(), "unknown_key");
  }
  const notes = key ? [] : configNotes(config, entries);
  const md = formatConfig(entries, notes, { user: files.user, repo: { ...files.repo, path: relative(ctx.root, files.repo.path) } });
  return rendered({ files, entries: entries.map((e) => ({ ...e, meaning: meaning(e.key) })), notes }, md);
}

/** A key inside one setting's value (`agents.claude.model`), credited to the layer that set the setting. */
function within(entries: ConfigEntry[], key: string): ConfigEntry[] {
  const outer = entries.find((e) => key.startsWith(`${e.key}.`));
  if (!outer) return [];
  let value: unknown = outer.value;
  for (const seg of key.slice(outer.key.length + 1).split(".")) value = typeof value === "object" && value !== null ? (value as Record<string, unknown>)[seg] : undefined;
  return value === undefined ? [] : [{ key, value, source: outer.source, group: outer.group }];
}

/** Hints for the mistakes the layering makes easy; one line each, no decisions. */
function configNotes(config: ResolvedConfig, entries: ConfigEntry[]): string[] {
  const notes: string[] = [];
  if (config.runner === null && config.default_mode === "auto")
    notes.push("`default_mode` is auto but this machine has no `runner`: every story runs manual (MO2). Set `runner` in ~/.norn/config.yaml.");
  for (const e of entries) {
    if (e.repo_ignored !== undefined) notes.push(`\`${e.key}\`: the repo's ${show(e.repo_ignored)} does not apply; a repo can only lower a machine cap (K2).`);
    else if (e.group === "machine" && e.source === "repo") notes.push(`\`${e.key}\` is set by the repo for every machine; it usually belongs in ~/.norn/config.yaml.`);
  }
  for (const [name, agent] of Object.entries(config.agents)) {
    if (agent.args?.includes("--permission-mode"))
      notes.push(`\`agents.${name}\` passes \`--permission-mode\`: that is the agent's own permission mode, not norn's \`default_mode\`.`);
  }
  return notes;
}

/** One line on what each setting does, by key, else by its top-level key. */
const MEANING: Record<string, string> = {
  runner: "starts agents in auto mode; none: every story runs manual",
  max_agents: "agents running at once on this machine, across repos",
  max_checks: "checks running at once on this machine",
  "slots.min": "lowest port slot number",
  "slots.max": "highest port slot number",
  "slots.port_base": "first port of slot 0",
  "slots.ports_per_slot": "ports reserved per worktree",
  "slots.env": "extra per-slot env vars ({slot} is replaced)",
  notifiers: "how you are told about new inbox items",
  agents: "a coding agent norn can brief or start",
  default_agent: "agent for steps that do not name one",
  default_mode: "who starts unattended steps of a story with no mode set: manual (you) or auto (the tick)",
  "remote.provider": "where stories come from: gh or glab",
  "remote.label": "issues assigned to you with this label become stories",
  "remote.git_remote": "git remote to push and fetch",
  "remote.host": "GitHub Enterprise or self-hosted GitLab host",
  "remote.sync_interval": "how often watch looks for new issues",
  base_branch: "branch stories are cut from and PR'd into",
  default_workflow: "workflow for a new story",
  default_slice_workflow: "workflow for a new slice",
  watch_interval: "time between ticks of norn watch",
  "claim.lease": "a claim not renewed for this long is free to take",
  "claim.renew": "how often the holder renews its claim",
  "limits.deadline": "unattended step runs this long, then times out",
  "limits.nudges": "nudges into the same session before giving up",
  "limits.retries": "fresh sessions after an agent died",
  "limits.stalled": "no activity for this long counts as stalled",
  "limits.attended_wait": "an attended run idle this long shows as Your turn",
};

/** What `null` means for the keys that allow it. */
const NULL_MEANS: Record<string, string> = { runner: "none", base_branch: "the remote's default branch" };

const meaning = (key: string) => MEANING[key] ?? MEANING[key.split(".")[0] as string] ?? "";

function show(v: unknown, key?: string): string {
  if (v === null) return key && NULL_MEANS[key] ? NULL_MEANS[key] : "`null`";
  return `\`${typeof v === "string" ? v : JSON.stringify(v)}\``;
}

const cell = (s: string) => s.replace(/\|/g, "\\|");

function formatConfig(entries: ConfigEntry[], notes: string[], files: Record<"user" | "repo", { path: string; exists: boolean }>): string {
  const lines = [
    "# Config",
    "",
    `- user: \`${files.user.path}\`${files.user.exists ? "" : " (not created)"}`,
    `- repo: \`${files.repo.path}\`${files.repo.exists ? "" : " (not created)"}`,
    "",
    "The repo file overrides the user file, except machine caps, which it can only lower.",
  ];
  for (const g of GROUPS) {
    const rows = entries.filter((e) => e.group === g.group);
    if (!rows.length) continue;
    lines.push("", `## ${g.title} (usually in the ${g.file} file)`, "", "| Setting | Value | From | What it does |", "|---|---|---|---|");
    for (const e of rows) lines.push(`| \`${e.key}\` | ${cell(show(e.value, e.key))} | ${e.source} | ${cell(meaning(e.key))} |`);
  }
  if (notes.length) lines.push("", "## Notes", "", ...notes.map((n) => `- ${n}`));
  return lines.join("\n");
}
