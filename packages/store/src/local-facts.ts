/**
 * loadLocalFacts (H2, X1): the facts of a checkout read from its own files — no network, no port, no
 * writes. The store snapshot with each slice unit re-read from its own worktree (§7), this machine's
 * leases (K1, K3), each unit's hook facts from the trace (R5.1, R5.3), act failures, the PR and base caches (C1,
 * BS1) and, per unit, what its receipts say: the last outcome receipt (B3), the runs of its cursor step
 * (R5.3), an unknown launch (R5.1); per story its open notes (NT2/NT3) and ready approval (F35/C5).
 * observe (cli) extends these with git, runner, process and remote facts; the view (X1) reads them
 * as they are (`loadProjectView`), so `norn status` and the tick see one world. Its one write is the
 * tick's hook-file backfill (`backfillHooks`, D5).
 */
import { existsSync } from "node:fs";
import {
  type ActFailure,
  type FileError,
  hookWindowMs,
  type NumberedReceipt,
  openNotes,
  RE_ENTRY_KINDS,
  readyApproval,
  recordPushSlot,
  type StepRunFacts,
  type StoryFacts,
  storyMode,
  storyWorktreePath,
  type UnitFacts,
} from "@norn/core";
import { type HookFact, type LeaseFile, parseDuration, type ReceiptOf, type RejectedMailboxReceipt, type ResolvedConfig, type RunInfo, storyBranch, type UnitState, type Workflow } from "@norn/schema";
import type { LoadedConfig } from "./config.ts";
import { type BaseFactsCache, type IssueFactsCache, type PrFactsCache, readBaseFacts, readIssueFacts, readPrFacts } from "./base.ts";
import { readActFailures } from "./heartbeat.ts";
import { readRejectedReceipts } from "./local.ts";
import { listSuperseded, type SupersededCopy } from "./superseded.ts";
import { type BackfillRun, backfillHookFiles } from "./hook-backfill.ts";
import { type LeaseListing, type LeaseLiveness, listLeases } from "./leases.ts";
import { type ReceiptIndex, receiptIndex } from "./receipts.ts";
import { localRecordRefs } from "./record-ref.ts";
import { loadSnapshot, type RepoSnapshot, type StorySnapshot, type UnitSnapshot, withSliceWorktrees } from "./snapshot.ts";
import { skillSource, worktreeSkillsDrift } from "./skills.ts";
import { readUnitHooks, unitHooksChangedAt } from "./trace.ts";
import { readUnitMarker } from "./worktree.ts";

export interface LocalFactsOptions {
  /** ms epoch */
  now: number;
  /** norn home (default NORN_HOME_DIR or ~/.norn) */
  home?: string;
  env?: Record<string, string | undefined>;
  /** worktrees by their A3 marker: story key → path */
  storyWorktrees: ReadonlyMap<string, string>;
  /** worktrees by their A3 marker: slice key → path */
  sliceWorktrees: ReadonlyMap<string, string>;
  /** remote-tracking ref of the base branch records are read from (loadSnapshot); null = none */
  baseRef?: string | null;
  /** the config already loaded for this repo, home and env (loadSnapshot); default loaded here */
  config?: LoadedConfig;
  /** lease liveness check (default: holder pid + start time) */
  liveness?: LeaseLiveness;
  /** R5.3: the stalled window (ms) hook facts are always read back over; default the snapshot config's `limits.stalled` */
  stalledMs?: number;
  /** every valid receipt per unit too (`UnitSnapshot.receipts`): the view's timelines (X1) */
  includeApplied?: boolean;
  /** an unlistable leases dir is reported in `leases.errors` (file `leases`) instead of thrown: the view's (X1) */
  reportLeaseErrors?: boolean;
  /** B11, B12 (D5): first copy the live runs' hook lines from the day files into their hook files (the tick's, under its lock) */
  backfillHooks?: boolean;
  /** gh-61 D5: the running binary's version; given = `norn` is observed */
  running?: string;
  /**
   * gh-61 D5 (B18, B21): this norn's bundled skills (the source folder and their names), passed in by
   * the cli; given with `running` = each unit worktree's and the main checkout's `skills_drift` is observed
   */
  bundledSkills?: { source: string; names: readonly string[] };
}

