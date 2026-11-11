/** observe: what the remote says about a story — the git remote, the fetched base ref, PR merges by ancestry, the ready head. */
import type { GitPort, RemotePullRequest } from "@norn/core";
import { onlyNornCommitsSince } from "@norn/store";
import { commitOf } from "./git-facts.ts";

/** `name` when this repository has a git remote by that name, else null. */
export async function gitRemote(git: GitPort, root: string, name: string): Promise<string | null> {
  const names: string[] = await git.remotes(root).catch(() => []);
  return names.includes(name) ? name : null;
}

/** `refs/remotes/<remote>/<base>` when it exists locally (fetched), else null (solo, never fetched). */
export async function trackingRef(git: GitPort, root: string, remote: string | null, base: string): Promise<string | null> {
  if (!remote) return null;
  const ref = `refs/remotes/${remote}/${base}`;
  return (await git.hasRef(root, ref)) ? ref : null;
}

/**
 * Is the PR head (or, when its sha is unknown here, the story branch head) an ancestor of
 * the fetched base? Then the work is merged whatever the PR state says.
 */
export async function mergedByAncestry(git: GitPort, root: string, remote: string | null, branch: string, pr: RemotePullRequest, baseRef: string): Promise<boolean> {
  const head = (await commitOf(git, root, pr.head_sha)) ?? (await commitOf(git, root, `refs/heads/${branch}`)) ?? (remote ? await commitOf(git, root, `refs/remotes/${remote}/${branch}`) : null);
  if (!head) return false;
  return git.isAncestor(root, head, baseRef).catch(() => false);
}

/**
 * The story's ready approval (store), and `ready_head_norn` when the known PR head and the head the
 * approval let through are apart by norn's own commits of the story only, either way: past it (the `$done` commit) or
 * behind it, since boundaries after open-pr move only the heads ref and the approval records the local head.
 */
export async function readyHead(root: string, story: string, ready: { sha: string; at: string } | undefined, prHead: string | undefined): Promise<{ ready_head_sha?: string; ready_approved_at?: string; ready_head_norn?: string }> {
  if (!ready) return {};
  const sha = ready.sha;
  const norn = prHead && prHead !== sha && ((await onlyNornCommitsSince(root, sha, prHead, story)) || (await onlyNornCommitsSince(root, prHead, sha, story)));
  return { ready_head_sha: sha, ready_approved_at: ready.at, ...(norn ? { ready_head_norn: prHead } : {}) };
}

/**
 * `pr_unpushed`: the paths the local story branch changes since the known open PR's head, when that
 * head is an ancestor of it (the usual case: boundaries after open-pr move only the heads ref). A
 * diverged head is a person's push, which the head-changed item reports instead.
 */
export async function prUnpushed(git: GitPort, root: string, branch: string, pr: RemotePullRequest | null | undefined): Promise<{ pr_unpushed?: string[] }> {
  if (pr?.state !== "open") return {};
  const [prHead, head] = await Promise.all([commitOf(git, root, pr.head_sha).catch(() => null), commitOf(git, root, `refs/heads/${branch}`).catch(() => null)]);
  if (!prHead || !head || prHead === head || !(await git.isAncestor(root, prHead, head).catch(() => false))) return {};
  const paths = await git.changedPaths(root, prHead, head).catch(() => null);
  return paths?.length ? { pr_unpushed: paths } : {};
}
