/**
 * gh-110 D6: the file moves of `norn migrate`, from the old layout's places (D4) to the new ones (D1).
 * Each one can run again: a rerun moves what an interrupted run left and leaves the rest.
 */
import { cpSync, existsSync, mkdirSync, readdirSync, renameSync, rmdirSync, rmSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { atomicWrite, isErrno, readText } from "./fsx.ts";
import { ensureCheckoutFile } from "./machine-dir.ts";
import { machineDir, OLD_NORN_DIR, OLD_TRACE_DIR, OLD_WORKFLOWS_DIR, oldTickLockPath } from "./paths.ts";

const entries = (dir: string): string[] => {
  try {
    return readdirSync(dir).sort();
  } catch {
    return [];
  }
};

/** Move a file or folder into a folder made as needed: a rename, or copy then delete when `to` is on another filesystem. */
export function moveFile(from: string, to: string): void {
  mkdirSync(dirname(to), { recursive: true });
  try {
    renameSync(from, to);
  } catch (e) {
    if (!isErrno(e, "EXDEV")) throw e;
    cpSync(from, to, { recursive: true, preserveTimestamps: true });
    rmSync(from, { recursive: true, force: true });
  }
}

/** The old trace dir's entries to move, without the tick lock `norn migrate` holds there. */
export const oldTraceEntries = (root: string): string[] => entries(join(root, OLD_TRACE_DIR)).filter((n) => n !== basename(oldTickLockPath(root)));

/** Entries of the old workflows folder, relative to the root. */
export const oldWorkflowEntries = (root: string): string[] => entries(join(root, OLD_WORKFLOWS_DIR)).map((n) => `${OLD_WORKFLOWS_DIR}/${n}`);

/** Old trace entries a machine dir already holds under the same name: a rerun cannot tell which one to keep. */
export const traceClashes = (root: string): string[] => oldTraceEntries(root).filter((n) => existsSync(join(machineDir(root), n)));

/** B12: move the old trace dir's contents (all but the held lock) into the machine dir; true when something moved. */
export function moveOldTrace(root: string): boolean {
  const names = oldTraceEntries(root);
  for (const n of names) moveFile(join(root, OLD_TRACE_DIR, n), join(machineDir(root), n));
  if (existsSync(machineDir(root))) ensureCheckoutFile(root);
  return names.length > 0;
}

/** B13: the lines an older `norn init` wrote for the old trace folder; the person's own lines are kept. */
const OLD_IGNORE_LINES = [OLD_TRACE_DIR, `${OLD_TRACE_DIR}/`];

/** Drop norn's old trace line from `.gitignore`; true when the file changed. */
export function dropOldIgnoreLine(root: string): boolean {
  const path = join(root, ".gitignore");
  const text = readText(path);
  if (text === null) return false;
  const lines = text.split("\n");
  const kept = lines.filter((l) => !OLD_IGNORE_LINES.includes(l.trim()));
  if (kept.length === lines.length) return false;
  atomicWrite(path, kept.join("\n"));
  return true;
}

/** Remove the old layout's folders once they are empty (the lock already dropped). */
export function removeOldLayoutDirs(root: string): void {
  for (const d of [OLD_WORKFLOWS_DIR, OLD_TRACE_DIR, OLD_NORN_DIR]) {
    const dir = join(root, d);
    if (existsSync(dir) && entries(dir).length === 0) rmdirSync(dir);
  }
}
