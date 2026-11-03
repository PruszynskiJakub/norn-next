/**
 * `norn config set <key> <value>` and `norn config unset <key>` (B62–B68, gh-64 D4): one value in
 * the user (`~/.norn/config.yaml`), local (`.agents/norn.config.local.yaml`) or team
 * (`.agents/norn.config.yaml`) file, edited in place. A key the file does not take is refused
 * (`config_wrong_file`, `config_moved`). Without `--user`/`--local`/`--repo` a person at a terminal
 * is asked which file (B64); anywhere else it is a usage error (B65).
 */
import { relative } from "node:path";
import { CONFIG_FILES, configKeyProblem } from "@norn/schema";
import { type ConfigLayerName, editConfigLayer } from "@norn/store";
import { defineCommand, opt, type ParsedArgs } from "../command.ts";
import type { Context } from "../context.ts";
import { refuse, rendered, usageError } from "../output.ts";
import { cmd } from "@norn/core";

const FILE_OPTIONS = { user: { type: "boolean" }, local: { type: "boolean" }, repo: { type: "boolean" } } as const;
const FILE_HELP = {
  "--user": `edit ${CONFIG_FILES.user} (this machine, your defaults)`,
  "--local": `edit ${CONFIG_FILES.local} (you, in this repo)`,
  "--repo": `edit ${CONFIG_FILES.repo} (the team's, committed)`,
};
const PASS_FILE = "pass --user, --local or --repo";

export const configSetCommand = defineCommand({
  name: "config set",
  version: "acts",
  summary: "Set one value in the user, local or repo config file",
  usage: "norn config set <key> <value> [--user|--local|--repo] [--json]",
  markdown: true,
  options: FILE_OPTIONS,
  optionHelp: FILE_HELP,
  positionals: { min: 2, max: 2 },
  async run(ctx, args) {
    const [key, text] = args.positionals as [string, string];
    refuseWrittenByNorn(key);
    const file = await layerFile(ctx, args, "Write to");
    const r = edit(ctx, file, key, { set: text });
    const where = `the ${file} file (\`${shown(ctx, r.path)}\`)`;
    const md = r.changed ? `Set \`${key}\` to \`${text}\` in ${where}.` : `\`${key}\` is already \`${text}\` in ${where}; nothing changed.`;
    return rendered({ file, path: r.path, key, value: r.value, changed: r.changed }, md);
  },
});

export const configUnsetCommand = defineCommand({
  name: "config unset",
  version: "acts",
  summary: "Remove one value from the user, local or repo config file",
  usage: "norn config unset <key> [--user|--local|--repo] [--json]",
  markdown: true,
  options: FILE_OPTIONS,
  optionHelp: FILE_HELP,
  positionals: { min: 1, max: 1 },
  async run(ctx, args) {
    const key = args.positionals[0] as string;
    refuseWrittenByNorn(key);
    const file = await layerFile(ctx, args, "Remove from");
    const r = edit(ctx, file, key, { unset: true });
    const where = `the ${file} file (\`${shown(ctx, r.path)}\`)`;
    const md = r.changed ? `Removed \`${key}\` from ${where}.` : `\`${key}\` is not set in ${where}; nothing changed.`;
    return rendered({ file, path: r.path, key, removed: r.changed }, md);
  },
});

/** gh-61 D4, K8: `norn_version` is written by `norn upgrade` and `norn init` only; hand-editing stays the escape hatch (B17). */
function refuseWrittenByNorn(key: string): void {
  if (key === "norn_version") throw refuse("`norn_version` is written by norn upgrade, which moves the skills and files with it", cmd.upgrade(), "written_by_norn");
}

/** The file flag, else the person's pick at a terminal (B64), else a usage error (B65). */
async function layerFile(ctx: Context, args: ParsedArgs, verb: string): Promise<ConfigLayerName> {
  const flags = (["user", "local", "repo"] as const).filter((f) => opt.bool(args, f));
  if (flags.length > 1) throw usageError(`${flags.map((f) => `--${f}`).join(" and ")} together: pick one file`, PASS_FILE);
  if (flags[0]) return flags[0];
  const terminal = ctx.terminal(args.json === true);
  if (!terminal) throw usageError("which config file? (no terminal to ask in)", PASS_FILE, "file_required");
  const choices = [
    { value: "user", label: `user (${CONFIG_FILES.user}): this machine, your defaults` },
    { value: "local", label: `local (${CONFIG_FILES.local}): you, in this repo` },
    { value: "repo", label: `repo (${CONFIG_FILES.repo}): the team's, committed` },
  ];
  const picked = await terminal.pick(`${verb} which file?`, choices, 0);
  if (!picked) throw refuse("Nothing picked", null, "cancelled");
  return picked as ConfigLayerName;
}

function edit(ctx: Context, file: ConfigLayerName, key: string, change: { set: string } | { unset: true }) {
  const r = editConfigLayer({ repoRoot: ctx.root, home: ctx.home, file, key, edit: change });
  if (!r.ok) throw refuse(r.error, r.code === "config_wrong_file" ? inRightFile(key, change) : cmd.config(), r.code);
  return r;
}

/** D4: the same edit in the file that takes the key, so the refusal says where it goes. */
function inRightFile(key: string, change: { set: string } | { unset: true }): string {
  const right = (["user", "local", "repo"] as const).find((f) => configKeyProblem(f, key) === null);
  if (!right) return cmd.config();
  const value = "set" in change ? ` ${/^[\w.:/@-]+$/.test(change.set) ? change.set : JSON.stringify(change.set)}` : "";
  return `norn config ${"set" in change ? "set" : "unset"} ${key}${value} --${right}`;
}

const shown = (ctx: Context, path: string) => (path.startsWith(ctx.root) ? relative(ctx.root, path) : path);
