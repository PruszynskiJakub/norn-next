/**
 * The vcs slot: the version control a story's branches and worktrees live in (git, ...). Every
 * provider reaches its tool only through `ctx.exec`, and keeps worktrees under
 * `<ctx.repo.dataDir>/worktrees/`, never beside the repo, so a worktree is never committed by
 * accident and the repo's own folder stays the person's.
 */
import type { Static, TSchema } from "@sinclair/typebox";
import type { HostContext } from "./host.ts";
import type { PluginResult } from "./result.ts";

export interface VcsCapabilities {
  /** one checkout per unit; without it every unit shares the repo's own checkout */
  worktrees: boolean;
  /** the provider can merge one branch into another */
  merge: boolean;
  /** the provider has a remote to push to and fetch from */
  push: boolean;
}

/** A merge that went through (the branch's new head), or one that stopped on conflicts; a conflict is data, never a failure. */
export type VcsMergeOutcome = { head: string } | { conflict: { files: string[] } };

/** An operation stopped half-way in a checkout, waiting for someone to conclude or abort it. */
export interface VcsUnfinished {
  operation: "merge" | "rebase" | "cherry-pick";
  /** the paths still unmerged, sorted; empty once every conflict is resolved but the operation is not concluded */
  unmerged: string[];
}

/** A conflict left unresolved in a file: where its opening marker line is. */
export interface VcsConflictMarker {
  path: string;
  /** the opening marker's line in the file as `head` holds it, from 1 */
  line: number;
}

export interface VcsMergeOptions {
  /**
   * on a conflict, abort the merge so the branch and its worktree are as they were before it began;
   * the outcome still names the conflicting paths. For a one-off update nobody stands by to resolve
   */
  abortOnConflict?: boolean;
}

export interface VcsPushOptions {
  /**
   * the commit the remote branch is expected at; the push refuses (`conflict`) when it has moved, so
   * a push never overwrites work someone else pushed meanwhile
   */
  lease?: string;
}

export interface VcsWorktrees {
  /** make the unit's worktree on `branch` (when the branch is new, cut from the remote's copy of it if there is one, else from `base`), or find the one there */
  ensure(unit: string, branch: string, base: string): Promise<PluginResult<{ path: string }>>;
  /** remove the unit's worktree; removing a missing one is not an error */
  remove(unit: string): Promise<PluginResult<void>>;
  /** where the unit's worktree is or would be; pure, so a reader needs no effect to find it */
  path(unit: string): string;
}

export interface Vcs {
  readonly name: string;
  readonly capabilities: VcsCapabilities;
  readonly worktree: VcsWorktrees;
  /** the commit `ref` names, or null when it names none */
  head(ref: string): Promise<PluginResult<string | null>>;
  /** whether commit `a` is reachable from `b` */
  isAncestor(a: string, b: string): Promise<PluginResult<boolean>>;
  /** the newest commit both refs reach, or null when they share none */
  mergeBase(a: string, b: string): Promise<PluginResult<string | null>>;
  /** merge `from` into `branch` in the branch's worktree, never rebasing; a conflict leaves the merge in progress unless `abortOnConflict` */
  merge(branch: string, from: string, opts?: VcsMergeOptions): Promise<PluginResult<VcsMergeOutcome>>;
  /**
   * the paths merging `from` into `into` would conflict on, empty when it merges clean: a trial that
   * moves no branch and touches no worktree. Optional; without it a host cannot tell a base move
   * that conflicts from a clean one, and reports neither as stale.
   */
  conflicts?(into: string, from: string): Promise<PluginResult<string[]>>;
  /**
   * the ref holding the remote's copy of `branch` as last fetched (`origin/main`), or null when there
   * is no remote or it lacks the branch. Optional; without it a host measures the base at the local
   * branch, which moves only when the person pulls.
   */
  remoteRef?(branch: string): Promise<PluginResult<string | null>>;
  /**
   * the commit the remote's copy of `branch` was at when last fetched, null when the remote has no
   * such branch or there is no remote. Optional; without it a host cannot take in what a person
   * pushed to the branch, and a push after theirs is refused.
   */
  remoteHead?(branch: string): Promise<PluginResult<string | null>>;
  /**
   * the operation stopped half-way in the checkout at `path` (a unit's worktree, or the repo's own
   * checkout), or null when none is or `path` is no checkout. Optional (plugin API 1.9); without it a
   * host cannot hold back a report made while a merge still waits to be concluded.
   */
  unfinished?(path: string): Promise<PluginResult<VcsUnfinished | null>>;
  /**
   * the paths in the checkout at `path` holding a change not committed (staged, unstaged, or
   * untracked and not ignored), sorted; empty when it is clean or `path` is no checkout. Optional
   * (plugin API 1.10); without it a host cannot hold back a report that would leave work behind.
   */
  uncommitted?(path: string): Promise<PluginResult<string[]>>;
  /**
   * the files in the checkout at `path` that are untracked and not ignored, sorted; empty when there
   * are none or `path` is no checkout. Optional (plugin API 1.15); without it what a check leaves in
   * a unit's worktree stays there for the next step to deal with.
   */
  untracked?(path: string): Promise<PluginResult<string[]>>;
  /**
   * the conflicts the commits on `head` since it left `base` (from their merge base) added and left
   * unresolved: an opening, a separating and a closing marker line, in that order, all added by those
   * commits, sorted by path and line. A file that only quotes a marker or two is never one. Empty when
   * there are none. Optional (plugin API 1.11); without it a host cannot hold back a report that
   * leaves a conflict in the work.
   */
  conflictMarkers?(base: string, head: string): Promise<PluginResult<VcsConflictMarker[]>>;
  /**
   * delete the local `branch` whatever it holds; deleting a missing one is not an error. The host
   * asks only once the branch's commits are somewhere else, and never for a branch a worktree has
   * checked out. Optional (plugin API 1.14); without it a finished unit's branch stays.
   */
  deleteBranch?(branch: string): Promise<PluginResult<void>>;
  push(branch: string, opts?: VcsPushOptions): Promise<PluginResult<void>>;
  fetch(): Promise<PluginResult<void>>;
}

export interface VcsFactory<S extends TSchema = TSchema> {
  configSchema: S;
  create(ctx: HostContext, config: Static<S>): Vcs;
}
