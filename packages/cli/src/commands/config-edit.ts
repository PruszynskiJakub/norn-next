/**
 * `norn config set <key> <value>` and `norn config unset <key>` (B62–B68): one value in the user
 * (`~/.norn/config.yaml`) or repo (`.agents/norn/config.yaml`) file, edited in place (D8). Without
 * `--user`/`--repo` a person at a terminal is asked which file (B64); anywhere else it is a usage
 * error (B65).
 */
import { relative } from "node:path";
import { type ConfigLayerName, editConfigLayer } from "@norn/store";
import { defineCommand, opt, type ParsedArgs } from "../command.ts";
import type { Context } from "../context.ts";
import { refuse, rendered, usageError } from "../output.ts";
import { cmd } from "@norn/core";

const FILE_OPTIONS = { user: { type: "boolean" }, repo: { type: "boolean" } } as const;
const FILE_HELP = { "--user": "edit ~/.norn/config.yaml (yours, this machine)", "--repo": "edit .agents/norn/config.yaml (the team's, committed)" };
const PASS_FILE = "pass --user or --repo";

export const configSetCommand = defineCommand({
  name: "config set",
  summary: "Set one value in the user or repo config file",
  usage: "norn config set <key> <value> [--user|--repo] [--json]",
  markdown: true,
  options: FILE_OPTIONS,
  optionHelp: FILE_HELP,
  positionals: { min: 2, max: 2 },
  async run(ctx, args) {
    const [key, text] = args.positionals as [string, string];
    const file = await layerFile(ctx, args, "Write to");
    const r = edit(ctx, file, key, { set: text });
    const where = `the ${file} file (\`${shown(ctx, r.path)}\`)`;
    const md = r.changed ? `Set \`${key}\` to \`${text}\` in ${where}.` : `\`${key}\` is already \`${text}\` in ${where}; nothing changed.`;
    return rendered({ file, path: r.path, key, value: r.value, changed: r.changed }, md);
  },
});

export const configUnsetCommand = defineCommand({
  name: "config unset",
  summary: "Remove one value from the user or repo config file",
  usage: "norn config unset <key> [--user|--repo] [--json]",
  markdown: true,
  options: FILE_OPTIONS,
  optionHelp: FILE_HELP,
  positionals: { min: 1, max: 1 },
  async run(ctx, args) {
    const key = args.positionals[0] as string;
    const file = await layerFile(ctx, args, "Remove from");
    const r = edit(ctx, file, key, { unset: true });
    const where = `the ${file} file (\`${shown(ctx, r.path)}\`)`;
    const md = r.changed ? `Removed \`${key}\` from ${where}.` : `\`${key}\` is not set in ${where}; nothing changed.`;
    return rendered({ file, path: r.path, key, removed: r.changed }, md);
  },
});

/** The file flag, else the person's pick at a terminal (B64), else a usage error (B65). */
async function layerFile(ctx: Context, args: ParsedArgs, verb: string): Promise<ConfigLayerName> {
  const user = opt.bool(args, "user");
  const repo = opt.bool(args, "repo");
  if (user && repo) throw usageError("--user and --repo together: pick one file", PASS_FILE);
  if (user || repo) return user ? "user" : "repo";
  const terminal = ctx.terminal(args.json === true);
  if (!terminal) throw usageError("which config file? (no terminal to ask in)", PASS_FILE, "file_required");
  const choices = [
    { value: "user", label: "user (~/.norn/config.yaml): yours, this machine" },
    { value: "repo", label: "repo (.agents/norn/config.yaml): the team's, committed" },
  ];
  const picked = await terminal.pick(`${verb} user (~/.norn/config.yaml) or repo (.agents/norn/config.yaml)?`, choices, 0);
  if (!picked) throw refuse("Nothing picked", null, "cancelled");
  return picked as ConfigLayerName;
}

function edit(ctx: Context, file: ConfigLayerName, key: string, change: { set: string } | { unset: true }) {
  void ctx.config; // refuses a corrupt layer (S2) before anything is edited
  const r = editConfigLayer({ repoRoot: ctx.root, home: ctx.home, file, key, edit: change });
  if (!r.ok) throw refuse(r.error, cmd.config(), r.code);
  return r;
}

const shown = (ctx: Context, path: string) => (path.startsWith(ctx.root) ? relative(ctx.root, path) : path);
