/** `norn run <verb>` (B2, B43–B45): the runs of a unit — `list` its step timeline, `view` one run. */
import { defineNoun } from "../command.ts";
import { runListCommand } from "./run-list.ts";
import { runViewCommand } from "./run-view.ts";

export const runNoun = defineNoun({
  name: "run",
  summary: "The runs of a unit: its step timeline, one run, why a tick decided what it did",
  verbs: [runListCommand, runViewCommand],
});
