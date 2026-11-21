/**
 * The rule a run that may not keep code is held to once it reports, judged over what the host saw
 * change since the visit's snapshot. Pure, so `norn done` refusing early and the tick's check after the
 * run's processes are killed judge alike; the host only reports the changes and performs the reset.
 */
import type { GuardedCode } from "./run-state.ts";

/** The files a scratch run may change without a word: an install rewrites them, and nothing in one can hide a stub. */
export const LOCKFILES: readonly string[] = [
  "bun.lock",
  "bun.lockb",
  "package-lock.json",
  "npm-shrinkwrap.json",
  "yarn.lock",
  "pnpm-lock.yaml",
  "deno.lock",
  "Cargo.lock",
  "Gemfile.lock",
  "poetry.lock",
  "uv.lock",
  "Pipfile.lock",
  "composer.lock",
  "go.sum",
  "mix.lock",
  "pubspec.lock",
  "Podfile.lock",
  "flake.lock",
];

export interface ChangesSeen {
  code: GuardedCode;
  /** the outcome reported passes the step (its verdict is `pass`) */
  passes: boolean;
  /** tracked paths changed since the snapshot, norn's own files left out */
  changed: readonly string[];
  headMoved: boolean;
  remoteMoved: boolean;
  configChanged: boolean;
  hooksChanged: boolean;
  /** a ref other than the unit's own moved */
  refsChanged: boolean;
}

export interface ChangesJudged {
  /** `refused`: the report may not stand; `reset`: it stands once `reset` (and HEAD, with `resetHead`) is put back */
  verdict: "clean" | "reset" | "refused";
  reasons: string[];
  reset: string[];
  resetHead: boolean;
  /** what a person should know that holds nothing back */
  notes: string[];
}

const isLockfile = (path: string): boolean => LOCKFILES.includes(path.slice(path.lastIndexOf("/") + 1));

export function judgeChanges(seen: ChangesSeen): ChangesJudged {
  const reasons: string[] = [];
  if (seen.remoteMoved) reasons.push("the remote's copy of the branch moved since the run started");
  if (seen.configChanged) reasons.push("the repo's git config changed since the run started");
  if (seen.hooksChanged) reasons.push("a git hook changed since the run started");
  // a commit moves the branch's own ref, so only a ref that moved without it is someone else's to note
  const notes = seen.refsChanged && !seen.headMoved ? ["a ref other than this unit's branch moved while the run worked (a branch, a tag or a stash): norn cannot tell who moved it"] : [];
  const moved = "the branch moved since the run started: a commit was made, or the branch reset";
  let reset: string[] = [];
  let resetHead = false;
  if (seen.code === "read") {
    if (seen.changed.length > 0) reasons.push(`tracked files changed since the run started: ${seen.changed.join(", ")}`);
    if (seen.headMoved) reasons.push(moved);
  } else if (seen.passes) {
    const other = seen.changed.filter((p) => !isLockfile(p));
    // the reset would hide a stub behind a pass, so a pass needs the code as the run found it
    if (other.length > 0) reasons.push(`an outcome that passes the step is refused while a tracked file other than a lockfile changed since the run started: ${other.join(", ")}`);
    if (seen.headMoved) reasons.push(`an outcome that passes the step is refused while ${moved}`);
    reset = seen.changed.filter(isLockfile);
  } else {
    reset = [...seen.changed];
    resetHead = seen.headMoved;
  }
  if (reasons.length > 0) return { verdict: "refused", reasons, reset: [], resetHead: false, notes };
  return { verdict: reset.length > 0 || resetHead ? "reset" : "clean", reasons, reset, resetHead, notes };
}
