/**
 * Unit worktrees under `<dataDir>/worktrees/`, one per unit, named so a slice's folder never nests
 * inside its story's. Never beside the repo: a worktree there would show up in the person's checkout.
 */
import { fail, type HostContext, ok, type PluginResult, type VcsWorktrees } from "@norn/plugin-api";
import { git, gitFailure } from "./git.ts";
import { revParse, samePath, worktreeList } from "./refs.ts";

/** `gh-12/03` lives at `worktrees/gh-12-03`, so a story's folder never contains its slices'. */
export function worktreePath(ctx: HostContext, unit: string): string {
  return `${ctx.repo.dataDir}/worktrees/${unit.replace("/", "-")}`;
}

/**
 * Make the unit's worktree on `branch`, or find the one already there. A branch this clone lacks is
 * cut from the remote's copy when `remote` has one (the unit was carried on by another machine, whose
 * pushed work a branch cut from `base` would drop, and whose push would then be refused), else from
 * `base`; an existing one is checked out as it is, so a re-run after a crash never moves it.
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
    if (there.branch === branch) return ok({ path });
    return fail("conflict", `the worktree of ${unit} at ${path} is on ${there.branch ?? "a detached head"}, not ${branch}`, false);
  }
  const elsewhere = list.value.find((w) => w.branch === branch);
  if (elsewhere) return fail("conflict", `${branch} is checked out at ${elsewhere.path}: one branch has one worktree`, false);
  const exists = await revParse(ctx, root, `refs/heads/${branch}`);
  if (!exists.ok) return exists;
  let start = base;
  if (exists.value === null && remote !== undefined && !remote.startsWith("-")) {
    const copy = await revParse(ctx, root, `refs/remotes/${remote}/${branch}`);
    if (!copy.ok) return copy;
    if (copy.value !== null) start = `refs/remotes/${remote}/${branch}`;
  }
  const args = exists.value === null ? ["worktree", "add", "--quiet", "-b", branch, path, start] : ["worktree", "add", "--quiet", path, branch];
  const added = await git(ctx, root, args);
  return added.code === 0 ? ok({ path }) : gitFailure(added, "worktree add", "invalid");
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
