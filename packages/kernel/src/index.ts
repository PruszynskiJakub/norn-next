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

export { type AnsweredAsk, type BriefCommands, type BriefInputView, type BriefProduced, type BriefRenderInput, type BriefStory, DEFAULT_BRIEF_COMMANDS, HANDOFF_MAX_BYTES, type ReportHintInput, renderBrief, renderReportHint, renderStepReminder } from "./brief/render.ts";
export * from "./model/actions.ts";
export * from "./model/capabilities.ts";
export * from "./model/config.ts";
export * from "./model/grant.ts";
export { launchedRun } from "./model/launched.ts";
export * from "./model/detect.ts";
export * from "./model/facts.ts";
export * from "./model/receipts.ts";
export * from "./model/run-state.ts";
export * from "./model/session.ts";
export * from "./model/validate.ts";
export * from "./workflow/document.ts";
export * from "./workflow/graph.ts";
export { type LoadWorkflowOptions, loadWorkflow, type StepKindInfo } from "./workflow/load.ts";
export { type Produced, producedFiles, producedOn, producesOn } from "./workflow/produces.ts";
export { guardChanges } from "./workflow/guard.ts";
export { type CountedStep, type DerivedCounters, deriveCounters, type ExitLeft } from "./workflow/counters.ts";
export { type ApplyResult, applyReceipts, type NewRunStateInput, newRunState, type RouteTaken } from "./journal/apply.ts";
export { type ActOutcome, type ActPlan, Journal, outcomeReceiptId, type UnitJournal } from "./journal/journal.ts";
export { readRunState, RUN_STATE_UPGRADES, type RunStateRead, type RunStateUpgrade } from "./journal/format.ts";
export { type DecideContext, decideContext, Decisions } from "./decide/context.ts";
export { decide } from "./decide/index.ts";
export { decideUnit } from "./decide/unit.ts";
export { changeClosedReason, decideIntake, decideStory, decideStoryTail, ITEM_CLOSED_REASON, isChangeClosedReason, unsyncedReason } from "./decide/story.ts";
export { loadProblem } from "./decide/story-unit.ts";
export { RULE_IDS } from "./decide/rules.ts";
export { type CriteriaCheck, type CriteriaCheckInput, type CriteriaRefusal, type CriteriaRefusalCode, checkCriteriaReport, verdictCounts, wantsCriteria, worstVerdict } from "./workflow/criteria.ts";
