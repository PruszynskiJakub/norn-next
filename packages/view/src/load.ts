/**
 * loadProjectView (X1): one read-only pass over local data — spec folders (main checkout
 * and story worktrees), runs/, the trace window, local claim refs and ~/.norn leases.
 * No network (no fetch, no ls-remote, no remote API) and no writes of any kind.
 */
import { existsSync, readdirSync, statSync } from "node:fs";
import { hostname, userInfo } from "node:os";
import { join } from "node:path";
import {
  actFailureItem,
  buildInbox,
  type ClaimState,
  effectiveMode,
  type Facts,
  type FileError,
  formatAge,
  heartbeatDown,
  nextCommand,
  type NumberedReceipt,
  openNotes,
  RECENT_MS,
  readyApproval,
  type RunFacts,
  type RunnerCapabilities,
  sliceWorktreePath,
  startCommandFor,
  type StoryFacts,
  stepOf,
  storyWorktreePath,
  type UnitFacts,
  type UnpushedRuns,
  type WorktreeFacts,
} from "@norn/core";
import { DEFAULT_CONFIG, type HookFact, type LeaseFile, type Mode, type ResolvedConfig, sliceBranch, storyBranch, type TraceEvent } from "@norn/schema";
import {
  classifyClaim,
  cachedDefaultBranch,
  defaultBaseRef,
  readBaseFacts,
  onlyNornCommitsSince,
  readPrFacts,
  lastTickAt,
  type LeaseEntry,
  type LeaseLiveness,
  listLeases,
  loadSnapshot,
  readEnvNorn,
  readActFailures,
  readLocalClaim,
  readTrace,
  readUnitMarker,
  type StorySnapshot,
  type UnitSnapshot,
  type UnpushedTarget,
  unpushedRuns,
  withSliceWorktrees,
} from "@norn/store";
import { mergeTimeline, receiptEntry, traceEntries, traceUnits } from "./timeline.ts";
import type { BaseSyncView, ClaimView, CounterView, PrView, ProjectView, RecentDone, RunView, SliceView, StoryView, TimelineEntry, UnitView } from "./types.ts";

export interface LoadProjectViewOptions {
  repoRoot: string;
  /** norn home (default NORN_HOME_DIR or ~/.norn) */
  home?: string;
  /** ms epoch; default Date.now() */
  now?: number;
  env?: Record<string, string | undefined>;
  /** `user@machine` whose claims count as `mine`; default this OS user and host */
  holder?: string;
  /** this machine's heartbeat id, also counted as `mine` */
  heartbeatId?: string | null;
  /** what the configured runner can do (R4.1); `open` makes Your turn show `norn open` (MO5) */
  runnerCapabilities?: RunnerCapabilities;
  /** story worktrees to scan before repoRoot; default: every `<repoRoot>-worktrees/<story>` folder */
  storyRoots?: string[];
  /** trace window lower bound (ISO); default 14 days before now */
  traceSince?: string;
  /** lease liveness check (default: holder pid + start time) */
  liveness?: LeaseLiveness;
}

const TRACE_WINDOW_MS = 14 * 86_400_000;
const STORY_DIR = /^(?:gh|gl)-[1-9][0-9]*-[a-z0-9]+(?:-[a-z0-9]+)*$/;

function push<T>(m: Map<string, T[]>, k: string, v: T): void {
  const list = m.get(k);
  if (list) list.push(v);
  else m.set(k, [v]);
}

export function defaultHolder(): string {
  let user = "user";
  try {
    user = userInfo().username || user;
  } catch {}
  return `${user}@${hostname()}`;
}

/** Story worktrees beside the repo (GR3): `<repo>-worktrees/<id>-<slug>`, slice worktrees (`--`) excluded. */
export function discoverStoryRoots(repoRoot: string): string[] {
  const base = `${repoRoot.replace(/\/+$/, "")}-worktrees`;
  try {
    return readdirSync(base)
      .filter((n) => STORY_DIR.test(n) && !n.includes("--") && statSync(join(base, n)).isDirectory())
      .sort()
      .map((n) => join(base, n));
  } catch {
    return [];
  }
}

