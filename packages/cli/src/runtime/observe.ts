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
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { hostname, userInfo } from "node:os";
import { join } from "node:path";
import { claude } from "@norn/adapters";
import {
  type ClaimState,
  type Facts,
  edgeOf,
  type FileError,
  type ForeignCommit,
  type GitPort,
  type MailboxItem,
  type NumberedReceipt,
  openNotes,
  RE_ENTRY_KINDS,
  readyApproval,
  type Ports,
  type RemoteIssue,
  type RemotePullRequest,
  type RepoWorkflows,
  type RunFacts,
  type SliceFileFacts,
  type StepRunFacts,
  type StoryBase,
  type StoryFacts,
  stepOf,
  storyWorktreePath,
  type UnitFacts,
  type UnitRef,
  type WorktreeFacts,
  type WorktreeStatus,
} from "@norn/core";
import {
  type HookFact,
  type LeaseFile,
  parseDuration,
  parseReceiptFileName,
  type ReceiptOf,
  type ResolvedConfig,
  sliceBranch,
  storyBranch,
  type UnitState,
  type Workflow,
} from "@norn/schema";
import {
  classifyClaim,
  fetchNornRefs,
  onlyNornCommitsSince,
  listLeases,
  listMailbox,
  loadSnapshot,
  readEnvNorn,
  readActFailures,
  type BaseFactsCache,
  readBaseFacts,
  readPrFacts,
  type PrFactsCache,
  readLocalClaim,
  readReceipt,
  readUnitMarker,
  receiptsDir,
  type StorySnapshot,
  traceDir,
  type UnitSnapshot,
  type UnpushedTarget,
  type UnpushedUnit,
  unpushedRuns,
  withSliceWorktrees,
  writeBaseFacts,
  writePrFacts,
  heartbeatId,
  readRemoteCache,
  traceForeignCommits,
  writeRemoteCache,
} from "@norn/store";
import type { Context } from "../context.ts";
import { leaseLiveness } from "./leases.ts";
import { agentSkills, repoWorkflows } from "./workflows.ts";

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

export function machineHolder(env: Record<string, string | undefined>): string {
  let user = env.USER ?? env.LOGNAME;
  if (!user) {
    try {
      user = userInfo().username;
    } catch {
      user = "norn";
    }
  }
  const host = (env.NORN_MACHINE ?? hostname().split(".")[0] ?? "machine") || "machine";
  return `${user.replace(/[@\s]/g, "_")}@${host.replace(/[@\s]/g, "_")}`;
}

/** `name` when this repository has a git remote by that name, else null. */
export async function gitRemote(git: GitPort, root: string, name: string): Promise<string | null> {
  const names: string[] = await git.remotes(root).catch(() => []);
  return names.includes(name) ? name : null;
}

/** Newest mtime of the given worktree-relative paths (ms), or null. */
function newestMtime(dir: string, paths: string[]): number | null {
  let max: number | null = null;
  for (const p of paths.slice(0, 500)) {
    try {
      const m = statSync(join(dir, p)).mtimeMs;
      if (max === null || m > max) max = m;
    } catch {
      /* deleted file */
    }
  }
  return max === null ? null : Math.floor(max);
}

// ------------------------------------------------------------ hooks (A2) from the trace

