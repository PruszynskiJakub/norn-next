/**
 * loadProjectView (X1): one read-only pass over local data — the checkout's local facts as observe
 * reads them (`loadLocalFacts`: spec folders in the main checkout and story worktrees, runs/, hook
 * facts, caches, ~/.norn leases) and local claim refs. No trace day file (B1, B2, D1): timelines are
 * a separate read, `loadTimelines`.
 * No network (no fetch, no ls-remote, no remote API) and no writes of any kind.
 */
import { existsSync } from "node:fs";
import {
  cmd,
  actFailureItem,
  buildInbox,
  checkRunningSince,
  type ClaimState,
  effectiveMode,
  type Facts,
  type FileError,
  formatAge,
  heartbeatDown,
  nextCommand,
  type NumberedReceipt,
  RECENT_MS,
  type RunFacts,
  type RunnerCapabilities,
  startCommandFor,
  type StoryFacts,
  stepOf,
  type UnitFacts,
  type UnpushedRuns,
  type WorktreeFacts,
} from "@norn/core";
import { DEFAULT_CONFIG, type HookFact, type Mode, type ResolvedConfig, sliceBranch, storyBranch } from "@norn/schema";
import {
  cachedDefaultBranch,
  classifyClaim,
  defaultBaseRef,
  lastTickAt,
  type LeaseEntry,
  type LeaseLiveness,
  type LocalUnit,
  bindNornHome,
  loadLocalFacts,
  machineHolder,
  onlyNornCommitsSince,
  readEnvNorn,
  readLocalClaim,
  runHooks,
  scanWorktrees,
  type StorySnapshot,
  type UnitSnapshot,
  type UnpushedTarget,
  unpushedRuns,
} from "@norn/store";
import type { BaseSyncView, ClaimView, CounterView, PrView, ProjectView, RecentDone, RunView, SliceView, StoryView, UnitView } from "./types.ts";

export interface LoadProjectViewOptions {
  repoRoot: string;
  /** norn home (default NORN_HOME_DIR or ~/.norn) */
  home?: string;
  /** ms epoch; default Date.now() */
  now?: number;
  env?: Record<string, string | undefined>;
  /** `user@machine` whose claims count as `mine`; default this machine's (`machineHolder`, R7.2) */
  holder?: string;
  /** this machine's heartbeat id, also counted as `mine` */
  heartbeatId?: string | null;
  /** what the configured runner can do (R4.1); `open` makes Your turn show `norn story start` (MO5) */
  runnerCapabilities?: RunnerCapabilities;
  /** lease liveness check (default: holder pid + start time) */
  liveness?: LeaseLiveness;
}

