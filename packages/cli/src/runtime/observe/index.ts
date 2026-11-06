/**
 * observe (H2): compose every fact decide needs — store snapshot (frontmatter, runs/ state,
 * unapplied receipts, pinned workflows), git (worktrees, dirty paths, activity times), the
 * remote (issues, PRs; throttled, GR1/GR6–GR8, H5), runner pane state, hook events from the
 * trace, process liveness, claims and mailbox refs (T2, T9), and this machine's leases (K1, K3).
 *
 * Local reads never wait on the network: remote calls happen only when a sync is due
 * (`remote.sync_interval`, or `sync: "force"`), and a failing remote leaves remote facts
 * `undefined` ("not observed") so decide does not act on them.
 */
import { existsSync } from "node:fs";
import {
  type ClaimState,
  type Facts,
  type ForeignCommit,
  type MailboxItem,
  type Ports,
  type RemoteIssue,
  type RemotePullRequest,
  type RepoWorkflows,
  type SliceFileFacts,
  type StoryPrSeen,
  type StoryFacts,
  type UnitFacts,
  type UnitRef,
  type UnmarkedWorktree,
  type WorktreeFacts,
} from "@norn/core";
import { claimRef, isClosedStatus, parseDuration, type ResolvedConfig, sliceBranch, storyBranch, type UnitState, type Workflow } from "@norn/schema";
import {
  type BaseFactsCache,
  baseStoryFacts,
  classifyClaim,
  localRecordOf,
  readRecordRef,
  recordTreeId,
  fetchElsewhere,
  fetchNornRefs,
  heartbeatId,
  heldElsewhereKeys,
  remoteStoryBranch,
  loadLocalFacts,
  machineHolder,
  type IssueFactsCache,
  type LocalStory,
  type LocalStoryRefs,
  type PrFactsCache,
  readLocalStoryRefs,
  type RemoteCache,
  readRemoteCache,
  type RepoSnapshot,
  inferUnitMarker,
  readUnitMarker,
  traceForeignCommits,
  writeBaseFacts,
  writeIssueFacts,
  writePrFacts,
  writeRemoteCache,
} from "@norn/store";
import type { Context } from "../../context.ts";
import { leaseLiveness } from "../leases.ts";
import { bundledSkillSet } from "../skills-drift.ts";
import { checkedRepoWorkflows } from "../workflows.ts";
import { mapBounded } from "./bounded.ts";
import { findOrphanBranches, foreignCommits, intakeOnly, refMap, storyBase, worktreeFacts } from "./git-facts.ts";
import { gitRemote, mergedByAncestry, readyHead, trackingRef } from "./remote.ts";
import { duringRun, type LocalRunEnv, runWindows, unitFacts } from "./run-facts.ts";

export { type DatedCommit, findOrphanBranches, foreignCommits, storyBaseRef } from "./git-facts.ts";
export { gitRemote, mergedByAncestry } from "./remote.ts";

/** How many stories observe reads from git, and from the remote, at once. */
const GIT_CONCURRENCY = 4;
const REMOTE_CONCURRENCY = 4;

export type SyncMode = "auto" | "force" | "never";

export interface ObserveOptions {
  tick_id: string;
  /** remote sync: when due (default), now, or not at all */
  sync?: SyncMode;
  /** B11, B12 (D5): backfill the live runs' hook files from the day files first (the tick's) */
  backfillHooks?: boolean;
}

/** Where a story lives on disk (not part of Facts; used by act). */
export interface StoryLoc {
  key: string;
  slug: string;
  /** checkout the spec was read from (story worktree, or the main checkout) */
  root: string;
  /** absolute spec folder in `root` */
  specPath: string;
  /** root-relative spec folder `.agents/specs/<id>-<slug>` */
  spec_dir: string;
  /** story worktree, if it exists */
  worktree: string | null;
  branch: string;
}

/** Where a unit lives on disk. */
export interface UnitLoc {
  unit: UnitRef;
  story: string;
  /** checkout the unit's runs/ were read from */
  root: string;
  /** absolute runs/<unit>/ */
  runsDir: string;
  /** absolute path of the unit's handoff, from its own resolver (`handoffPath`, gh-195 prefactor 2) */
  handoffFile: string;
  /** the unit's own worktree (slice) or the story worktree (story unit) */
  worktree: string | null;
  branch: string;
  state: UnitState | null;
  workflow: Workflow | null;
}

