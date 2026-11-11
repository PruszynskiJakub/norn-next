/**
 * The one push of a story or slice branch: every step boundary (act), every claim release
 * (`norn story handoff`, a clean `watch` exit) and `norn story close` push through it, so a
 * person's push to the story branch is taken in the same way wherever norn pushes.
 */
import type { GitPort } from "@norn/core";
import { syncRemoteBranch } from "./integrate.ts";

export interface PushBranchOptions {
  cwd: string;
  remote: string;
  branch: string;
  /** trailers of the merge commit made when a person's push is taken in (`Norn-Tick` is added) */
  trailers: Record<string, string>;
  tick: string;
}

/** `reason`: `held` (conflict markers) or the git push reason; `message` says it in full */
export type PushBranchResult = { ok: true } | { ok: false; reason: string; message: string };

/**
 * Push `branch` from `cwd` (only the claim holder). Slice branches are rebased by integrate, so
 * they force-push. Never publishes a commit that leaves conflict markers (an agent's merge
 * included); a story branch someone pushed to meanwhile is merged in (never rebased: the branch
 * is published, and neither side may be dropped) and pushed again.
 */
export async function pushBranch(git: GitPort, opts: PushBranchOptions): Promise<PushBranchResult> {
  const { cwd, remote, branch } = opts;
  const held = await markersHeld(git, cwd, remote, branch);
  if (held) return { ok: false, reason: "held", message: held };
  const force = branch.includes("/") ? "+" : "";
  const push = () => git.push(cwd, remote, `${force}refs/heads/${branch}:refs/heads/${branch}`);
  let r = await push();
  if (!r.ok && r.reason === "rejected" && !force) {
    const taken = await takeRemoteBranch(git, opts);
    if (taken !== true) return { ok: false, reason: r.reason, message: `${r.reason}: ${r.message}${taken ? `; ${taken}` : ""}` };
    r = await push();
  }
  return r.ok ? { ok: true } : { ok: false, reason: r.reason, message: `${r.reason}: ${r.message}` };
}

/** Why the push of `branch` is held — its unpublished commits leave conflict markers — or null. */
async function markersHeld(git: GitPort, cwd: string, remote: string, branch: string): Promise<string | null> {
  const marked = await git.outgoingConflictMarkers(cwd, remote, `refs/heads/${branch}`);
  if (!marked.length) return null;
  const where = marked.map((m) => `${m.path}${m.commit ? ` (commit ${m.commit.slice(0, 12)})` : ""}`);
  return `held: conflict markers in ${where.join(", ")}; nothing pushed — resolve them in a new commit (never rewrite the branch)`;
}

/**
 * The push of the story branch was rejected — someone pushed to it. Take the
 * remote branch in (fast-forward, else a merge commit with norn's trailers); true when the push may
 * be retried, else why not (null = nothing new on the remote, e.g. a protected branch).
 */
async function takeRemoteBranch(git: GitPort, opts: PushBranchOptions): Promise<true | string | null> {
  const { cwd, remote, branch } = opts;
  try {
    if ((await git.status(cwd)).branch !== branch) return `${branch} is not checked out in ${cwd}`;
    const r = await syncRemoteBranch(git, { cwd, branch, remote, message: `Merge ${remote}/${branch} into ${branch}`, trailers: { ...opts.trailers, "Norn-Tick": opts.tick } });
    if (r.outcome === "conflict") return `story branch diverged from ${remote}/${branch}; merging it conflicts in ${r.files.join(", ") || "?"} — merge it in ${cwd} by hand`;
    return r.outcome === "adopted" || r.outcome === "merged" ? true : null;
  } catch (e) {
    return `taking in ${remote}/${branch} failed: ${(e as Error).message}`;
  }
}
