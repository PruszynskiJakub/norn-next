/**
 * `norn inbox [--text]` (O1): what needs a person, grouped by action — Your turn, Answer,
 * Approve, Unblock, Unclaimed, Running, Recently done — each item with its reason, age and the
 * exact command that resolves it. Read only via @norn/view (X1); JSON unless `--text`.
 */
import { defineCommand, opt } from "../command.ts";
import { textOutput } from "../output.ts";
import { projectView } from "../runtime/human.ts";
import { formatInbox } from "@norn/view";

export const inboxCommand = defineCommand({
  name: "inbox",
  summary: "What needs you, grouped by action, with the command to resolve each item (O1)",
  usage: "norn inbox [--text]",
  options: { text: { type: "boolean" } },
  async run(ctx, args) {
    const view = await projectView(ctx);
    if (opt.bool(args, "text")) return textOutput(formatInbox(view));
    return view.inbox;
  },
});
