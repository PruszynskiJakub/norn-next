/**
 * ProjectView: the read model front ends consume (X1). Plain JSON — no functions,
 * Dates or Maps — so `norn status --json`, a web cockpit and a Herdr pane share it.
 */
import type { FileError, Inbox, InboxEntry } from "@norn/core";
import type { LeaseKind, Mode, ParkKind, SliceStatus, StoryStatus, UnitStatus } from "@norn/schema";

export interface CounterView {
  name: string;
  value: number;
  /** W4 limit from the pinned workflow; null when the workflow declares none */
  max: number | null;
}

export interface ClaimView {
  /** none / mine (this user@machine or heartbeat) / other / expired / corrupt (T2) */
  state: "none" | "mine" | "other" | "expired" | "corrupt";
  holder: string | null;
  expires_at: string | null;
  /** true when nobody holds a live claim (none or expired) */
  unclaimed: boolean;
}

/** Fields common to the story unit and slice units. */
export interface UnitView {
  /** story key or slice key */
  key: string;
  story: string;
  /** null for the story unit */
  slice: string | null;
  title: string;
  url: string | null;
  /** pinned workflow name, else the frontmatter/config workflow the unit would start with */
  workflow: string;
  /** story mode (MO1) */
  mode: Mode;
  /** MO2: manual when the step is attended or no runner is configured */
  effective_mode: Mode;
  /** auto requested but running manual (MO2) */
  mode_downgraded: boolean;
  claim: ClaimView;
  /** `not_started` when there is no state.json; `corrupt` when a file failed validation (S2) */
  status: UnitStatus | "not_started";
  /** cursor step (`$done` once finished); null when not started */
  step: string | null;
  attempt: number | null;
  counters: CounterView[];
  park: { kind: ParkKind; reason: string; since: string } | null;
  /** ISO time the unit entered its current situation (park, run start, step entry) */
  since: string | null;
  /** compact age of `since`, e.g. `12m` */
  age: string | null;
  last_outcome: { step: string; outcome: string; at: string } | null;
  /** next command for a person or agent (S9) */
  next: string | null;
  updated_at: string | null;
  errors: FileError[];
  /** R4.3: the last act effect that failed for the unit on this checkout, while it still applies */
  act_failure: { effect: string; reason: string; at: string; tick_id: string } | null;
}

export interface SliceView extends UnitView {
  slice: string;
  nn: string;
  /** slice frontmatter status (planned / active / integrated / dropped); null if unreadable */
  slice_status: SliceStatus | null;
  depends_on: string[];
  integrated: boolean;
}

export interface StoryView extends UnitView {
  slice: null;
  /** coarse frontmatter status; null if story.md is unreadable */
  story_status: StoryStatus | null;
  /** root-relative spec folder */
  spec_dir: string;
  /** checkout or worktree the spec was read from */
  root: string;
  slices: SliceView[];
}

export interface RunView {
  unit: string;
  story: string;
  slice: string | null;
  run_id: string;
  step: string;
  attempt: number;
  started_at: string;
  how: "manual" | "auto" | "tick";
  agent: string | null;
  session: { runner: string; session_id: string; pane_id?: string } | null;
  /** from this machine's leases: true live, false dead holder, null unknown (no lease here) */
  alive: boolean | null;
  lease: { kind: LeaseKind; file: string; slot: number | null } | null;
  /** newest hook fact for this run in the trace window */
  last_hook_at: string | null;
  /**
   * R4.4: the run's last classification at its step (`stalled`, `silent`, `timeout`, …), so a frozen
   * agent is never shown as plain `alive`; null when the tick has not classified this run
   */
  classified: { outcome: string; at: string } | null;
  /** R7.1: machine that launched the run, when recorded */
  machine: string | null;
}

/** R5.5 (N3): this checkout's heartbeat as `heartbeat.json` records it. */
export interface HeartbeatView {
  holder: string;
  /** ISO time the last tick finished here; null = never */
  last_tick_at: string | null;
  /** compact age of last_tick_at */
  age: string | null;
  /** older than 3 × watch interval (or never) while a held story has a unit in auto mode */
  down: boolean;
}

export type TimelineSource = "receipt" | "tick" | "hook" | "reject" | "briefing" | "foreign" | "take";

