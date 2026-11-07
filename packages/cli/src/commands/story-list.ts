/**
 * `norn story list [--json]`: stories, slices, runs and recently done units from
 * @norn/view, as a table; `--json` for data.
 */
import { formatStatus } from "@norn/view";
import { defineCommand } from "../command.ts";
import { rendered } from "../output.ts";
import { projectView } from "../runtime/human.ts";

export const storyListCommand = defineCommand({
  name: "story list",
  version: "reads",
  summary: "Stories, slices, runs and claims at a glance",
  usage: "norn story list [--json]",
  markdown: true,
  async run(ctx) {
    const view = await projectView(ctx);
    return rendered(view, formatStatus(view));
  },
});