/** Hook facts appended by `norn hook`, read from trace day files since `since` (fast scan). */
export function readHookFacts(root: string, since: string): HookFact[] {
  let names: string[];
  try {
    names = readdirSync(traceDir(root)).filter((n) => /^\d{4}-\d{2}-\d{2}\.jsonl$/.test(n));
  } catch {
    return [];
  }
  const day = since.slice(0, 10);
  const out: HookFact[] = [];
  for (const name of names.sort()) {
    if (name.slice(0, 10) < day) continue;
    let text: string;
    try {
      text = readFileSync(join(traceDir(root), name), "utf8");
    } catch {
      continue;
    }
    for (const line of text.split("\n")) {
      if (!line.startsWith('{"type":"hook"')) continue;
      try {
        const ev = JSON.parse(line) as { fact?: HookFact };
        if (ev.fact && ev.fact.at >= since) out.push(ev.fact);
      } catch {
        /* diagnostic file; bad lines are skipped */
      }
    }
  }
  return out.sort((a, b) => a.at.localeCompare(b.at));
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

  const snapshot = loadSnapshot({ repoRoot: root, storyRoots: [...storyWts.values()], home: ctx.home, env: ctx.env, baseRef });
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
  const prSeenIn = readPrFacts(root);
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
  const liveness = leaseLiveness((p) => ports.process.isAlive(p));
  const leases = await listLeases(ctx.home, liveness);
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

  // hooks are read once: back to the oldest live run or launch-unknown run (R5.1), and always the
  // stalled window (R5.3: hook activity of any run of a unit's cursor step)
  const starts: string[] = [new Date(now - parseDuration(config.limits.stalled)).toISOString()];
  const unitSnaps = new Map<StorySnapshot, UnitSnapshot[]>();
  for (const s of snapshot.stories) {
    const units = withSliceWorktrees(s, (slice) => sliceWts.get(slice)).units;
    unitSnaps.set(s, units);
    for (const u of units) {
      if (liveRun(u.state)) starts.push(u.state?.run?.started_at ?? (u.state as UnitState).updated_at);
      const unknown = unknownLaunch(u.unapplied);
      if (unknown) starts.push(unknown.receipt.at);
    }
  }
  const hooks = readHookFacts(root, starts.sort()[0] as string);
  const failures = readActFailures(root);
  const holder = machineHolder(ctx.env);
  const local: LocalRunEnv = { holder, runner: ports.runner && runner ? ports.runner : null, stalledMs: parseDuration(config.limits.stalled), now };

  const refs = await refMap(git, root);
  // BS1: last measurements; stories not seen this tick drop out of the cache
  const baseCacheIn = readBaseFacts(root);
  const baseCache: BaseFactsCache = {};
  const unpushed: Record<string, UnpushedUnit[]> = {};
  const stories: StoryFacts[] = [];
  const storyLocs: Record<string, StoryLoc> = {};
  const unitLocs: Record<string, UnitLoc> = {};
  for (const s of snapshot.stories) {
    const branch = storyBranch(s.key, s.slug);
    const conventional = storyWorktreePath(root, s.key, s.slug);
    const storyWt = storyWts.get(s.key) ?? (existsSync(conventional) && readUnitMarker(conventional).marker ? conventional : null);
    const storyWorktree = await wtFacts(storyWt);
    storyLocs[s.key] = { key: s.key, slug: s.slug, root: s.root, specPath: s.path, spec_dir: s.spec_dir, worktree: storyWt, branch };

    const read = await readLocalClaim(root, s.key).catch((e: Error) => ({ state: "corrupt" as const, sha: "?", error: { file: `refs/norn/claims/${s.key}`, errors: [{ path: "", message: e.message }] } }));
    const claim: ClaimState = classifyClaim(read, { heartbeat_id: hb }, now);
    const mailbox: MailboxItem[] | undefined = await listMailbox(root, s.key).catch(() => undefined);

    const units: UnitFacts[] = [];
    const foreign: ForeignCommit[] = [];
    const targets: UnpushedTarget[] = [];
    for (const u of unitSnaps.get(s) ?? []) {
      const sliceFile = u.unit.slice ? s.slices.find((f) => f.key === u.unit.slice) : undefined;
      const ownWt = u.unit.slice ? (sliceWts.get(u.unit.slice) ?? null) : storyWt;
      const worktree = await wtFacts(ownWt);
      const unitBranch = u.unit.slice ? (sliceFile ? sliceBranch(s.key, sliceFile.nn, sliceFile.slug) : (worktree?.status?.branch ?? `${s.key}/${u.unit.dir}`)) : branch;
      const uf = await unitFacts(ports, root, s, u, worktree, hooks, leases.live.map((e) => e.lease), local);
      const failure = failures[u.unit.key];
      if (failure) uf.act_failure = failure;
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
      ...(await readyHead(root, s, unitSnaps.get(s)?.[0], (storyPrs.has(s.key) ? storyPrs.get(s.key) : prSeen[s.key]?.pr)?.head_sha)),
      ...storyNotes(s, unitSnaps.get(s) ?? []),
      ...(s.base_status !== undefined ? { base_status: s.base_status } : {}),
      ...(lost.length ? { unpushed_runs: lost.map((l) => ({ unit: l.unit, files: l.files })) } : {}),
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


/** BS0: the base ref of every story — the fetched `<remote>/<base>`, or the local base branch without a remote. */
export const storyBaseRef = (remote: string | null, base: string) => (remote ? `refs/remotes/${remote}/${base}` : `refs/heads/${base}`);

/**
 * BS1: the story branch against its base ref. Measured (divergence, and `git merge-tree` when the
 * story is behind) only when the pair (head, base sha) is not the cached one (`trace/base.json`).
 * Absent when the story is finished, its branch or the base ref is missing, or git fails.
 */
async function storyBase(
  git: Ports["git"],
  root: string,
  remote: string | null,
  base: string,
  branch: string,
  status: string | undefined,
  refs: Map<string, string>,
  prev: BaseFactsCache,
  next: BaseFactsCache,
  key: string,
): Promise<{ base?: StoryBase }> {
  if (status === "done" || status === "dropped") return {};
  const ref = storyBaseRef(remote, base);
  const head = refs.get(`refs/heads/${branch}`);
  const sha = refs.get(ref);
  if (!head || !sha) return {};
  const hit = prev[key];
  if (hit && hit.head === head && hit.sha === sha && hit.ref === ref) {
    next[key] = hit;
    return { base: hit };
  }
  try {
    const d = await git.divergence(root, head, sha);
    const conflicts = d.behind > 0 ? await git.mergeTree(root, head, sha) : [];
    const b: StoryBase = { ref, sha, head, merge_base: d.merge_base ?? "", behind: d.behind, ahead: d.ahead, conflicts };
    next[key] = b;
    return { base: b };
  } catch {
    return {};
  }
}

/** `refs/remotes/<remote>/<base>` when it exists locally (fetched), else null (solo, never fetched). */
async function trackingRef(git: GitPort, root: string, remote: string | null, base: string): Promise<string | null> {
  if (!remote) return null;
  const ref = `refs/remotes/${remote}/${base}`;
  return (await git.hasRef(root, ref)) ? ref : null;
}

async function commitOf(git: GitPort, root: string, rev: string): Promise<string | null> {
  if (!rev) return null;
  return git.revParse(root, `${rev}^{commit}`);
}

/**
 * P2 (F34): is the PR head (or, when its sha is unknown here, the story branch head) an ancestor of
 * the fetched base? Then the work is merged whatever the PR state says.
 */
export async function mergedByAncestry(git: GitPort, root: string, remote: string | null, branch: string, pr: RemotePullRequest, baseRef: string): Promise<boolean> {
  const head = (await commitOf(git, root, pr.head_sha)) ?? (await commitOf(git, root, `refs/heads/${branch}`)) ?? (remote ? await commitOf(git, root, `refs/remotes/${remote}/${branch}`) : null);
  if (!head) return false;
  return git.isAncestor(root, head, baseRef).catch(() => false);
}

/**
 * Q6: commits on `branch` (first-parent, not on the base) made after the newest norn commit — one
 * carrying a `Norn-Tick` trailer. A branch with no norn commit in that range reports none.
 */
/** C4: a found commit with its committer date (ISO), compared with the unit's run windows; not part of the facts. */
export type DatedCommit = ForeignCommit & { committed_at?: string };

export async function foreignCommits(git: GitPort, root: string, remote: string | null, branch: string, baseRef: string | null, refs?: Map<string, string>): Promise<DatedCommit[]> {
  const local = `refs/heads/${branch}`;
  const tracking = remote ? `refs/remotes/${remote}/${branch}` : null;
  const ref = refs ? (refs.get(local) ?? (tracking ? refs.get(tracking) : undefined) ?? null) : ((await commitOf(git, root, local)) ?? (tracking ? await commitOf(git, root, tracking) : null));
  if (!ref) return [];
  const baseSha = baseRef ? (refs?.get(baseRef) ?? baseRef) : "";
  // the answer only depends on (head, base): remembered for the process (watch, tests)
  const memo = `${root}\0${branch}\0${ref}\0${baseSha}`;
  const hit = FOREIGN_MEMO.get(memo);
  if (hit) return hit;
  const log = await git.firstParentLog(root, ref, { limit: 100, trailer: "Norn-Tick", ...(baseSha ? { exclude: baseSha } : {}) }).catch(() => null);
  if (!log) return [];
  let found: DatedCommit[] = [];
  const out: DatedCommit[] = [];
  for (const c of log) {
    if (c.trailer) {
      found = out;
      break;
    }
    out.push({ sha: c.sha, subject: c.subject, author: c.author, at: c.authored_at, ...(c.committed_at ? { committed_at: c.committed_at } : {}), branch });
  }
  if (FOREIGN_MEMO.size > 500) FOREIGN_MEMO.clear();
  FOREIGN_MEMO.set(memo, found);
  return found;
}

const FOREIGN_MEMO = new Map<string, DatedCommit[]>();

/** Receipt kinds a run writes, from its start to its end (C4). */
const RUN_KINDS = ["started", "done", "ask", "stuck", "classify", "answer"] as const;

/**
 * C4: the time spans (ms epoch) of every run of the unit — from its first to its last receipt, and
 * open-ended for the run the unit is still in (running, or parked on an ask). An agent launched by
 * norn commits only inside them; a person's commit outside them stays foreign (Q6).
 */
function runWindows(story: StorySnapshot, u: UnitSnapshot): Array<[number, number]> {
  const spans = new Map<string, [number, number]>();
  const widen = (run: string, t: number, end = t) => {
    if (!Number.isFinite(t)) return;
    const cur = spans.get(run);
    spans.set(run, cur ? [Math.min(cur[0], t), Math.max(cur[1], end)] : [t, end]);
  };
  for (const { receipt: r } of receiptsOfKinds(story, u, RUN_KINDS)) if (r.run_id) widen(r.run_id, Date.parse(r.at));
  // the agent of a run parked on an ask is still at work (a permission prompt answered in its pane)
  const st = u.state;
  if (st?.run) widen(st.run.run_id, Date.parse(st.run.started_at), st.status === "running" || (st.status === "parked" && st.park?.kind === "ask") ? Number.POSITIVE_INFINITY : Date.parse(st.run.started_at));
  // commit dates have second precision
  return [...spans.values()].map(([a, b]) => [Math.floor(a / 1000) * 1000, b]);
}

const duringRun = (c: DatedCommit, windows: ReadonlyArray<[number, number]>) => {
  const t = Date.parse(c.committed_at ?? c.at);
  return Number.isFinite(t) && windows.some(([a, b]) => t >= a && t <= b);
};

/** Every branch and remote-tracking ref → sha, in one git call. */
async function refMap(git: GitPort, root: string): Promise<Map<string, string>> {
  const refs = await git.listRefs(root, ["refs/heads/", "refs/remotes/"]).catch(() => []);
  return new Map(refs.map((r) => [r.ref, r.sha]));
}

/**
 * F35/C5: `ready_head_sha` from the story unit's approve and re-entry receipts (`readyApproval`, BS10.2: with its time), and
 * `ready_head_norn` when the known PR head moved past it by norn's own commits of the story only.
 */
async function readyHead(root: string, story: StorySnapshot, u: UnitSnapshot | undefined, prHead: string | undefined): Promise<{ ready_head_sha?: string; ready_approved_at?: string; ready_head_norn?: string }> {
  const wf = u?.workflow?.workflow;
  if (!u || !wf) return {};
  const ready = readyApproval(wf, receiptsOfKinds(story, u, ["approve", ...RE_ENTRY_KINDS]));
  if (!ready) return {};
  const sha = ready.sha;
  const norn = prHead && prHead !== sha && (await onlyNornCommitsSince(root, sha, prHead, story.key));
  return { ready_head_sha: sha, ready_approved_at: ready.at, ...(norn ? { ready_head_norn: prHead } : {}) };
}

/** Receipts of the given kinds in a unit's runs dir, ascending — read by file name, the others never opened. */
function receiptsOfKinds(story: StorySnapshot, u: UnitSnapshot, kinds: readonly string[]): NumberedReceipt[] {
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

/** NT2/NT3: the story's open notes — notes of `done` receipts of its units no `approve` acknowledged. */
function storyNotes(story: StorySnapshot, units: UnitSnapshot[]): { notes?: StoryFacts["notes"] } {
  const notes = openNotes(units.map((u) => ({ unit: u.unit.key, receipts: receiptsOfKinds(story, u, ["done", "approve"]) })));
  return notes.length ? { notes } : {};
}

const STORY_BRANCH = /^((?:gh|gl)-\d+)-[a-z0-9][a-z0-9-]*$/;
const SLICE_BRANCH = /^((?:gh|gl)-\d+)\/(\d+)-([a-z0-9][a-z0-9-]*)$/;

/**
 * K5: local branches of norn's shape that no unit needs any more — not checked out in a worktree,
 * and their story is unknown here or finished (done/dropped), or (slice branches) their slice is
 * integrated/dropped. Reported every tick; `norn tidy` deletes the ones whose commits are kept elsewhere.
 */
export async function findOrphanBranches(git: Ports["git"], root: string, worktrees: Array<{ branch: string | null }>, stories: StoryFacts[]): Promise<string[]> {
  const refs = await git.listRefs(root, "refs/heads/").catch(() => []);
  const checkedOut = new Set(worktrees.map((w) => w.branch).filter((b): b is string => !!b));
  const byKey = new Map(stories.map((s) => [s.key, s]));
  const finished = (s: StoryFacts | undefined) => !s || s.frontmatter?.status === "done" || s.frontmatter?.status === "dropped";
  const out: string[] = [];
  for (const { ref } of refs) {
    const name = ref.slice("refs/heads/".length);
    if (checkedOut.has(name)) continue;
    const slice = SLICE_BRANCH.exec(name);
    if (slice) {
      const story = byKey.get(slice[1] as string);
      const file = story?.slices.find((f) => f.nn === slice[2] && f.slug === slice[3]);
      const status = file?.frontmatter?.status;
      if (finished(story) || status === "integrated" || status === "dropped") out.push(name);
      continue;
    }
    const st = STORY_BRANCH.exec(name);
    if (st && finished(byKey.get(st[1] as string))) out.push(name);
  }
  return out.sort();
}

async function worktreeFacts(ports: Ports, path: string): Promise<WorktreeFacts | null> {
  if (!existsSync(path)) return null;
  const marker = readUnitMarker(path).exists;
  const status: WorktreeStatus | null = await ports.git.status(path).catch(() => null);
  const last_commit_at = await ports.git.lastCommitTime(path).catch(() => null);
  const changed = status ? [...status.staged, ...status.unstaged, ...status.untracked] : [];
  const slotRaw = readEnvNorn(path)?.NORN_SLOT;
  const slot = slotRaw !== undefined && /^\d+$/.test(slotRaw) ? Number(slotRaw) : null;
  // H1/BS5.1: an agent's merge (or rebase) in progress defers norn's commits; decide must know it
  const in_progress = await ports.git.inProgress(path).catch(() => null);
  return { path, exists: true, marker, status, last_commit_at, last_file_change_at: newestMtime(path, changed), slot, ...(in_progress ? { in_progress } : {}) };
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

/** Run facts are observed for running units and for parked ones that keep their run (B2: is the session still there to answer into?). */
const liveRun = (st: UnitState | null | undefined): boolean => !!st?.run && (st.status === "running" || st.status === "parked");

/**
 * R5.1: the unapplied `started` receipt (norn's own, auto) whose launch never reached `state.json`
 * — no session recorded, and no later receipt of the run's agent showing it ran. Null when none.
 */
export function unknownLaunch(unapplied: readonly NumberedReceipt[]): (NumberedReceipt & { receipt: ReceiptOf<"started"> }) | null {
  const last = unapplied.filter((r) => r.receipt.kind === "started" && r.receipt.how === "auto" && r.receipt.by === "norn").at(-1) as (NumberedReceipt & { receipt: ReceiptOf<"started"> }) | undefined;
  if (!last || last.receipt.session) return null;
  if (unapplied.some((r) => r.n > last.n && r.receipt.by === "agent")) return null;
  return last;
}

interface LocalRunEnv {
  /** this machine's `user@host` (R7.2) */
  holder: string;
  /** this machine's available runner */
  runner: Ports["runner"];
  stalledMs: number;
  now: number;
}

/**
 * R5.3 + R5.1: the unit's `started` / `classify` receipts at its cursor step/attempt (newest first,
 * stopping at the first of another cursor), and every session id its `started` receipts recorded.
 */
function cursorRuns(runsDir: string, st: UnitState, root: string): { runs: Map<string, { died: boolean }>; sessions: Set<string> } {
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

async function unitFacts(
  ports: Ports,
  repoRoot: string,
  story: StorySnapshot,
  u: UnitSnapshot,
  worktree: WorktreeFacts | null,
  hooks: HookFact[],
  leases: LeaseFile[],
  env: LocalRunEnv,
): Promise<UnitFacts> {
  const now = env.now;
  const st = u.state;
  const prefix = `${story.spec_dir}/runs/${u.unit.dir}/`;
  const dirty = worktree?.status ? [...worktree.status.staged, ...worktree.status.unstaged, ...worktree.status.untracked] : [];
  const uncommitted = dirty.some((p) => p.startsWith(prefix));

  const lo = st ? lastOutcomeReceipt(u.path, st, worktree?.path ?? story.root) : null;
  const last_check = lo?.receipt.kind === "check" && lo.receipt.outcome === "fail" ? lo : null;
  const last_findings = lo?.receipt.kind === "done" && lo.receipt.findings?.length ? lo : null;

  const cursor = st ? cursorRuns(u.path, st, worktree?.path ?? story.root) : null;
  const unknown = st ? unknownLaunch(u.unapplied) : null;
  let run: RunFacts | null = null;
  if (unknown && st) {
    // R5.1: look for the run: its hook facts, runner sessions in its worktree, processes with its NORN_RUN
    const r = unknown.receipt;
    const runId = r.run_id as string;
    const mine = claude.withPendingCommands(hooks.filter((h) => h.run_id === runId));
    const agentSession = mine.findLast((h) => h.agent_session_id)?.agent_session_id ?? null;
    const foreign = !!r.machine && r.machine !== env.holder;
    const candidates = !foreign && env.runner?.findSessions ? await env.runner.findSessions({ run_id: runId, cwd: r.worktree }).catch(() => []) : [];
    // a pane another run of the unit already recorded is that run's, not this one
    const fresh = candidates.filter((c) => !cursor?.sessions.has(c.session.session_id));
    const chosen = fresh.find((c) => !!agentSession && c.agent_session_id === agentSession) ?? (fresh.length === 1 ? fresh[0] : undefined);
    const last = mine.at(-1);
    const last_hook_at = last ? Date.parse(last.at) : null;
    run = {
      run_id: runId,
      session: chosen?.session ?? null,
      process_alive: chosen?.session.process ? await ports.process.isAlive(chosen.session.process).catch(() => null) : null,
      pane: null,
      hooks: mine,
      last_hook_at,
      last_activity_at: last_hook_at,
      transcript: [...mine].reverse().find((h) => h.transcript)?.transcript ?? null,
      launch_unknown: { n: unknown.n, at: Date.parse(r.at), agent_session_id: agentSession ?? chosen?.agent_session_id ?? null },
    };
  } else if (liveRun(st) && st?.run) {
    const r = st.run;
    const session = r.session ? { runner: r.session.runner, session_id: r.session.session_id, ...(r.session.pane_id ? { pane_id: r.session.pane_id } : {}), ...(r.process ? { process: r.process } : {}) } : null;
    // R7.2 (N5): a pid or pane id from another machine means nothing in this machine's tables
    const foreign = !!r.machine && r.machine !== env.holder;
    const process_alive = r.process && !foreign ? await ports.process.isAlive(r.process).catch(() => null) : null;
    const pane = session && !foreign && ports.runner && session.runner === ports.runner.name ? await ports.runner.paneState(session).catch(() => null) : null;
    // A2: a Claude permission prompt names no command; take it from the preceding PreToolUse
    // (other agents' facts pass through unchanged) so the implicit ask and inbox show it
    const mine = claude.withPendingCommands(hooks.filter((h) => (h.run_id ? h.run_id === r.run_id : !!worktree && h.cwd.startsWith(worktree.path) && h.at >= r.started_at)));
    const last = mine.at(-1);
    const last_hook_at = last ? Date.parse(last.at) : null;
    const acts = [last_hook_at, worktree?.last_commit_at ?? null, worktree?.last_file_change_at ?? null].filter((x): x is number => x !== null);
    run = {
      run_id: r.run_id,
      session,
      process_alive,
      pane,
      hooks: mine,
      last_hook_at,
      last_activity_at: acts.length ? Math.min(Math.max(...acts), now) : null,
      transcript: [...mine].reverse().find((h) => h.transcript)?.transcript ?? r.transcript ?? null,
    };
    // B3: a gone process's first output lines (its run log) say why it never got going
    if (session && (process_alive === false || pane?.alive === false) && ports.runner?.output && session.runner === ports.runner.name) {
      const output = await ports.runner.output(session).catch(() => null);
      if (output) run.output = output;
    }
  }

  const mineLeases = leases.filter((l) => l.repo === repoRoot && l.story === u.unit.story && l.slice === u.unit.slice);
  const lease = mineLeases.find((l) => l.kind === "check") ?? mineLeases.find((l) => l.kind === "agent") ?? null;

  // R5.3: runs of the cursor step and their hook activity
  let step_runs: StepRunFacts[] | undefined;
  if (cursor) {
    step_runs = [...cursor.runs].map(([run_id, r]) => {
      const own = hooks.filter((h) => h.run_id === run_id);
      const last = own.at(-1);
      return { run_id, last_hook_at: last ? Date.parse(last.at) : null, ended: r.died || last?.event === "session_end" };
    });
  }

  const errors: FileError[] = u.errors;
  return {
    unit: u.unit,
    state: st,
    workflow: u.workflow?.workflow ?? null,
    workflow_hash: u.workflow?.hash ?? null,
    errors,
    unapplied: u.unapplied,
    last_check,
    last_findings,
    last_outcome_receipt: lo,
    worktree,
    run,
    lease,
    uncommitted,
    ...(step_runs ? { step_runs } : {}),
  };
}