/** A worktree as the view sees it: on disk and its slot; git status is not read (no git, X1). Null when absent, as observe. */
function worktreeFacts(path: string | null): WorktreeFacts | null {
  if (!path || !existsSync(path)) return null;
  const slotRaw = readEnvNorn(path)?.NORN_SLOT;
  return {
    path,
    exists: true,
    status: null,
    last_commit_at: null,
    last_file_change_at: null,
    slot: slotRaw !== undefined && /^\d+$/.test(slotRaw) ? Number(slotRaw) : null,
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
  const checkSince = checkRunningSince(step, uf);
  const since = st ? (st.park?.since ?? (st.status === "running" ? st.run?.started_at : null) ?? checkSince ?? (st.status === "done" ? st.updated_at : st.step_entered_at)) : null;
  // R5.5 (A8): while the heartbeat is down an auto step waits for `norn watch`, not a person
  const waitsForHeartbeat = ctx.heartbeatDown && step?.type === "agent" && eff.mode === "auto";
  const start = step?.type === "agent" ? (waitsForHeartbeat ? cmd.watch() : startCommandFor(uf, sf, ctx.config)) : undefined;
  const failure = actFailureItem(sf, uf) ? uf.act_failure : undefined;
  return {
    key: u.unit.key,
    story: story.key,
    slice: u.unit.slice,
    title,
    url: story.frontmatter?.url ?? null,
    workflow: st?.workflow ?? workflow,
    round: st ? (st.round ?? 1) : null,
    mode: sf.mode,
    effective_mode: eff.mode,
    mode_downgraded: eff.downgraded,
    claim: claimView(sf.claim),
    status: corrupt ? "corrupt" : (st?.status ?? "not_started"),
    step: st?.step ?? null,
    step_type: step?.type ?? null,
    attempt: st?.attempt ?? null,
    counters: counters(u),
    park: st?.park ? { kind: st.park.kind, reason: st.park.reason, since: st.park.since } : null,
    ...(checkSince ? { check_running: true as const } : {}),
    since,
    age: since ? formatAge(ctx.now - Date.parse(since)) : null,
    last_outcome: st?.last_outcome ? { step: st.last_outcome.step, outcome: st.last_outcome.outcome, at: st.last_outcome.at } : null,
    next: corrupt ? cmd.runView(u.unit.key, { why: true }) : nextCommand(u.unit.key, st, start),
    updated_at: st?.updated_at ?? null,
    errors: u.errors,
    act_failure: failure ? { effect: failure.effect, reason: failure.reason, at: failure.at, tick_id: failure.tick_id } : null,
  };
}

/**
 * A unit's facts as the view has them: what loadLocalFacts read (B3, R5.1, R5.3), its worktree as
 * on disk, and its run from the state record — hooks picked as observe picks them (`runHooks`), the
 * process judged by its lease (the view has no process or runner port).
 */
function unitFacts(lu: LocalUnit, hooks: readonly HookFact[], leaseByRun: ReadonlyMap<string, { entry: LeaseEntry; alive: boolean }>): UnitFacts {
  const u = lu.snapshot;
  const st = u.state;
  const worktree = worktreeFacts(lu.worktree);
  let run: RunFacts | null = null;
  const unknown = lu.unknown_launch;
  if (unknown && st) {
    // R5.1: a launch that never reached state.json — its hooks, and the agent session they name
    const r = unknown.receipt;
    const mine = hooks.filter((h) => h.run_id === r.run_id);
    const last = mine.at(-1);
    const last_hook_at = last ? Date.parse(last.at) : null;
    run = {
      run_id: r.run_id as string,
      session: null,
      process_alive: null,
      pane: null,
      hooks: mine,
      last_hook_at,
      last_activity_at: last_hook_at,
      transcript: [...mine].reverse().find((h) => h.transcript)?.transcript ?? null,
      launch_unknown: { n: unknown.n, at: Date.parse(r.at), agent_session_id: mine.findLast((h) => h.agent_session_id)?.agent_session_id ?? null },
    };
  } else if (st?.run) {
    const r = st.run;
    const lease = leaseByRun.get(r.run_id);
    const mine = runHooks(hooks, r, worktree?.path ?? null);
    const last = mine.at(-1);
    const last_hook_at = last ? Date.parse(last.at) : null;
    run = {
      run_id: r.run_id,
      session: r.session ? { ...r.session, ...(r.process ? { process: r.process } : {}) } : null,
      process_alive: lease ? lease.alive : null,
      pane: null,
      hooks: mine,
      last_hook_at,
      last_activity_at: last_hook_at,
      transcript: [...mine].reverse().find((h) => h.transcript)?.transcript ?? r.transcript ?? null,
    };
  }
  return {
    unit: u.unit,
    record: u.record,
    state: st,
    workflow: u.workflow?.workflow ?? null,
    workflow_hash: u.workflow?.hash ?? null,
    errors: u.errors,
    unapplied: u.unapplied,
    last_check: lu.last_check,
    last_findings: lu.last_findings,
    last_outcome_receipt: lu.last_outcome_receipt,
    worktree,
    run,
    lease: lu.lease,
    uncommitted: false,
    ...(lu.step_runs ? { step_runs: lu.step_runs } : {}),
    ...(lu.act_failure ? { act_failure: lu.act_failure } : {}),
  };
}

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
  const holder = opts.holder ?? machineHolder(opts.env ?? process.env);
  const errors: FileError[] = [];

  // H2/X1: the local facts observe reads, from the worktrees found on disk (GR3, A3)
  if (opts.home) bindNornHome(opts.repoRoot, opts.home);
  const wts = scanWorktrees(opts.repoRoot);
  const local = await loadLocalFacts(opts.repoRoot, {
    now,
    home: opts.home,
    env: opts.env,
    storyWorktrees: wts.stories,
    sliceWorktrees: wts.slices,
    liveness: opts.liveness,
    includeApplied: true,
    reportLeaseErrors: true,
  });
  const snap = local.snapshot;
  let config = DEFAULT_CONFIG;
  if (snap.config.ok) config = snap.config.config;
  else errors.push(...snap.config.errors);
  errors.push(...snap.workflows.errors);
  const runner = config.runner?.adapter ?? null;
  const lastTick = lastTickAt(opts.repoRoot);
  const ctx: Ctx = { now, config, runner, heartbeatDown: false };

  const leases = local.leases;
  const claims = await Promise.all(local.stories.map((s) => readLocalClaim(opts.repoRoot, s.snapshot.key).catch(() => ({ state: "none" }) as const)));
  errors.push(...leases.errors);

  const leaseByRun = new Map<string, { entry: LeaseEntry; alive: boolean }>();
  for (const [list, alive] of [[leases.dead, false], [leases.live, true]] as const)
    for (const entry of list) if (entry.lease.run_id && entry.lease.kind !== "slot") leaseByRun.set(entry.lease.run_id, { entry, alive });

  const me = { heartbeat_id: opts.heartbeatId ?? null };

  // R2.3: on a story not held here, local runs/ work that never reached the record (an inbox Check item)
  const remoteName = config.remote.git_remote;
  const baseRef = defaultBaseRef(opts.repoRoot, remoteName, config.base_branch);
  const prSeen = local.pr_seen;
  const unpushed = await Promise.all(
    local.stories.map(async (ls, i): Promise<UnpushedRuns[]> => {
      const read = ls.snapshot;
      const c = classifyClaim(claims[i] ?? { state: "none" }, me, now);
      if (c.state === "mine" || c.state === "corrupt" || ((c.state === "other" || c.state === "expired") && (c.blob.holder === holder || c.blob.heartbeat_id === me.heartbeat_id))) return [];
      if (!ls.worktree) return [];
      const targets: UnpushedTarget[] = [{ unit: read.key, dir: read.units[0]?.unit.dir ?? "_story", cwd: ls.worktree, branch: storyBranch(read.key, read.slug) }];
      for (const lu of ls.units) {
        const u = lu.snapshot;
        const file = read.slices.find((f) => f.key === u.unit.slice);
        if (u.unit.slice && lu.worktree && file) targets.push({ unit: u.unit.key, dir: u.unit.dir, cwd: lu.worktree, branch: sliceBranch(read.key, file.nn, file.slug) });
      }
      const found = await unpushedRuns(remoteName, baseRef, read.spec_dir, targets).catch(() => []);
      return found.map((f) => ({ unit: f.unit, files: f.files }));
    }),
  );
  // F35/C5: the ready approval's head, voided by a later re-entry; and whether only norn moved the PR head since
  const readyHeads = await Promise.all(
    local.stories.map(async (ls): Promise<{ ready_head_sha?: string; ready_approved_at?: string; ready_head_norn?: string }> => {
      if (!ls.ready) return {};
      const sha = ls.ready.sha;
      const prHead = prSeen[ls.snapshot.key]?.pr?.head_sha;
      const norn = !!prHead && prHead !== sha && (await onlyNornCommitsSince(opts.repoRoot, sha, prHead, ls.snapshot.key).catch(() => false));
      return { ready_head_sha: sha, ready_approved_at: ls.ready.at, ...(norn ? { ready_head_norn: prHead } : {}) };
    }),
  );
  const runs: RunView[] = [];
  const storyFacts: StoryFacts[] = [];
  const stories: StoryView[] = [];
  const views: Array<() => void> = [];

  local.stories.forEach((ls, i) => {
    const story = ls.snapshot;
    let claim = classifyClaim(claims[i] ?? { state: "none" }, me, now);
    if (claim.state === "other" && claim.blob.holder === holder) claim = { ...claim, state: "mine" };
    const storyState = story.units[0]?.state ?? null;
    const mode: Mode = storyState?.mode ?? config.default_mode;
    const finished = story.frontmatter?.status === "done" || story.frontmatter?.status === "dropped";

    const units: UnitFacts[] = ls.units.map((lu) => unitFacts(lu, lu.hooks, leaseByRun));
    const sf: StoryFacts = {
      key: story.key,
      slug: story.slug,
      spec_dir: story.spec_dir,
      branch: storyBranch(story.key, story.slug),
      frontmatter: story.frontmatter,
      frontmatter_error: story.frontmatter_error,
      worktree: worktreeFacts(ls.worktree),
      claim,
      mailbox: undefined,
      issue: undefined,
      pr: undefined,
      // C1: the PR as this checkout's last sync saw it — merge (BS10), retarget (BS11), head changed (F35)
      ...(prSeen[story.key] && !finished ? { pr_seen: prSeen[story.key] } : {}),
      // gh-71 D5: the issue as this checkout's last sync saw it — the finished-round Check item
      ...(local.issue_seen[story.key] && !finished ? { issue_seen: local.issue_seen[story.key] } : {}),
      ...readyHeads[i],
      units,
      slices: story.slices,
      mode,
      ...(unpushed[i]?.length ? { unpushed_runs: unpushed[i] } : {}),
      // NT2/NT3: open notes of the story (loadLocalFacts, as observe)
      ...(ls.notes ? { notes: ls.notes } : {}),
      // BS1: the last base measurement of this checkout's ticks (stale items, merge-item detail)
      ...(local.base[story.key] && !finished ? { base: local.base[story.key] } : {}),
    };
    storyFacts.push(sf);

    // Runs.
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
    },
    remote: { issues: undefined },
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
    recently_done,
    errors,
  };
}
