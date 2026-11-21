/**
 * `norn plugin update <name>`: update an installed plugin to the newest version its spec allows.
 * Re-runs the install of the spec the lock keeps (a local path is linked again and its version
 * read again), checks the API range again, and re-pins. A bundled plugin updates with norn itself.
 */
import { defineCommand } from "../command.ts";
import { refuse } from "../output.ts";
import { bundledNames } from "../plugins/bundled.ts";
import { repoLock } from "../plugins/install.ts";
import { pinPlugin } from "../plugins/pin.ts";

export const pluginUpdateCommand = defineCommand({
  // the effects its step kinds declare are accepted here, which is a person's to do
  personOnly: true,
  name: "plugin update",
  summary: "Update an installed plugin to the newest version its spec allows",
  usage: "norn plugin update <name>",
  positionals: { min: 1, max: 1 },
  async run(ctx, args) {
    const name = args.positionals[0] as string;
    if (bundledNames().includes(name)) throw refuse(`plugin ${name} is bundled: it updates with norn itself`, "upgrade norn", "plugin_bundled", { plugin: name });
    const { lock } = await repoLock(ctx);
    const entry = lock.plugins.find((e) => e.name === name);
    if (!entry) throw refuse(`plugin ${name} is not in this repo's lock`, "norn plugin list", "plugin_not_installed", { plugin: name });
    return pinPlugin(ctx, entry.spec, "update");
  },
});
