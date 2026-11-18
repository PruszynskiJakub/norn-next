/** Reading refs and checkouts: answers about the repo, never a change to it. */
import { fail, type HostContext, ok, type PluginResult, type VcsUnfinished } from "@norn/plugin-api";
import { git, gitFailure, lines } from "./git.ts";

/** A ref git would read as an option is never passed on, whatever names it. */
const optionLike = (ref: string): boolean => ref.startsWith("-");

/** The commit `ref` names, or null when it names none. */
export async function revParse(ctx: HostContext, cwd: string, ref: string): Promise<PluginResult<string | null>> {
  if (optionLike(ref)) return fail("invalid", `git: ${ref} is not a ref`, false);
  const out = await git(ctx, cwd, ["rev-parse", "--verify", "--quiet", "--end-of-options", `${ref}^{commit}`]);
  if (out.code === 0) return ok(out.stdout.trim() || null);
  // --verify --quiet exits 1 with no output for a ref that names nothing; anything else is git failing
  if (out.code === 1 && out.stderr.trim() === "") return ok(null);
  return gitFailure(out, "rev-parse");
}

/** Whether `a` is reachable from `b`. */
export async function isAncestor(ctx: HostContext, cwd: string, a: string, b: string): Promise<PluginResult<boolean>> {
  if (optionLike(a) || optionLike(b)) return fail("invalid", `git: ${a} or ${b} is not a ref`, false);
  const out = await git(ctx, cwd, ["merge-base", "--is-ancestor", a, b]);
  if (out.code === 0) return ok(true);
  if (out.code === 1) return ok(false);
  return gitFailure(out, "merge-base");
}

/**
 * The paths merging `from` into `into` would conflict on, empty when it merges clean. `merge-tree
 * --write-tree` merges in the object store only, so no branch moves and no worktree is touched.
 */
export async function trialConflicts(ctx: HostContext, cwd: string, into: string, from: string): Promise<PluginResult<string[]>> {
  if (optionLike(into) || optionLike(from)) return fail("invalid", `git: ${into} or ${from} is not a ref`, false);
  const out = await git(ctx, cwd, ["merge-tree", "--write-tree", "--name-only", "--no-messages", into, from]);
  if (out.code === 0) return ok([]);
  // exit 1 is a conflicted merge: the tree id, then one conflicted path per line
  if (out.code === 1) return ok([...new Set(lines(out.stdout).slice(1))].sort());
  return gitFailure(out, "merge-tree");
}

export async function mergeBase(ctx: HostContext, cwd: string, a: string, b: string): Promise<PluginResult<string | null>> {
  if (optionLike(a) || optionLike(b)) return fail("invalid", `git: ${a} or ${b} is not a ref`, false);
  const out = await git(ctx, cwd, ["merge-base", a, b]);
  if (out.code === 0) return ok(out.stdout.trim() || null);
  if (out.code === 1) return ok(null);
  return gitFailure(out, "merge-base");
}

/** The branch checked out in `cwd`, or null on a detached head. */
export async function currentBranch(ctx: HostContext, cwd: string): Promise<PluginResult<string | null>> {
  const out = await git(ctx, cwd, ["symbolic-ref", "--quiet", "--short", "HEAD"]);
  if (out.code === 0) return ok(out.stdout.trim() || null);
  if (out.code === 1) return ok(null);
  return gitFailure(out, "symbolic-ref");
}

/** The remotes the repo has. */
export async function remotes(ctx: HostContext, cwd: string): Promise<PluginResult<string[]>> {
  const out = await git(ctx, cwd, ["remote"]);
  return out.code === 0 ? ok(lines(out.stdout).map((l) => l.trim())) : gitFailure(out, "remote");
}

/** `name` when the repo has that remote, else null: a repo without one has nothing to push or fetch. */
export async function remoteIfAny(ctx: HostContext, cwd: string, name: string): Promise<PluginResult<string | null>> {
  const r = await remotes(ctx, cwd);
  return r.ok ? ok(r.value.includes(name) ? name : null) : r;
}

