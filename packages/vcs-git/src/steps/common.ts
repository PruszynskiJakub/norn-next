/** What every git step kind resolves first: where it runs, which remote, and which base. */
import { fail, type HostContext, ok, type PluginResult, type StepKindInput } from "@norn/plugin-api";
import { type Static, Type } from "@sinclair/typebox";
import { git, gitFailure } from "../git.ts";
import { mergeInto } from "../merge.ts";
import { currentBranch, isAncestor, remoteIfAny, revParse } from "../refs.ts";
import { DEFAULT_REMOTE } from "../vcs.ts";
import { worktreePath } from "../worktree.ts";

/** The keys every git step kind takes beside its head key. */
export const GitStepKeys = {
  /** the ref the story takes updates from; absent: the host's base, else the remote's default branch */
  base: Type.Optional(Type.String({ minLength: 1, pattern: "^[^-]" })),
  /** the remote to fetch from and push to; absent: `origin` */
  remote: Type.Optional(Type.String({ minLength: 1, pattern: "^[^-]" })),
};
export const GitStepConfig = Type.Object(GitStepKeys, { additionalProperties: false });
export type GitStepConfig = Static<typeof GitStepConfig>;

export interface StepPlace {
  cwd: string;
  branch: string;
  remote: string;
}

/** The unit's worktree and the branch checked out there; a detached worktree has no branch to update. */
export async function stepPlace(ctx: HostContext, input: StepKindInput<GitStepConfig>): Promise<PluginResult<StepPlace>> {
  const cwd = input.worktree ?? input.slots?.vcs?.worktree.path(input.unit) ?? worktreePath(ctx, input.unit);
  const branch = await currentBranch(ctx, cwd);
  if (!branch.ok) return branch;
  if (branch.value === null) return fail("invalid", `${input.step}: the worktree of ${input.unit} at ${cwd} has no branch checked out`, false);
  if (input.branch !== undefined && input.branch !== branch.value)
    return fail("conflict", `${input.step}: the worktree of ${input.unit} is on ${branch.value}, not ${input.branch}`, false);
  return ok({ cwd, branch: branch.value, remote: input.config.remote ?? DEFAULT_REMOTE });
}

export interface RemoteSync {
  /** the remote branch's commit after the fetch, null when it was never pushed */
  tracking: string | null;
  /** the remote branch held commits the local one lacked, and they were taken in */
  took: boolean;
}

/**
 * Take in commits a person pushed to the story branch (an "update branch" on the forge): a
 * fast-forward when the local branch is behind, a merge commit when they diverged, never a rebase
 * nor a force, since both sides are published. Reads the remote-tracking ref the tick's fetch left.
 * A conflicting merge of the branch with itself is aborted and refused: it is a person's to
 * resolve, never a resolver of the base.
 */
export async function syncRemote(ctx: HostContext, p: StepPlace): Promise<PluginResult<RemoteSync>> {
  const tracking = await revParse(ctx, p.cwd, `refs/remotes/${p.remote}/${p.branch}`);
  if (!tracking.ok) return tracking;
  if (tracking.value === null) return ok({ tracking: null, took: false });
  const behind = await isAncestor(ctx, p.cwd, tracking.value, "HEAD");
  if (!behind.ok) return behind;
  if (behind.value) return ok({ tracking: tracking.value, took: false });
  const ff = await isAncestor(ctx, p.cwd, "HEAD", tracking.value);
  if (!ff.ok) return ff;
  if (ff.value) {
    const out = await git(ctx, p.cwd, ["merge", "--ff-only", "--quiet", tracking.value]);
    return out.code === 0 ? ok({ tracking: tracking.value, took: true }) : gitFailure(out, "merge --ff-only");
  }
  const remoteRef = `${p.remote}/${p.branch}`;
  const m = await mergeInto(ctx, p.cwd, tracking.value, { message: `Merge ${remoteRef} into ${p.branch}` });
  if (!m.ok) return m;
  if ("conflict" in m.value)
    return fail(
      "conflict",
      `${p.branch} diverged from ${remoteRef}; merging it conflicts in ${m.value.conflict.files.join(", ") || "?"}. Nothing was pushed: merge ${remoteRef} into ${p.branch} in ${p.cwd} by hand (a merge commit, never a rebase or a force), and the step runs again`,
      false,
    );
  return ok({ tracking: tracking.value, took: true });
}

export interface ResolvedBase {
  ref: string;
  sha: string;
}

/**
 * The base the step compares against: the step's own `base`, else the host's, else the remote's
 * default branch (`<remote>/HEAD`), else a local `main`. Read after a fetch, so it is the newest the
 * remote had.
 */
export async function resolveBase(ctx: HostContext, cwd: string, input: StepKindInput<GitStepConfig>, remote: string): Promise<PluginResult<ResolvedBase>> {
  const named = input.config.base ?? input.base?.ref;
  const candidates = named !== undefined ? [named] : await defaultBases(ctx, cwd, remote);
  for (const ref of candidates) {
    const sha = await revParse(ctx, cwd, ref);
    if (!sha.ok) return sha;
    if (sha.value !== null) return ok({ ref, sha: sha.value });
  }
  return fail("not_found", `${input.step}: no base found (tried ${candidates.join(", ") || "nothing"}); set the step's base`, false);
}

async function defaultBases(ctx: HostContext, cwd: string, remote: string): Promise<string[]> {
  const has = await remoteIfAny(ctx, cwd, remote);
  if (!has.ok || has.value === null) return ["main"];
  const head = await git(ctx, cwd, ["symbolic-ref", "--quiet", "--short", `refs/remotes/${remote}/HEAD`]);
  const named = head.code === 0 ? head.stdout.trim() : "";
  return [...(named ? [named] : []), `${remote}/main`, "main"];
}