/** R5.3 + R5.1: the runs of a unit's cursor step/attempt, and every session id its `started` receipts recorded. */
export interface CursorRuns {
  runs: Map<string, { died: boolean }>;
  sessions: Set<string>;
}

export interface LocalUnit {
  snapshot: UnitSnapshot;
  /** the unit's own worktree (slice) or the story worktree (story unit), when known */
  worktree: string | null;
  last_outcome_receipt: NumberedReceipt | null;
  cursor: CursorRuns | null;
  /** R5.1: the `started` receipt whose launch never reached state.json */
  unknown_launch: (NumberedReceipt & { receipt: ReceiptOf<"started"> }) | null;
  /** this machine's check lease of the unit, else its agent lease */
  lease: LeaseFile | null;
  /** the unit's hook facts (its hook file, `readUnitHooks`), back to the oldest live or launch-unknown run of any unit (R5.1), and always the stalled window (R5.3); empty for a unit with no such run whose hook file was not written within the stalled window (D4) */
  hooks: HookFact[];
  /** R5.3: runs of the cursor step and their hook activity */
  step_runs?: StepRunFacts[];
  act_failure?: ActFailure;
  /** gh-61 D5: the worktree's bundled skills that differ from the running norn's; absent = not observed */
  skills_drift?: string[];
}

export interface LocalStory {
  /** the story as read, its slice units re-read from their own worktrees */
  snapshot: StorySnapshot;
  /** the story worktree: marked in the worktree list, else the conventional path when marked */
  worktree: string | null;
  units: LocalUnit[];
  /** NT2/NT3 */
  notes?: StoryFacts["notes"];
  /** F35/C5: the story unit's ready approval (`readyApproval`) */
  ready?: { sha: string; at: string };
  /** gh-195 (08-F4, review F2): the story's refused record push, from its own slot of failures.json (`StoryFacts.record_refused`) */
  record_refused?: ActFailure;
  /** gh-195 (review#2 F3): the local record ref's commit while the story unit has no run state (`StoryFacts.record_unplaced`) */
  record_unplaced?: string;
  /** gh-195 D12 (B21): mailbox receipts this checkout rejected that no later accepted answer or approval cleared */
  rejected?: RejectedMailboxReceipt[];
}

export interface LocalFacts {
  snapshot: RepoSnapshot;
  /** in snapshot story order */
  stories: LocalStory[];
  leases: LeaseListing;
  failures: Record<string, ActFailure>;
  /** C1: the PR cache as the last sync left it */
  pr_seen: PrFactsCache;
  /** gh-71 D5: the issue cache as the last sync left it */
  issue_seen: IssueFactsCache;
  /** BS1: the base measurement cache as the last tick left it */
  base: BaseFactsCache;
  /**
   * gh-61 D5: the running version and the one this checkout's team config records (null = none,
   * B5); absent when no running version was given or the config failed to load.
   */
  norn?: { running: string; repo: string | null; skills_drift?: string[] };
  /** gh-195 D11 (B27): records this checkout set aside as superseded (`Facts.superseded`) */
  superseded: SupersededCopy[];
}

