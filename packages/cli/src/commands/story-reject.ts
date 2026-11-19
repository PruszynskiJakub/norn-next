/**
 * `norn story reject <key> --reason <text> [--gate <step>]`: reject the gate a story waits at, with the reason the next attempt gets.
 * Records a `gate.decided` receipt through the journal, or sends it to the machine holding the story.
 */
import { defineCommand } from "../command.ts";
import { decideGate } from "./gate-support.ts";

export const storyRejectCommand = defineCommand({
  name: "story reject",
  acts: true,
  summary: "Reject the gate a story waits at, with the reason the next attempt gets",
  usage: "norn story reject <key> --reason <text> [--gate <step>]",
  options: {
    gate: { type: "string" },
    reason: { type: "string" },
  },
  optionHelp: {
    "--gate <step>": "the gate step, when the story waits on several",
    "--reason <text>": "required: what failed; the agent sent back gets it",
  },
  positionals: { min: 1, max: 1 },
  async run(ctx, args) {
    return decideGate(ctx, args, "reject");
  },
});
