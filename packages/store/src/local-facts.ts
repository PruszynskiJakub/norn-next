/**
 * loadLocalFacts (H2, X1): the facts of a checkout read from its own files — no network, no port, no
 * writes. The store snapshot with each slice unit re-read from its own worktree (§7), this machine's
 * leases (K1, K3), each unit's hook facts from the trace (R5.1, R5.3), act failures, the PR and base caches (C1,
 * BS1) and, per unit, what its receipts say: the last outcome receipt (B3), the runs of its cursor step
 * (R5.3), an unknown launch (R5.1); per story its open notes (NT2/NT3) and ready approval (F35/C5).
 * observe (cli) extends these with git, runner, process and remote facts; the view (X1) reads them
 * as they are (`loadProjectView`), so `norn inbox` and the tick see one world. Its one write is the
 * tick's hook-file backfill (`backfillHooks`, D5).
 */
import { existsSync, readdirSync } from "node:fs";
import { type ActFailure, type FileError, type NumberedReceipt, openNotes, RE_ENTRY_KINDS, readyApproval, type StepRunFacts, type StoryFacts, storyWorktreePath } from "@norn/core";
import { DEFAULT_CONFIG, type HookFact, type LeaseFile, parseDuration, parseReceiptFileName, type ReceiptOf, type RunInfo, type UnitState } from "@norn/schema";
import { type BaseFactsCache, type PrFactsCache, readBaseFacts, readPrFacts } from "./base.ts";
import { readActFailures } from "./heartbeat.ts";
import { type BackfillRun, backfillHookFiles } from "./hook-backfill.ts";
import { type LeaseListing, type LeaseLiveness, listLeases } from "./leases.ts";
import { receiptsDir } from "./paths.ts";
import { readReceipt } from "./receipts.ts";
import { loadSnapshot, type RepoSnapshot, type StorySnapshot, type UnitSnapshot, withSliceWorktrees } from "./snapshot.ts";
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
  /** the last outcome receipt when it is a failed check (B3) */
  last_check: NumberedReceipt | null;
  /** the last outcome receipt when it is a `done` with findings (B3) */
  last_findings: NumberedReceipt | null;
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
}

export interface LocalFacts {
  snapshot: RepoSnapshot;
  /** in snapshot story order */
  stories: LocalStory[];
  leases: LeaseListing;
  failures: Record<string, ActFailure>;
  /** C1: the PR cache as the last sync left it */
  pr_seen: PrFactsCache;
  /** BS1: the base measurement cache as the last tick left it */
  base: BaseFactsCache;
}

export async function loadLocalFacts(root: string, opts: LocalFactsOptions): Promise<LocalFacts> {
  const now = opts.now;
  const includeApplied = opts.includeApplied;
  const snapshot = loadSnapshot({ repoRoot: root, storyRoots: [...opts.storyWorktrees.values()], home: opts.home, env: opts.env, baseRef: opts.baseRef, includeApplied });
  const leases = await listLeases(snapshot.home, opts.liveness).catch((e: unknown): LeaseListing => {
    if (!opts.reportLeaseErrors) throw e;
    return { live: [], dead: [], errors: [{ file: "leases", errors: [{ path: "", message: (e as Error).message }] } satisfies FileError] };
  });
  const live = leases.live.map((e) => e.lease);
  const stalledMs = opts.stalledMs ?? parseDuration((snapshot.config.ok ? snapshot.config.config : DEFAULT_CONFIG).limits.stalled);

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
  const stories = placed.map(({ s, storyWt, units: us }): LocalStory => {
    const units = us.map(({ u, worktree }) => localUnit(root, s, u, worktree, hooksOf.get(u) ?? [], live, failures));
    const ready = readyOf(s, s.units[0]);
    const notes = openNotes(s.units.map((u) => ({ unit: u.unit.key, receipts: receiptsOfKinds(s, u, ["done", "approve"]) })));
    return { snapshot: s, worktree: storyWt, units, ...(notes.length ? { notes } : {}), ...(ready ? { ready } : {}) };
  });
  return { snapshot, stories, leases, failures, pr_seen: readPrFacts(root), base: readBaseFacts(root) };
}

