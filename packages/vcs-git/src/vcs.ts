/** The git vcs: branches, merges and pushes through `git`, never rebasing a story branch. */
import { fail, type HostContext, ok, type Vcs, type VcsFactory } from "@norn/plugin-api";
import { GitVcsConfig } from "./config.ts";
import { mergeInto } from "./merge.ts";
import { fetchRemote, pushBranch } from "./push.ts";
import { isAncestor, mergeBase, remoteIfAny, revParse, trialConflicts, uncommitted, unfinished, worktreeList } from "./refs.ts";
import { gitWorktrees } from "./worktree.ts";

export const DEFAULT_REMOTE = "origin";

export function createGitVcs(ctx: HostContext, config: GitVcsConfig): Vcs {
  const root = ctx.repo.root;
  const remote = config.remote ?? DEFAULT_REMOTE;
  return {
    name: "git",
    capabilities: { worktrees: true, merge: true, push: true },
    worktree: gitWorktrees(ctx, remote),
    head: (ref) => revParse(ctx, root, ref),
    isAncestor: (a, b) => isAncestor(ctx, root, a, b),
    mergeBase: (a, b) => mergeBase(ctx, root, a, b),
    conflicts: (into, from) => trialConflicts(ctx, root, into, from),
    async remoteRef(branch) {
      if (branch.startsWith("-")) return fail("invalid", `git: ${branch} is not a branch`, false);
      const has = await remoteIfAny(ctx, root, remote);
      if (!has.ok || has.value === null) return has.ok ? ok(null) : has;
      const sha = await revParse(ctx, root, `refs/remotes/${remote}/${branch}`);
      if (!sha.ok) return sha;
      return ok(sha.value === null ? null : `${remote}/${branch}`);
    },
    unfinished: (path) => unfinished(ctx, root, path),
    uncommitted: (path) => uncommitted(ctx, root, path),
    async merge(branch, from, opts) {
      const list = await worktreeList(ctx, root);
      if (!list.ok) return list;
      // a merge needs a checkout of the branch; a branch without one has nowhere for a conflict to wait
      const wt = list.value.find((w) => w.branch === branch);
      if (!wt) return fail("not_found", `git: ${branch} is checked out in no worktree, so nothing can merge into it`, false);
      const r = await mergeInto(ctx, wt.path, from, { keepConflict: opts?.abortOnConflict !== true });
      if (!r.ok) return r;
      return ok("conflict" in r.value ? { conflict: r.value.conflict } : { head: r.value.head });
    },
    async remoteHead(branch) {
      if (branch.startsWith("-")) return fail("invalid", `git: ${branch} is not a branch`, false);
      const has = await remoteIfAny(ctx, root, remote);
      if (!has.ok) return has;
      return has.value === null ? ok(null) : revParse(ctx, root, `refs/remotes/${remote}/${branch}`);
    },
    async push(branch, opts) {
      const r = await pushBranch(ctx, root, remote, branch, opts?.lease);
      return r.ok ? ok(undefined) : r;
    },
    async fetch() {
      const r = await fetchRemote(ctx, root, remote);
      return r.ok ? ok(undefined) : r;
    },
  };
}

export const gitVcsFactory: VcsFactory<typeof GitVcsConfig> = { configSchema: GitVcsConfig, create: createGitVcs };
