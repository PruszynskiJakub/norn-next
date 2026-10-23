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
}

export type TimelineSource = "receipt" | "tick" | "hook" | "reject" | "briefing";

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
