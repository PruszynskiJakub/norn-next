/** observe: what the remote says about a story — the git remote, the fetched base ref, PR merges by ancestry (P2), the ready head (F35/C5). */
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
 * P2 (F34): is the PR head (or, when its sha is unknown here, the story branch head) an ancestor of
 * the fetched base? Then the work is merged whatever the PR state says.
 */
export async function mergedByAncestry(git: GitPort, root: string, remote: string | null, branch: string, pr: RemotePullRequest, baseRef: string): Promise<boolean> {
  const head = (await commitOf(git, root, pr.head_sha)) ?? (await commitOf(git, root, `refs/heads/${branch}`)) ?? (remote ? await commitOf(git, root, `refs/remotes/${remote}/${branch}`) : null);
  if (!head) return false;
  return git.isAncestor(root, head, baseRef).catch(() => false);
}

/** F35/C5: the story's ready approval (store), and `ready_head_norn` when the known PR head moved past it by norn's own commits of the story only. */
export async function readyHead(root: string, story: string, ready: { sha: string; at: string } | undefined, prHead: string | undefined): Promise<{ ready_head_sha?: string; ready_approved_at?: string; ready_head_norn?: string }> {
  if (!ready) return {};
  const sha = ready.sha;
  const norn = prHead && prHead !== sha && (await onlyNornCommitsSince(root, sha, prHead, story));
  return { ready_head_sha: sha, ready_approved_at: ready.at, ...(norn ? { ready_head_norn: prHead } : {}) };
}
