/**
 * `norn orient <story|unit> [--open] [--json]`: one story at a glance for a person and the agent
 * that sits with them (@norn/view orientReport, X1) — read only: no receipt, run or claim. Markdown
 * by default, `--json` for data (P8).
 *
 * `--open` gives the story an orient workspace in Herdr: it focuses the workspace labelled
 * `<story> orient` when one exists, else creates it in the story worktree with an agent told to run
 * `norn orient <key>` and follow it. The agent runs with `NORN_ORIENT=1`, so its hooks are no facts
 * of a run and `brief`/`done`/`ask`/`stuck` refuse it. Outside Herdr it prints the command.
 */
import { startAgentCommand } from "@norn/core";
import type { ResolvedConfig } from "@norn/schema";
import { formatOrient, orientReport } from "@norn/view";
import { defineCommand, opt } from "../command.ts";
import { refuse, rendered } from "../output.ts";
import { ORIENT_ENV } from "../runtime/agent-unit.ts";
import { cockpitHerdr } from "../runtime/cockpit.ts";
import { parseUnitKey, projectView } from "../runtime/human.ts";

/** Label of a story's orient workspace in Herdr. */
export const orientLabel = (story: string) => `${story} orient`;

/** The orient agent: the default agent with its configured args, its first prompt `norn orient <key>`. */
export function orientAgentCommand(config: ResolvedConfig, key: string): string {
  const name = config.default_agent;
  const agent = config.agents[name];
  return `${ORIENT_ENV}=1 ${startAgentCommand(null, agent?.command ?? agent?.adapter ?? name, agent?.args, `Run \`norn orient ${key}\` and follow it.`)}`;
}

export const orientCommand = defineCommand({
  name: "orient",
  summary: "One story at a glance: slices, PR, open notes, what waits for you; --open gives it a Herdr workspace with an agent",
  usage: "norn orient <story|unit> [--open] [--json]",
  markdown: true,
  options: { open: { type: "boolean" } },
  positionals: { min: 1, max: 1 },
  async run(ctx, args) {
    const { key, story } = parseUnitKey(args.positionals[0] as string);
    const report = orientReport(await projectView(ctx), key, ctx.config.remote.provider);
    if (!report) throw refuse(`unknown story ${story}`, "norn status", "unknown_unit");
    if (!opt.bool(args, "open")) return rendered(report, formatOrient(report, ctx.clock.now()));

    const label = orientLabel(story);
    const command = orientAgentCommand(ctx.config, key);
    const cockpit = cockpitHerdr(ctx);
    if (!cockpit) {
      const by = `cd ${report.root} && ${command}`;
      return rendered({ story, opened: false, command: by }, `Not inside Herdr. Start the orient agent yourself:\n\n    ${by}\n`);
    }
    const existing = (await cockpit.listWorkspaces()).find((w) => w.label === label);
    if (existing) {
      await cockpit.focusWorkspace(existing.workspace_id);
      return rendered({ story, opened: true, created: false, workspace_id: existing.workspace_id }, `Focused workspace ${label}.`);
    }
    const ws = await cockpit.openWorkspace(report.root, label, command);
    return rendered({ story, opened: true, created: true, workspace_id: ws.workspace_id, pane_id: ws.pane_id, command }, `Opened workspace ${label} with an orient agent.`);
  },
});
