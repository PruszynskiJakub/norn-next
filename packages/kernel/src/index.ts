// The session reducer reads only normalized events, never a harness's native shapes.
export type { HarnessEvent, HarnessEventOf, HarnessEventType } from "@norn/plugin-api";
export { type ClassifyOptions, classifySession } from "./session/classify.ts";
export { reduceSession } from "./session/reduce.ts";
export type {
  HookErrorEntry,
  OpenInput,
  OpenPermission,
  PendingTool,
  RunningSubagent,
  SessionActivity,
  SessionFacts,
  SessionLimit,
  SessionReport,
  SessionView,
} from "./session/view.ts";
