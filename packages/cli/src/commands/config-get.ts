/**
 * `norn config get <key>`: print one config key of the merged config, and which file set it.
 * Dotted keys, as `tracker.intake.label`. A key no file and no default sets is refused, so a script
 * never reads an absent key as an empty value.
 */
import { stringify } from "yaml";
import { defineCommand } from "../command.ts";
import { getKey } from "../config/merge.ts";
import { LAYERS } from "../config/paths.ts";
import { refuse, rendered } from "../output.ts";

export const configGetCommand = defineCommand({
  name: "config get",
  summary: "Print one config key of the merged config",
  usage: "norn config get <key>",
  positionals: { min: 1, max: 1 },
  async run(ctx, args) {
    const key = args.positionals[0] as string;
    const loaded = await ctx.config();
    const value = getKey(loaded.config, key);
    if (value === undefined) throw refuse(`config key ${key} is not set`, "norn config show", "config_key_unset", { key });
    const text = typeof value === "object" && value !== null ? stringify(value).trimEnd() : String(value);
    // the highest layer holding the key wins the merge, so it is the one to edit
    const source = [...LAYERS].reverse().find((l) => getKey(loaded.layers[l], key) !== undefined);
    return rendered({ key, value, ...(source ? { source, file: loaded.paths[source] } : { source: "default" }) }, text);
  },
});
