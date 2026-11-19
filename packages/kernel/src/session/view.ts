import type { EndReason, LimitKind, ReportVerb, ToolKind } from "@norn/plugin-api";

export interface PendingTool {
  id: string;
  kind: ToolKind;
}

export interface RunningSubagent {
  id: string;
  background: boolean;
}

export interface OpenInput {
  id: string;
  question: string;
  options?: string[];
}

export interface OpenPermission {
  id: string;
  prompt: string;
  /** the pending call the prompt asks about, as `Bash(rm -rf build)`; absent when none was pending */
  call?: { id: string; tool: string };
}

export interface SessionLimit {
  kind: LimitKind;
  resets_at?: string;
}

export interface SessionReport {
  verb: ReportVerb;
  outcome?: string;
}

export interface HookErrorEntry {
  hook: string;
  message: string;
}

/** Everything the events of one run say about its session, before any judgement of time. */
export interface SessionView {
  harness_session?: string;
  /** a turn or tool activity has been seen, so the session is past starting */
  active: boolean;
  pending_tools: PendingTool[];
  subagents: RunningSubagent[];
  input?: OpenInput;
  permission?: OpenPermission;
  /** absent once the agent shows activity after the limit: a limited agent cannot act */
  limit?: SessionLimit;
  turn_ended: boolean;
  last_message?: string;
  /** the harness or provider error the last turn stopped on; a turn that ends cleanly clears it */
  error?: string;
  report?: SessionReport;
  ended?: EndReason;
  compactions: number;
  pane_answers: number;
  errors: HookErrorEntry[];
  last_event_at?: string;
}

export type SessionActivity =
  | "starting"
  | "working"
  | "awaiting_tools"
  | "awaiting_subagents"
  | "asking"
  | "permission"
  | "limited"
  | "turn_ended"
  | "reported"
  | "ended";

/** The session as the rest of norn reads it at one instant. */
export interface SessionFacts {
  activity: SessionActivity;
  /** only a working agent with nothing outstanding can be silent; any wait has a reason to be quiet */
  silent: boolean;
  ask?: OpenInput;
  permission?: OpenPermission;
  limit?: SessionLimit;
  report?: SessionReport;
  last_message?: string;
  /** the error the last turn stopped on, which a run ending there unreported names */
  error?: string;
  /** when the newest event came, so decide can judge silence by a workflow's own `stalled` window */
  last_event_at?: string;
  pending_tools: number;
  subagents: number;
  pane_answers: number;
  errors: string[];
}
