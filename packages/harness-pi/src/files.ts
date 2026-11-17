/**
 * The extension's files on disk. Writes go temp file, fsync, rename, so a pi starting mid-install
 * loads either the old extension or the new, never a torn file that fails to load and drops every hook.
 */
import { closeSync, fsyncSync, mkdirSync, openSync, readdirSync, readFileSync, renameSync, rmdirSync, rmSync, writeSync } from "node:fs";
import { basename, dirname, join } from "node:path";

/** The file's text, or null when there is none. */
export function readText(path: string): string | null {
  try {
    return readFileSync(path, "utf8");
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw e;
  }
}

function fsyncDir(dir: string): void {
  // some platforms refuse to open a directory for sync; the rename has still happened
  try {
    const fd = openSync(dir, "r");
    try {
      fsyncSync(fd);
    } finally {
      closeSync(fd);
    }
  } catch {}
}

export function writeTextAtomic(path: string, text: string): void {
  const dir = dirname(path);
  mkdirSync(dir, { recursive: true });
  // a fixed temp name would let two installs race on one temp file; the pid keeps them apart
  const tmp = join(dir, `.${basename(path)}.${process.pid}.tmp`);
  const fd = openSync(tmp, "w");
  try {
    writeSync(fd, text);
    fsyncSync(fd);
  } finally {
    closeSync(fd);
  }
  try {
    renameSync(tmp, path);
  } catch (e) {
    rmSync(tmp, { force: true });
    throw e;
  }
  fsyncDir(dir);
}

export function removeFile(path: string): void {
  rmSync(path, { force: true });
  fsyncDir(dirname(path));
}

/** Remove `dir` when nothing is left in it; a folder holding anything is a person's and stays. */
export function removeIfEmpty(dir: string): void {
  let names: string[];
  try {
    names = readdirSync(dir);
  } catch {
    return;
  }
  if (names.length > 0) return;
  rmdirSync(dir);
  fsyncDir(dirname(dir));
}