export interface SyncReport {
  ran: boolean;
  ok: boolean;
  error?: string;
}

export interface Observed {
  facts: Facts;
  workflows: RepoWorkflows;
  config: ResolvedConfig;
  ports: Ports;
  root: string;
  /** git remote name, or null when the repo has none (solo: local refs are the truth) */
  remote: string | null;
  heartbeat_id: string;
  stories: Record<string, StoryLoc>;
  units: Record<string, UnitLoc>;
  sync: SyncReport;
}

// ------------------------------------------------------------ observe

/**
 * The last seen value per story, kept between syncs: what this sync read (`fresh`, null included), else
 * what was kept before; finished stories drop out.
 */
function carrySeen<V, T>(stories: ReadonlyArray<{ key: string; frontmatter?: { status: string } | null }>, prev: Record<string, T>, fresh: ReadonlyMap<string, V | null>, seen: (v: V | null) => T): Record<string, T> {
  const out: Record<string, T> = {};
  for (const s of stories) {
    if (isClosedStatus(s.frontmatter?.status)) continue;
    const v = fresh.has(s.key) ? seen(fresh.get(s.key) ?? null) : prev[s.key];
    if (v) out[s.key] = v;
  }
  return out;
}

/** Write a cache only when it changed since it was read. */
function writeIfChanged<T>(root: string, next: T, prev: T, write: (root: string, value: T) => void): void {
  if (JSON.stringify(next) !== JSON.stringify(prev)) write(root, next);
}

/** The unit worktrees `git worktree` lists, by their A3 markers: story and slice worktrees, orphans, and the ones a marker is inferred for. */
function classifyWorktrees(root: string, wtList: ReadonlyArray<{ path: string; branch: string | null }>) {
  const storyWts = new Map<string, string>();
  const sliceWts = new Map<string, string>();
  const orphanWts: string[] = [];
  const unmarked: UnmarkedWorktree[] = [];
  for (const w of wtList) {
    if (w.path === root) continue;
    let marker = readUnitMarker(w.path).marker;
    // gh-195/05 (B2): a unit worktree whose marker `git clean -fdx` took is read by the marker its folder
    // and branch name (its run state is in the machine dir, S12); observe writes nothing (H2), act
    // writes the marker back (`restore_markers`)
    const inferred = marker ? null : inferUnitMarker(root, w.path, w.branch);
    if (inferred) unmarked.push({ path: w.path, marker: (marker = inferred) });
    if (!marker) {
      if (w.path.startsWith(`${root}-worktrees/`)) orphanWts.push(w.path);
      continue;
    }
    if (marker.slice === null) storyWts.set(marker.story, w.path);
    else sliceWts.set(marker.slice, w.path);
  }
  return { storyWts, sliceWts, orphanWts, unmarked };
}

type Elsewhere = Awaited<ReturnType<typeof heldElsewhereKeys>>;

/** What a remote sync read; `issues` undefined and the story maps empty when it failed (not observed). */
interface RemoteRead {
  issues: RemoteIssue[] | undefined;
  storyIssues: Map<string, RemoteIssue | null>;
  storyPrs: Map<string, RemotePullRequest | null>;
  elsewhere: Elsewhere;
  elsewherePrs: Map<string, StoryPrSeen>;
}

/**
 * GR1, H5: one remote sync — norn refs, the stories another heartbeat holds, the assigned issues, each
 * active story's issue and PR, and the PRs of the stories held elsewhere. Records the attempt in
 * `cache` and the outcome in `sync`; a failure leaves the remote facts unobserved.
 */
