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
  push(branch: string, opts?: VcsPushOptions): Promise<PluginResult<void>>;
  fetch(): Promise<PluginResult<void>>;
}

export interface VcsFactory<S extends TSchema = TSchema> {
  configSchema: S;
  create(ctx: HostContext, config: Static<S>): Vcs;
}
