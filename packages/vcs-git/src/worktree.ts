/**
 * Unit worktrees under `<dataDir>/worktrees/`, one per unit, named so a slice's folder never nests
 * inside its story's. Never beside the repo: a worktree there would show up in the person's checkout.
 */
import { fail, type HostContext, ok, type PluginResult, type VcsWorktrees } from "@norn/plugin-api";
import { git, gitFailure } from "./git.ts";
import { publishedCopyRef } from "./heads.ts";
import { isAncestor, revParse, samePath, worktreeList } from "./refs.ts";

/** `gh-12/03` lives at `worktrees/gh-12-03`, so a story's folder never contains its slices'. */
export function worktreePath(ctx: HostContext, unit: string): string {
  return `${ctx.repo.dataDir}/worktrees/${unit.replace("/", "-")}`;
}

/**
 * Make the unit's worktree on `branch`, or find the one already there. A branch this clone lacks is
 * cut from the newest of the remote's copy and the branch's published head when `remote` has either
 * (the unit was carried on by another machine, whose work a branch cut from `base` would drop, and
 * whose push would then be refused), else from `base`. An existing branch, with or without its
 * worktree, is only moved forward to them when it is strictly behind, so a re-run after a crash never
 * loses a commit.
 */
export async function ensureWorktree(ctx: HostContext, unit: string, branch: string, base: string, remote?: string): Promise<PluginResult<{ path: string }>> {
  if (branch.startsWith("-") || base.startsWith("-")) return fail("invalid", `git: ${branch} or ${base} is not a ref`, false);
  const path = worktreePath(ctx, unit);
  const root = ctx.repo.root;
  // a folder removed by hand leaves its registration behind, and git would refuse to add it again
  const pruned = await git(ctx, root, ["worktree", "prune"]);
  if (pruned.code !== 0) return gitFailure(pruned, "worktree prune");
  const list = await worktreeList(ctx, root);
  if (!list.ok) return list;
  const there = list.value.find((w) => samePath(w.path, path));
  if (there) {
    if (there.branch !== branch) return fail("conflict", `the worktree of ${unit} at ${path} is on ${there.branch ?? "a detached head"}, not ${branch}`, false);
    return catchUp(ctx, root, path, branch, remote);
  }
  const elsewhere = list.value.find((w) => w.branch === branch);
  if (elsewhere) return fail("conflict", `${branch} is checked out at ${elsewhere.path}: one branch has one worktree`, false);
  const exists = await revParse(ctx, root, `refs/heads/${branch}`);
  if (!exists.ok) return exists;
  const carried = remote !== undefined && !remote.startsWith("-") ? await carriedOn(ctx, root, remote, branch) : ok(null);
  if (!carried.ok) return carried;
  if (exists.value !== null && carried.value !== null && carried.value.sha !== exists.value) {
    const behind = await isAncestor(ctx, root, exists.value, carried.value.sha);
    if (!behind.ok) return behind;
    if (behind.value) {
      const moved = await git(ctx, root, ["update-ref", `refs/heads/${branch}`, carried.value.sha, exists.value]);
      if (moved.code !== 0) return gitFailure(moved, "update-ref");
    }
  }
  const start = carried.value?.ref ?? base;
  const args = exists.value === null ? ["worktree", "add", "--quiet", "-b", branch, path, start] : ["worktree", "add", "--quiet", path, branch];
  const added = await git(ctx, root, args);
  return added.code === 0 ? ok({ path }) : gitFailure(added, "worktree add", "invalid");
}

/**
 * Move an existing worktree forward to what another clone carried the unit on to. A worktree left
 * from before a takeover would otherwise run the next step on the old head, and that step's work
 * would never take in the other holder's commits. One that diverged from it is refused: neither side's
 * commits may silently win, so a person merges them.
 */
async function catchUp(ctx: HostContext, root: string, path: string, branch: string, remote: string | undefined): Promise<PluginResult<{ path: string }>> {
  if (remote === undefined || remote.startsWith("-")) return ok({ path });
  const carried = await carriedOn(ctx, root, remote, branch);
  if (!carried.ok) return carried;
  if (carried.value === null) return ok({ path });
  const head = await revParse(ctx, root, `refs/heads/${branch}`);
  if (!head.ok) return head;
  if (head.value === null || carried.value.sha === head.value) return ok({ path });
  const ahead = await isAncestor(ctx, root, carried.value.sha, head.value);
  if (!ahead.ok) return ahead;
  if (ahead.value) return ok({ path });
  const behind = await isAncestor(ctx, root, head.value, carried.value.sha);
  if (!behind.ok) return behind;
  if (!behind.value)
    return fail("conflict", `${branch} in ${path} and ${carried.value.ref} diverged: another clone carried the unit on while this one committed; merge ${carried.value.ref} into it in ${path}`, false);
  const moved = await git(ctx, path, ["merge", "--ff-only", "--quiet", carried.value.sha]);
  return moved.code === 0 ? ok({ path }) : gitFailure(moved, `fast-forward ${branch} to ${carried.value.ref}`, "conflict");
}

/**
 * The newest of what another clone left of `branch` on `remote`: its branch there and its published
 * head, as last fetched. When the two diverged the published head wins: it is the last step a
 * holder finished, and the push step merges a person's commits on the branch in before it pushes.
 */
async function carriedOn(ctx: HostContext, root: string, remote: string, branch: string): Promise<PluginResult<{ ref: string; sha: string } | null>> {
  const found: { ref: string; sha: string }[] = [];
  for (const ref of [publishedCopyRef(remote, branch), `refs/remotes/${remote}/${branch}`]) {
    const sha = await revParse(ctx, root, ref);
    if (!sha.ok) return sha;
    if (sha.value !== null) found.push({ ref, sha: sha.value });
  }
  const [head, copy] = found;
  if (!head || !copy || head.sha === copy.sha) return ok(head ?? null);
  const copyAhead = await isAncestor(ctx, root, head.sha, copy.sha);
  if (!copyAhead.ok) return copyAhead;
  return ok(copyAhead.value ? copy : head);
}

/** Remove the unit's worktree with whatever it holds; its branch stays. A missing one is not an error. */
export async function removeWorktree(ctx: HostContext, unit: string): Promise<PluginResult<void>> {
  const path = worktreePath(ctx, unit);
  const root = ctx.repo.root;
  const list = await worktreeList(ctx, root);
  if (!list.ok) return list;
  if (list.value.some((w) => samePath(w.path, path))) {
    const out = await git(ctx, root, ["worktree", "remove", "--force", "--force", path]);
    if (out.code !== 0) return gitFailure(out, "worktree remove");
  }
  const pruned = await git(ctx, root, ["worktree", "prune"]);
  return pruned.code === 0 ? ok(undefined) : gitFailure(pruned, "worktree prune");
}

export function gitWorktrees(ctx: HostContext, remote?: string): VcsWorktrees {
  return {
    path: (unit) => worktreePath(ctx, unit),
    ensure: (unit, branch, base) => ensureWorktree(ctx, unit, branch, base, remote),
    remove: (unit) => removeWorktree(ctx, unit),
  };
}