/** The slice's worktree (`<story worktree>--<nn>-<slug>`, GR3) when it exists and its `.norn-unit` marker names that slice. */
export function markedSliceWorktree(storyWt: string, story: StorySnapshot, slice: string): string | null {
  const file = story.slices.find((s) => s.key === slice);
  const dir = story.units.find((u) => u.unit.slice === slice)?.unit.dir;
  const nn = file?.nn ?? dir?.split("-")[0];
  const slug = file?.slug ?? dir?.replace(/^\d+-/, "");
  if (!nn || !slug) return null;
  const path = sliceWorktreePath(storyWt, nn, slug);
  return readUnitMarker(path).marker?.slice === slice ? path : null;
}

function worktreeFacts(path: string): WorktreeFacts {
  const exists = existsSync(path);
  const slot = exists ? Number(readEnvNorn(path)?.NORN_SLOT ?? Number.NaN) : Number.NaN;
  return {
    path,
    exists,
    marker: exists && readUnitMarker(path).exists,
    status: null,
    last_commit_at: null,
    last_file_change_at: null,
    slot: Number.isFinite(slot) ? slot : null,
  };
}

function claimView(c: ClaimState): ClaimView {
  if (c.state === "none") return { state: "none", holder: null, expires_at: null, unclaimed: true };
  if (c.state === "corrupt") return { state: "corrupt", holder: null, expires_at: null, unclaimed: false };
  return { state: c.state, holder: c.blob.holder, expires_at: c.blob.expires_at, unclaimed: c.state === "expired" };
}

function counters(u: UnitSnapshot): CounterView[] {
  const max = u.workflow?.workflow.counters ?? {};
  const live = u.state?.counters ?? {};
  return Object.keys({ ...max, ...live })
    .sort()
    .map((name) => ({ name, value: live[name] ?? 0, max: max[name]?.max ?? null }));
}

interface Ctx {
  now: number;
  config: ResolvedConfig;
  runner: string | null;
  /** R5.5: the heartbeat is down — auto steps get no manual start hint */
  heartbeatDown: boolean;
}

function unitView(u: UnitSnapshot, story: StorySnapshot, sf: StoryFacts, uf: UnitFacts, ctx: Ctx, title: string, workflow: string): UnitView {
  const st = u.state;
  const step = st && u.workflow ? stepOf(u.workflow.workflow, st.step) : null;
  const eff = effectiveMode(sf.mode, step?.type === "agent" && !!step.attended, ctx.runner);
  const corrupt = u.errors.length > 0 || st?.status === "corrupt";
  const since = st ? (st.park?.since ?? (st.status === "running" ? st.run?.started_at : null) ?? (st.status === "done" ? st.updated_at : st.step_entered_at)) : null;
  // R5.5 (A8): while the heartbeat is down an auto step waits for `norn watch`, not a person
  const waitsForHeartbeat = ctx.heartbeatDown && step?.type === "agent" && eff.mode === "auto";
  const start = step?.type === "agent" ? (waitsForHeartbeat ? "norn watch" : startCommandFor(uf, sf, ctx.config)) : undefined;
  const failure = actFailureItem(sf, uf) ? uf.act_failure : undefined;
  return {
    key: u.unit.key,
    story: story.key,
    slice: u.unit.slice,
    title,
    url: story.frontmatter?.url ?? null,
    workflow: st?.workflow ?? workflow,
    mode: sf.mode,
    effective_mode: eff.mode,
    mode_downgraded: eff.downgraded,
    claim: claimView(sf.claim),
    status: corrupt ? "corrupt" : (st?.status ?? "not_started"),
    step: st?.step ?? null,
    attempt: st?.attempt ?? null,
    counters: counters(u),
    park: st?.park ? { kind: st.park.kind, reason: st.park.reason, since: st.park.since } : null,
    since,
    age: since ? formatAge(ctx.now - Date.parse(since)) : null,
    last_outcome: st?.last_outcome ? { step: st.last_outcome.step, outcome: st.last_outcome.outcome, at: st.last_outcome.at } : null,
    next: corrupt ? `norn why ${u.unit.key}` : nextCommand(u.unit.key, st, start),
    updated_at: st?.updated_at ?? null,
    errors: u.errors,
    act_failure: failure ? { effect: failure.effect, reason: failure.reason, at: failure.at, tick_id: failure.tick_id } : null,
  };
}