export async function loadLocalFacts(root: string, opts: LocalFactsOptions): Promise<LocalFacts> {
  const now = opts.now;
  const includeApplied = opts.includeApplied;
  const snapshot = loadSnapshot({ repoRoot: root, storyRoots: [...opts.storyWorktrees].map(([story, path]) => ({ story, path })), home: opts.home, env: opts.env, baseRef: opts.baseRef, includeApplied, ...(opts.config ? { config: opts.config } : {}) });
  const leases = await listLeases(snapshot.home, opts.liveness).catch((e: unknown): LeaseListing => {
    if (!opts.reportLeaseErrors) throw e;
    return { live: [], dead: [], errors: [{ file: "leases", errors: [{ path: "", message: (e as Error).message }] } satisfies FileError] };
  });
  const live = leases.live.map((e) => e.lease);
  const stalledMs = opts.stalledMs ?? hookWindowMs(Object.values(snapshot.workflows.workflows).map((w) => w.workflow));

  const starts: string[] = [new Date(now - stalledMs).toISOString()];
  // units with a live run or an unknown launch (R5.1): their hook files are always read (D4)
  const running = new Map<UnitSnapshot, string>();
  const read = snapshot.stories.map((s) => {
    const story = withSliceWorktrees(s, (slice) => opts.sliceWorktrees.get(slice), { includeApplied });
    for (const u of story.units) {
      const run = liveRun(u.state) ? (u.state?.run?.started_at ?? (u.state as UnitState).updated_at) : null;
      const unknown = unknownLaunch(u.unapplied)?.receipt.at ?? null;
      for (const at of [run, unknown]) if (at) starts.push(at);
      const began = [run, unknown].filter((at): at is string => !!at).sort()[0];
      if (began) running.set(u, began);
    }
    return story;
  });
  const failures = readActFailures(root);
  const rejected = readRejectedReceipts(root);

  const placed = read.map((s) => {
    const conventional = storyWorktreePath(root, s.key, s.slug);
    const storyWt = opts.storyWorktrees.get(s.key) ?? (existsSync(conventional) && readUnitMarker(conventional).marker ? conventional : null);
    return { s, storyWt, units: s.units.map((u) => ({ u, worktree: u.unit.slice ? (opts.sliceWorktrees.get(u.unit.slice) ?? null) : storyWt })) };
  });
  if (opts.backfillHooks) {
    const runs: BackfillRun[] = [...running].map(([u, started_at]) => ({ unit: { key: u.unit.key, story: u.unit.story, slice: u.unit.slice }, started_at }));
    backfillHookFiles(root, runs, new Date(now).toISOString());
  }
  // B8 (D4): only the hook files of units with a live run or an unknown launch (R5.1), or written within the stalled window (R5.3)
  const hooked = placed.flatMap(({ units }) => units.map(({ u }) => u)).filter((u) => {
    if (running.has(u)) return true;
    const changed = unitHooksChangedAt(root, u.unit);
    return changed !== null && changed >= now - stalledMs;
  });
  const unitHooks = readUnitHooks(root, hooked.map((u) => u.unit), starts.sort()[0] as string);
  const hooksOf = new Map(hooked.map((u, i) => [u, (unitHooks[i] ?? []).map((e) => e.fact)]));
  const drift = skillsDriftOf(opts);
  let refs: Map<string, string> | undefined;
  const stories = placed.map(({ s, storyWt, units: us }): LocalStory => {
    // each unit's receipts folder is listed once for every read below
    const index = new Map(s.units.map((u) => [u, receiptIndex(u.path)]));
    const indexOf = (u: UnitSnapshot) => index.get(u) as ReceiptIndex;
    const units = us.map(({ u, worktree }) => {
      const lu = localUnit(root, s, u, indexOf(u), worktree, hooksOf.get(u) ?? [], live, failures);
      // a finished unit starts no agent step: its skills are not compared (observe cost)
      const skills_drift = worktree && u.state?.status !== "done" ? drift(worktree) : undefined;
      return skills_drift ? { ...lu, skills_drift } : lu;
    });
    const ready = readyOf(s, s.units[0], indexOf);
    const notes = openNotes(s.units.map((u) => ({ unit: u.unit.key, receipts: receiptsOfKinds(s, u, ["done", "approve"], indexOf(u)) })));
    const refused = failures[recordPushSlot(s.key)];
    // review#2 F3: a record ref here while the story unit has no run state — the record is not in place
    const unplaced = !s.units[0]?.state ? (refs ??= localRecordRefs(root)).get(s.key) : undefined;
    const open = openRejections(s, rejected, indexOf);
    return {
      snapshot: s,
      worktree: storyWt,
      units,
      ...(notes.length ? { notes } : {}),
      ...(ready ? { ready } : {}),
      ...(refused ? { record_refused: refused } : {}),
      ...(unplaced ? { record_unplaced: unplaced } : {}),
      ...(open.length ? { rejected: open } : {}),
    };
  });
  // gh-61 D5, B12: the version the main checkout's team config records
  const mainDrift = drift(root);
  const norn =
    opts.running !== undefined && snapshot.config.ok ? { running: opts.running, repo: snapshot.config.config.norn_version ?? null, ...(mainDrift ? { skills_drift: mainDrift } : {}) } : undefined;
  return { snapshot, stories, leases, failures, pr_seen: readPrFacts(root), issue_seen: readIssueFacts(root), base: readBaseFacts(root), ...(norn ? { norn } : {}), superseded: listSuperseded(root) };
}

