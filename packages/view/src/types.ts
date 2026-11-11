/**
 * ProjectView: the read model front ends consume. Plain JSON — no functions,
 * Dates or Maps — so `norn story list --json`, a web cockpit and a Herdr pane share it.
 */
import type { FileError, Inbox, InboxEntry, PullRequestCi, StoryNote } from "@norn/core";
import type { LeaseKind, Mode, ParkKind, ResolvedConfig, SliceStatus, StoryStatus, UnitStatus } from "@norn/schema";

export interface CounterView {
  name: string;
  value: number;
  /** limit from the pinned workflow; null when the workflow declares none */
  max: number | null;
}

export interface ClaimView {
  /** none / mine (this checkout's heartbeat) / other (another heartbeat, even of this user@machine) / expired / corrupt */
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
  /** on the story, the round it is in; on a slice, the round that started it; null when not started */
  round: number | null;
  /** story mode */
  mode: Mode;
  /** Manual when the step is attended or no runner is configured */
  effective_mode: Mode;
  /** auto requested but running manual */
  mode_downgraded: boolean;
  claim: ClaimView;
  /** `not_started` when there is no state.json; `corrupt` when a file failed validation */
  status: UnitStatus | "not_started";
  /** cursor step (`$done` once finished); null when not started */
  step: string | null;
  /** the cursor step's type in the pinned workflow; null when not started or unknown */
  step_type: StepType | null;
  attempt: number | null;
  counters: CounterView[];
  park: { kind: ParkKind; reason: string; since: string } | null;
  /** The check step's `norn check-run` holds its lease; `since` is then the lease's */
  check_running?: true;
  /** ISO time the unit entered its current situation (park, run start, step entry) */
  since: string | null;
  /** compact age of `since`, e.g. `12m` */
  age: string | null;
  last_outcome: { step: string; outcome: string; at: string } | null;
  /** next command for a person or agent */
  next: string | null;
  updated_at: string | null;
  errors: FileError[];
  /** The last act effect that failed for the unit on this checkout, while it still applies */
  act_failure: { effect: string; reason: string; at: string; tick_id: string } | null;
  /** steps after the cursor in the pinned workflow's step order (0 at the last step); null when not started or unknown. Sorts the cockpit's in-flight stories */
  steps_left: number | null;
}

export interface SliceView extends UnitView {
  slice: string;
  nn: string;
  /** slice frontmatter status (planned / active / integrated / dropped); null if unreadable */
  slice_status: SliceStatus | null;
  depends_on: string[];
  integrated: boolean;
}

/** How the story branch stands against its base, and the last base merge on record. */
export interface BaseSyncView {
  /** base branch name (e.g. `main`) */
  branch: string;
  /** as the last tick of this checkout measured it; null = never measured here */
  behind: number | null;
  ahead: number | null;
  /** paths a merge of the base would conflict in ([] = clean) */
  conflicts: string[];
  /** the last merge of the base into the story branch: norn's `update` merge commit, or a resolve's merge verified at `norn done` */
  last_update: { sha: string; base_sha: string; at: string; step: string } | null;
}

/** The story PR as this checkout's last remote sync saw it (`trace/pr.json`). */
export interface PrView {
  number: number;
  url: string;
  state: "open" | "closed" | "merged";
  is_draft: boolean;
  /** ISO time of that sync */
  seen_at: string;
}

/** The receipt kinds a `--delegated` command writes (approve, reject, answer, run rerun, a new round). */
export type DelegatedKind = "approve" | "reject" | "answer" | "unstick" | "round";

/** A decision a supervisor made on the person's behalf (a `delegated` receipt). */
export interface DelegatedDecision {
  /** story or slice key */
  unit: string;
  /** the story round it was made in (story unit); null for a slice */
  round: number | null;
  step: string;
  /** approve, reject, answer, unstick (rerun) or round (a new round) */
  kind: DelegatedKind;
  /** the workflow of the round it started (kind round) */
  workflow?: string;
  reason: string;
  at: string;
  who: string | null;
}

export interface StoryView extends UnitView {
  slice: null;
  /** The story's delegated decisions over its rounds and slices, oldest first */
  delegated: DelegatedDecision[];
  /** story branch; null for a story held from its record alone, which has none */
  branch: string | null;
  /** the story PR as last seen here; null = none seen (or no sync yet) */
  pr: PrView | null;
  /** Open notes of the story and its slices, in the order they were left */
  notes: StoryNote[];
  /** Base sync state; null = no measurement and no base merge on record */
  base_sync: BaseSyncView | null;
  /** coarse frontmatter status; null if spec.md is unreadable */
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
   * last classification at its step (`stalled`, `silent`, `timeout`, …), so a frozen agent never
   * shows as plain `alive`; null = not classified
   */
  classified: { outcome: string; at: string } | null;
  /** Machine that launched the run, when recorded */
  machine: string | null;
}

