import { defineNornPlugin } from "@norn/plugin-api";
import { awaitChecks } from "./await-checks.ts";
import { awaitMerge } from "./await-merge.ts";
import { openPr } from "./open-pr.ts";

/** The forge step kinds, kept in the runtime so they work over any forge plugin, `none` included. */
export const stepsForgePlugin = defineNornPlugin({
  name: "norn-steps-forge",
  api: "^1.27",
  provides: { stepKinds: { "open-pr": openPr, "await-checks": awaitChecks, "await-merge": awaitMerge } },
});
