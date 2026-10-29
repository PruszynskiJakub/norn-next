/**
 * `norn story list [--json]` (B15, §15, MO2): stories, slices, runs and recently done units from
 * @norn/view (X1), the table `norn status` printed before; `--json` gives the same value it did (B70).
 */
import { formatStatus } from "@norn/view";
import { defineCommand } from "../command.ts";
import { rendered } from "../output.ts";
import { projectView } from "../runtime/human.ts";

export const storyListCommand = defineCommand({
  name: "story list",
  summary: "Stories, slices, runs and claims at a glance",
  usage: "norn story list [--json]",
  markdown: true,
  async run(ctx) {
    const view = await projectView(ctx);
    const { timeline: _timeline, ...rest } = view;
    return rendered(rest, formatStatus(view));
  },
});
