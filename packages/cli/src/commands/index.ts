/**
 * The command registry: every top-level command and every noun with its verbs, in the order
 * `norn help` lists them. A command's body lives in its own file.
 */
import type { Command, Noun } from "../command.ts";
import { defineNoun } from "../command.ts";
import { askCommand } from "./ask.ts";
import { briefCommand } from "./brief.ts";
import { configGetCommand } from "./config-get.ts";
import { configSetCommand } from "./config-set.ts";
import { configShowCommand } from "./config-show.ts";
import { doctorCommand } from "./doctor.ts";
import { doneCommand } from "./done.ts";
import { helpCommand } from "./help.ts";
import { hookCommand } from "./hook.ts";
import { initCommand } from "./init.ts";
import { pluginAddCommand } from "./plugin-add.ts";
import { pluginListCommand } from "./plugin-list.ts";
import { pluginRemoveCommand } from "./plugin-remove.ts";
import { pluginUpdateCommand } from "./plugin-update.ts";
import { runAttachCommand } from "./run-attach.ts";
import { runRerunCommand } from "./run-rerun.ts";
import { runStartCommand } from "./run-start.ts";
import { runStopCommand } from "./run-stop.ts";
import { statusCommand } from "./status.ts";
import { storyAnswerCommand } from "./story-answer.ts";
import { storyApproveCommand } from "./story-approve.ts";
import { storyCloseCommand } from "./story-close.ts";
import { storyCreateCommand } from "./story-create.ts";
import { storyListCommand } from "./story-list.ts";
import { storyRejectCommand } from "./story-reject.ts";
import { storyRoundCommand } from "./story-round.ts";
import { storyTakeCommand } from "./story-take.ts";
import { storyUpdateBranchCommand } from "./story-update-branch.ts";
import { storyViewCommand } from "./story-view.ts";
import { stuckCommand } from "./stuck.ts";
import { tickCommand } from "./tick.ts";
import { tidyCommand } from "./tidy.ts";
import { watchCommand } from "./watch.ts";
import { workflowConfirmCommand } from "./workflow-confirm.ts";

export const COMMANDS: readonly Command[] = [
  helpCommand,
  initCommand,
  doctorCommand,
  statusCommand,
  tickCommand,
  watchCommand,
  tidyCommand,
  briefCommand,
  doneCommand,
  askCommand,
  stuckCommand,
  hookCommand,
];

export const NOUNS: readonly Noun[] = [
  defineNoun({ name: "story", summary: "Stories: list, view, create, the person's decisions, the next round, taking one to this machine, and updating a finished one's branch", verbs: [storyListCommand, storyViewCommand, storyCreateCommand, storyApproveCommand, storyRejectCommand, storyAnswerCommand, storyRoundCommand, storyTakeCommand, storyUpdateBranchCommand, storyCloseCommand] }),
  defineNoun({ name: "run", summary: "Runs: start one manual mode holds, stop a live one, run a step again, bring one's pane in front", verbs: [runStartCommand, runStopCommand, runRerunCommand, runAttachCommand] }),
  defineNoun({ name: "workflow", summary: "Workflows: confirm a repo workflow held for the person", verbs: [workflowConfirmCommand] }),
  defineNoun({ name: "config", summary: "Read and change the config", verbs: [configGetCommand, configSetCommand, configShowCommand] }),
  defineNoun({ name: "plugin", summary: "Install, list, update and remove plugins", verbs: [pluginAddCommand, pluginListCommand, pluginRemoveCommand, pluginUpdateCommand] }),
];

export function findCommand(name: string): Command | undefined {
  return [...COMMANDS, ...NOUNS.flatMap((n) => n.verbs)].find((c) => c.name === name);
}

export function findNoun(name: string): Noun | undefined {
  return NOUNS.find((n) => n.name === name);
}
