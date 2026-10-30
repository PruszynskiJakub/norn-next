/**
 * Command registry. To add a command: create `src/commands/<name>.ts` exporting
 * `defineCommand({...})`, then list it here. A verb goes in its noun's `verbs` and the noun here.
 */
import type { Command, Noun } from "../command.ts";
import { askCommand } from "./ask.ts";
import { briefCommand } from "./brief.ts";
import { doneCommand } from "./done.ts";
import { hookEventCommand } from "./hook.ts";
import { checkRunCommand } from "./check-run.ts";
import { stuckCommand } from "./stuck.ts";
import { helpCommand } from "./help.ts";
import { initCommand } from "./init.ts";
import { syncCommand } from "./sync.ts";
import { tickCommand } from "./tick.ts";
import { uninstallCommand } from "./uninstall.ts";
import { watchCommand } from "./watch.ts";
import { runNoun } from "./run.ts";
import { storyNoun } from "./story.ts";
import { statusCommand } from "./status.ts";
import { configNoun } from "./config.ts";
import { doctorCommand } from "./doctor.ts";
import { tidyCommand } from "./tidy.ts";
import { migrateCommand } from "./migrate.ts";

export const COMMANDS: readonly Command[] = [initCommand, uninstallCommand, syncCommand, tickCommand, watchCommand, briefCommand, doneCommand, askCommand, stuckCommand, hookEventCommand, checkRunCommand, statusCommand, tidyCommand, doctorCommand, migrateCommand, helpCommand];

export const NOUNS: readonly Noun[] = [storyNoun, runNoun, configNoun];

/** A flat command by name, or a verb by its full name (`run list`). */
export function findCommand(name: string): Command | undefined {
  return COMMANDS.find((c) => c.name === name) ?? NOUNS.flatMap((n) => n.verbs).find((c) => c.name === name);
}

export function findNoun(name: string): Noun | undefined {
  return NOUNS.find((n) => n.name === name);
}