async function syncRemote(
  remotePort: NonNullable<Ports["remote"]>,
  o: { root: string; remote: string | null; hb: string; now: number; label: string; stories: RepoSnapshot["stories"]; snapshotKeys: ReadonlySet<string>; cache: RemoteCache; sync: SyncReport },
): Promise<RemoteRead> {
  const { root, remote, hb, now, cache, sync } = o;
  const out: RemoteRead = { issues: undefined, storyIssues: new Map(), storyPrs: new Map(), elsewhere: [], elsewherePrs: new Map() };
  let elsewhereError: string | null = null;
  sync.ran = true;
  cache.attempted_at = now;
  try {
    if (remote) await fetchNornRefs(root, remote).catch(() => undefined);
    // gh-195 D6 (B30): of the record refs, only those of the stories another heartbeat holds that this checkout has no copy of
    const elsewhere = (out.elsewhere = await heldElsewhereKeys(root, { heartbeat_id: hb }, now, o.snapshotKeys));
    // a failed fetch leaves the views on the refs fetched before, and the sync says so (trace, remote.json)
    if (remote) await fetchElsewhere(root, remote, elsewhere.map((e) => e.key)).catch((e: Error) => void (elsewhereError = `fetch of the stories held elsewhere failed: ${e.message}`));
    const listedIssues = await remotePort.listAssignedIssues({ label: o.label });
    out.issues = listedIssues;
    const active = o.stories.filter((s) => s.frontmatter && !isClosedStatus(s.frontmatter.status));
    const read = await mapBounded(active, REMOTE_CONCURRENCY, async (s) => {
      const fm = s.frontmatter as NonNullable<typeof s.frontmatter>;
      const listed = listedIssues.find((i) => i.number === fm.number && i.provider === fm.provider);
      return { issue: listed ?? (await remotePort.getIssue(fm.number)), pr: await remotePort.findPullRequest(storyBranch(s.key, s.slug)) };
    });
    active.forEach((s, i) => {
      out.storyIssues.set(s.key, (read[i] as (typeof read)[number]).issue);
      out.storyPrs.set(s.key, (read[i] as (typeof read)[number]).pr);
    });
    // B18: the PR of a story held elsewhere and its CI, for the view (its branch as the fetch just found it)
    const seen = await mapBounded(elsewhere, REMOTE_CONCURRENCY, async (e) => {
      const branch = remote ? await remoteStoryBranch(root, remote, e.key) : null;
      const pr = branch ? await remotePort.findPullRequest(branch) : null;
      // a CI read that fails leaves the CI unknown for this story only, and the sync says so
      let error: string | null = null;
      const ci = pr ? await remotePort.pullRequestCi(pr.number).catch((err: Error) => void (error = `CI of ${e.key}'s PR #${pr.number}: ${err.message}`)) : undefined;
      return { seen: { pr, observed_at: now, ...(ci ? { ci } : {}) } satisfies StoryPrSeen, error: error as string | null };
    });
    elsewhere.forEach((e, i) => {
      const r = seen[i] as (typeof seen)[number];
      out.elsewherePrs.set(e.key, r.seen);
      elsewhereError ??= r.error;
    });
    cache.synced_at = now;
    cache.last_error = elsewhereError;
    if (elsewhereError) {
      sync.ok = false;
      sync.error = elsewhereError;
    }
  } catch (e) {
    sync.ok = false;
    sync.error = (e as Error).message;
    cache.last_error = sync.error;
    out.issues = undefined;
    out.storyIssues.clear();
    out.storyPrs.clear();
  }
  return out;
}

/** What every story's facts are read against, gathered once per observe. */
interface StoryEnv {
  ports: Ports;
  root: string;
  remote: string | null;
  config: ResolvedConfig;
  workflows: RepoWorkflows;
  hb: string;
  now: number;
  holder: string;
  base: string;
  baseRef: string | null;
  runEnv: LocalRunEnv;
  refs: Map<string, string>;
  storyRefs: LocalStoryRefs;
  wtFacts: (path: string | null) => Promise<WorktreeFacts | null>;
  storyIssues: ReadonlyMap<string, RemoteIssue | null>;
  storyPrs: ReadonlyMap<string, RemotePullRequest | null>;
  prSeen: PrFactsCache;
  issueSeen: IssueFactsCache;
  byAncestry: ReadonlySet<string>;
  baseCacheIn: BaseFactsCache;
}