/** This checkout's heartbeat as `heartbeat.json` records it. */
export interface HeartbeatView {
  holder: string;
  /** ISO time the last tick finished here; null = never */
  last_tick_at: string | null;
  /** compact age of last_tick_at */
  age: string | null;
  /** How long the last tick took, in ms; absent when not recorded */
  last_tick_ms?: number;
  /** older than 3 × watch interval (or never) while a held story has a unit in auto mode */
  down: boolean;
  /**
   * a tick ran here within 3 × watch interval in any mode: lets a supervisor check the watch before
   * any story is in auto, where `down` cannot fire
   */
  up: boolean;
}

export type TimelineSource = "receipt" | "tick" | "hook" | "reject" | "briefing" | "foreign" | "take" | "criteria";

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
  heartbeat: HeartbeatView;
  stories: StoryView[];
  inbox: Inbox;
  /** current run per unit, oldest first */
  runs: RunView[];
  /** units finished within the last 24 h, newest first */
  recently_done: RecentDone[];
  /** Stories another heartbeat holds that this checkout has no copy of */
  elsewhere: ElsewhereView[];
  /** config, workflow or lease files that failed to read */
  errors: FileError[];
}

/** A unit's standing from a story's record ref. */
export interface RecordUnitView {
  key: string;
  slice: string | null;
  step: string;
  attempt: number;
  status: string;
  counters: CounterView[];
}

/** A story held by another heartbeat, read from local refs only. Data only: `formatElsewhere` writes the sentences. */
export interface ElsewhereView {
  key: string;
  title: string;
  url: string | null;
  /** the claim's holder: the machine the run state is on */
  holder: string;
  /** the claim's last renewal (the holder's heartbeat) and expiry */
  renewed_at: string;
  expires_at: string;
  expired: boolean;
  /** the team's record policy as this checkout's config has it */
  policy: ResolvedConfig["record"]["policy"];
  branch: string | null;
  /** the remote-tracking story branch's head */
  head: { sha: string; subject: string; at: string } | null;
  /** The step the story's last boundary commit ended; null = no boundary pushed yet */
  last_boundary: string | null;
  /**
   * the record ref's commit, time and units; `current` = kept current by the holder (policy
   * `remote`), false = as of `at`; null = no ref here
   */
  record: { sha: string; at: string; holder: string | null; current: boolean; units: RecordUnitView[]; errors: FileError[] } | null;
  pr: PrView | null;
  /** The CI state of the PR's head as the last sync saw it; null = not observed */
  ci: PullRequestCi | null;
}

export type { Inbox, InboxEntry };

/** Workflow step type of a timeline row; `unknown` when the pinned workflow is unreadable. */
export type StepType = "agent" | "check" | "gate" | "git" | "slices" | "merge" | "unknown";

/** Who acted in a step: an agent run, a norn tick, or a person (`user@machine`). */
export interface StepWho {
  by: "agent" | "human" | "norn";
  /** agent name, `tick`, or the person's `user@machine` */
  name: string;
  run_id: string | null;
  tick_id: string | null;
}

/** One visit of a unit to a step: `norn run list` row. Paths are absolute. */
export interface StepRow {
  unit: string;
  slice: string | null;
  /** The story round the row belongs to (a slice's: the round that started it); absent = 1 */
  round?: number;
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
  /** counter bumped by the edge taken */
  counter: { name: string; value: number; max: number } | null;
  who: StepWho[];
  /** full reason text: handoff, check result, gate comment, classify detail */
  reason: string | null;
  /** A person's decision in this row was made by a supervisor on their behalf */
  delegated?: true;
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
 * Where a trace's record paths point: the machine dir, or a finished story's archive ref.
 */
export interface TraceRecords {
  /**
   * `machine`: the machine dir holds the run state (`root` its story folder); `archive`: a finished
   * story's record from its archive ref, unpacked into the machine dir's cache
   */
  source: "machine" | "archive";
  root: string;
  /** archive: the record ref (`refs/norn/runs/<story>`) */
  ref?: string;
  /** archive: the record commit read */
  commit?: string;
}

/** Criteria reports of the units shown (`norn done --criteria`), counted from the trace. */
export interface CriteriaSummary {
  reports: number;
  verdicts: { pass: number; fail: number; person: number; unverified: number };
  /** reports whose unit declared no frontmatter `criteria`, so coverage was not checked */
  unchecked_coverage: number;
}

/** One round of a story, as `norn run list` heads its rows. */
export interface RoundView {
  n: number;
  workflow: string;
  /** how it ended: finished by its workflow (`at: $done`) or by the person with `--force` at a step; null = the round under way */
  ended: { by: "workflow" | "person"; at: string } | null;
  /** The reason of a supervisor's `--delegated` decision that started this round; absent = the person's own */
  delegated_reason?: string;
}

export interface TraceView extends UnitTraceSummary {
  /** A story's rounds, oldest first (set by loadTraceView for a story; a flat record is round 1) */
  rounds?: RoundView[];
  /** set by loadTraceView */
  records?: TraceRecords;
  /** Set by loadTraceView when the trace holds criteria reports for the units shown */
  criteria?: CriteriaSummary;
  steps: StepRow[];
  /** the story first, then each slice shown */
  units: UnitTraceSummary[];
  /** no-op / claim-renew tick entries left out (0 with `--all`) */
  hidden_events: number;
}
