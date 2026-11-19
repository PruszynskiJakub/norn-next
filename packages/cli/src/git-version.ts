/**
 * The oldest git norn runs on. Base conflicts are found with `git merge-tree --write-tree`, which git
 * gained in 2.38; an older git fails that call on every tick, so a conflict with the base goes unseen.
 */
import type { HostContext } from "@norn/plugin-api";
import { type CliFailure, refuse } from "./output.ts";

export const MIN_GIT_VERSION = [2, 38] as const;
export const MIN_GIT_TEXT = MIN_GIT_VERSION.join(".");

/** `git version 2.39.3 (Apple Git-145)` as numbers; null for output that names no version. */
export function parseGitVersion(out: string): readonly number[] | null {
  const m = /git version (\d+)\.(\d+)/.exec(out);
  return m ? [Number(m[1]), Number(m[2])] : null;
}

/**
 * Whether `git --version` printed a version below the floor. Output that names no version passes: a
 * build that spells its version otherwise is not refused on a guess.
 */
export function gitTooOld(out: string): boolean {
  const v = parseGitVersion(out);
  if (!v) return false;
  const [major = 0, minor = 0] = v;
  return major < MIN_GIT_VERSION[0] || (major === MIN_GIT_VERSION[0] && minor < MIN_GIT_VERSION[1]);
}

export const GIT_UPGRADE = `upgrade git to ${MIN_GIT_TEXT} or later (https://git-scm.com)`;

/** The refusal of a command that must not run on this git, or null when git is new enough. */
export async function gitVersionRefusal(host: HostContext, cwd: string): Promise<CliFailure | null> {
  const r = await host.exec(["git", "--version"], { cwd, timeoutMs: 15_000 });
  if (r.code !== 0) return refuse(`git cannot be run: ${(r.stderr.trim() || `exit ${r.code}`).split("\n")[0]}`, `install git ${MIN_GIT_TEXT} or later, then norn doctor`, "git_too_old");
  const found = r.stdout.trim();
  if (!gitTooOld(found)) return null;
  return refuse(`git ${MIN_GIT_TEXT} or later is required to find conflicts with the base (found: ${found})`, `${GIT_UPGRADE}, then norn doctor`, "git_too_old");
}
