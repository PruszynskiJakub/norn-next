/**
 * `norn run <verb>` (B2, B43–B53): the runs of a unit — `list` its step timeline, `view` one run,
 * `attach` to its agent pane, `rerun` a stuck or parked unit, `cancel` a running one.
 */
import { defineNoun } from "../command.ts";
import { runAttachCommand } from "./run-attach.ts";
import { runCancelCommand } from "./run-cancel.ts";
import { runListCommand } from "./run-list.ts";
import { runRerunCommand } from "./run-rerun.ts";
import { runViewCommand } from "./run-view.ts";

export const runNoun = defineNoun({
  name: "run",
  summary: "The runs of a unit: its step timeline, one run, why a tick decided what it did, its agent pane; rerun or cancel it",
  verbs: [runListCommand, runViewCommand, runAttachCommand, runRerunCommand, runCancelCommand],
});