function localUnit(root: string, story: StorySnapshot, u: UnitSnapshot, worktree: string | null, hooks: HookFact[], leases: LeaseFile[], failures: Record<string, ActFailure>): LocalUnit {
  const st = u.state;
  // receipts display relative to the unit's worktree when it is there, else the story's checkout
  const at = worktree && existsSync(worktree) ? worktree : story.root;
  const lo = st ? lastOutcomeReceipt(u.path, st, at) : null;
  const cursor = st ? cursorRuns(u.path, st, at) : null;
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
    last_check: lo?.receipt.kind === "check" && lo.receipt.outcome === "fail" ? lo : null,
    last_findings: lo?.receipt.kind === "done" && lo.receipt.findings?.length ? lo : null,
    cursor,
    unknown_launch: st ? unknownLaunch(u.unapplied) : null,
    lease: mine.find((l) => l.kind === "check") ?? mine.find((l) => l.kind === "agent") ?? null,
    hooks,
    ...(step_runs ? { step_runs } : {}),
    ...(failure ? { act_failure: failure } : {}),
  };
}

/** F35/C5: the story unit's approve and re-entry receipts give its ready approval (BS10.2: with its time). */
function readyOf(story: StorySnapshot, u: UnitSnapshot | undefined): { sha: string; at: string } | undefined {
  const wf = u?.workflow?.workflow;
  if (!u || !wf) return undefined;
  const ready = readyApproval(wf, receiptsOfKinds(story, u, ["approve", ...RE_ENTRY_KINDS]));
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

/** Receipts of the given kinds in a unit's runs dir, ascending — read by file name, the others never opened. */
export function receiptsOfKinds(story: StorySnapshot, u: UnitSnapshot, kinds: readonly string[]): NumberedReceipt[] {
  let names: string[];
  try {
    names = readdirSync(receiptsDir(u.path));
  } catch {
    return [];
  }
  const out: NumberedReceipt[] = [];
  const ns = names
    .map(parseReceiptFileName)
    .filter((p): p is { n: number; kind: string } => !!p && kinds.includes(p.kind))
    .map((p) => p.n)
    .sort((a, b) => a - b);
  for (const n of ns) {
    const r = readReceipt(u.path, n, story.root);
    if (r && "receipt" in r) out.push(r);
  }
  return out;
}

/** The receipt that produced `state.last_outcome`, scanning newest receipts first (B3 Rework). */
function lastOutcomeReceipt(runsDir: string, state: UnitState, root: string): NumberedReceipt | null {
  const id = state.last_outcome?.receipt_id;
  if (!id) return null;
  let names: string[];
  try {
    names = readdirSync(receiptsDir(runsDir));
  } catch {
    return null;
  }
  const ns = names
    .map(parseReceiptFileName)
    .filter((p): p is { n: number; kind: string } => !!p && (p.kind === "check" || p.kind === "done"))
    .map((p) => p.n)
    .sort((a, b) => b - a)
    .slice(0, 50);
  for (const n of ns) {
    const r = readReceipt(runsDir, n, root);
    if (r && "receipt" in r && r.receipt.receipt_id === id) return r;
  }
  return null;
}

/**
 * R5.3 + R5.1: the unit's `started` / `classify` receipts at its cursor step/attempt (newest first,
 * stopping at the first of another cursor), and every session id its `started` receipts recorded.
 */
function cursorRuns(runsDir: string, st: UnitState, root: string): CursorRuns {
  const runs = new Map<string, { died: boolean }>();
  const sessions = new Set<string>();
  let names: string[];
  try {
    names = readdirSync(receiptsDir(runsDir));
  } catch {
    return { runs, sessions };
  }
  const ns = names
    .map(parseReceiptFileName)
    .filter((p): p is { n: number; kind: string } => !!p && (p.kind === "started" || p.kind === "classify"))
    .sort((a, b) => b.n - a.n);
  let atCursor = true;
  for (const { n } of ns) {
    const r = readReceipt(runsDir, n, root);
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