/**
 * gh-61 D5, D14: a worktree's drifted bundled skills (`worktreeSkillsDrift`), each folder compared
 * once per load (a story worktree serves the story unit and every slice without its own); undefined
 * when not observed (no running version or bundled skills given, or no such folder).
 */
function skillsDriftOf(opts: LocalFactsOptions): (worktree: string) => string[] | undefined {
  const { running, bundledSkills: bundled } = opts;
  const seen = new Map<string, string[]>();
  // the bundled folders are read once for every worktree compared
  const source = bundled ? skillSource(bundled.source) : null;
  return (worktree) => {
    if (running === undefined || !bundled || !source || !existsSync(worktree)) return undefined;
    let names = seen.get(worktree);
    if (!names) seen.set(worktree, (names = worktreeSkillsDrift(worktree, source, bundled.names, running)));
    return names;
  };
}

function localUnit(root: string, story: StorySnapshot, u: UnitSnapshot, index: ReceiptIndex, worktree: string | null, hooks: HookFact[], leases: LeaseFile[], failures: Record<string, ActFailure>): LocalUnit {
  const st = u.state;
  // S12 (gh-195/05): receipts in the machine dir display absolute; an older norn's record in a tree
  // relative to the unit's worktree when it is there, else the story's checkout; gh-195/06: a record
  // read from a unit worktree's branch (an older norn's), relative to that worktree
  const at = u.tree_root ?? (!story.run_state.tree ? undefined : worktree && existsSync(worktree) ? worktree : story.root);
  const lo = st ? lastOutcomeReceipt(index, st, at) : null;
  const cursor = st ? cursorRuns(index, st, at) : null;
  const mine = leases.filter((l) => l.repo === root && l.story === u.unit.story && l.slice === u.unit.slice);
  let step_runs: StepRunFacts[] | undefined;
  if (cursor) {
    step_runs = [...cursor.runs].map(([run_id, r]) => {
      const own = hooks.filter((h) => h.run_id === run_id);
      const last = own.at(-1);
      return { run_id, last_hook_at: last ? Date.parse(last.at) : null, ended: r.died || last?.event === "session_end" };
    });
  }
  const failure = failures[u.unit.key];
  return {
    snapshot: u,
    worktree,
    last_outcome_receipt: lo,
    cursor,
    unknown_launch: st ? unknownLaunch(u.unapplied) : null,
    lease: mine.find((l) => l.kind === "check") ?? mine.find((l) => l.kind === "agent") ?? null,
    hooks,
    ...(step_runs ? { step_runs } : {}),
    ...(failure ? { act_failure: failure } : {}),
  };
}

