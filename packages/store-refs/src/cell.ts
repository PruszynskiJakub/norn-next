/**
 * A ref the store moves by compare-and-swap, and the one loop every write goes through: read the
 * ref, decide on what it holds, write the new commit, swap. A lost swap starts over from a fresh
 * read, so a decision is never applied to a ref that moved after it was made.
 */
import { fail, ok, type PluginResult } from "@norn/plugin-api";
import { commitTree, fetchRefs, type Git, hasObject, hashBlob, lsRemote, pushLeased, refHead, updateRef } from "./git.ts";
import { loadSnapshot, type Snapshot, writeTree } from "./tree.ts";

export interface RefCell {
  readonly ref: string;
  /** the commit the ref is at now, with its objects present locally */
  head(): Promise<PluginResult<string | null>>;
  /** move the ref from `old` to `next`; `lost` when something else moved it first */
  swap(next: string, old: string | null): Promise<PluginResult<"swapped" | "lost">>;
}

/** A ref in this clone: run data, published later by flush. */
export function localCell(git: Git, ref: string): RefCell {
  return {
    ref,
    head: () => refHead(git, ref),
    swap: async (next, old) => ok((await updateRef(git, ref, next, old)) ? "swapped" : "lost"),
  };
}

/** A ref the remote decides: claims and mailboxes, pushed the moment they change. */
export function remoteCell(git: Git, remote: string, ref: string): RefCell {
  return {
    ref,
    head: async () => {
      const at = await lsRemote(git, remote, ref);
      if (!at.ok || at.value === null || (await hasObject(git, at.value))) return at;
      // every commit on these refs has the one before as parent, so fetching the ref now brings this one too
      const fetched = await fetchRefs(git, remote, [ref]);
      if (!fetched.ok) return fetched;
      return (await hasObject(git, at.value)) ? at : fail("unavailable", `refs store: ${ref} moved on ${remote} while it was fetched`);
    },
    swap: async (next, old) => {
      const pushed = await pushLeased(git, remote, next, ref, old);
      return pushed.ok ? ok(pushed.value === "pushed" ? "swapped" : "lost") : pushed;
    },
  };
}

/** What a write decided: its answer, and the files to set (text) or remove (null). No files: nothing to write. */
export interface Decision<T> {
  result: T;
  writes?: Map<string, string | null>;
}

export interface MutateOptions {
  git: Git;
  now: () => string;
  /** a commit message unique to this write, so two racers making the same change never make the same commit */
  message: () => string;
}

/** How often a write starts over after losing a swap before it reports the ref as too busy. */
const MAX_ATTEMPTS = 80;

const pause = (attempt: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, Math.min(4 * attempt, 60) + Math.random() * 15));

export async function read(git: Git, cell: RefCell): Promise<PluginResult<Snapshot>> {
  const head = await cell.head();
  return head.ok ? loadSnapshot(git, head.value) : head;
}

export async function mutate<T>(opts: MutateOptions, cell: RefCell, decide: (snap: Snapshot) => Promise<PluginResult<Decision<T>>>): Promise<PluginResult<T>> {
  const { git } = opts;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    const snap = await read(git, cell);
    if (!snap.ok) return snap;
    const decided = await decide(snap.value);
    if (!decided.ok) return decided;
    const writes = decided.value.writes;
    if (!writes || writes.size === 0) return ok(decided.value.result);
    const changes = new Map<string, string | null>();
    for (const [path, text] of writes) {
      if (text === null) {
        changes.set(path, null);
        continue;
      }
      const blob = await hashBlob(git, text);
      if (!blob.ok) return blob;
      changes.set(path, blob.value);
    }
    const tree = await writeTree(git, snap.value, changes);
    if (!tree.ok) return tree;
    const commit = await commitTree(git, tree.value, snap.value.head, opts.message(), opts.now());
    if (!commit.ok) return commit;
    const swapped = await cell.swap(commit.value, snap.value.head);
    if (!swapped.ok) return swapped;
    if (swapped.value === "swapped") return ok(decided.value.result);
    await pause(attempt);
  }
  return fail("unavailable", `refs store: ${cell.ref} kept moving; gave up after ${MAX_ATTEMPTS} attempts`);
}
