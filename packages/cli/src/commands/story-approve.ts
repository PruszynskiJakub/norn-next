/**
 * `norn story approve <key> [--gate <step>] [--reason <text>]`: approve the gate a story waits at.
 * Records a `gate.decided` receipt through the journal, or sends it to the machine holding the story.
 */
import { defineCommand } from "../command.ts";
import { decideGate } from "./gate-support.ts";

export const storyApproveCommand = defineCommand({
  name: "story approve",
  acts: true,
  personOnly: true,
  summary: "Approve the gate a story waits at",
  usage: "norn story approve <key> [--gate <step>] [--reason <text>]",
  options: {
    gate: { type: "string" },
    reason: { type: "string" },
  },
  optionHelp: {
    "--gate <step>": "the gate step, when the story waits on several",
    "--reason <text>": "a comment kept on the decision",
  },
  positionals: { min: 1, max: 1 },
  async run(ctx, args) {
    return decideGate(ctx, args, "approve");
  },
});
