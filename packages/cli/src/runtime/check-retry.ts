/**
 * What `run view` says about a unit a check's fail sent back: the check, when it failed,
 * the rerun that retries it, and whether the work changed since — so a person or a supervisor tells a
 * glitch from a real failure without reading git themselves.
 */
import { checkRetryOf, cmd, type GitPort, isCodePath, isStepBoundary, type UnitFacts } from "@norn/core";

export interface CheckRetry {
  /** the check step whose fail sent the unit to the step it is at */
  check: string;
  /** when that check failed (its receipt's `at`) */
  failed_at: string;
  /**
   * a commit since that fail's boundary commit, or an uncommitted change in the worktree, touches a
   * path outside the spec's `handoffs/` (and an older layout's `runs/`); null when it cannot be told
   * (no worktree here, no such boundary commit)
   */
  code_changed: boolean | null;
  /** the rerun at that check */
  command: string;
}

/** Commits searched back from the worktree's HEAD for the fail's boundary. */
const LOG_LIMIT = 200;

/** null unless the unit sits at the step a check's fail sent it to (`checkRetryOf`). */
export async function checkRetry(git: GitPort, uf: UnitFacts): Promise<CheckRetry | null> {
  const st = uf.state;
  const check = uf.workflow && st ? checkRetryOf(uf.workflow, st) : null;
  if (!check || !st?.last_outcome) return null;
  const at = { step: check, outcome: st.last_outcome.outcome, next: st.step };
  const wt = uf.worktree?.exists ? uf.worktree : null;
  let code_changed: boolean | null = null;
  if (wt) {
    const boundary = (await git.log(wt.path, "HEAD", LOG_LIMIT).catch(() => [])).find((c) => isStepBoundary(c.trailers, st.story, st.slice, at));
    if (boundary) {
      const dirty = wt.status ? [...wt.status.staged, ...wt.status.unstaged, ...wt.status.untracked] : [];
      const committed = await git.changedPaths(wt.path, boundary.sha, "HEAD").catch(() => null);
      code_changed = committed === null ? null : [...committed, ...dirty].some(isCodePath);
    }
  }
  return { check, failed_at: st.last_outcome.at, code_changed, command: cmd.runRerun(uf.unit.key, { step: check }) };
}
