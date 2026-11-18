/**
 * The settings file on disk. Writes go temp file, fsync, rename, so Claude Code reading the file
 * mid-write sees either the old settings or the new, never a torn file that drops every hook.
 */
import { closeSync, fsyncSync, mkdirSync, openSync, readFileSync, renameSync, rmSync, writeSync } from "node:fs";
import { basename, dirname, join } from "node:path";

/** The parsed JSON at `path`, or null when there is no file; throws on a file that is not JSON. */
export function readJson(path: string): unknown {
  let text: string;
  try {
    text = readFileSync(path, "utf8");
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw e;
  }
  try {
    return JSON.parse(text);
  } catch (e) {
    throw new Error(`${path} is not valid JSON; fix or remove it (${e instanceof Error ? e.message : String(e)})`);
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

export function writeJsonAtomic(path: string, value: unknown): void {
  const dir = dirname(path);
  mkdirSync(dir, { recursive: true });
  // a fixed temp name would let two installs race on one temp file; the pid keeps them apart
  const tmp = join(dir, `.${basename(path)}.${process.pid}.tmp`);
  const fd = openSync(tmp, "w");
  try {
    writeSync(fd, `${JSON.stringify(value, null, 2)}\n`);
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
