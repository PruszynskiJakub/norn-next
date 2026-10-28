/**
 * `norn story chat [<story>] [--json]` (B29): gives a story its own Herdr workspace with an agent. It
 * focuses the workspace labelled `<story> orient` when one exists, else creates it in the story
 * worktree with an agent told to run `norn story view <story>` and follow it. The agent runs with
 * `NORN_ORIENT=1`, so its hooks are no facts of a run and `brief`/`done`/`ask`/`stuck` refuse it;
 * like a launched agent (R8.1) it runs the norn that opened it, first on PATH. Outside Herdr it
 * prints the command. In a slice worktree it acts on the slice's story (B55).
 */
import { join } from "node:path";
import { cmd, startAgentCommand } from "@norn/core";
import type { ResolvedConfig } from "@norn/schema";
import { orientReport } from "@norn/view";
import { defineCommand } from "../command.ts";
import { refuse, rendered } from "../output.ts";
import { ORIENT_ENV } from "../runtime/agent-unit.ts";
import { parseUnitKey } from "../runtime/args.ts";
import { cockpitHerdr } from "../runtime/cockpit.ts";
import { projectView } from "../runtime/human.ts";
import { isOrientWorkspace } from "../runtime/segment.ts";
import { ensureShim, nornEntry, withNornOnPath } from "../runtime/shim.ts";
import { aStory, resolveTarget } from "../runtime/target.ts";

/** The chat agent: the default agent with its configured args, its first prompt `norn story view <story>`. */
function chatAgentCommand(config: ResolvedConfig, story: string): string {
  const name = config.default_agent;
  const agent = config.agents[name];
  return `${ORIENT_ENV}=1 ${startAgentCommand(null, agent?.command ?? agent?.adapter ?? name, agent?.args, `Run \`${cmd.storyView(story)}\` and follow it.`)}`;
}

export const storyChatCommand = defineCommand({
  name: "story chat",
  summary: "Give a story its own Herdr workspace with an agent to talk it over",
  usage: "norn story chat [<story>] [--json]",
  markdown: true,
  positionals: { max: 1 },
  async run(ctx, args) {
    const raw = await resolveTarget(ctx, args.positionals[0], args.json === true, aStory("story chat", cmd.storyChat));
    const { story } = parseUnitKey(raw);
    const report = orientReport(await projectView(ctx), story, ctx.config.remote.provider);
    if (!report) throw refuse(`unknown story ${story}`, cmd.status(), "unknown_unit");

    const label = `${story} orient`;
    const command = chatAgentCommand(ctx.config, story);
    const cockpit = cockpitHerdr(ctx);
    if (!cockpit) {
      const by = `cd ${report.root} && ${command}`;
      return rendered({ story, opened: false, command: by }, `Not inside Herdr. Start the chat agent yourself:\n\n    ${by}\n`);
    }
    const existing = (await cockpit.listWorkspaces()).find((w) => isOrientWorkspace(w, story, report.root));
    if (existing) {
      await cockpit.focusWorkspace(existing.workspace_id);
      return rendered({ story, opened: true, created: false, workspace_id: existing.workspace_id }, `Focused workspace ${label}.`);
    }
    // R8.1: the agent's `norn` is this norn (its `norn story view` must exist), set inside the command —
    // through a shim of its own, not the launch shim launched agents' hooks share
    const shim = ensureShim(ctx.home, nornEntry(), join(ctx.home, "orient", "bin"));
    const launcher = withNornOnPath([], shim, ctx.env.PATH).argv[0] as string;
    const ws = await cockpit.openWorkspace(report.root, label, `${launcher} env ${command}`);
    return rendered({ story, opened: true, created: true, workspace_id: ws.workspace_id, pane_id: ws.pane_id, command }, `Opened workspace ${label} with a chat agent.`);
  },
});
