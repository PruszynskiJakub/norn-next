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
import { runStartCommand } from "./run-start.ts";
import { runStopCommand } from "./run-stop.ts";
import { statusCommand } from "./status.ts";
import { storyAnswerCommand } from "./story-answer.ts";
import { storyApproveCommand } from "./story-approve.ts";
import { storyCloseCommand } from "./story-close.ts";
import { storyCreateCommand } from "./story-create.ts";
import { storyListCommand } from "./story-list.ts";
import { storyRejectCommand } from "./story-reject.ts";
import { storyViewCommand } from "./story-view.ts";
import { stuckCommand } from "./stuck.ts";
import { tickCommand } from "./tick.ts";
import { watchCommand } from "./watch.ts";

export const COMMANDS: readonly Command[] = [
  helpCommand,
  initCommand,
  doctorCommand,
  statusCommand,
  tickCommand,
  watchCommand,
  briefCommand,
  doneCommand,
  askCommand,
  stuckCommand,
  hookCommand,
];

export const NOUNS: readonly Noun[] = [
  defineNoun({ name: "story", summary: "Stories: list, view, create, and the person's decisions", verbs: [storyListCommand, storyViewCommand, storyCreateCommand, storyApproveCommand, storyRejectCommand, storyAnswerCommand, storyCloseCommand] }),
  defineNoun({ name: "run", summary: "Agent runs: start one manual mode holds, stop a live one", verbs: [runStartCommand, runStopCommand] }),
  defineNoun({ name: "config", summary: "Read and change the config", verbs: [configGetCommand, configSetCommand, configShowCommand] }),
  defineNoun({ name: "plugin", summary: "Install, list, update and remove plugins", verbs: [pluginAddCommand, pluginListCommand, pluginRemoveCommand, pluginUpdateCommand] }),
];

export function findCommand(name: string): Command | undefined {
  return [...COMMANDS, ...NOUNS.flatMap((n) => n.verbs)].find((c) => c.name === name);
}

export function findNoun(name: string): Noun | undefined {
  return NOUNS.find((n) => n.name === name);
}
