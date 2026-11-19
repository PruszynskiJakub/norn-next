/**
 * `norn init [--tracker <name>] [--forge <name>] [--store <name>] [--executor <harness>] [--runner <name>] [--mode auto|manual] [--commit] [--yes]`: set up norn in this repo: detect the tracker, forge and executor, write the config, run doctor.
 * Writes the repo-local config (or the committed one with `--commit`), keeps `.agents/` out of git
 * unless committed, prints what it chose and runs doctor. It never asks: every choice is detected or
 * given as a flag (`init.ts`). The choices are resolved against the bundled and installed plugins
 * before anything is written, so a name no plugin provides is refused with nothing changed; a config
 * file already there is never overwritten, though one holding only what `norn plugin add` wrote is
 * completed, so a plugin that provides a choice can be added first. The old norn's team config, when
 * the repo still holds it, gives the keys it can map (migrate.ts) and init says which it ignored.
 */
import { join } from "node:path";
import type { HostFiles } from "@norn/plugin-api";
import { defineCommand, opt } from "../command.ts";
import { configError, loadConfig, mergeConfig, parseLayer } from "../config/load.ts";
import { mapOldConfig, type OldConfig } from "../config/migrate.ts";
import { isOldUserConfig, mapOldUserConfig, OLD_USER_BACKUP_SUFFIX, type OldUserConfig, oldUserConfigText } from "../config/migrate-user.ts";
import { AGENTS_DIR, configPaths, type Layer, layerFileName, OLD_REPO_CONFIG_FILE, REPO_COMMITTED_FILE, REPO_LOCAL_FILE } from "../config/paths.ts";
import type { ConfigLayer } from "../config/schema.ts";
import { CliContext } from "../context.ts";
import { doctorLines, runDoctor } from "../doctor.ts";
import { choose, completable, completedText, detect, detectTestCommand, initLayer, initText, offerLine, testLine, withExcluded } from "../init.ts";
import { refuse, rendered, usageError } from "../output.ts";
import { wirePlugins } from "../wiring.ts";

/** The old config's workflow choices, which init's own layer has no detection for. */
function withOldKernelKeys(layer: ConfigLayer, old: OldConfig | null): ConfigLayer {
  if (!old?.workflow && !old?.slice_workflow) return layer;
  return { ...layer, kernel: { ...layer.kernel, ...(old.workflow && { workflow: old.workflow }), ...(old.slice_workflow && { slice_workflow: old.slice_workflow }) } };
}

function oldConfigLines(old: OldConfig): string[] {
  const list = (keys: string[]) => (keys.length > 0 ? keys.join(", ") : "none");
  return [
    `- ${OLD_REPO_CONFIG_FILE} (the old norn's config): took ${list(old.mapped)}; ignored ${list(old.ignored)}`,
    ...old.notes.map((n) => `- ${n}`),
    `- this norn never reads ${OLD_REPO_CONFIG_FILE}: delete it once the new config holds what you need`,
  ];
}

/**
 * The old norn's user config rewritten in this norn's keys, the old text kept beside it under a name
 * not yet taken. Done first and on its own: it is the machine's file, not this repo's, and every
 * command refuses until it is rewritten, a repo already set up included.
 */
async function migrateOldUserConfig(files: HostFiles, path: string): Promise<(OldUserConfig & { backup: string }) | null> {
  const text = await files.read(path);
  if (text === null || !isOldUserConfig(text)) return null;
  const m = mapOldUserConfig(text);
  let backup = `${path}${OLD_USER_BACKUP_SUFFIX}`;
  for (let n = 2; (await files.read(backup)) !== null; n++) backup = `${path}${OLD_USER_BACKUP_SUFFIX}-${n}`;
  // the old text is kept before the file is rewritten, so a crash between the two loses nothing
  await files.write(backup, text);
  await files.write(path, oldUserConfigText(m, backup.split("/").pop() ?? backup));
  return { ...m, backup };
}

