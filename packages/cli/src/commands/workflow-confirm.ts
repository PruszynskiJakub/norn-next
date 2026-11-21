/**
 * `norn workflow confirm <name>`: confirm a repo workflow held because its change touches a person's
 * step, `attended:` or `allow:`. The revision it loads to now is kept in the machine dir, outside every
 * worktree, and new rounds run it from the next tick; a later change is weighed against it. A person's
 * command: confirming is how the person sees what an agent may have changed in a file it can edit.
 */
import { confirmedWorkflowPath } from "@norn/runtime";
import { defineCommand } from "../command.ts";
import { rendered } from "../output.ts";
import { workflowRefusal } from "./person-support.ts";

export const workflowConfirmCommand = defineCommand({
  name: "workflow confirm",
  personOnly: true,
  summary: "Confirm a repo workflow held because it changes a person's step, attended: or allow:",
  usage: "norn workflow confirm <name>",
  positionals: { min: 1, max: 1 },
  async run(ctx, args) {
    const name = args.positionals[0] as string;
    const env = await ctx.runtimeEnv();
    const held = env.held[name];
    if (!held) {
      const refused = workflowRefusal(env, name);
      if (refused) throw refused;
      return rendered({ workflow: name, confirmed: false }, `Nothing to confirm: workflow ${name} runs as its file says.`);
    }
    const w = await ctx.repo();
    await w.ctx.files.write(confirmedWorkflowPath(w.machine, name), `${JSON.stringify(held.current.pinned, null, 2)}\n`);
    const value = { workflow: name, confirmed: true, hash: held.current.pinned.hash, changes: held.changes };
    return rendered(value, `Confirmed workflow ${name}; new rounds run it from the next tick:\n${held.changes.map((c) => `- ${c}`).join("\n")}`);
  },
});
