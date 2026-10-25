/**
 * Command registry. To add a command: create `src/commands/<name>.ts` exporting
 * `defineCommand({...})`, then list it here.
 */
import type { Command } from "../command.ts";
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
import { statusCommand } from "./status.ts";
import { traceCommand } from "./trace.ts";
import { unstickCommand } from "./unstick.ts";
import { whyCommand } from "./why.ts";
import { workflowCommand } from "./workflow.ts";
import { doctorCommand } from "./doctor.ts";
import { dropCommand } from "./drop.ts";
import { releaseCommand } from "./release.ts";
import { takeCommand } from "./take.ts";
import { tidyCommand } from "./tidy.ts";
import { paneCommand } from "./pane.ts";
import { updateCommand } from "./update.ts";

export const COMMANDS: readonly Command[] = [initCommand, uninstallCommand, syncCommand, tickCommand, watchCommand, briefCommand, doneCommand, askCommand, stuckCommand, hookEventCommand, inboxCommand, paneCommand, statusCommand, traceCommand, whyCommand, answerCommand, approveCommand, unstickCommand, updateCommand, modeCommand, workflowCommand, takeCommand, releaseCommand, dropCommand, tidyCommand, doctorCommand, helpCommand];

export function findCommand(name: string): Command | undefined {
  return COMMANDS.find((c) => c.name === name);
}
