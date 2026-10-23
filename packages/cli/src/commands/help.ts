/** `norn help`: the command list as JSON. */
import { defineCommand } from "../command.ts";

export const helpCommand = defineCommand({
  name: "help",
  summary: "List commands",
  usage: "norn help [command]",
  positionals: { max: 1 },
  repo: false,
  async run(_ctx, args) {
    // imported lazily: the registry imports this file
    const { COMMANDS, findCommand } = await import("./index.ts");
    const { helpFor } = await import("../cli.ts");
    const name = args.positionals[0];
    const c = name ? findCommand(name) : undefined;
    return c ? helpFor(c) : { commands: COMMANDS.map(helpFor) };
  },
});
