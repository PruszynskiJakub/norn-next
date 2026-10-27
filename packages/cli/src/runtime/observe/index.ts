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
  type StoryFacts,
  type UnitFacts,
  type UnitRef,
  type WorktreeFacts,
} from "@norn/core";
import { parseDuration, type ResolvedConfig, sliceBranch, storyBranch, type UnitState, type Workflow } from "@norn/schema";
import {
  type BaseFactsCache,
  classifyClaim,
  fetchNornRefs,
  heartbeatId,
  listMailbox,
  loadLocalFacts,
  machineHolder,
  type PrFactsCache,
  readLocalClaim,
  readRemoteCache,
  readUnitMarker,
  traceForeignCommits,
  type UnpushedTarget,
  type UnpushedUnit,
  unpushedRuns,
  writeBaseFacts,
  writePrFacts,
  writeRemoteCache,
} from "@norn/store";
import type { Context } from "../../context.ts";
import { leaseLiveness } from "../leases.ts";
import { agentSkills, repoWorkflows } from "../workflows.ts";
import { findOrphanBranches, foreignCommits, intakeOnly, refMap, storyBase, worktreeFacts } from "./git-facts.ts";
import { gitRemote, mergedByAncestry, readyHead, trackingRef } from "./remote.ts";
import { duringRun, type LocalRunEnv, runWindows, unitFacts } from "./run-facts.ts";

export { type DatedCommit, findOrphanBranches, foreignCommits, storyBaseRef } from "./git-facts.ts";
export { gitRemote, mergedByAncestry } from "./remote.ts";

export type SyncMode = "auto" | "force" | "never";

export interface ObserveOptions {
  tick_id: string;
  /** remote sync: when due (default), now, or not at all */
  sync?: SyncMode;
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
  /** R2.3: per story not held here, local runs/ work not on the remote (facts carry `{unit, files}`) */
  unpushed: Record<string, UnpushedUnit[]>;
}

// ------------------------------------------------------------ observe

