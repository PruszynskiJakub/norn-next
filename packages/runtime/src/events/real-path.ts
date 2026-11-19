/**
 * A path with every symlink on it followed, through the host's `readLink`. The guard folds a path
 * lexically, so a link inside the worktree that points into run state would carry a write there
 * unseen; the guard checks the followed path too. `..` steps back from the followed prefix, as the
 * file system does, never from the path as written.
 */
import type { HostFiles } from "@norn/plugin-api";

/** As the kernel's own limit: a chain longer than this is a loop, and the rest of the path is kept as written. */
const MAX_LINKS = 40;

const parent = (dir: string): string => dir.slice(0, Math.max(0, dir.lastIndexOf("/")));

/** `path` (resolved against `base` when relative) with its links followed; a host without `readLink`, or a component it cannot read, follows nothing further. */
export async function realPath(files: Pick<HostFiles, "readLink">, base: string, path: string): Promise<string> {
  let todo = (path.startsWith("/") ? path : `${base}/${path}`).split("/");
  let done = "";
  let hops = 0;
  while (todo.length > 0) {
    const seg = todo.shift() as string;
    if (seg === "" || seg === ".") continue;
    if (seg === "..") {
      done = parent(done);
      continue;
    }
    const next = `${done}/${seg}`;
    let target: string | null = null;
    if (files.readLink && hops < MAX_LINKS) {
      try {
        target = await files.readLink(next);
      } catch {
        // a component that is a file, or one the host may not read: what follows cannot be a link it follows
        target = null;
      }
    }
    if (target === null) {
      done = next;
      continue;
    }
    hops++;
    todo = [...target.split("/"), ...todo];
    if (target.startsWith("/")) done = "";
  }
  return done === "" ? "/" : done;
}
