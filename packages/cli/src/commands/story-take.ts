/**
 * `norn story take <story>` (GR1, SPEC-cockpit CP4): assign an open issue carrying the intake label to the
 * person, so the next sync takes it in. Assigning is how the person chooses when intake takes an issue in
 * (GR1, GR2 starts it at once); this is the cockpit backlog's take on an issue row. It writes nothing
 * locally and takes nothing in itself.
 */
import { cmd } from "@norn/core";
import { parseStoryKey } from "@norn/schema";
import { defineCommand } from "../command.ts";
import { CliFailure, failure, refuse, rendered, usageError } from "../output.ts";
import { projectView } from "../runtime/human.ts";

export const storyTakeCommand = defineCommand({
  name: "story take",
  summary: "Assign a labelled issue to you, so the next sync takes it in (GR1)",
  usage: "norn story take <story>",
  markdown: true,
  positionals: { max: 1 },
  async run(ctx, args) {
    const raw = args.positionals[0];
    const provider = ctx.config.remote.provider;
    const parts = raw ? parseStoryKey(raw) : null;
    if (!raw || !parts || parts.provider !== provider) throw usageError(`name the issue's story key${raw ? `, not '${raw}'` : ""} (e.g. ${provider === "gh" ? "gh" : "gl"}-123)`, cmd.storyTake("<story>"));
    const key = raw;
    const label = ctx.config.remote.label;
    if ((await projectView(ctx)).stories.some((s) => s.key === key)) throw refuse(`${key} is taken in already`, cmd.storyView(key), "taken_in");
    const remote = (await ctx.ports()).remote;
    if (!remote) throw refuse("no remote is configured", cmd.doctor(), "no_remote");
    const remoteFailed = (e: unknown) => failure(`the remote failed: ${(e as Error).message}`, cmd.doctor(), "remote_failed");
    try {
      const issue = await remote.getIssue(parts.number);
      if (!issue) throw refuse(`no issue #${parts.number} on the remote`, cmd.status(), "no_issue");
      if (issue.state !== "open") throw refuse(`issue #${parts.number} is closed`, `reopen it on the remote first: ${issue.url}`, "issue_closed");
      // GR1: intake lists only issues with the label
      if (!issue.labels.includes(label)) throw refuse(`issue #${parts.number} has no '${label}' label, so intake would not take it in`, `add the '${label}' label: ${issue.url}`, "not_labelled");
      const me = await remote.whoami();
      if (!issue.assignees.includes(me)) await remote.assignIssue(parts.number, me);
      const value = { story: key, number: parts.number, url: issue.url, assignee: me };
      return rendered(value, `${key}\n\nAssigned ${issue.url} to ${me}; the next sync takes it in (\`${cmd.sync()}\` to do it now).\n`);
    } catch (e) {
      if (e instanceof CliFailure) throw e; // a refusal above
      throw remoteFailed(e);
    }
  },
});
