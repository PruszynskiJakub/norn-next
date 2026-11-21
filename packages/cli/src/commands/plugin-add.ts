/**
 * `norn plugin add <spec>`: install a plugin (npm spec, git URL or local path) and pin it in the lock.
 * Runs `bun add <spec>` in <norn home>/plugins (or links a local path), checks the plugin's API range,
 * then records name, spec, version and range in the lock (`plugins/pin.ts`).
 */
import { defineCommand } from "../command.ts";
import { pinPlugin } from "../plugins/pin.ts";

export const pluginAddCommand = defineCommand({
  name: "plugin add",
  summary: "Install a plugin (npm spec, git URL or local path) and pin it in the lock",
  usage: "norn plugin add <spec>",
  positionals: { min: 1, max: 1 },
  // the effects its step kinds declare are accepted here, which is a person's to do
  personOnly: true,
  async run(ctx, args) {
    return pinPlugin(ctx, args.positionals[0] as string, "add");
  },
});
