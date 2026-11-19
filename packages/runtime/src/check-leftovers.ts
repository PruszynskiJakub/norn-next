/**
 * What a check leaves in a unit's worktree. A check runs the repo's own commands there (an install, a
 * coverage report), and a file one writes that the repo neither tracks nor ignores would read as the
 * next agent's uncommitted work and hold back its `norn done`. The untracked files are read before
 * the check starts, and those that appear by the time it settles are removed: nobody else works in
 * the worktree while its unit is at a check, so they are the check's own. A tracked file a check
 * changes is never touched, as it may be work; the next agent's done names it.
 */
import { join } from "node:path";
import type { RuntimeEnv } from "./env.ts";

/** How many removed files the check's output names before it counts the rest. */
const NAMED = 10;

/** The worktree's untracked files, or null when the vcs cannot tell, which leaves the check's leftovers alone. */
export async function untrackedFiles(env: RuntimeEnv, worktree: string): Promise<string[] | null> {
  const vcs = env.slots.vcs;
  if (!vcs.untracked) return null;
  try {
    const r = await vcs.untracked(worktree);
    return r.ok ? r.value : null;
  } catch {
    return null;
  }
}

/** Remove the untracked files that were not there before the check; the line its output carries about them, or "". */
export async function removeLeftovers(env: RuntimeEnv, worktree: string, before: readonly string[] | undefined): Promise<string> {
  if (before === undefined) return "";
  const now = await untrackedFiles(env, worktree);
  if (now === null) return "";
  const had = new Set(before);
  const left = now.filter((p) => !had.has(p));
  const removed: string[] = [];
  for (const p of left) {
    try {
      await env.ctx.files.remove(join(worktree, p));
      removed.push(p);
    } catch {
      // one that cannot be removed stays, and the next agent's done names it
    }
  }
  if (removed.length === 0) return "";
  const named = removed.slice(0, NAMED).join(", ") + (removed.length > NAMED ? ` and ${removed.length - NAMED} more` : "");
  return `\n(norn removed what the check left untracked in the worktree: ${named})`;
}
