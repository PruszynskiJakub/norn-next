/**
 * Installing a plugin and pinning it: the lock entry (name, spec, version, API range) and the spec
 * under `plugins.<name>` in the config (the committed one in team mode), so a teammate without it is
 * told what to add. A plugin written for another plugin API is refused before anything is pinned.
 */
import { PLUGIN_API_VERSION } from "@norn/plugin-api";
import { setConfigKey } from "../config/set.ts";
import type { CliContext } from "../context.ts";
import { refuse, rendered } from "../output.ts";
import { bundledNames } from "./bundled.ts";
import { providesOf, providesText } from "./describe.ts";
import { installPlugin, repoLock } from "./install.ts";
import { loadInstalled } from "./installed.ts";
import { effectsText, writeAccepted } from "./accepted.ts";
import { type LockEntry, withEntry, writeLock } from "./lock.ts";

/** Install `spec`, check it loads on this plugin API, and pin it; `plugin update` runs the same. */
export async function pinPlugin(ctx: CliContext, spec: string, verb: "add" | "update") {
  const r = await repoLock(ctx);
  const got = await installPlugin(ctx, spec);
  const bundled = bundledNames();
  const pending: LockEntry = { name: got.name, spec: got.spec, version: got.version, api: "*" };
  const load = await loadInstalled(pending, r.pluginsDir, ctx.io.importer, PLUGIN_API_VERSION);
  if (!load.ok) {
    if (load.reason === "api")
      throw refuse(
        load.message,
        `norn plugin add ${got.name}@<a version written for plugin API ${PLUGIN_API_VERSION}>${verb === "update" ? `, or norn plugin remove ${got.name}` : ""}`,
        "plugin_api",
        { plugin: got.name, wants: load.api, implements: PLUGIN_API_VERSION },
      );
    throw refuse(load.message, `norn plugin add <the spec of a norn plugin package>`, load.reason === "missing" ? "plugin_missing" : "plugin_invalid", { plugin: got.name });
  }
  if (bundled.includes(got.name) || bundled.includes(load.plugin.name))
    throw refuse(`plugin ${load.plugin.name} is bundled with norn`, "norn plugin list", "plugin_bundled", { plugin: load.plugin.name });
  const entry: LockEntry = { ...pending, api: load.plugin.api };
  // the config first: a config file norn cannot write refuses before the lock pins anything
  const config = await setConfigKey(r.w.ctx.files, r.paths, r.team ? "repo" : "local", `plugins.${entry.name}`, entry.spec);
  await writeLock(r.w.ctx.files, r.path, withEntry(r.lock, entry));
  // the person running add or update accepts the effects its kinds declare now, and the floor reads them
  const accepted = await writeAccepted(r.w.ctx.files, r.w.home, entry, load.plugin);
  const provides = providesOf(load.plugin);
  const value = { ...entry, plugin: load.plugin.name, provides, effects: accepted.effects, lock: r.path, config: config.file, team: r.team };
  return rendered(
    value,
    `${verb === "add" ? "Added" : "Updated"} ${entry.name} ${entry.version} (plugin API ${entry.api}), pinned in ${r.path}.\nProvides ${providesText(provides)}.\nIts step kinds' effects, accepted: ${effectsText(accepted.effects)}.`,
  );
}