/** Build the read model. Async only because claim refs are read through local git. */
/** BS1/BS3: the last base measurement (`trace/base.json`) and the newest base merge in the story unit's receipts. */
function baseSync(sf: StoryFacts, receipts: readonly NumberedReceipt[], branch: string): BaseSyncView | null {
  let last: BaseSyncView["last_update"] = null;
  for (const { receipt: r } of [...receipts].sort((a, b) => b.n - a.n)) {
    if (r.kind === "classify" && r.outcome === "done" && r.base?.merged && r.base.head) last = { sha: r.base.head, base_sha: r.base.sha, at: r.at, step: r.step };
    else if (r.kind === "done" && r.base_merge?.merge) last = { sha: r.base_merge.merge, base_sha: r.base_merge.sha, at: r.at, step: r.step };
    if (last) break;
  }
  const b = sf.base;
  if (!b && !last) return null;
  return { branch: b ? b.ref.replace(/^refs\/(remotes\/[^/]+|heads)\//, "") : branch, behind: b?.behind ?? null, ahead: b?.ahead ?? null, conflicts: b?.conflicts ?? [], last_update: last };
}

function prView(seen: StoryFacts["pr_seen"]): PrView | null {
  const pr = seen?.pr;
  return pr ? { number: pr.number, url: pr.url, state: pr.state, is_draft: pr.is_draft, seen_at: new Date(seen.observed_at).toISOString() } : null;
}

export async function loadProjectView(opts: LoadProjectViewOptions): Promise<ProjectView> {
  const now = opts.now ?? Date.now();
  const holder = opts.holder ?? defaultHolder();
  const errors: FileError[] = [];

  const snap = loadSnapshot({
    repoRoot: opts.repoRoot,
    storyRoots: opts.storyRoots ?? discoverStoryRoots(opts.repoRoot),
    home: opts.home,
    env: opts.env,
    includeApplied: true,
  });
  let config = DEFAULT_CONFIG;
  if (snap.config.ok) config = snap.config.config;
  else errors.push(...snap.config.errors);
  errors.push(...snap.workflows.errors);
  const runner = config.runner?.adapter ?? null;
  const lastTick = lastTickAt(opts.repoRoot);
  const failures = readActFailures(opts.repoRoot);
  const ctx: Ctx = { now, config, runner, heartbeatDown: false };

  // Local reads in parallel: claim refs (no fetch) and machine leases.
  const [claims, leases, trace] = await Promise.all([
    Promise.all(snap.stories.map((s) => readLocalClaim(opts.repoRoot, s.key).catch(() => ({ state: "none" }) as const))),
    listLeases(snap.home, opts.liveness).catch((e: unknown) => {
      errors.push({ file: "leases", errors: [{ path: "", message: (e as Error).message }] });
      return { live: [] as LeaseEntry[], dead: [] as LeaseEntry[], errors: [] as FileError[] };
    }),
    Promise.resolve(readTrace(opts.repoRoot, { since: opts.traceSince ?? new Date(now - TRACE_WINDOW_MS).toISOString() })),
  ]);
  errors.push(...leases.errors, ...trace.errors);

  const traceByUnit = new Map<string, TraceEvent[]>();
  const hooksByRun = new Map<string, HookFact[]>();
  for (const ev of trace.events) {
    for (const k of traceUnits(ev)) push(traceByUnit, k, ev);
    if (ev.type === "hook" && ev.fact.run_id) push(hooksByRun, ev.fact.run_id, ev.fact);
  }
  const leaseByRun = new Map<string, { entry: LeaseEntry; alive: boolean }>();
  for (const [list, alive] of [[leases.dead, false], [leases.live, true]] as const)
    for (const entry of list) if (entry.lease.run_id && entry.lease.kind !== "slot") leaseByRun.set(entry.lease.run_id, { entry, alive });

  const me = { heartbeat_id: opts.heartbeatId ?? null };

  // R2.3: on a story not held here, local runs/ work that never reached the record (an inbox Check item)
  const remoteName = config.remote.git_remote;
  const baseRef = defaultBaseRef(opts.repoRoot, remoteName, config.base_branch);
  const baseFacts = readBaseFacts(opts.repoRoot);
  const prSeen = readPrFacts(opts.repoRoot);
  const unpushed = await Promise.all(
    snap.stories.map(async (read, i): Promise<UnpushedRuns[]> => {
      const c = classifyClaim(claims[i] ?? { state: "none" }, me, now);
      if (c.state === "mine" || c.state === "corrupt" || ((c.state === "other" || c.state === "expired") && (c.blob.holder === holder || c.blob.heartbeat_id === me.heartbeat_id))) return [];
      const storyWt = storyWorktreePath(opts.repoRoot, read.key, read.slug);
      if (readUnitMarker(storyWt).marker?.story !== read.key) return [];
      const targets: UnpushedTarget[] = [{ unit: read.key, dir: read.units[0]?.unit.dir ?? "_story", cwd: storyWt, branch: storyBranch(read.key, read.slug) }];
      for (const u of read.units) {
        const wt = u.unit.slice ? markedSliceWorktree(storyWt, read, u.unit.slice) : null;
        const file = read.slices.find((f) => f.key === u.unit.slice);
        if (wt && file) targets.push({ unit: u.unit.key, dir: u.unit.dir, cwd: wt, branch: sliceBranch(read.key, file.nn, file.slug) });
      }
      const found = await unpushedRuns(remoteName, baseRef, read.spec_dir, targets).catch(() => []);
      return found.map((f) => ({ unit: f.unit, files: f.files }));
    }),
  );
  // F35/C5: the ready approval's head, voided by a later re-entry; and whether only norn moved the PR head since
  const readyHeads = await Promise.all(
    snap.stories.map(async (story): Promise<{ ready_head_sha?: string; ready_approved_at?: string; ready_head_norn?: string }> => {
      const wf = story.units[0]?.workflow?.workflow;
      const receipts = story.units[0]?.receipts;
      const ready = wf && receipts ? readyApproval(wf, receipts) : undefined;
      if (!ready) return {};
      const sha = ready.sha;
      const prHead = prSeen[story.key]?.pr?.head_sha;
      const norn = !!prHead && prHead !== sha && (await onlyNornCommitsSince(opts.repoRoot, sha, prHead, story.key).catch(() => false));
      return { ready_head_sha: sha, ready_approved_at: ready.at, ...(norn ? { ready_head_norn: prHead } : {}) };
    }),
  );
  const runs: RunView[] = [];
  const timeline: Record<string, TimelineEntry[]> = {};
  const storyFacts: StoryFacts[] = [];
  const stories: StoryView[] = [];
  const views: Array<() => void> = [];

  snap.stories.forEach((read, i) => {
    const storyWt = storyWorktreePath(opts.repoRoot, read.key, read.slug);
    // A slice running in its own worktree keeps its live runs/ there (§7); same rule as observe.
    const story = withSliceWorktrees(read, (slice) => markedSliceWorktree(storyWt, read, slice), { includeApplied: true });
    let claim = classifyClaim(claims[i] ?? { state: "none" }, me, now);
    if (claim.state === "other" && claim.blob.holder === holder) claim = { ...claim, state: "mine" };
    const storyState = story.units[0]?.state ?? null;
    const mode: Mode = storyState?.mode ?? config.default_mode;

    const units: UnitFacts[] = story.units.map((u) => {
      const sl = u.unit.slice === null ? null : story.slices.find((s) => s.key === u.unit.slice);
      const wt = u.unit.slice === null ? storyWt : sliceWorktreePath(storyWt, sl?.nn ?? u.unit.dir.split("-")[0] ?? "", sl?.slug ?? u.unit.dir.replace(/^\d+-/, ""));
      const r = u.state?.run ?? null;
      const lease = r ? leaseByRun.get(r.run_id) : undefined;
      const hooks = r ? (hooksByRun.get(r.run_id) ?? []) : [];
      const lastHook = hooks.length ? Math.max(...hooks.map((h) => Date.parse(h.at))) : null;
      const run: RunFacts | null = r
        ? {
            run_id: r.run_id,
            session: r.session ? { ...r.session, ...(r.process ? { process: r.process } : {}) } : null,
            process_alive: lease ? lease.alive : null,
            pane: null,
            hooks,
            last_hook_at: lastHook,
            last_activity_at: lastHook,
            transcript: r.transcript ?? null,
          }
        : null;
      return {
        unit: u.unit,
        state: u.state,
        workflow: u.workflow?.workflow ?? null,
        workflow_hash: u.workflow?.hash ?? null,
        errors: u.errors,
        unapplied: u.unapplied,
        last_check: null,
        last_findings: null,
        last_outcome_receipt: (u.receipts ?? []).find((r) => !!u.state?.last_outcome && r.receipt.receipt_id === u.state.last_outcome.receipt_id) ?? null,
        worktree: worktreeFacts(wt),
        run,
        lease: (lease?.entry.lease as LeaseFile | undefined) ?? null,
        uncommitted: false,
        ...(failures[u.unit.key] ? { act_failure: failures[u.unit.key] } : {}),
      };
    });

    const sf: StoryFacts = {
      key: story.key,
      slug: story.slug,
      spec_dir: story.spec_dir,
      branch: storyBranch(story.key, story.slug),
      frontmatter: story.frontmatter,
      frontmatter_error: story.frontmatter_error,
      worktree: units[0]?.worktree ?? null,
      claim,
      mailbox: undefined,
      issue: undefined,
      pr: undefined,
      // C1: the PR as this checkout's last sync saw it — merge (BS10), retarget (BS11), head changed (F35)
      ...(prSeen[story.key] && story.frontmatter?.status !== "done" && story.frontmatter?.status !== "dropped" ? { pr_seen: prSeen[story.key] } : {}),
      ...readyHeads[i],
      units,
      slices: story.slices,
      mode,
      ...(unpushed[i]?.length ? { unpushed_runs: unpushed[i] } : {}),
      // NT2/NT3: open notes of the story, same rule as observe
      ...((notes) => (notes.length ? { notes } : {}))(openNotes(story.units.map((u) => ({ unit: u.unit.key, receipts: u.receipts ?? [] })))),
      // BS1: the last base measurement of this checkout's ticks (stale items, merge-item detail)
      ...(baseFacts[story.key] && story.frontmatter?.status !== "done" && story.frontmatter?.status !== "dropped" ? { base: baseFacts[story.key] } : {}),
    };
    storyFacts.push(sf);

    // Runs and timelines.
    story.units.forEach((u, j) => {
      const r = u.state?.run;
      const uf = units[j] as UnitFacts;
      if (r) {
        const lease = leaseByRun.get(r.run_id);
        runs.push({
          unit: u.unit.key,
          story: story.key,
          slice: u.unit.slice,
          run_id: r.run_id,
          step: r.step,
          attempt: r.attempt,
          started_at: r.started_at,
          how: r.how,
          agent: r.agent ?? null,
          session: r.session ?? null,
          alive: lease ? lease.alive : null,
          lease: lease ? { kind: lease.entry.lease.kind, file: lease.entry.file, slot: lease.entry.lease.slot ?? null } : null,
          last_hook_at: uf.run?.last_hook_at ? new Date(uf.run.last_hook_at).toISOString() : null,
          // R4.4: the tick's last classification of this run (until the cursor moves)
          classified:
            u.state?.status === "running" && u.state.last_outcome?.source === "classified" && u.state.last_outcome.step === r.step
              ? { outcome: u.state.last_outcome.outcome, at: u.state.last_outcome.at }
              : null,
          machine: r.machine ?? null,
        });
      }
      const entries = (u.receipts ?? u.unapplied).map(receiptEntry);
      for (const ev of traceByUnit.get(u.unit.key) ?? []) entries.push(...traceEntries(ev, u.unit.key));
      timeline[u.unit.key] = mergeTimeline(entries);
    });

    // Unit views — built once the heartbeat state is known (R5.5), below.
    views.push(() => {
      const storyTitle = story.frontmatter?.title ?? story.key;
      const storyUnit = story.units[0] as UnitSnapshot;
      const base = unitView(storyUnit, story, sf, units[0] as UnitFacts, ctx, storyTitle, story.frontmatter?.workflow ?? config.default_workflow);
      const slices: SliceView[] = story.units.slice(1).map((u, k) => {
        const file = story.slices.find((s) => s.key === u.unit.slice);
        const fm = file?.frontmatter ?? null;
        const v = unitView(u, story, sf, units[k + 1] as UnitFacts, ctx, fm?.title ?? u.unit.key, fm?.workflow ?? config.default_slice_workflow);
        return {
          ...v,
          slice: u.unit.slice as string,
          nn: file?.nn ?? u.unit.dir.split("-")[0] ?? "",
          slice_status: fm?.status ?? null,
          depends_on: fm?.depends_on ?? [],
          integrated: fm?.status === "integrated",
          errors: file?.error ? [file.error, ...v.errors] : v.errors,
        };
      });
      stories.push({
        ...base,
        slice: null,
        branch: sf.branch,
        pr: prView(prSeen[story.key]),
        notes: sf.notes ?? [],
        base_sync: baseSync(sf, storyUnit.receipts ?? [], config.base_branch ?? cachedDefaultBranch(opts.repoRoot) ?? "main"),
        story_status: story.frontmatter?.status ?? null,
        spec_dir: story.spec_dir,
        root: story.root,
        slices,
        errors: story.frontmatter_error ? [story.frontmatter_error, ...base.errors] : base.errors,
      });
    });
  });

  const facts: Facts = {
    tick_id: "view",
    now,
    repo: { root: opts.repoRoot, default_branch: config.base_branch ?? cachedDefaultBranch(opts.repoRoot) ?? "main", remote: config.remote.git_remote },
    machine: {
      holder,
      heartbeat_id: opts.heartbeatId ?? null,
      runner,
      ...(runner && opts.runnerCapabilities ? { runner_capabilities: { ...opts.runnerCapabilities } } : {}),
      leases: leases.live.map((e) => e.lease),
      dead_leases: leases.dead.map((e) => e.lease),
    },
    remote: { synced_at: null, issues: undefined },
    stories: storyFacts,
    heartbeat: { last_tick_at: lastTick },
    orphans: { worktrees: [], branches: [] },
  };
  // R5.5 (N3): is this checkout's heartbeat down while it holds auto work?
  const down = heartbeatDown(facts, config);
  ctx.heartbeatDown = !!down;
  for (const build of views) build();
  const heartbeat = { holder, last_tick_at: lastTick === null ? null : new Date(lastTick).toISOString(), age: lastTick === null ? null : formatAge(now - lastTick), down: !!down };

  const recently_done: RecentDone[] = stories
    .flatMap((s) => [s, ...s.slices])
    .filter((u) => u.status === "done" && u.updated_at && now - Date.parse(u.updated_at) <= RECENT_MS)
    .map((u) => ({ unit: u.key, title: u.title, done_at: u.updated_at as string, age: formatAge(now - Date.parse(u.updated_at as string)) }))
    .sort((a, b) => Date.parse(b.done_at) - Date.parse(a.done_at) || a.unit.localeCompare(b.unit));

  runs.sort((a, b) => Date.parse(a.started_at) - Date.parse(b.started_at) || a.unit.localeCompare(b.unit));

  return {
    at: new Date(now).toISOString(),
    repo: opts.repoRoot,
    holder,
    runner,
    heartbeat,
    stories,
    inbox: buildInbox(facts, config),
    runs,
    timeline,
    recently_done,
    errors,
  };
}
