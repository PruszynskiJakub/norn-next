/**
 * gh-195/06 (B34, D13): move the run state an older norn left on a unit's branch (`<spec folder>/runs/`
 * in its worktree) into the machine dir (S12). The copy is built and validated beside its target, then
 * put in place atomically (S1); a record that fails validation is not copied (S2). Removing it from the
 * worktree, and so from the branch, comes only after every copy is in place, and the handoffs stay
 * (gh-195/07 moves them).
 */
import { cpSync, existsSync, readdirSync, rmSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import type { FileError } from "@norn/core";
import { ROUNDS_DIR, type RunStory } from "@norn/schema";
import { atomicCopyDir, displayPath } from "./fsx.ts";
import { statePath } from "./paths.ts";
import { listReceipts } from "./receipts.ts";
import { treeRunStateDir, treeRunStateFiles } from "./run-state.ts";
import { readPinnedWorkflow, readState } from "./unit.ts";

/** The files of a record folder that fail validation: each state, pinned workflow and receipt of it and of its rounds (S2). */
export function recordErrors(dir: string, root?: string): FileError[] {
  const errors: FileError[] = [];
  const folders = [dir];
  const rounds = join(dir, ROUNDS_DIR);
  if (existsSync(rounds)) for (const r of readdirSync(rounds).sort()) folders.push(join(rounds, r));
  for (const f of folders) {
    if (!existsSync(statePath(f))) continue;
    const st = readState(f, root);
    if (!st.ok && st.reason === "corrupt") errors.push(st.error);
    const wf = readPinnedWorkflow(f, root);
    if (!wf.ok && wf.reason === "corrupt") errors.push(wf.error);
    errors.push(...listReceipts(f, root ? { root } : {}).errors);
  }
  return errors;
}

/**
 * Copy one unit's record folder `from` (in a worktree's tree) to `to` (in the machine dir), leaving its
 * handoff (`handoff`, the unit's `handoffPath` there) out. A flat record (RD7: `state.json` directly in the folder) lands as it is in `to`, which
 * decide names as the story's round 1. Nothing is copied when `to` already holds its state (an earlier
 * move that stopped after the copy, S5): returns false then. Throws, copying nothing, when a file of
 * the record fails validation (S2).
 */
export function copyTreeRecord(from: string, to: string, handoff: string): boolean {
  if (existsSync(statePath(to))) return false;
  const flat = existsSync(statePath(from));
  const staging = join(dirname(to), `.${basename(to)}.move-${process.pid}`);
  rmSync(staging, { recursive: true, force: true });
  try {
    cpSync(from, staging, {
      recursive: true,
      filter: (src) => {
        if (src === from) return true;
        const top = src.slice(from.length + 1).split("/")[0];
        // the handoff stays in the worktree; a flat record's partial rounds/ is no part of it
        return !(src === handoff || (flat && top === ROUNDS_DIR));
      },
    });
    const errors = recordErrors(staging);
    if (errors.length) throw new Error(`${displayPath(from)} failed validation (S2): ${errors.map((e) => e.file.replace(staging, from)).join(", ")}`);
    atomicCopyDir(staging, to);
  } finally {
    rmSync(staging, { recursive: true, force: true });
  }
  return true;
}

/**
 * Remove an older norn's run state from the tree of `root` (every file there but the units' handoffs),
 * and the folders it leaves empty; returns the files it removed, absolute.
 */
export function removeTreeRunState(root: string, story: RunStory): string[] {
  const files = treeRunStateFiles(root, story);
  for (const f of files) rmSync(f, { force: true });
  const prune = (dir: string): boolean => {
    const left = readdirSync(dir, { withFileTypes: true }).filter((d) => !(d.isDirectory() && prune(join(dir, d.name))));
    if (left.length) return false;
    rmSync(dir, { recursive: true, force: true });
    return true;
  };
  const base = treeRunStateDir(root, story);
  if (files.length && existsSync(base)) prune(base);
  return files;
}
