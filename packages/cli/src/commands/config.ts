/**
 * `norn config <verb>` (K2, gh-64 B46): `list` every setting in effect, with or without a key, with
 * its value and source (`built-in`, `derived` with the reason, `user`, `local`, `repo`), grouped by
 * the file it belongs in; `get <key>` that setting, or every setting under it (`agents`, `claim`);
 * `set` and `unset` one value in the user, local or team file (`config-edit.ts`).
 */
import { existsSync } from "node:fs";
import { relative } from "node:path";
import { CONFIG_FILES, type ConfigEntry } from "@norn/schema";
import type { LoadedConfig } from "@norn/store";
import { defineCommand, defineNoun } from "../command.ts";
import type { Context } from "../context.ts";
import { rendered, usageError } from "../output.ts";
import { cmd } from "@norn/core";
import { configSetCommand, configUnsetCommand } from "./config-edit.ts";

type Group = "machine" | "person" | "team" | "norn";
const GROUP_OF: Record<string, Group> = {
  max_agents: "machine",
  notify: "machine",
  trace: "machine",
  runner: "machine",
  mode: "person",
  agent: "person",
  agents: "person",
  provider: "team",
  base_branch: "team",
  workflow: "team",
  slice_workflow: "team",
  norn_version: "team",
};
const GROUPS: Array<{ group: Group; title: string }> = [
  { group: "machine", title: `This machine (${CONFIG_FILES.user})` },
  { group: "person", title: `You (${CONFIG_FILES.local} over ${CONFIG_FILES.user})` },
  { group: "team", title: `The team (${CONFIG_FILES.repo})` },
  { group: "norn", title: "No key: built in or derived" },
];
const groupOf = (key: string): Group => GROUP_OF[key.split(".")[0] as string] ?? "norn";

const configListCommand = defineCommand({
  name: "config list",
  version: "reads",
  summary: "Show the resolved config and which file set each value",
  usage: "norn config list [--json]",
  markdown: true,
  run: async (ctx) => showConfig(ctx),
});

const configGetCommand = defineCommand({
  name: "config get",
  version: "reads",
  summary: "Show one setting, or every setting under a key, and which file set it",
  usage: "norn config get <key> [--json]",
  markdown: true,
  positionals: { min: 1, max: 1 },
  run: async (ctx, args) => showConfig(ctx, args.positionals[0]),
});

export const configNoun = defineNoun({
  name: "config",
  summary: "Show the resolved config; set or unset one value in the user, local or team file",
  verbs: [configListCommand, configGetCommand, configSetCommand, configUnsetCommand],
});

function showConfig(ctx: Context, key?: string) {
  void ctx.config; // refuses a config with problems (B7), so the load below is ok
  const loaded = ctx.loaded as Extract<LoadedConfig, { ok: true }>;
  const files = {
    user: { path: loaded.paths.user, exists: existsSync(loaded.paths.user) },
    local: { path: loaded.paths.local, exists: existsSync(loaded.paths.local) },
    repo: { path: loaded.paths.repo, exists: existsSync(loaded.paths.repo) },
  };
  const all = loaded.entries;
  let entries = all;
  if (key) {
    entries = all.filter((e) => e.key === key || e.key.startsWith(`${key}.`));
    if (!entries.length) throw usageError(`no setting '${key}'`, cmd.config(), "unknown_key");
  }
  const md = formatConfig(entries, {
    user: files.user,
    local: { ...files.local, path: relative(ctx.root, files.local.path) },
    repo: { ...files.repo, path: relative(ctx.root, files.repo.path) },
  });
  return rendered({ files, entries: entries.map((e) => ({ ...e, meaning: meaning(e.key) })) }, md);
}

/** One line on what each setting does, by key, else by its top-level key. */
const MEANING: Record<string, string> = {
  runner: "where auto mode starts agents (detected)",
  max_agents: "agent sessions (and checks) at once on this machine, across repos",
  "notify.os": "OS notifications for new inbox items",
  "notify.ntfy": "ntfy URL for new inbox items",
  "notify.webhook": "webhook URL for new inbox items",
  "trace.retain": "trace norn tidy keeps (at least 14d)",
  agents: "a coding agent's model and extra args",
  agent: "agent for steps that do not name one",
  mode: "who starts unattended steps of a story: manual (you) or auto (the tick)",
  provider: "where stories come from: gh or glab",
  label: "issues assigned to you with this label become stories",
  git_remote: "git remote to push and fetch",
  sync_interval: "how often watch looks for new issues",
  base_branch: "branch stories are cut from and PR'd into",
  workflow: "workflow for a new story",
  slice_workflow: "workflow for a new slice",
  norn_version: "the norn version this repo needs (only norn upgrade and norn init write it)",
  interval: "time between ticks (norn watch --interval, norn tick --interval)",
  "claim.lease": "a claim not renewed for this long is free to take",
  "claim.renew": "how often the holder renews its claim",
};

/** What `null` means for the keys that allow it. */
const NULL_MEANS: Record<string, string> = { base_branch: "the remote's default branch", norn_version: `not recorded: \`${cmd.upgrade()}\` records it` };

const meaning = (key: string) => MEANING[key] ?? MEANING[key.split(".")[0] as string] ?? "";

function show(v: unknown, key?: string): string {
  if (v === null) return key && NULL_MEANS[key] ? NULL_MEANS[key] : "`null`";
  return `\`${typeof v === "string" ? v : JSON.stringify(v)}\``;
}

const cell = (s: string) => s.replace(/\|/g, "\\|");

const sourceText = (e: ConfigEntry) => (e.reason ? `${e.source}: ${e.reason}` : e.source);

function formatConfig(entries: ConfigEntry[], files: Record<"user" | "local" | "repo", { path: string; exists: boolean }>): string {
  const lines = [
    "# Config",
    "",
    `- user: \`${files.user.path}\`${files.user.exists ? "" : " (not created)"}`,
    `- local: \`${files.local.path}\`${files.local.exists ? "" : " (not created)"}`,
    `- repo: \`${files.repo.path}\`${files.repo.exists ? "" : " (not created)"}`,
    "",
    "For your keys the nearer file wins: local over user over built-in.",
  ];
  for (const g of GROUPS) {
    const rows = entries.filter((e) => groupOf(e.key) === g.group);
    if (!rows.length) continue;
    lines.push("", `## ${g.title}`, "", "| Setting | Value | From | What it does |", "|---|---|---|---|");
    for (const e of rows) lines.push(`| \`${e.key}\` | ${cell(show(e.value, e.key))} | ${cell(sourceText(e))} | ${cell(meaning(e.key))} |`);
  }
  return lines.join("\n");
}