/** A unit's facts as its own files give them (X1); observe adds its worktree, run and git facts on top, the view its worktree and its run judged by lease. */
export function baseUnitFacts(
  lu: LocalUnit,
): Pick<UnitFacts, "unit" | "record" | "state" | "workflow" | "workflow_hash" | "errors" | "unapplied" | "last_outcome_receipt" | "lease" | "step_runs" | "act_failure" | "skills_drift"> {
  const u = lu.snapshot;
  return {
    unit: u.unit,
    record: u.record,
    state: u.state,
    workflow: u.workflow?.workflow ?? null,
    workflow_hash: u.workflow?.hash ?? null,
    errors: u.errors,
    unapplied: u.unapplied,
    last_outcome_receipt: lu.last_outcome_receipt,
    lease: lu.lease,
    ...(lu.step_runs ? { step_runs: lu.step_runs } : {}),
    ...(lu.act_failure ? { act_failure: lu.act_failure } : {}),
    ...(lu.skills_drift ? { skills_drift: lu.skills_drift } : {}),
  };
}

/**
 * A story's facts as its own files give them (X1); observe adds its claim, mailbox, remote, base and
 * git facts on top, the view its claim and caches. `workflows` and `config` are the caller's: the mode
 * (B10, B25) of a story whose story unit pins no workflow yet is the one it will start in (MO1).
 */
export function baseStoryFacts(
  ls: LocalStory,
  workflows: Readonly<Record<string, { workflow: Workflow | null } | undefined>>,
  config: Pick<ResolvedConfig, "mode" | "workflow">,
): Pick<StoryFacts, "key" | "slug" | "spec_dir" | "branch" | "frontmatter" | "frontmatter_error" | "mode" | "notes" | "rejected_mailbox" | "record_refused" | "record_unplaced" | "record_only"> {
  const s = ls.snapshot;
  const story = s.units[0];
  return {
    key: s.key,
    slug: s.slug,
    spec_dir: s.spec_dir,
    branch: storyBranch(s.key, s.slug),
    frontmatter: s.frontmatter,
    frontmatter_error: s.frontmatter_error,
    mode: storyMode(story?.state, story?.workflow?.workflow ?? workflows[s.frontmatter?.workflow ?? config.workflow]?.workflow, config),
    ...(ls.notes ? { notes: ls.notes } : {}),
    ...(ls.rejected ? { rejected_mailbox: ls.rejected } : {}),
    ...(ls.record_refused ? { record_refused: ls.record_refused } : {}),
    ...(ls.record_unplaced ? { record_unplaced: ls.record_unplaced } : {}),
    ...(s.record_only ? { record_only: true } : {}),
  };
}

/** F35/C5: the story unit's approve and re-entry receipts give its ready approval (BS10.2: with its time). */
function readyOf(story: StorySnapshot, u: UnitSnapshot | undefined, indexOf: (u: UnitSnapshot) => ReceiptIndex): { sha: string; at: string } | undefined {
  const wf = u?.workflow?.workflow;
  if (!u || !wf) return undefined;
  const ready = readyApproval(wf, receiptsOfKinds(story, u, ["approve", ...RE_ENTRY_KINDS], indexOf(u)));
  return ready ? { sha: ready.sha, at: ready.at } : undefined;
}

/**
 * A2/R5.3: the hook facts of a run — those naming its run id, and those naming none fired in its
 * worktree since it started. observe and the view (X1) pick them the same way.
 */
export function runHooks(hooks: readonly HookFact[], run: Pick<RunInfo, "run_id" | "started_at">, worktree: string | null): HookFact[] {
  return hooks.filter((h) => (h.run_id ? h.run_id === run.run_id : !!worktree && h.cwd.startsWith(worktree) && h.at >= run.started_at));
}

/** Run facts are observed for running units and for parked ones that keep their run (B2: is the session still there to answer into?). */
export const liveRun = (st: UnitState | null | undefined): boolean => !!st?.run && (st.status === "running" || st.status === "parked");

/**
 * R5.1: the unapplied `started` receipt (norn's own, auto) whose launch never reached `state.json`
 * — no session recorded, and no later receipt of the run's agent showing it ran. Null when none.
 */