const STOPPED = [
  ["MERGE_HEAD", "merge"],
  ["REBASE_HEAD", "rebase"],
  ["CHERRY_PICK_HEAD", "cherry-pick"],
] as const;

/** The operation git stopped half-way in `cwd`, or null when none is. */
export async function stoppedOperation(ctx: HostContext, cwd: string): Promise<PluginResult<VcsUnfinished["operation"] | null>> {
  for (const [ref, operation] of STOPPED) {
    const r = await revParse(ctx, cwd, ref);
    if (!r.ok) return r;
    if (r.value !== null) return ok(operation);
  }
  return ok(null);
}

/**
 * The operation stopped half-way in the checkout at `path` and the paths it left unmerged, or null
 * when none is or `path` is no checkout of this repo: a folder that is gone has nothing in progress.
 */
export async function unfinished(ctx: HostContext, root: string, path: string): Promise<PluginResult<VcsUnfinished | null>> {
  const list = await worktreeList(ctx, root);
  if (!list.ok) return list;
  if (!list.value.some((w) => samePath(w.path, path))) return ok(null);
  const op = await stoppedOperation(ctx, path);
  if (!op.ok) return op;
  if (op.value === null) return ok(null);
  const unmerged = await unmergedPaths(ctx, path);
  return unmerged.ok ? ok({ operation: op.value, unmerged: unmerged.value }) : unmerged;
}

/**
 * Why `cwd` cannot take a merge now, or null when it can: someone's merge or rebase in progress (a
 * resolver's, never aborted or concluded here) or uncommitted changes.
 */
export async function notReady(ctx: HostContext, cwd: string): Promise<PluginResult<string | null>> {
  const op = await stoppedOperation(ctx, cwd);
  if (!op.ok) return op;
  if (op.value !== null) return ok(`a ${op.value} is in progress in ${cwd}`);
  const st = await git(ctx, cwd, ["status", "--porcelain", "--untracked-files=normal"]);
  if (st.code !== 0) return gitFailure(st, "status");
  return ok(st.stdout.trim() === "" ? null : `${cwd} has uncommitted changes`);
}

/** Paths a stopped merge left unmerged, sorted. */
export async function unmergedPaths(ctx: HostContext, cwd: string): Promise<PluginResult<string[]>> {
  const out = await git(ctx, cwd, ["diff", "--name-only", "--diff-filter=U"]);
  return out.code === 0 ? ok([...new Set(lines(out.stdout))].sort()) : gitFailure(out, "diff");
}

export interface WorktreeEntry {
  path: string;
  /** the branch's short name, null when detached */
  branch: string | null;
}

export async function worktreeList(ctx: HostContext, cwd: string): Promise<PluginResult<WorktreeEntry[]>> {
  const out = await git(ctx, cwd, ["worktree", "list", "--porcelain"]);
  if (out.code !== 0) return gitFailure(out, "worktree list");
  const list: WorktreeEntry[] = [];
  for (const block of out.stdout.split("\n\n")) {
    const fields = lines(block);
    const path = fields.find((f) => f.startsWith("worktree "))?.slice("worktree ".length);
    if (path === undefined) continue;
    const ref = fields.find((f) => f.startsWith("branch "))?.slice("branch ".length);
    list.push({ path, branch: ref === undefined ? null : ref.replace(/^refs\/heads\//, "") });
  }
  return ok(list);
}

/**
 * Two spellings of one folder: git prints a worktree's path resolved, so on a host whose temp folder
 * is a symlink (`/var` to `/private/var`) the path asked for and the path listed differ by that prefix.
 */
export function samePath(a: string, b: string): boolean {
  const norm = (p: string) => p.replace(/\/+$/, "").replace(/^\/private(?=\/)/, "");
  return norm(a) === norm(b);
}