/** One story's facts, its location and its units' locations, and its base measurements for the cache. */
async function storyFactsOf(env: StoryEnv, ls: LocalStory): Promise<{ facts: StoryFacts; loc: StoryLoc; locs: UnitLoc[]; baseNext: BaseFactsCache }> {
  const { ports, root, remote, config, hb, now, refs } = env;
  const git = ports.git;
  const s = ls.snapshot;
  const branch = storyBranch(s.key, s.slug);
  const storyWt = ls.worktree;
  const storyWorktree = await env.wtFacts(storyWt);
  const loc: StoryLoc = { key: s.key, slug: s.slug, root: s.root, specPath: s.path, spec_dir: s.spec_dir, worktree: storyWt, branch };

  const read = await env.storyRefs.claim(s.key).catch((e: Error) => ({ state: "corrupt" as const, sha: "?", error: { file: claimRef(s.key), errors: [{ path: "", message: e.message }] } }));
  const claim: ClaimState = classifyClaim(read, { heartbeat_id: hb }, now);
  const mailbox: MailboxItem[] | undefined = await env.storyRefs.mailbox(s.key).catch(() => undefined);

  const units: UnitFacts[] = [];
  const locs: UnitLoc[] = [];
  const foreign: ForeignCommit[] = [];
  for (const lu of ls.units) {
    const u = lu.snapshot;
    const sliceFile = u.unit.slice ? s.slices.find((f) => f.key === u.unit.slice) : undefined;
    const ownWt = lu.worktree;
    const worktree = await env.wtFacts(ownWt);
    const unitBranch = u.unit.slice ? (sliceFile ? sliceBranch(s.key, sliceFile.nn, sliceFile.slug) : (worktree?.status?.branch ?? `${s.key}/${u.unit.dir}`)) : branch;
    const uf = await unitFacts(ports, s, lu, worktree, lu.hooks, env.runEnv);
    // a done slice not yet integrated: is its branch in the story branch (the slice cleanup's delete)
    if (sliceFile && u.state?.status === "done" && sliceFile.frontmatter?.status !== "integrated") {
      const head = refs.get(`refs/heads/${unitBranch}`);
      if (head && refs.has(`refs/heads/${branch}`)) {
        const inStory = await git.isAncestor(root, head, `refs/heads/${branch}`).catch(() => null);
        if (inStory !== null) uf.branch_in_story = inStory;
      }
    }
    units.push(uf);
    // Q6: commits norn did not make; an agent's own commits mid-run are not foreign
    // C4: …nor are commits made during any run of this unit (e.g. while it is parked on an ask)
    if (u.state?.status !== "running") {
      const found = await foreignCommits(git, root, remote, unitBranch, env.baseRef, refs);
      const windows = found.length ? runWindows(s, u) : [];
      foreign.push(...found.filter((c) => !duringRun(c, windows)).map(({ committed_at: _, ...c }) => c));
    }
    locs.push({
      unit: u.unit,
      story: s.key,
      root: ownWt && existsSync(ownWt) ? ownWt : s.root,
      runsDir: u.path,
      handoffFile: u.handoffFile,
      worktree: ownWt,
      branch: unitBranch,
      state: u.state,
      workflow: u.workflow?.workflow ?? null,
    });
  }

  const heldHere = claim.state === "mine" || (claim.state === "expired" && claim.blob.heartbeat_id === hb);
  // gh-195 D11 (B27, R2.3): this checkout's own record of a story another heartbeat holds (read only, H2)
  const heldElsewhere = claim.state === "other" || (claim.state === "expired" && claim.blob.heartbeat_id !== hb);
  const localRecord = heldElsewhere ? await localRecordOf(root, s, env.holder) : null;
  // gh-195 D4 (B10, B12): under remote, what the holder's record would pack to and what it last pushed
  let record: StoryFacts["record"];
  if (heldHere && config.record.policy === "remote") {
    const pushed = await readRecordRef(root, s.key);
    record = { tree: recordTreeId(root, s, pushed?.sha.length === 64 ? "sha256" : "sha1"), pushed };
  }

  const baseNext: BaseFactsCache = {};
  const { storyPrs, prSeen, issueSeen } = env;
  const facts: StoryFacts = {
    ...baseStoryFacts(ls, env.workflows, config),
    worktree: storyWorktree,
    claim,
    mailbox,
    issue: env.storyIssues.get(s.key),
    pr: storyPrs.get(s.key),
    ...(prSeen[s.key] ? { pr_seen: prSeen[s.key] } : {}),
    ...(issueSeen[s.key] ? { issue_seen: issueSeen[s.key] } : {}),
    ...(env.byAncestry.has(s.key) ? { merged_by_ancestry: true } : {}),
    ...(foreign.length ? { foreign_commits: foreign } : {}),
    ...(await readyHead(root, s.key, ls.ready, (storyPrs.has(s.key) ? storyPrs.get(s.key) : prSeen[s.key]?.pr)?.head_sha)),
    ...(s.base_status !== undefined ? { base_status: s.base_status } : {}),
    ...(localRecord ? { local_record: localRecord } : {}),
    ...(claim.state === "none" && s.frontmatter?.status === "new" ? await intakeOnly(git, root, remote ? env.baseRef : `refs/heads/${env.base}`, branch, s.key, refs) : {}),
    ...(await storyBase(git, root, remote, env.base, branch, s.frontmatter?.status, refs, env.baseCacheIn, baseNext, s.key)),
    ...(record ? { record } : {}),
    units,
    slices: s.slices satisfies SliceFileFacts[],
  };
  return { facts, loc, locs, baseNext };
}

