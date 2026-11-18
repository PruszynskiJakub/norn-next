/**
 * A ref's tree as a flat map of file paths, and the rewrite of a few of them into a new tree. Only
 * the folders on the path to a changed file are rebuilt; every other subtree keeps its object id.
 */
import { fail, ok, type PluginResult } from "@norn/plugin-api";
import { type Git, lsTree, type MkTreeEntry, mkTree } from "./git.ts";

const FILE_MODE = "100644";

export interface Snapshot {
  /** the commit read, or null when the ref does not exist */
  head: string | null;
  /** blob path → object id */
  files: Map<string, string>;
  /** folder path → tree id, as read */
  trees: Map<string, string>;
}

export async function loadSnapshot(git: Git, head: string | null): Promise<PluginResult<Snapshot>> {
  if (head === null) return ok({ head, files: new Map(), trees: new Map() });
  const entries = await lsTree(git, head);
  if (!entries.ok) return entries;
  const snap: Snapshot = { head, files: new Map(), trees: new Map() };
  for (const e of entries.value) {
    if (e.type === "blob") snap.files.set(e.path, e.sha);
    else if (e.type === "tree") snap.trees.set(e.path, e.sha);
  }
  return ok(snap);
}

/** Paths directly inside `dir` (no deeper), with the name each has there. */
export function filesIn(snap: Snapshot, dir: string): Array<{ path: string; name: string; sha: string }> {
  const prefix = `${dir}/`;
  const out: Array<{ path: string; name: string; sha: string }> = [];
  for (const [path, sha] of snap.files) {
    if (!path.startsWith(prefix)) continue;
    const name = path.slice(prefix.length);
    if (!name.includes("/")) out.push({ path, name, sha });
  }
  return out;
}

const parentOf = (path: string): string => {
  const cut = path.lastIndexOf("/");
  return cut < 0 ? "" : path.slice(0, cut);
};
const nameOf = (path: string): string => path.slice(path.lastIndexOf("/") + 1);
const depthOf = (dir: string): number => (dir === "" ? 0 : dir.split("/").length);

/**
 * The root tree after setting each changed path to a blob id (null removes it). A folder left with
 * nothing in it is dropped, as git itself never stores an empty subtree.
 */
export async function writeTree(git: Git, snap: Snapshot, changes: Map<string, string | null>): Promise<PluginResult<string>> {
  const files = new Map(snap.files);
  const dirty = new Set<string>([""]);
  for (const [path, sha] of changes) {
    if (sha === null) files.delete(path);
    else files.set(path, sha);
    for (let d = parentOf(path); d !== ""; d = parentOf(d)) dirty.add(d);
  }
  const held = new Set<string>();
  for (const path of files.keys()) for (let d = parentOf(path); d !== ""; d = parentOf(d)) held.add(d);
  // the last line of defence: a name both a blob and a subtree makes a tree git fsck refuses, and no remote would take it
  for (const path of files.keys()) if (held.has(path)) return fail("invalid", `refs store: ${path} would be both a file and a folder`, false);
  const dirs = new Set<string>([...snap.trees.keys(), ...dirty, ...held]);
  const built = new Map<string, string | null>();
  for (const dir of [...dirty].sort((a, b) => depthOf(b) - depthOf(a))) {
    const entries: MkTreeEntry[] = [];
    for (const [path, sha] of files) if (parentOf(path) === dir) entries.push({ mode: FILE_MODE, type: "blob", sha, name: nameOf(path) });
    for (const sub of dirs) {
      if (sub === "" || parentOf(sub) !== dir) continue;
      const sha = dirty.has(sub) ? built.get(sub) : snap.trees.get(sub);
      if (sha) entries.push({ mode: "040000", type: "tree", sha, name: nameOf(sub) });
    }
    if (entries.length === 0 && dir !== "") {
      built.set(dir, null);
      continue;
    }
    const tree = await mkTree(git, entries);
    if (!tree.ok) return tree;
    built.set(dir, tree.value);
  }
  return ok(built.get("") as string);
}