function oldUserConfigLines(m: OldUserConfig & { backup: string }): string[] {
  const list = (keys: string[]) => (keys.length > 0 ? keys.join(", ") : "none");
  return [
    `- ${layerFileName("user")} was the old norn's user config: rewrote it, the old text kept as ${m.backup}`,
    `  - took ${list(m.mapped)}`,
    ...m.ignored.map((i) => `  - ignored ${i}`),
  ];
}

export const initCommand = defineCommand({
  name: "init",
  summary: "Set up norn in this repo: detect the tracker, forge and executor, write the config, run doctor",
  usage: "norn init [--tracker <name>] [--forge <name>] [--store <name>] [--executor <harness>] [--runner <name>] [--mode auto|manual] [--commit] [--yes]",
  options: {
    tracker: { type: "string" },
    forge: { type: "string" },
    store: { type: "string" },
    executor: { type: "string" },
    runner: { type: "string" },
    mode: { type: "string" },
    commit: { type: "boolean" },
    yes: { type: "boolean" },
  },
  optionHelp: {
    "--tracker <name>": "the tracker plugin (detected: github when origin is on GitHub and gh is present, else local)",
    "--forge <name>": "the forge plugin (detected: github with the github tracker, else none)",
    "--store <name>": "where run state lives (default local)",
    "--executor <harness>": "the default executor's harness (detected: claude when it is on PATH, else pi when it is)",
    "--runner <name>": "where agents run (default headless; herdr when inside herdr and asked)",
    "--mode auto|manual": "how agent steps start: auto on their own, manual when a person runs norn run start (default auto with the headless runner, else manual)",
    "--commit": `write the committed config (${REPO_COMMITTED_FILE}, team mode) instead of the repo-local one (${REPO_LOCAL_FILE})`,
    "--yes": "take every detected choice without asking",
  },
  async run(ctx, args) {
    const w = await ctx.repo();
    const files = w.ctx.files;
    const commit = opt.bool(args, "commit");
    const layer: Layer = commit ? "repo" : "local";
    const paths = configPaths(w.home, w.repo.root);
    const userMigrated = await migrateOldUserConfig(files, paths.user);
    const current = await files.read(paths[layer]);
    const existing = current === null ? null : parseLayer(layer, current);
    if (current !== null && !(existing?.ok && completable(existing.value))) {
      // set up already, but its user config was the old norn's: rewriting that was the work to do
      if (userMigrated)
        return rendered(
          { root: w.repo.root, user_migrated: { file: paths.user, ...userMigrated } },
          [`# norn init in ${w.repo.root}`, "", `${layerFileName(layer)} exists already; left as it is.`, "", ...oldUserConfigLines(userMigrated)].join("\n"),
        );
      throw refuse(`norn is set up here already: ${layerFileName(layer)} exists`, "norn doctor, or norn config set <key> <value>", "already_initialized", { file: paths[layer] });
    }

    const given = opt.str(args, "mode");
    if (given !== undefined && given !== "auto" && given !== "manual") throw usageError(`--mode ${given}: the mode is auto or manual`, "norn init --mode auto, or norn init --mode manual");

    // the old norn's team config, when the repo still has it: its keys win over detection, a flag over both
    const oldText = await files.read(join(w.repo.root, OLD_REPO_CONFIG_FILE));
    const old = oldText === null ? null : mapOldConfig(oldText);
    const mode: "auto" | "manual" | undefined = given ?? old?.mode;
    const detected = await detect(w.ctx, ctx.env, w.repo.root);
    const flags = {
      tracker: opt.str(args, "tracker") ?? old?.tracker,
      forge: opt.str(args, "forge") ?? old?.forge,
      store: opt.str(args, "store"),
      executor: opt.str(args, "executor"),
      runner: opt.str(args, "runner"),
      ...(mode !== undefined && { mode }),
      yes: opt.bool(args, "yes"),
    };
    const { choices, offered } = choose(old?.base ? { ...detected, base: old.base } : detected, flags);
    const test = await detectTestCommand(files, w.repo.root);
    const doc = withOldKernelKeys(initLayer(choices, test), old);
    const text = current !== null && existing?.ok && existing.value ? completedText(current, existing.value, doc) : initText(doc);

    // checked as the next command will load it, with the other files, before a byte is written
    const before = await loadConfig(files, paths);
    const layers = before.ok ? before.value.layers : before.layers;
    if (!before.ok && before.problems.some((p) => p.layer !== "merged")) throw configError(before.problems, layers, paths);
    const own = parseLayer(layer, text);
    if (!own.ok) throw configError(own.problems, { ...layers, [layer]: {} }, paths);
    const merged = mergeConfig({ ...layers, [layer]: own.value }, paths);
    if (!merged.ok) throw configError(merged.problems, { ...layers, [layer]: {} }, paths);
    await wirePlugins(w, merged.value, ctx.io.importer);

    // a team that commits .agents/ keeps its specs and workflows there: hiding the folder would hide them from git
    const excluded = (await files.read(paths.repo)) === null ? AGENTS_DIR : REPO_LOCAL_FILE;
    await files.write(paths[layer], text);
    let exclude: "added" | "present" | "committed" = "committed";
    if (!commit) {
      const path = join(w.repo.common, "info", "exclude");
      const next = withExcluded(await files.read(path), excluded);
      if (next !== null) await files.write(path, next);
      exclude = next === null ? "present" : "added";
    }

    // a fresh context: this one may hold the "no config" it saw before the file was written
    const doctor = await runDoctor(new CliContext(ctx.io));
    const migrated = old && { file: OLD_REPO_CONFIG_FILE, mapped: old.mapped, ignored: old.ignored, notes: old.notes };
    const value = {
      root: w.repo.root,
      file: paths[layer],
      layer,
      team: commit,
      chose: choices,
      detected,
      offered,
      test,
      exclude,
      ...(!commit && { excluded }),
      ...(migrated && { migrated }),
      ...(userMigrated && { user_migrated: { file: paths.user, ...userMigrated } }),
      doctor,
    };
    const md = [
      `# norn init in ${w.repo.root}`,
      "",
      `Wrote ${layerFileName(layer)}${commit ? " (team mode: commit it)" : ""}.`,
      "",
      `- tracker: ${choices.tracker}${flags.tracker ? "" : detected.github ? (detected.gh ? " (origin is on GitHub)" : " (origin is on GitHub, but gh is not installed)") : " (no GitHub origin)"}`,
      `- forge: ${choices.forge}`,
      `- store: ${choices.store}`,
      `- executor: ${choices.executor} in ${choices.runner}${flags.executor || (choices.executor === "pi" ? detected.pi : detected.claude) ? "" : ` (${choices.executor} is not on PATH)`}`,
      `- mode: ${choices.mode}${flags.mode ? "" : choices.mode === "auto" ? ` (the ${choices.runner} runner has nobody beside the agent: agent steps start on their own)` : ` (agents run in ${choices.runner} beside a person: start each agent step with norn run start <unit>)`}`,
      `- base: ${choices.base}`,
      testLine(test),
      `- .git/info/exclude: ${exclude === "added" ? `added ${excluded}` : exclude === "present" ? `${excluded} already there` : "untouched (team mode)"}`,
      ...offered.map((o) => offerLine(o, choices)),
      ...(old ? oldConfigLines(old) : []),
      ...(userMigrated ? oldUserConfigLines(userMigrated) : []),
      "",
      `## norn doctor: ${doctor.ok ? "all checks pass" : "some checks fail"}`,
      "",
      ...doctorLines(doctor),
    ].join("\n");
    return rendered(value, md);
  },
});
