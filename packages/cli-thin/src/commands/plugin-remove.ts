/**
 * `norn plugin remove <name>`: unpin an installed plugin from this repo's lock, and drop its
 * `plugins.<name>` from whichever config file names it. The package stays in the plugins folder,
 * which other repos on this machine may pin. A plugin the config still picks a slot from is refused,
 * naming the key to change first: unpinning it would leave every command refusing.
 */
import { PLUGIN_API_VERSION } from "@norn/plugin-api";
import { defineCommand } from "../command.ts";
import { loadConfig } from "../config/load.ts";
import { getKey } from "../config/merge.ts";
import { LAYERS } from "../config/paths.ts";
import { setConfigKey } from "../config/set.ts";
import { refuse, rendered } from "../output.ts";
import { repoLock } from "../plugins/install.ts";
import { loadInstalled } from "../plugins/installed.ts";
import { withoutEntry, writeLock } from "../plugins/lock.ts";
import { picks } from "../plugins/resolve.ts";

export const pluginRemoveCommand = defineCommand({
  name: "plugin remove",
  summary: "Unpin an installed plugin from this repo's lock",
  usage: "norn plugin remove <name>",
  positionals: { min: 1, max: 1 },
  async run(ctx, args) {
    const name = args.positionals[0] as string;
    const r = await repoLock(ctx);
    const entry = r.lock.plugins.find((e) => e.name === name);
    if (!entry) throw refuse(`plugin ${name} is not in this repo's lock`, "norn plugin list", "plugin_not_installed", { plugin: name });
    // a plugin that no longer loads cannot be what a slot resolves to, so only a loading one is checked
    const load = await loadInstalled(entry, r.pluginsDir, ctx.io.importer, PLUGIN_API_VERSION);
    const loaded = await loadConfig(r.w.ctx.files, r.paths);
    if (load.ok && loaded.ok) {
      const used = picks(loaded.value.config).filter((p) => (load.plugin.provides[p.slot] as Record<string, unknown> | undefined)?.[p.name] !== undefined);
      const first = used[0];
      if (first)
        throw refuse(`the config picks ${used.map((u) => `${u.noun} ${u.name}`).join(", ")} from plugin ${name}`, `norn config set ${first.at} <another ${first.noun}>`, "plugin_in_use", {
          plugin: name,
          used: used.map((u) => u.at),
        });
    }
    const files = r.w.ctx.files;
    const key = `plugins.${name}`;
    const unset: string[] = [];
    for (const layer of LAYERS) {
      const doc = loaded.ok ? loaded.value.layers[layer] : loaded.layers[layer];
      if (getKey(doc, key) === undefined) continue;
      unset.push((await setConfigKey(files, r.paths, layer, key, undefined)).file);
    }
    await writeLock(files, r.path, withoutEntry(r.lock, name));
    return rendered({ name, lock: r.path, config: unset }, `Removed ${name} from ${r.path}${unset.length ? ` and ${unset.join(", ")}` : ""}.`);
  },
});