export async function observe(ctx: Context, opts: ObserveOptions): Promise<Observed> {
  const now = ctx.clock.now();
  const root = ctx.root;
  const config = ctx.config;
  const ports = await ctx.ports();
  const git = ports.git;
  const hb = heartbeatId(root, now);
  const remoteName = config.git_remote;
  const remote = await gitRemote(git, root, remoteName);

  // ---- worktrees (A3 markers tell story and slice worktrees apart)
  const wtList = await git.worktreeList(root).catch(() => []);
  const { storyWts, sliceWts, orphanWts, unmarked } = classifyWorktrees(root, wtList);

  // ---- remote sync (GR1, H5): throttled; failures leave remote facts unobserved
  const cache = readRemoteCache(root);
  const cacheIn = JSON.stringify(cache);
  const mode = opts.sync ?? "auto";
  const due = mode === "force" || (mode === "auto" && (cache.attempted_at === null || now - cache.attempted_at >= parseDuration(config.sync_interval)));
  const sync: SyncReport = { ran: false, ok: true };
  if (!cache.default_branch) {
    cache.default_branch = remote ? await git.defaultBranch(root, remote).catch(() => null) : null;
    cache.default_branch ??= (await git.status(root).catch(() => null))?.branch ?? "main";
  }
  // BS0: the base branch is config `base_branch` when set, else the discovered default branch
  const base = config.base_branch ?? cache.default_branch ?? "main";
  // P2 / F33 / F36: the fetched base branch is the record and the merge reference — never the
  // main checkout's local `main`, which norn does not move. Fetched with every remote sync.
  if (due && ports.remote && remote) await git.fetch(root, remote, [`+refs/heads/${base}:refs/remotes/${remote}/${base}`], { quiet: true }).catch(() => undefined);
  const baseRef = await trackingRef(git, root, remote, base);

  // ---- local facts (H2): the snapshot, leases (K1, K3), hook facts, caches, what the receipts say
  const liveness = leaseLiveness((p) => ports.process.isAlive(p));
  const local = await loadLocalFacts(root, { now, home: ctx.home, env: ctx.env, storyWorktrees: storyWts, sliceWorktrees: sliceWts, baseRef, config: ctx.loaded, liveness, backfillHooks: opts.backfillHooks, running: ctx.version, bundledSkills: bundledSkillSet(ctx.env) });
  const snapshot = local.snapshot;
  const snapshotKeys = new Set(snapshot.stories.map((s) => s.key));
  const workflows = checkedRepoWorkflows(snapshot.workflows, root, config, ports.agents);

  const remoteRead: RemoteRead =
    due && ports.remote
      ? await syncRemote(ports.remote, { root, remote, hb, now, label: config.label, stories: snapshot.stories, snapshotKeys, cache, sync })
      : { issues: undefined, storyIssues: new Map(), storyPrs: new Map(), elsewhere: [], elsewherePrs: new Map() };
  const { issues, storyIssues, storyPrs, elsewherePrs } = remoteRead;
  let elsewhere = remoteRead.elsewhere;
  if (JSON.stringify(cache) !== cacheIn) writeRemoteCache(root, cache);
  // C1: the last PR seen per story, kept between syncs for the inbox (`pr_seen`); finished stories drop out
  const prSeenIn = local.pr_seen;
  const prSeen: PrFactsCache = carrySeen(snapshot.stories, prSeenIn, storyPrs, (pr) => ({ pr, observed_at: now }));
  // B18: a story held elsewhere keeps its last PR (and CI) seen while another heartbeat holds it; never a fact of decide's
  if (!sync.ran && Object.keys(prSeenIn).some((k) => !snapshotKeys.has(k))) elsewhere = await heldElsewhereKeys(root, { heartbeat_id: hb }, now, snapshotKeys).catch(() => []);
  for (const e of elsewhere) {
    const seen = elsewherePrs.get(e.key) ?? prSeenIn[e.key];
    if (seen) prSeen[e.key] = seen;
  }
  writeIfChanged(root, prSeen, prSeenIn, writePrFacts);
  // gh-71 D5: the last issue seen per story, kept between syncs for the finished-round Check item (`issue_seen`)
  const issueSeenIn = local.issue_seen;
  const issueSeen: IssueFactsCache = carrySeen(snapshot.stories, issueSeenIn, storyIssues, (issue) => ({ issue, observed_at: now }));
  writeIfChanged(root, issueSeen, issueSeenIn, writeIssueFacts);

  // ---- P2 (F34): a PR not saying merged whose head is already on the fetched base is merged
  const byAncestry = new Set<string>();
  if (baseRef)
    for (const s of snapshot.stories) {
      const pr = storyPrs.get(s.key);
      if (pr && pr.state !== "merged" && (await mergedByAncestry(git, root, remote, storyBranch(s.key, s.slug), pr, baseRef))) byAncestry.add(s.key);
    }

  // ---- machine (K1, K3, MO2)
  const leases = local.leases;
  const runner = ports.runner && (await ports.runner.available().catch(() => false)) ? ports.runner.name : null;

  // ---- per-worktree facts, cached by path
  const wtCache = new Map<string, Promise<WorktreeFacts | null>>();
  const wtFacts = (path: string | null) => {
    if (!path) return Promise.resolve(null);
    let p = wtCache.get(path);
    if (!p) {
      p = worktreeFacts(ports, path);
      wtCache.set(path, p);
    }
    return p;
  };

  const holder = machineHolder(ctx.env);
  const runEnv: LocalRunEnv = { holder, runner: ports.runner && runner ? ports.runner : null, now };

  const refs = await refMap(git, root);
  // T2, T9: every story's claim and mailbox in one read
  const storyRefs = readLocalStoryRefs(root);
  // BS1: last measurements; stories not seen this tick drop out of the cache
  const baseCacheIn = local.base;
  const baseCache: BaseFactsCache = {};
  const stories: StoryFacts[] = [];
  const storyLocs: Record<string, StoryLoc> = {};
  const unitLocs: Record<string, UnitLoc> = {};
  const env: StoryEnv = { ports, root, remote, config, workflows, hb, now, holder, base, baseRef, runEnv, refs, storyRefs, wtFacts, storyIssues, storyPrs, prSeen, issueSeen, byAncestry, baseCacheIn };
  // each story's git reads are independent of the others': a few stories at a time, assembled in order
  const perStory = await mapBounded(local.stories, GIT_CONCURRENCY, (ls) => storyFactsOf(env, ls));
  for (const r of perStory) {
    stories.push(r.facts);
    storyLocs[r.facts.key] = r.loc;
    for (const l of r.locs) unitLocs[l.unit.key] = l;
    Object.assign(baseCache, r.baseNext);
  }

  // K5: worktrees of known shape whose story is unknown
  const known = new Set(stories.map((s) => s.key));
  for (const [story, path] of storyWts) if (!known.has(story)) orphanWts.push(path);
  for (const [slice, path] of sliceWts) if (!known.has(slice.split("/")[0] as string)) orphanWts.push(path);

  writeIfChanged(root, baseCache, baseCacheIn, writeBaseFacts);
  const orphanBranches = findOrphanBranches(refs, wtList, stories);
  traceForeignCommits(root, stories, opts.tick_id, now);

  const facts: Facts = {
    tick_id: opts.tick_id,
    now,
    repo: { root, default_branch: base, remote: remoteName },
    machine: {
      holder,
      heartbeat_id: hb,
      runner,
      ...(runner && ports.runner ? { runner_capabilities: { ...ports.runner.capabilities } } : {}),
      leases: leases.live.map((e) => e.lease),
      dead_lease_files: [...leases.dead.map((e) => e.file), ...leases.errors.map((e) => e.file)],
    },
    remote: { issues },
    stories,
    // R5.5: this tick is the checkout's heartbeat
    heartbeat: { last_tick_at: now },
    ...(local.norn ? { norn: local.norn } : {}),
    // gh-195 D16: run state an older norn left on the base, pointed to `norn upgrade`
    ...(local.snapshot.base_run_state.length ? { base_run_state: local.snapshot.base_run_state } : {}),
    ...(local.superseded.length ? { superseded: local.superseded } : {}),
    orphans: { worktrees: orphanWts.sort(), branches: orphanBranches },
    ...(unmarked.length ? { unmarked } : {}),
  };
  return { facts, workflows, config, ports, root, remote, heartbeat_id: hb, stories: storyLocs, units: unitLocs, sync };
}
