/**
 * `norn story view [<story|slice>] [--web] [--json]`: one story at a glance — its
 * slices with their workflow and step, the PR and its state, open notes, what waits for the person
 * (@norn/view orientReport). Read only: no receipt, run or claim. Markdown by default, `--json`
 * for data: the orient report extended with the slice steps and PR state. In a slice worktree
 * it views that slice's story. The chat agent (`norn story chat`, `NORN_ORIENT=1`) sees its
 * rules first. `--web` opens the story's PR in the browser, or its issue when there is no PR. A story
 * another machine holds shows its claim, branch, PR and record.
 */
import { cmd } from "@norn/core";
import { formatElsewhere, formatStoryView, orientReport } from "@norn/view";
import { defineCommand, opt } from "../command.ts";
import { failure, refuse, rendered } from "../output.ts";
import { ORIENT_ENV } from "../runtime/agent-unit.ts";
import { parseUnitKey } from "../runtime/args.ts";
import { projectView } from "../runtime/human.ts";
import { openLink } from "../runtime/open-link.ts";
import { aStory, targetKey } from "../runtime/target.ts";

export const storyViewCommand = defineCommand({
  name: "story view",
  version: "reads",
  summary: "One story: slices with their steps, the PR, open notes, what waits for you; --web opens the PR or issue",
  usage: "norn story view [<story|slice>] [--web] [--json]",
  markdown: true,
  options: { web: { type: "boolean" } },
  positionals: { max: 1 },
  async run(ctx, args) {
    const raw = await targetKey(ctx, args.positionals[0], args.json === true, aStory("story view", cmd.storyView));
    const { key, story, slice } = parseUnitKey(raw);
    const view = await projectView(ctx);
    const report = orientReport(view, key, ctx.config.provider);
    // A story another machine holds, from its claim, branch and record ref as fetched last
    const elsewhere = report ? null : view.elsewhere.find((e) => e.key === story);
    if (elsewhere && !opt.bool(args, "web")) return rendered(elsewhere, formatElsewhere(elsewhere));
    if (!report) throw refuse(`unknown story ${story}`, cmd.status(), "unknown_unit");
    if (slice && !report.slices.some((s) => s.key === slice)) throw refuse(`no slice ${slice} in story ${story}`, cmd.storyView(story), "unknown_unit");
    if (!opt.bool(args, "web")) return rendered(report, formatStoryView(report, ctx.clock.now(), { rules: ctx.env[ORIENT_ENV] === "1" }));

    const url = report.pr?.url ?? report.url;
    if (!url) throw refuse(`${story} has no PR and no issue link to open`, report.pr_command, "no_url");
    const r = await openLink(ctx, url);
    if (r.code !== 0) throw failure(`could not open ${url}: ${r.stderr.trim().split("\n")[0] || `exit ${r.code}`}`, url, "open_failed");
    return rendered({ story, opened: url }, `Opened ${url}`);
  },
});
