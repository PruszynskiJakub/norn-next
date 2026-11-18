/**
 * The settings file on disk. Writes go temp file, fsync, rename, so Claude Code reading the file
 * mid-write sees either the old settings or the new, never a torn file that drops every hook.
 */
import { closeSync, fsyncSync, mkdirSync, openSync, readdirSync, readFileSync, renameSync, rmdirSync, rmSync, writeSync } from "node:fs";
import { basename, dirname, join } from "node:path";

/** The text at `path`, or null when there is no file. */
export function readText(path: string): string | null {
  try {
    return readFileSync(path, "utf8");
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw e;
  }
}

/** The parsed JSON at `path`, or null when there is no file; throws on a file that is not JSON. */
export function readJson(path: string): unknown {
  const text = readText(path);
  if (text === null) return null;
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
  writeTextAtomic(path, `${JSON.stringify(value, null, 2)}\n`);
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
