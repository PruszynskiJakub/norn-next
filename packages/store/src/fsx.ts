/**
 * Low-level file primitives (S1): atomic writes (temp in the same dir → fsync → rename),
 * exclusive creates (temp → fsync → link, which fails with EEXIST atomically), and
 * validated reads that return a typed `corrupt` result instead of throwing (S2).
 */
import { closeSync, fsyncSync, linkSync, mkdirSync, openSync, readFileSync, renameSync, unlinkSync, writeSync } from "node:fs";
import { basename, dirname, join, relative } from "node:path";
import type { FileError } from "@norn/core";
import { type SchemaError, type SchemaName, type SchemaType, validate } from "@norn/schema";

/** Result of reading a persisted file. `missing` is not an error; `corrupt` marks the unit (S2). */
export type ReadResult<T> =
  | { ok: true; value: T; raw: string }
  | { ok: false; reason: "missing" }
  | { ok: false; reason: "corrupt"; error: FileError };

let tmpSeq = 0;
function tmpName(path: string): string {
  return join(dirname(path), `.${basename(path)}.${process.pid}.${Date.now()}.${tmpSeq++}.tmp`);
}

function fsyncDir(dir: string): void {
  try {
    const fd = openSync(dir, "r");
    try {
      fsyncSync(fd);
    } finally {
      closeSync(fd);
    }
  } catch {
    // some platforms refuse fsync on directories; the rename is still atomic
  }
}

function writeTemp(path: string, data: string | Uint8Array, mode = 0o644): string {
  mkdirSync(dirname(path), { recursive: true });
  const tmp = tmpName(path);
  const fd = openSync(tmp, "wx", mode);
  try {
    const buf = typeof data === "string" ? Buffer.from(data, "utf8") : data;
    let off = 0;
    while (off < buf.length) off += writeSync(fd, buf, off, buf.length - off);
    fsyncSync(fd);
  } finally {
    closeSync(fd);
  }
  return tmp;
}

/** Atomically replace `path` with `data` (S1). Creates parent dirs; `mode` for executables (R8.1 shim). */
export function atomicWrite(path: string, data: string | Uint8Array, mode?: number): void {
  const tmp = writeTemp(path, data, mode);
  try {
    renameSync(tmp, path);
  } catch (e) {
    safeUnlink(tmp);
    throw e;
  }
  fsyncDir(dirname(path));
}

/**
 * Create `path` with `data` only if it does not exist (O_EXCL semantics, atomic content).
 * Returns false when the file already exists.
 */
export function createExclusive(path: string, data: string | Uint8Array): boolean {
  const tmp = writeTemp(path, data);
  try {
    linkSync(tmp, path);
  } catch (e) {
    if (isErrno(e, "EEXIST")) return false;
    throw e;
  } finally {
    safeUnlink(tmp);
  }
  fsyncDir(dirname(path));
  return true;
}

export function json(value: unknown): string {
  return `${JSON.stringify(value, null, 2)}\n`;
}

export function atomicWriteJson(path: string, value: unknown): void {
  atomicWrite(path, json(value));
}

export function readText(path: string): string | null {
  try {
    return readFileSync(path, "utf8");
  } catch (e) {
    if (isErrno(e, "ENOENT") || isErrno(e, "ENOTDIR")) return null;
    throw e;
  }
}

export function safeUnlink(path: string): boolean {
  try {
    unlinkSync(path);
    return true;
  } catch (e) {
    if (isErrno(e, "ENOENT")) return false;
    throw e;
  }
}

export function isErrno(e: unknown, code: string): boolean {
  return typeof e === "object" && e !== null && (e as { code?: unknown }).code === code;
}

/** Path shown in a FileError: relative to `root` when given, else as is. */
export function displayPath(path: string, root?: string): string {
  return root ? relative(root, path) : path;
}

export function fileError(path: string, errors: SchemaError[], root?: string): FileError {
  return { file: displayPath(path, root), errors };
}

/** Validate parsed data against a published schema; wrap failures as a FileError. */
export function validated<N extends SchemaName>(
  name: N,
  value: unknown,
  path: string,
  raw: string,
  root?: string,
): ReadResult<SchemaType<N>> {
  const r = validate(name, value);
  return r.ok ? { ok: true, value: r.value, raw } : { ok: false, reason: "corrupt", error: fileError(path, r.errors, root) };
}

/** Read + parse + validate a JSON file (S1, S2). */
export function readJsonFile<N extends SchemaName>(name: N, path: string, root?: string): ReadResult<SchemaType<N>> {
  const raw = readText(path);
  if (raw === null) return { ok: false, reason: "missing" };
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (e) {
    return { ok: false, reason: "corrupt", error: fileError(path, [{ path: "", message: `invalid JSON: ${(e as Error).message}` }], root) };
  }
  return validated(name, parsed, path, raw, root);
}
