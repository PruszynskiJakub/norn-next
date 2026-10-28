/**
 * Command registry. To add a command: create `src/commands/<name>.ts` exporting
 * `defineCommand({...})`, then list it here. A verb goes in its noun's `verbs` and the noun here.
 */
import type { Command, Noun } from "../command.ts";
import { askCommand } from "./ask.ts";
import { briefCommand } from "./brief.ts";
import { doneCommand } from "./done.ts";
import { hookEventCommand } from "./hook.ts";
import { stuckCommand } from "./stuck.ts";
import { helpCommand } from "./help.ts";
import { initCommand } from "./init.ts";
import { syncCommand } from "./sync.ts";
import { tickCommand } from "./tick.ts";
import { uninstallCommand } from "./uninstall.ts";
import { watchCommand } from "./watch.ts";
import { answerCommand } from "./answer.ts";
import { approveCommand } from "./approve.ts";
import { inboxCommand } from "./inbox.ts";
import { modeCommand } from "./mode.ts";
import { runNoun } from "./run.ts";
import { statusCommand } from "./status.ts";
import { workflowCommand } from "./workflow.ts";
import { configCommand } from "./config.ts";
import { doctorCommand } from "./doctor.ts";
import { dropCommand } from "./drop.ts";
import { releaseCommand } from "./release.ts";
import { takeCommand } from "./take.ts";
import { tidyCommand } from "./tidy.ts";
import { cockpitCommand } from "./cockpit.ts";
import { openCommand } from "./open.ts";
import { orientCommand } from "./orient.ts";
import { updateCommand } from "./update.ts";

export const COMMANDS: readonly Command[] = [initCommand, uninstallCommand, syncCommand, tickCommand, watchCommand, briefCommand, doneCommand, askCommand, stuckCommand, hookEventCommand, inboxCommand, cockpitCommand, openCommand, orientCommand, statusCommand, answerCommand, approveCommand, updateCommand, modeCommand, workflowCommand, takeCommand, releaseCommand, dropCommand, tidyCommand, doctorCommand, configCommand, helpCommand];

export const NOUNS: readonly Noun[] = [runNoun];

/** A flat command by name, or a verb by its full name (`run list`). */
export function findCommand(name: string): Command | undefined {
  return COMMANDS.find((c) => c.name === name) ?? NOUNS.flatMap((n) => n.verbs).find((c) => c.name === name);
}

export function findNoun(name: string): Noun | undefined {
  return NOUNS.find((n) => n.name === name);
}