export async function observe(ctx: Context, opts: ObserveOptions): Promise<Observed> {
  const now = ctx.clock.now();
  const root = ctx.root;
  const config = ctx.config;
  const ports = await ctx.ports();
  const git = ports.git;
  const hb = heartbeatId(root, now);
  const remoteName = config.remote.git_remote;
  const remote = await gitRemote(git, root, remoteName);

  // ---- worktrees (A3 markers tell story and slice worktrees apart)
  const storyWts = new Map<string, string>();
  const sliceWts = new Map<string, string>();
  const orphanWts: string[] = [];
  const wtList = await git.worktreeList(root).catch(() => []);
  for (const w of wtList) {
    if (w.path === root) continue;
    const m = readUnitMarker(w.path);
    if (!m.marker) {
      if (w.path.startsWith(`${root}-worktrees/`)) orphanWts.push(w.path);
      continue;
    }
    if (m.marker.slice === null) storyWts.set(m.marker.story, w.path);
    else sliceWts.set(m.marker.slice, w.path);
  }

  // ---- remote sync (GR1, H5): throttled; failures leave remote facts unobserved
  const cache = readRemoteCache(root);
  const mode = opts.sync ?? "auto";
  const due = mode === "force" || (mode === "auto" && (cache.attempted_at === null || now - cache.attempted_at >= parseDuration(config.remote.sync_interval)));
  const sync: SyncReport = { ran: false, ok: true };
  let issues: RemoteIssue[] | undefined;
  const storyIssues = new Map<string, RemoteIssue | null>();
  const storyPrs = new Map<string, RemotePullRequest | null>();
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
  const local = await loadLocalFacts(root, { now, home: ctx.home, env: ctx.env, storyWorktrees: storyWts, sliceWorktrees: sliceWts, baseRef, liveness, stalledMs: parseDuration(config.limits.stalled) });
  const snapshot = local.snapshot;
  const workflows = repoWorkflows(snapshot.workflows, { default_agent: config.default_agent, visible: agentSkills(ports.agents, root) });

  if (due && ports.remote) {
    sync.ran = true;
    cache.attempted_at = now;
    try {
      if (remote) await fetchNornRefs(root, remote).catch(() => undefined);
      const label = config.remote.label;
      issues = await ports.remote.listAssignedIssues({ label });
      for (const s of snapshot.stories) {
        const fm = s.frontmatter;
        if (!fm || fm.status === "done" || fm.status === "dropped") continue;
        const listed = issues.find((i) => i.number === fm.number && i.provider === fm.provider);
        storyIssues.set(s.key, listed ?? (await ports.remote.getIssue(fm.number)));
        storyPrs.set(s.key, await ports.remote.findPullRequest(storyBranch(s.key, s.slug)));
      }
      cache.synced_at = now;
      cache.last_error = null;
    } catch (e) {
      sync.ok = false;
      sync.error = (e as Error).message;
      cache.last_error = sync.error;
      issues = undefined;
      storyIssues.clear();
      storyPrs.clear();
    }
  }
  writeRemoteCache(root, cache);
  // C1: the last PR seen per story, kept between syncs for the inbox (`pr_seen`); finished stories drop out
  const prSeenIn = local.pr_seen;
  const prSeen: PrFactsCache = {};
  for (const s of snapshot.stories) {
    if (s.frontmatter?.status === "done" || s.frontmatter?.status === "dropped") continue;
    const fresh = storyPrs.has(s.key) ? { pr: storyPrs.get(s.key) ?? null, observed_at: now } : prSeenIn[s.key];
    if (fresh) prSeen[s.key] = fresh;
  }
  if (JSON.stringify(prSeen) !== JSON.stringify(prSeenIn)) writePrFacts(root, prSeen);

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
  // BS1: last measurements; stories not seen this tick drop out of the cache
  const baseCacheIn = local.base;
  const baseCache: BaseFactsCache = {};
  const unpushed: Record<string, UnpushedUnit[]> = {};
  const stories: StoryFacts[] = [];
  const storyLocs: Record<string, StoryLoc> = {};
  const unitLocs: Record<string, UnitLoc> = {};
  for (const ls of local.stories) {
    const s = ls.snapshot;
    const branch = storyBranch(s.key, s.slug);
    const storyWt = ls.worktree;
    const storyWorktree = await wtFacts(storyWt);
    storyLocs[s.key] = { key: s.key, slug: s.slug, root: s.root, specPath: s.path, spec_dir: s.spec_dir, worktree: storyWt, branch };

    const read = await readLocalClaim(root, s.key).catch((e: Error) => ({ state: "corrupt" as const, sha: "?", error: { file: `refs/norn/claims/${s.key}`, errors: [{ path: "", message: e.message }] } }));
    const claim: ClaimState = classifyClaim(read, { heartbeat_id: hb }, now);
    const mailbox: MailboxItem[] | undefined = await listMailbox(root, s.key).catch(() => undefined);

    const units: UnitFacts[] = [];
    const foreign: ForeignCommit[] = [];
    const targets: UnpushedTarget[] = [];
    for (const lu of ls.units) {
      const u = lu.snapshot;
      const sliceFile = u.unit.slice ? s.slices.find((f) => f.key === u.unit.slice) : undefined;
      const ownWt = lu.worktree;
      const worktree = await wtFacts(ownWt);
      const unitBranch = u.unit.slice ? (sliceFile ? sliceBranch(s.key, sliceFile.nn, sliceFile.slug) : (worktree?.status?.branch ?? `${s.key}/${u.unit.dir}`)) : branch;
      const uf = await unitFacts(ports, s, lu, worktree, local.hooks, runEnv);
      if (lu.act_failure) uf.act_failure = lu.act_failure;
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
        const found = await foreignCommits(git, root, remote, unitBranch, baseRef, refs);
        const windows = found.length ? runWindows(s, u) : [];
        foreign.push(...found.filter((c) => !duringRun(c, windows)).map(({ committed_at: _, ...c }) => c));
      }
      if (ownWt && worktree?.exists) targets.push({ unit: u.unit.key, dir: u.unit.dir, cwd: ownWt, branch: unitBranch });
      unitLocs[u.unit.key] = {
        unit: u.unit,
        story: s.key,
        root: ownWt && existsSync(ownWt) ? ownWt : s.root,
        runsDir: u.path,
        worktree: ownWt,
        branch: unitBranch,
        state: u.state,
        workflow: u.workflow?.workflow ?? null,
      };
    }

    // R2.3: a checkout without the claim reports its local runs/ work that is not in the record
    const heldHere = claim.state === "mine" || (claim.state === "expired" && claim.blob.heartbeat_id === hb);
    const lost = remote && !heldHere && claim.state !== "corrupt" ? await unpushedRuns(remote, baseRef, s.spec_dir, targets) : [];
    if (lost.length) unpushed[s.key] = lost;

    stories.push({
      key: s.key,
      slug: s.slug,
      spec_dir: s.spec_dir,
      branch,
      frontmatter: s.frontmatter,
      frontmatter_error: s.frontmatter_error,
      worktree: storyWorktree,
      claim,
      mailbox,
      issue: storyIssues.has(s.key) ? storyIssues.get(s.key) : undefined,
      pr: storyPrs.has(s.key) ? storyPrs.get(s.key) : undefined,
      ...(prSeen[s.key] ? { pr_seen: prSeen[s.key] } : {}),
      ...(byAncestry.has(s.key) ? { merged_by_ancestry: true } : {}),
      ...(foreign.length ? { foreign_commits: foreign } : {}),
      ...(await readyHead(root, s.key, ls.ready, (storyPrs.has(s.key) ? storyPrs.get(s.key) : prSeen[s.key]?.pr)?.head_sha)),
      ...(ls.notes ? { notes: ls.notes } : {}),
      ...(s.base_status !== undefined ? { base_status: s.base_status } : {}),
      ...(lost.length ? { unpushed_runs: lost.map((l) => ({ unit: l.unit, files: l.files })) } : {}),
      ...(claim.state === "none" && s.frontmatter?.status === "new" ? await intakeOnly(git, root, remote ? baseRef : `refs/heads/${base}`, branch, s.key, refs) : {}),
      ...(await storyBase(git, root, remote, base, branch, s.frontmatter?.status, refs, baseCacheIn, baseCache, s.key)),
      units,
      slices: s.slices satisfies SliceFileFacts[],
      mode: units[0]?.state?.mode ?? config.default_mode,
    });
  }

  // K5: worktrees of known shape whose story is unknown
  const known = new Set(stories.map((s) => s.key));
  for (const [story, path] of storyWts) if (!known.has(story)) orphanWts.push(path);
  for (const [slice, path] of sliceWts) if (!known.has(slice.split("/")[0] as string)) orphanWts.push(path);

  if (JSON.stringify(baseCache) !== JSON.stringify(baseCacheIn)) writeBaseFacts(root, baseCache);
  const orphanBranches = await findOrphanBranches(git, root, wtList, stories);
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
      dead_leases: leases.dead.map((e) => e.lease),
      dead_lease_files: [...leases.dead.map((e) => e.file), ...leases.errors.map((e) => e.file)],
    },
    remote: { synced_at: cache.synced_at, issues },
    stories,
    // R5.5: this tick is the checkout's heartbeat
    heartbeat: { last_tick_at: now },
    orphans: { worktrees: orphanWts.sort(), branches: orphanBranches },
  };
  return { facts, workflows, config, ports, root, remote, heartbeat_id: hb, stories: storyLocs, units: unitLocs, sync, unpushed };
}
