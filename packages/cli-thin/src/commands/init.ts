/**
 * `norn init [--tracker <name>] [--forge <name>] [--store <name>] [--executor <harness>] [--runner <name>] [--commit] [--yes]`: set up norn in this repo: detect the tracker, forge and executor, write the config, run doctor.
 * Writes the repo-local config (or the committed one with `--commit`), keeps `.agents/` out of git
 * unless committed, prints what it chose and runs doctor. It never asks: every choice is detected or
 * given as a flag (`init.ts`). The choices are resolved against the bundled and installed plugins
 * before anything is written, so a name no plugin provides is refused with nothing changed; a config
 * file already there is never overwritten, though one holding only what `norn plugin add` wrote is
 * completed, so a plugin that provides a choice can be added first.
 */
import { join } from "node:path";
import { defineCommand, opt } from "../command.ts";
import { configError, loadConfig, mergeConfig, parseLayer } from "../config/load.ts";
import { AGENTS_DIR, configPaths, type Layer, layerFileName, REPO_COMMITTED_FILE, REPO_LOCAL_FILE } from "../config/paths.ts";
import { CliContext } from "../context.ts";
import { doctorLines, runDoctor } from "../doctor.ts";
import { choose, completable, completedText, detect, initLayer, initText, withExcluded } from "../init.ts";
import { refuse, rendered } from "../output.ts";
import { wirePlugins } from "../wiring.ts";

export const initCommand = defineCommand({
  name: "init",
  summary: "Set up norn in this repo: detect the tracker, forge and executor, write the config, run doctor",
  usage: "norn init [--tracker <name>] [--forge <name>] [--store <name>] [--executor <harness>] [--runner <name>] [--commit] [--yes]",
  options: {
    tracker: { type: "string" },
    forge: { type: "string" },
    store: { type: "string" },
    executor: { type: "string" },
    runner: { type: "string" },
    commit: { type: "boolean" },
    yes: { type: "boolean" },
  },
  optionHelp: {
    "--tracker <name>": "the tracker plugin (detected: github when origin is on GitHub and gh is present, else local)",
    "--forge <name>": "the forge plugin (detected: github with the github tracker, else none)",
    "--store <name>": "where run state lives (default local)",
    "--executor <harness>": "the default executor's harness (detected: claude when it is on PATH)",
    "--runner <name>": "where agents run (default headless; herdr when inside herdr and asked)",
    "--commit": `write the committed config (${REPO_COMMITTED_FILE}, team mode) instead of the repo-local one (${REPO_LOCAL_FILE})`,
    "--yes": "take every detected choice without asking",
  },
  async run(ctx, args) {
    const w = await ctx.repo();
    const files = w.ctx.files;
    const commit = opt.bool(args, "commit");
    const layer: Layer = commit ? "repo" : "local";
    const paths = configPaths(w.home, w.repo.root);
    const current = await files.read(paths[layer]);
    const existing = current === null ? null : parseLayer(layer, current);
    if (current !== null && !(existing?.ok && completable(existing.value)))
      throw refuse(`norn is set up here already: ${layerFileName(layer)} exists`, "norn doctor, or norn config set <key> <value>", "already_initialized", { file: paths[layer] });

    const detected = await detect(w.ctx, ctx.env, w.repo.root);
    const flags = { tracker: opt.str(args, "tracker"), forge: opt.str(args, "forge"), store: opt.str(args, "store"), executor: opt.str(args, "executor"), runner: opt.str(args, "runner"), yes: opt.bool(args, "yes") };
    const { choices, offered } = choose(detected, flags);
    const doc = initLayer(choices);
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

    await files.write(paths[layer], text);
    let exclude: "added" | "present" | "committed" = "committed";
    if (!commit) {
      const path = join(w.repo.common, "info", "exclude");
      const next = withExcluded(await files.read(path), AGENTS_DIR);
      if (next !== null) await files.write(path, next);
      exclude = next === null ? "present" : "added";
    }

    // a fresh context: this one may hold the "no config" it saw before the file was written
    const doctor = await runDoctor(new CliContext(ctx.io));
    const value = { root: w.repo.root, file: paths[layer], layer, team: commit, chose: choices, detected, offered, exclude, doctor };
    const md = [
      `# norn init in ${w.repo.root}`,
      "",
      `Wrote ${layerFileName(layer)}${commit ? " (team mode: commit it)" : ""}.`,
      "",
      `- tracker: ${choices.tracker}${flags.tracker ? "" : detected.github ? (detected.gh ? " (origin is on GitHub)" : " (origin is on GitHub, but gh is not installed)") : " (no GitHub origin)"}`,
      `- forge: ${choices.forge}`,
      `- store: ${choices.store}`,
      `- executor: ${choices.executor} in ${choices.runner}${flags.executor || detected.claude ? "" : " (claude is not on PATH)"}`,
      `- base: ${choices.base}`,
      `- .git/info/exclude: ${exclude === "added" ? `added ${AGENTS_DIR}` : exclude === "present" ? `${AGENTS_DIR} already there` : "untouched (team mode)"}`,
      ...offered.map((o) => `- offered: this shell runs inside ${o}; norn config set executors.${choices.executor}.runner ${o} runs agents in its panes`),
      "",
      `## norn doctor: ${doctor.ok ? "all checks pass" : "some checks fail"}`,
      "",
      ...doctorLines(doctor),
    ].join("\n");
    return rendered(value, md);
  },
});
