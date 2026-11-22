import { chmod, link, lstat, mkdir, open, readdir, readFile, readlink, rename, symlink, unlink } from "node:fs/promises";
import { basename, dirname, isAbsolute, join, resolve } from "node:path";
import type { HostFiles } from "@norn/plugin-api";

/**
 * Temp files carry this suffix, and `list` leaves them out: a writer's half-made file is never one
 * of the names a store enumerates (a receipt folder must list only whole receipts).
 */
export const TEMP_SUFFIX = ".norn-tmp";

let tempSeq = 0;
function tempName(path: string): string {
  return join(dirname(path), `.${basename(path)}.${process.pid}.${Date.now()}.${tempSeq++}${TEMP_SUFFIX}`);
}

function errno(e: unknown): string | undefined {
  return (e as NodeJS.ErrnoException | undefined)?.code;
}

async function fsyncDir(dir: string): Promise<void> {
  try {
    const h = await open(dir, "r");
    try {
      await h.sync();
    } finally {
      await h.close();
    }
  } catch {
    // some platforms refuse fsync on a folder; the rename or link is still atomic
  }
}

/** Write `data` to a fresh temp file beside `path` and fsync it, so what a rename or link puts in place is on disk first. */
async function writeTemp(path: string, data: string | Uint8Array): Promise<string> {
  await mkdir(dirname(path), { recursive: true });
  const tmp = tempName(path);
  const h = await open(tmp, "wx");
  try {
    await h.writeFile(data);
    await h.sync();
  } catch (e) {
    await h.close();
    await unlink(tmp).catch(() => {});
    throw e;
  }
  await h.close();
  return tmp;
}

/** rwxr-xr-x */
const EXECUTABLE = 0o755;

async function replace(p: string, data: string | Uint8Array, mode?: number): Promise<void> {
  const tmp = await writeTemp(p, data);
  try {
    if (mode !== undefined) await chmod(tmp, mode);
    await rename(tmp, p);
  } catch (e) {
    await unlink(tmp).catch(() => {});
    throw e;
  }
  await fsyncDir(dirname(p));
}

/** Files on the local disk; a relative path is taken from `root`. */
export function nodeFiles(root: string): HostFiles {
  const at = (path: string): string => (isAbsolute(path) ? path : resolve(root, path));
  return {
    read: async (path) => {
      try {
        return await readFile(at(path), "utf8");
      } catch (e) {
        if (errno(e) === "ENOENT") return null;
        throw e;
      }
    },
    write: (path, data) => replace(at(path), data),
    readBytes: async (path) => {
      try {
        return new Uint8Array(await readFile(at(path)));
      } catch (e) {
        if (errno(e) === "ENOENT") return null;
        throw e;
      }
    },
    writeBytes: (path, data) => replace(at(path), data),
    // the bit goes on the temp file, so the name never points at a script that cannot run
    writeExecutable: (path, data) => replace(at(path), data, EXECUTABLE),
    // link, not open("wx") on the target: a reader racing the creator (a lock's owner reading its
    // timestamp) sees no file or the whole file, never an empty one
    create: async (path, data) => {
      const p = at(path);
      const tmp = await writeTemp(p, data);
      try {
        await link(tmp, p);
      } catch (e) {
        if (errno(e) === "EEXIST") return false;
        throw e;
      } finally {
        await unlink(tmp).catch(() => {});
      }
      await fsyncDir(dirname(p));
      return true;
    },
    list: async (dir) => {
      try {
        const names = await readdir(at(dir));
        return names.filter((n) => !n.endsWith(TEMP_SUFFIX)).sort();
      } catch (e) {
        if (errno(e) === "ENOENT") return [];
        throw e;
      }
    },
    // a temp link renamed over the name: a reader sees the old link or the new one, never none
    symlink: async (target, path) => {
      const p = at(path);
      const there = await lstat(p).catch((e: unknown) => {
        if (errno(e) === "ENOENT") return null;
        throw e;
      });
      if (there && !there.isSymbolicLink()) throw new Error(`${p} is a ${there.isDirectory() ? "folder" : "file"}, not a link; it is left as it is`);
      await mkdir(dirname(p), { recursive: true });
      const tmp = tempName(p);
      await symlink(target, tmp);
      try {
        await rename(tmp, p);
      } catch (e) {
        await unlink(tmp).catch(() => {});
        throw e;
      }
      await fsyncDir(dirname(p));
    },
    readLink: async (path) => {
      try {
        return await readlink(at(path));
      } catch (e) {
        if (errno(e) === "ENOENT" || errno(e) === "EINVAL") return null;
        throw e;
      }
    },
    remove: async (path) => {
      const p = at(path);
      try {
        await unlink(p);
      } catch (e) {
        if (errno(e) === "ENOENT") return;
        throw e;
      }
      await fsyncDir(dirname(p));
    },
  };
}