export interface TimelineEntry {
  at: string;
  source: TimelineSource;
  /** receipt kind, hook event, or tick action kind */
  kind: string;
  /** one line */
  summary: string;
  /** receipt number / receipt_id, tick_id or trace event id */
  ref: string;
}

export interface RecentDone {
  unit: string;
  title: string;
  done_at: string;
  age: string;
}

export interface ProjectView {
  at: string;
  repo: string;
  /** user@machine the view was built for (claim `mine`) */
  holder: string;
  runner: string | null;
  /** R5.5: this checkout's heartbeat */
  heartbeat: HeartbeatView;
  stories: StoryView[];
  inbox: Inbox;
  /** current run per unit, oldest first */
  runs: RunView[];
  /** unit key → entries, oldest first */
  timeline: Record<string, TimelineEntry[]>;
  /** units finished within the last 24 h, newest first */
  recently_done: RecentDone[];
  /** config, workflow, trace or lease files that failed to read */
  errors: FileError[];
}

export type { Inbox, InboxEntry };

/** Workflow step type of a timeline row; `unknown` when the pinned workflow is unreadable. */
export type StepType = "agent" | "check" | "gate" | "git" | "slices" | "unknown";

/** Who acted in a step: an agent run, a norn tick, or a person (`user@machine`). */
export interface StepWho {
  by: "agent" | "human" | "norn";
  /** agent name, `tick`, or the person's `user@machine` */
  name: string;
  run_id: string | null;
  tick_id: string | null;
}

/** One visit of a unit to a step: `norn trace` row (O4). Paths are absolute. */
export interface StepRow {
  unit: string;
  slice: string | null;
  step: string;
  attempt: number;
  type: StepType;
  attended: boolean;
  entered_at: string | null;
  /** null while the unit is still in this step */
  left_at: string | null;
  /** left − entered; up to now while open */
  duration_ms: number | null;
  open: boolean;
  outcome: string | null;
  /** step (or `$done`) the unit moved to */
  to: string | null;
  /** W4 counter bumped by the edge taken */
  counter: { name: string; value: number; max: number } | null;
  who: StepWho[];
  /** full reason text: handoff, check result, gate comment, classify detail */
  reason: string | null;
  /** time a person was waited on: the whole step for gates, ask → answer otherwise */
  wait_ms: number;
  paths: { receipts: string[]; evidence: string[]; logs: string[]; briefings: string[] };
  /** the unit's events in this step (`--events`; no-op ticks only with `--all`) */
  events?: TimelineEntry[];
}

export interface StepTotals {
  /** intake → $done (or now while unfinished) */
  wall_clock_ms: number | null;
  /** $done → PR merged, when the merge was seen */
  merge_wait_ms: number | null;
  /** summed row durations per step type (this unit's own rows) */
  by_type: Record<string, number>;
  by_step: Record<string, number>;
  /** gates + unanswered/answered asks; for a story, summed over its slices too */
  human_wait_ms: number;
}

export interface UnitTraceSummary {
  unit: string;
  story: string;
  slice: string | null;
  title: string;
  status: UnitStatus | "not_started";
  step: string | null;
  /** story intake (frontmatter) or first sign of the unit */
  intake_at: string | null;
  done_at: string | null;
  merged_at: string | null;
  totals: StepTotals;
}

/**
 * Where a trace's record paths point (F36): a story worktree, the main checkout, or — for a
 * story with no worktree whose records the checkout does not have — the cached copy of the
 * base branch in the trace dir (replaced when `origin/<base>` moves; `ref` is the live source).
 */
export interface TraceRecords {
  source: "worktree" | "checkout" | "base_cache";
  root: string;
  /** checkout records identical to the base branch copy */
  same_as_base?: boolean;
  /** base_cache: the remote-tracking ref the copy was taken from */
  ref?: string;
}

/** `norn trace <unit>`: rows of the unit (and, for a story, its slices interleaved). */
export interface TraceView extends UnitTraceSummary {
  /** set by loadTraceView */
  records?: TraceRecords;
  steps: StepRow[];
  /** the story first, then each slice shown */
  units: UnitTraceSummary[];
  /** no-op / claim-renew tick entries left out (0 with `--all`) */
  hidden_events: number;
}
