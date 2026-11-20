import { defineNornPlugin } from "@norn/plugin-api";
import { awaitMerge } from "./await-merge.ts";
import { markReady } from "./mark-ready.ts";
import { openPr } from "./open-pr.ts";

/** The forge step kinds, kept in the runtime so they work over any forge plugin, `none` included. */
export const stepsForgePlugin = defineNornPlugin({
  name: "norn-steps-forge",
  api: "^1.4",
  provides: { stepKinds: { "open-pr": openPr, "mark-ready": markReady, "await-merge": awaitMerge } },
});