function unknownLaunch(unapplied: readonly NumberedReceipt[]): (NumberedReceipt & { receipt: ReceiptOf<"started"> }) | null {
  const last = unapplied.filter((r) => r.receipt.kind === "started" && r.receipt.how === "auto" && r.receipt.by === "norn").at(-1) as (NumberedReceipt & { receipt: ReceiptOf<"started"> }) | undefined;
  if (!last || last.receipt.session) return null;
  if (unapplied.some((r) => r.n > last.n && r.receipt.by === "agent")) return null;
  return last;
}

/**
 * gh-195 D12 (B21): the story's rejected mailbox receipts still to show — those no answer or approval
 * applied to a unit of the story since has cleared. "Since" is the holder's own receipt order: a receipt
 * numbered past the unit's last one when the receipt was rejected (`seen`; a unit not seen then, any).
 * A gate rejection does not clear it.
 */
function openRejections(story: StorySnapshot, rejected: readonly RejectedMailboxReceipt[], indexOf: (u: UnitSnapshot) => ReceiptIndex): RejectedMailboxReceipt[] {
  const mine = rejected.filter((r) => r.story === story.key);
  if (!mine.length) return [];
  const accepted = story.units.flatMap((u) =>
    receiptsOfKinds(story, u, ["answer", "approve"], indexOf(u))
      .filter((r) => r.n <= (u.state?.applied_through ?? 0))
      .map((r) => ({ unit: u.unit.key, n: r.n })),
  );
  return mine.filter((x) => !accepted.some((r) => r.n > (x.seen[r.unit] ?? 0)));
}

/** Receipts of the given kinds in a unit's runs dir, ascending — read by file name, the others never opened. */
export function receiptsOfKinds(story: StorySnapshot, u: UnitSnapshot, kinds: readonly string[], index: ReceiptIndex = receiptIndex(u.path)): NumberedReceipt[] {
  const out: NumberedReceipt[] = [];
  for (const { n } of index.entries.filter((e) => kinds.includes(e.kind))) {
    const r = index.read(n, story.root);
    if (r && "receipt" in r) out.push(r);
  }
  return out;
}

/** The receipt that produced `state.last_outcome`, scanning newest receipts first (B3 Rework). */
function lastOutcomeReceipt(index: ReceiptIndex, state: UnitState, root: string | undefined): NumberedReceipt | null {
  const id = state.last_outcome?.receipt_id;
  if (!id) return null;
  const ns = index.entries
    .filter((e) => e.kind === "check" || e.kind === "done")
    .map((e) => e.n)
    .reverse()
    .slice(0, 50);
  for (const n of ns) {
    const r = index.read(n, root);
    if (r && "receipt" in r && r.receipt.receipt_id === id) return r;
  }
  return null;
}

/**
 * R5.3 + R5.1: the unit's `started` / `classify` receipts at its cursor step/attempt (newest first,
 * stopping at the first of another cursor), and every session id its `started` receipts recorded.
 */
function cursorRuns(index: ReceiptIndex, st: UnitState, root: string | undefined): CursorRuns {
  const runs = new Map<string, { died: boolean }>();
  const sessions = new Set<string>();
  const ns = index.entries.filter((e) => e.kind === "started" || e.kind === "classify").reverse();
  let atCursor = true;
  for (const { n } of ns) {
    const r = index.read(n, root);
    if (!r || !("receipt" in r)) continue;
    const rc = r.receipt;
    if (rc.kind === "started" && rc.session) sessions.add(rc.session.session_id);
    if (!atCursor) continue;
    if (rc.step !== st.step || rc.attempt !== st.attempt) {
      atCursor = false;
      continue;
    }
    if (!rc.run_id) continue;
    const cur = runs.get(rc.run_id) ?? { died: false };
    if (rc.kind === "classify" && (rc.outcome === "died" || rc.route === "retry")) cur.died = true;
    runs.set(rc.run_id, cur);
  }
  return { runs, sessions };
}
