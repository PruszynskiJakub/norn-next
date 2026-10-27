/** observe: git facts of the repository — story bases (BS0, BS1), intake-only branches (R3.1), foreign commits (Q6), orphan branches (K5), worktrees. */
import { existsSync, statSync } from "node:fs";
import { join } from "node:path";
import { type ForeignCommit, type GitPort, isIntakeCommit, type Ports, type StoryBase, type StoryFacts, type WorktreeFacts, type WorktreeStatus } from "@norn/core";
import { type BaseFactsCache, readEnvNorn } from "@norn/store";

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

/** BS0: the base ref of every story — the fetched `<remote>/<base>`, or the local base branch without a remote. */
export const storyBaseRef = (remote: string | null, base: string) => (remote ? `refs/remotes/${remote}/${base}` : `refs/heads/${base}`);

/**
 * BS1: the story branch against its base ref. Measured (divergence, and `git merge-tree` when the
 * story is behind) only when the pair (head, base sha) is not the cached one (`trace/base.json`).
 * Absent when the story is finished, its branch or the base ref is missing, or git fails.
 */
export async function storyBase(
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

/**
 * R3.1: does the local story branch hold nothing beyond its intake commit — read off the commits'
 * trailers (`isIntakeCommit`), never their subjects. Not observed without the branch or the base ref.
 */
export async function intakeOnly(git: GitPort, root: string, baseRef: string | null, branch: string, story: string, refs: Map<string, string>): Promise<{ intake_only?: boolean }> {
  if (!baseRef || !refs.has(`refs/heads/${branch}`)) return {};
  const commits = await git.log(root, `${baseRef}..refs/heads/${branch}`).catch(() => null);
  if (!commits) return {};
  return { intake_only: commits.length === 0 || (commits.length === 1 && isIntakeCommit((commits[0] as (typeof commits)[number]).trailers, story)) };
}

export async function commitOf(git: GitPort, root: string, rev: string): Promise<string | null> {
  if (!rev) return null;
  return git.revParse(root, `${rev}^{commit}`);
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

/** Every branch and remote-tracking ref → sha, in one git call. */
export async function refMap(git: GitPort, root: string): Promise<Map<string, string>> {
  const refs = await git.listRefs(root, ["refs/heads/", "refs/remotes/"]).catch(() => []);
  return new Map(refs.map((r) => [r.ref, r.sha]));
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

export async function worktreeFacts(ports: Ports, path: string): Promise<WorktreeFacts | null> {
  if (!existsSync(path)) return null;
  const status: WorktreeStatus | null = await ports.git.status(path).catch(() => null);
  const last_commit_at = await ports.git.lastCommitTime(path).catch(() => null);
  const changed = status ? [...status.staged, ...status.unstaged, ...status.untracked] : [];
  const slotRaw = readEnvNorn(path)?.NORN_SLOT;
  const slot = slotRaw !== undefined && /^\d+$/.test(slotRaw) ? Number(slotRaw) : null;
  // H1/BS5.1: an agent's merge (or rebase) in progress defers norn's commits; decide must know it
  const in_progress = await ports.git.inProgress(path).catch(() => null);
  return { path, exists: true, status, last_commit_at, last_file_change_at: newestMtime(path, changed), slot, ...(in_progress ? { in_progress } : {}) };
}
