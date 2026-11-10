/**
 * A story's record on `refs/norn/runs/<story>`. Pack writes the story's
 * run-state folder in the machine dir as one commit with git plumbing (blobs, a temporary index,
 * `write-tree`, `commit-tree`), its parent the previous record commit, pushed with a lease on the sha
 * this checkout last saw (as claims are). The blobs are the files' bytes as they are: no filter
 * or line-ending conversion of the repository's config applies. Unpack extracts a record
 * commit into a temp folder (refusing any entry that is not a plain file inside it), parses every JSON
 * file and validates each state, pinned workflow and receipt against its schema, and only then
 * renames it into place, replacing what was there. `recordTreeId` names the tree a pack would
 * write without writing anything, so observe stays effect-free.
 */
import { createHash } from "node:crypto";
import { type Dirent, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve, sep } from "node:path";
import { type FileError, normalizeUnitState } from "@norn/core";
import { parseRoundDirName, parseSliceDirName, RECORD_REF_PREFIX, ROUNDS_DIR, type RunStory, recordRef, sliceKey, STORY_UNIT_DIR, treeStoryRunStatePath, type UnitState, validate, type Workflow } from "@norn/schema";
import { fsyncTree, isErrno } from "./fsx.ts";
import { archiveCacheDir, statePath } from "./paths.ts";
import { casRef, git, gitOk, gitSync, readLocalRef } from "./git.ts";
import { listReceipts } from "./receipts.ts";
import { storyRunStateDir } from "./run-state.ts";
import { parseWorkflowText, readPinnedWorkflow, readState } from "./unit.ts";

/** The files of a record folder that fail validation: each state, pinned workflow and receipt of it and of its rounds. */
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
 * Every regular file of a folder, relative and sorted (git's order is applied when trees are built).
 * A dot-named entry is a staging or temp folder of an atomic write or a move (`.x.move-<pid>`,
 * `.x.<pid>.….tmp`), never part of the record; a symlink is no part of it either.
 */
function filesUnder(base: string): string[] {
  const out: string[] = [];
  const walk = (dir: string, rel: string) => {
    let list: Dirent[];
    try {
      list = readdirSync(dir, { withFileTypes: true });
    } catch (e) {
      if (isErrno(e, "ENOENT")) return;
      throw e;
    }
    for (const d of list) {
      if (d.name.startsWith(".")) continue;
      const r = rel ? `${rel}/${d.name}` : d.name;
      if (d.isDirectory()) walk(join(dir, d.name), r);
      else if (d.isFile()) out.push(r);
    }
  };
  walk(base, "");
  return out.sort();
}

/** The record ref as this checkout last saw it: its commit and tree; null = none here. */
export async function readRecordRef(root: string, story: string): Promise<{ sha: string; tree: string } | null> {
  const ref = recordRef(story);
  const sha = await readLocalRef(root, ref);
  if (sha === null) return null;
  const tree = await readLocalRef(root, `${sha}^{tree}`);
  return tree === null ? null : { sha, tree };
}

/**
 * The id of the tree a pack of the story's run-state folder would write, computed from the files
 * (git's object format; `algo` sha256 for a repository on it), or null when the folder holds no file.
 */
export function recordTreeId(root: string, story: RunStory, algo: "sha1" | "sha256" = "sha1"): string | null {
  const base = storyRunStateDir(root, story);
  const files = filesUnder(base);
  if (!files.length) return null;
  const hash = (type: string, body: Buffer): Buffer => createHash(algo).update(`${type} ${body.length}\0`).update(body).digest();
  interface Dir {
    files: Map<string, Buffer>;
    dirs: Map<string, Dir>;
  }
  const top: Dir = { files: new Map(), dirs: new Map() };
  for (const f of files) {
    const parts = f.split("/");
    let d = top;
    for (const p of parts.slice(0, -1)) {
      let next = d.dirs.get(p);
      if (!next) d.dirs.set(p, (next = { files: new Map(), dirs: new Map() }));
      d = next;
    }
    d.files.set(parts.at(-1) as string, hash("blob", readFileSync(join(base, f))));
  }
  const treeOf = (d: Dir): Buffer => {
    // git sorts tree entries by name, a folder's name compared as if it ended in "/"
    const entries = [
      ...[...d.files].map(([name, sha]) => ({ key: name, line: Buffer.concat([Buffer.from(`100644 ${name}\0`), sha]) })),
      ...[...d.dirs].map(([name, sub]) => ({ key: `${name}/`, line: Buffer.concat([Buffer.from(`40000 ${name}\0`), treeOf(sub)]) })),
    ].sort((a, b) => Buffer.compare(Buffer.from(a.key), Buffer.from(b.key)));
    return hash("tree", Buffer.concat(entries.map((e) => e.line)));
  };
  return treeOf(top).toString("hex");
}

/** Pack the story's run-state folder into a tree; null when it holds no file. */
async function writeRecordTree(root: string, story: RunStory): Promise<string | null> {
  const base = storyRunStateDir(root, story);
  const files = filesUnder(base);
  if (!files.length) return null;
  const shas = (await gitOk(root, ["hash-object", "-w", "--no-filters", "--stdin-paths"], `${files.map((f) => join(base, f)).join("\n")}\n`)).trim().split("\n");
  const tmp = mkdtempSync(join(tmpdir(), "norn-record-"));
  try {
    const env = { GIT_INDEX_FILE: join(tmp, "index") };
    const info = files.map((f, i) => `100644 ${shas[i]}\t${f}`).join("\n");
    const u = await git(root, ["update-index", "--add", "--index-info"], `${info}\n`, { env });
    if (u.code !== 0) throw new Error(`git update-index failed: ${u.stderr.trim()}`);
    const w = await git(root, ["write-tree"], undefined, { env });
    if (w.code !== 0) throw new Error(`git write-tree failed: ${w.stderr.trim()}`);
    return w.stdout.trim();
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
}

/** The `Norn-Branch-Commit` a record commit names; null = none (a story without a branch). */
export async function recordBranchCommit(root: string, sha: string): Promise<string | null> {
  const r = await git(root, ["log", "-1", "--format=%(trailers:key=Norn-Branch-Commit,valueonly)", sha]);
  return r.code === 0 ? r.stdout.trim() || null : null;
}

/** The `Norn-Holder` a record commit names; null = none or unreadable. */
export async function recordHolder(root: string, sha: string): Promise<string | null> {
  const r = await git(root, ["log", "-1", "--format=%(trailers:key=Norn-Holder,valueonly)", sha]);
  return r.code === 0 ? r.stdout.trim() || null : null;
}

export type RecordPushResult =
  | { ok: true; pushed: false; reason: "unchanged" | "empty"; sha: string | null }
  | { ok: true; pushed: true; sha: string; tree: string }
  | { ok: false; reason: "stale" | "rejected" | "network" | "other"; message: string };

/**
 * Pack the story's record and push it to `refs/norn/runs/<story>` with a lease on
 * `expected` (the sha this checkout last saw; null = the ref must not exist), its parent that commit.
 * Trailers `Norn-Story`, `Norn-Branch-Commit` (when the story has a branch) and `Norn-Holder`; the
 * commit time is `at` (what "record as of" shows). A tree unchanged from `expected`'s, matching
 * the same branch commit, pushes nothing; the same tree for a branch that moved on (a release's
 * handoff commit) is pushed again, so the record names the branch as pushed. Without a
 * remote the local ref is the record (solo).
 */
export async function pushRecord(
  root: string,
  remote: string | null,
  story: RunStory,
  o: { expected: string | null; holder: string; branch_commit: string | null; at: string },
): Promise<RecordPushResult> {
  const tree = await writeRecordTree(root, story);
  if (tree === null) return { ok: true, pushed: false, reason: "empty", sha: o.expected };
  if (o.expected !== null && (await readLocalRef(root, `${o.expected}^{tree}`)) === tree && (await recordBranchCommit(root, o.expected)) === o.branch_commit)
    return { ok: true, pushed: false, reason: "unchanged", sha: o.expected };
  const trailers = [`Norn-Story: ${story.key}`, ...(o.branch_commit ? [`Norn-Branch-Commit: ${o.branch_commit}`] : []), `Norn-Holder: ${o.holder}`];
  const message = `norn: record ${story.key}\n\n${trailers.join("\n")}\n`;
  const env = { GIT_AUTHOR_DATE: o.at, GIT_COMMITTER_DATE: o.at };
  const parent = o.expected !== null && (await readLocalRef(root, `${o.expected}^{commit}`)) !== null ? ["-p", o.expected] : [];
  const c = await git(root, ["commit-tree", tree, ...parent], message, { env });
  if (c.code !== 0) return { ok: false, reason: "other", message: `git commit-tree failed: ${c.stderr.trim()}` };
  const sha = c.stdout.trim();
  const r = await casRef(root, remote, recordRef(story.key), sha, o.expected);
  return r.ok ? { ok: true, pushed: true, sha, tree } : r;
}

/** A record commit's tree entry that may be written: a plain file whose path stays inside the record. */
interface RecordEntry {
  path: string;
  blob: string;
}

/**
 * The entries of the record commit `sha`, checked before anything is read or written —
 * every entry must be a plain file (mode 100644 or 100755) whose path stays inside `base` (the folder
 * it would land in): an absolute path, an empty, `.` or `..` segment, a symlink or a submodule is
 * refused, since a record may come from another machine. `fail` names a refused entry's file. One set
 * of checks for an unpack (`unpackRecord`) and for a read into memory (`readRecordObjects`).
 */
function recordEntries(root: string, sha: string, base: string, fail: (path: string, message: string) => FileError): { entries: RecordEntry[]; refused: FileError[] } {
  const entries: RecordEntry[] = [];
  const refused: FileError[] = [];
  // -z: a name with a tab or a newline is read whole; the path is what follows the first tab
  const ls = gitSync(root, ["ls-tree", "-r", "-z", "--full-tree", sha]);
  if (ls.code !== 0) return { entries, refused: [fail("", `git ls-tree ${sha} failed: ${ls.stderr.trim()}`)] };
  for (const line of ls.stdout.toString("utf8").split("\0").filter(Boolean)) {
    const tab = line.indexOf("\t");
    const [mode, type, blob] = line.slice(0, tab).split(" ") as [string, string, string];
    const path = line.slice(tab + 1);
    const inside = resolve(base, path).startsWith(`${base}${sep}`);
    if (type !== "blob" || (mode !== "100644" && mode !== "100755")) refused.push(fail(path, `not a plain file in the record (${mode} ${type})`));
    else if (path.startsWith("/") || path.split("/").some((x) => x === "" || x === "." || x === "..") || !inside) refused.push(fail(path, "a path outside the record"));
    else entries.push({ path, blob });
  }
  return { entries, refused };
}

/** Every JSON file of a record must parse; `fail` names the file. Shared by the unpack and the read into memory. */
function jsonErrors(files: ReadonlyArray<{ path: string; text: string }>, fail: (path: string, message: string) => FileError): FileError[] {
  const errors: FileError[] = [];
  for (const f of files.filter((x) => x.path.endsWith(".json")))
    try {
      JSON.parse(f.text);
    } catch (err) {
      errors.push(fail(f.path, `invalid JSON: ${(err as Error).message}`));
    }
  return errors;
}

export type UnpackResult = { ok: true; files: number } | { ok: false; errors: FileError[] };

/**
 * Extract the record commit `sha` into `dest` (a story's run-state folder). Every entry
 * must be a plain file (mode 100644 or 100755) whose path stays inside `dest`: an absolute path, an
 * empty, `.` or `..` segment, a symlink or a submodule is refused before anything is written,
 * since a record may come from another machine. The files are written into a temp folder beside
 * `dest`; every JSON file must parse, and each state, pinned workflow and receipt must pass its schema.
 * Only then is the temp folder renamed into place, replacing `dest` whole. A record that
 * fails puts nothing in place: its errors are returned instead. Synchronous, so the snapshot's archive
 * cache uses it too.
 */
export function unpackRecord(root: string, sha: string, dest: string): UnpackResult {
  const staged = stageRecordSync(root, sha, dest);
  if (!staged.ok) return staged;
  try {
    staged.place();
    return { ok: true, files: staged.files };
  } finally {
    staged.discard();
  }
}

/**
 * A record extracted and validated beside its destination, not in place yet (`dir`: the staged folder,
 * laid out as `dest` will be, so a caller may add a file to it first): `place()` renames it into place,
 * replacing `dest` whole; `discard()` drops what is left (a no-op once placed).
 */
export type StagedRecord = { ok: true; files: number; dir: string; place(): void; discard(): void } | { ok: false; errors: FileError[] };

/**
 * A `dest` an interrupted `place()` moved aside and never swapped back is put back, and the
 * staging folders a killed process left beside it are dropped, before anything is staged there again.
 */
function recoverPlace(dest: string): void {
  const parent = dirname(dest);
  const aside = asideOf(dest);
  if (!existsSync(dest) && existsSync(aside)) renameSync(aside, dest);
  else rmSync(aside, { recursive: true, force: true });
  let names: string[] = [];
  try {
    names = readdirSync(parent);
  } catch (e) {
    if (!isErrno(e, "ENOENT")) throw e;
  }
  for (const n of names) if (n.startsWith(`.${basename(dest)}.unpack-`)) rmSync(join(parent, n), { recursive: true, force: true });
}
const asideOf = (dest: string): string => join(dirname(dest), `.${basename(dest)}.replaced`);

/**
 * The checks of `unpackRecord` — hostile entries refused, every file extracted into a temp
 * folder beside `dest`, every JSON parsed and each state, pinned workflow and receipt validated — with
 * the rename left to the caller, so a command can check a record before it changes anything else
 * (`story checkout` validates before it claims). A failing record leaves nothing.
 */
export function stageRecordSync(root: string, sha: string, dest: string): StagedRecord {
  const staging = join(dirname(dest), `.${basename(dest)}.unpack-${process.pid}`);
  const fail = (path: string, message: string): FileError => ({ file: join(dest, path), errors: [{ path: "", message }] });
  const { entries, refused } = recordEntries(root, sha, staging, fail);
  if (refused.length) return { ok: false, errors: refused };
  const discard = () => rmSync(staging, { recursive: true, force: true });
  recoverPlace(dest);
  try {
    mkdirSync(staging, { recursive: true });
    for (const e of entries) {
      // binary-safe: evidence holds images
      const out = gitSync(root, ["cat-file", "blob", e.blob]);
      if (out.code !== 0) throw new Error(`git cat-file ${e.blob} failed: ${out.stderr.trim()}`);
      mkdirSync(dirname(join(staging, e.path)), { recursive: true });
      writeFileSync(join(staging, e.path), out.stdout);
    }
    const errors = jsonErrors(
      entries.filter((x) => x.path.endsWith(".json")).map((e) => ({ path: e.path, text: readFileSync(join(staging, e.path), "utf8") })),
      fail,
    );
    const named = new Set(errors.map((e) => e.file));
    for (const d of readdirSync(staging, { withFileTypes: true }))
      if (d.isDirectory())
        for (const e of recordErrors(join(staging, d.name))) {
          const file = e.file.replace(staging, dest);
          if (!named.has(file)) errors.push({ ...e, file });
        }
    if (errors.length) {
      discard();
      return { ok: false, errors };
    }
    fsyncTree(staging);
  } catch (err) {
    discard();
    throw err;
  }
  return { ok: true, files: entries.length, dir: staging, place: () => placeStaged(staging, dest), discard };
}

/**
 * An empty record staged beside `dest`, for a takeover whose record is lost: the
 * caller writes the new round into `dir`, then `place()` puts it in place as `stageRecordSync`'s does,
 * replacing whatever `dest` held.
 */
export function stageEmptyRecord(dest: string): Extract<StagedRecord, { ok: true }> {
  const staging = join(dirname(dest), `.${basename(dest)}.unpack-${process.pid}`);
  // What a killed checkout left beside `dest` is swept first, and the staging folder is
  // created exclusively, so a new round never starts from leftovers
  recoverPlace(dest);
  mkdirSync(dirname(dest), { recursive: true });
  mkdirSync(staging);
  return { ok: true, files: 0, dir: staging, place: () => placeStaged(staging, dest), discard: () => rmSync(staging, { recursive: true, force: true }) };
}

/** Rename the staged folder `staging` into `dest`, replacing `dest` whole; never loses `dest` (`recoverPlace`). */
function placeStaged(staging: string, dest: string): void {
  // into an empty place: one rename
  if (!existsSync(dest)) return renameSync(staging, dest);
  // rename cannot replace a non-empty folder: the old one goes aside under a fixed name, the new one
  // in, then the old one is dropped; a crash between the two renames is undone by the next stage
  // (`recoverPlace`), so `dest` is never lost
  const aside = asideOf(dest);
  rmSync(aside, { recursive: true, force: true });
  renameSync(dest, aside);
  try {
    renameSync(staging, dest);
  } catch (err) {
    renameSync(aside, dest);
    throw err;
  }
  rmSync(aside, { recursive: true, force: true });
}

/** Story key → record commit of every archive ref this checkout has (one `for-each-ref`, local only). */
export function localRecordRefs(root: string): Map<string, string> {
  const r = gitSync(root, ["for-each-ref", "--format=%(objectname) %(refname)", RECORD_REF_PREFIX]);
  const out = new Map<string, string>();
  if (r.code !== 0) return out;
  for (const line of r.stdout.toString().split("\n").filter(Boolean)) {
    const [sha, ref] = line.split(" ") as [string, string];
    out.set(ref.slice(RECORD_REF_PREFIX.length), sha);
  }
  return out;
}

/**
 * The folder holding a finished story's record as its archive ref
 * `refs/norn/runs/<story>` has it here (local refs only: never the network), unpacked once per
 * record commit into the machine dir's `archive/<story>/<commit>/` (`unpackRecord`: hostile
 * entries refused, every file validated, renamed into place), older commits' copies dropped. Null when
 * there is no such ref here, or its record does not unpack (nothing is guessed). Read-only input.
 */
export function archivedRecordDir(root: string, story: string, sha: string | undefined = localRecordRefs(root).get(story)): string | null {
  if (!sha || !/^[0-9a-f]{40,64}$/.test(sha)) return null;
  const cache = archiveCacheDir(root, story);
  const dir = join(cache, sha);
  if (existsSync(dir)) return dir;
  mkdirSync(cache, { recursive: true });
  if (!unpackRecord(root, sha, dir).ok) return null;
  for (const n of readdirSync(cache)) if (n !== sha && !n.startsWith(".")) rmSync(join(cache, n), { recursive: true, force: true });
  return dir;
}

/**
 * The commit `refs/norn/runs/<story>` has on `remote`, its objects fetched here
 * but no local ref written, so a record is checked before it counts; null = the remote has no such ref.
 * `setRecordRef` then makes it this checkout's (the lease of its next record push).
 */
export async function fetchRecordCommit(root: string, remote: string, story: string): Promise<string | null> {
  const ref = recordRef(story);
  const sha = await remoteRecordSha(root, remote, story);
  if (!sha) return null;
  const f = await git(root, ["fetch", "--quiet", "--no-tags", remote, ref]);
  if (f.code !== 0) throw new Error(`git fetch ${remote} ${ref} failed: ${f.stderr.trim()}`);
  // the ref moved between the listing and the fetch: the listed commit may not have come along
  if ((await readLocalRef(root, `${sha}^{commit}`)) === null) throw new Error(`${ref} moved on ${remote} while it was fetched; retry`);
  return sha;
}

/** The commit `refs/norn/runs/<story>` has on `remote` now (`ls-remote`, nothing fetched); null = none. */
export async function remoteRecordSha(root: string, remote: string, story: string): Promise<string | null> {
  const ref = recordRef(story);
  const listed = await git(root, ["ls-remote", remote, ref]);
  if (listed.code !== 0) throw new Error(`git ls-remote ${remote} failed: ${listed.stderr.trim()}`);
  return listed.stdout.split("\n").map((l) => l.split("\t")).find((p) => p[1]?.trim() === ref)?.[0]?.trim() || null;
}

/** Point this checkout's `refs/norn/runs/<story>` at `sha` (a record already fetched and checked). */
export async function setRecordRef(root: string, story: string, sha: string): Promise<void> {
  await gitOk(root, ["update-ref", recordRef(story), sha]);
}

/**
 * Fetch the archive refs of `stories` alone from `remote` into the same local
 * refs, for a command that needs those stories' records (`run list`, `run view`, `story reopen`); a
 * story the remote has no ref of is skipped. Returns the refs fetched; never touches another ref.
 */
export async function fetchRecords(root: string, remote: string, stories: readonly string[]): Promise<string[]> {
  if (!stories.length) return [];
  const wanted = new Set(stories.map(recordRef));
  const listed = await git(root, ["ls-remote", remote, ...wanted]);
  if (listed.code !== 0) throw new Error(`git ls-remote ${remote} failed: ${listed.stderr.trim()}`);
  const refs = listed.stdout
    .split("\n")
    .map((l) => l.split("\t")[1]?.trim())
    .filter((ref): ref is string => !!ref && wanted.has(ref));
  if (!refs.length) return [];
  const f = await git(root, ["fetch", "--quiet", "--no-tags", remote, ...refs.map((ref) => `+${ref}:${ref}`)]);
  if (f.code !== 0) throw new Error(`git fetch ${remote} failed: ${f.stderr.trim()}`);
  return refs;
}

/** Why a tree's run state could not be packed: no such folder at the rev, git failing, or a record that fails validation. */
export type TreeRecordFailure = { kind: "missing" | "git"; message: string } | { kind: "invalid"; errors: FileError[] };

/**
 * The record commit of a finished story's run state an older norn left in the tree
 * at `rev`: the `<spec folder>/runs` subtree committed as is (`commit-tree`, no unpacking, no parent),
 * with the `Norn-Story` and `Norn-Holder` trailers and commit time `at`. Its files are checked the way
 * an unpack checks them (a temp copy, discarded): a record that fails is not packed.
 */
export function treeRecordCommit(root: string, rev: string, story: RunStory, o: { holder: string; at: string }): { ok: true; sha: string; tree: string } | ({ ok: false } & TreeRecordFailure) {
  const path = treeStoryRunStatePath(story);
  const t = gitSync(root, ["rev-parse", "--verify", "-q", `${rev}:${path}`]);
  if (t.code !== 0) return { ok: false, kind: "missing", message: `no ${path} at ${rev}` };
  const tree = t.stdout.toString().trim();
  const message = `norn: record ${story.key}\n\nNorn-Story: ${story.key}\nNorn-Holder: ${o.holder}\n`;
  const c = gitSync(root, ["commit-tree", tree], new TextEncoder().encode(message), { env: { GIT_AUTHOR_DATE: o.at, GIT_COMMITTER_DATE: o.at } });
  if (c.code !== 0) return { ok: false, kind: "git", message: `git commit-tree failed: ${c.stderr.trim()}` };
  const sha = c.stdout.toString().trim();
  const check = mkdtempSync(join(tmpdir(), "norn-record-check-"));
  try {
    const u = unpackRecord(root, sha, join(check, "record"));
    if (!u.ok) return { ok: false, kind: "invalid", errors: u.errors.map((e) => ({ ...e, file: e.file.replace(join(check, "record"), join(root, path)) })) };
  } finally {
    rmSync(check, { recursive: true, force: true });
  }
  return { ok: true, sha, tree };
}

/** A unit of a record read from git objects: its key and its validated state and pinned workflow. */
export interface RecordObjectUnit {
  key: string;
  /** null = the story unit */
  slice: string | null;
  state: UnitState;
  workflow: Workflow | null;
}

/**
 * The record commit `sha` read from git objects into memory, writing
 * nothing — what a view of a story held elsewhere reads. Its entries pass the same checks as an
 * unpack (`recordEntries`, `jsonErrors`); each unit's state (the story's current round), pinned
 * workflow and receipts are validated against their schemas, and a file that fails is reported in
 * `errors` (its unit is left out), never skipped silently.
 */
export async function readRecordObjects(root: string, story: string, sha: string): Promise<{ units: RecordObjectUnit[]; errors: FileError[] }> {
  const name = (path: string) => `${recordRef(story)}:${path}`;
  const fail = (path: string, message: string): FileError => ({ file: name(path), errors: [{ path: "", message }] });
  const { entries, refused } = recordEntries(root, sha, "/record", fail);
  if (refused.length) return { units: [], errors: refused };
  // the text files a reader needs: states, pinned workflows, receipts (never evidence or logs)
  const wanted = entries.filter((e) => /(^|\/)(state\.json|workflow\.yaml)$/.test(e.path) || /(^|\/)receipts\/[^/]+\.json$/.test(e.path));
  const texts = new Map<string, string>();
  const missing: FileError[] = [];
  if (wanted.length) {
    const out = gitSync(root, ["cat-file", "--batch"], new TextEncoder().encode(`${wanted.map((e) => e.blob).join("\n")}\n`));
    if (out.code !== 0) return { units: [], errors: [fail("", `git cat-file failed: ${out.stderr.toString().trim()}`)] };
    // one reply per object, in order: `<sha> blob <size>\n<content>\n`, or `<sha> missing\n` with no content
    let pos = 0;
    for (const e of wanted) {
      const nl = out.stdout.indexOf(0x0a, pos);
      const [, type, size] = out.stdout.subarray(pos, nl).toString().split(" ");
      if (type !== "blob") {
        missing.push(fail(e.path, `object ${e.blob} ${type === "missing" ? "missing from the repository" : `is a ${type}, not a blob`}`));
        pos = nl + 1;
        continue;
      }
      texts.set(e.path, out.stdout.subarray(nl + 1, nl + 1 + Number(size)).toString("utf8"));
      pos = nl + 1 + Number(size) + 1;
    }
  }
  const errors = [...missing, ...jsonErrors([...texts].map(([path, text]) => ({ path, text })), fail)];
  const bad = new Set(errors.map((e) => e.file));
  for (const [path, text] of texts) {
    if (bad.has(name(path)) || !/(^|\/)receipts\/[^/]+\.json$/.test(path)) continue;
    const v = validate("receipt", JSON.parse(text));
    if (!v.ok) errors.push({ file: name(path), errors: v.errors });
  }
  // a unit's folder: `_story` (its current round: the highest `rounds/NN-<wf>` holding a state; a flat
  // record's `_story` itself) or a slice's `<nn>-<slug>`
  const folders = new Map<string, string>();
  for (const path of texts.keys()) {
    if (!path.endsWith("/state.json")) continue;
    const dir = path.slice(0, -"/state.json".length);
    const [top, sub, round] = dir.split("/");
    if (top === STORY_UNIT_DIR) {
      const r = sub === ROUNDS_DIR && round ? parseRoundDirName(round) : null;
      if (sub !== undefined && !r) continue;
      const held = folders.get(STORY_UNIT_DIR);
      const heldRound = held ? parseRoundDirName(held.split("/")[2] ?? "") : null;
      if (!held || (r && (!heldRound || r.n > heldRound.n))) folders.set(STORY_UNIT_DIR, dir);
    } else if (top && sub === undefined && parseSliceDirName(top, { loose: true })) folders.set(top, dir);
  }
  const units: RecordObjectUnit[] = [];
  for (const unit of [...folders.keys()].sort((a, b) => (a === STORY_UNIT_DIR ? -1 : b === STORY_UNIT_DIR ? 1 : a.localeCompare(b)))) {
    const dir = folders.get(unit) as string;
    const statePath_ = `${dir}/state.json`;
    if (bad.has(name(statePath_))) continue;
    const st = validate("state-record", JSON.parse(texts.get(statePath_) as string));
    if (!st.ok) {
      errors.push({ file: name(statePath_), errors: st.errors });
      continue;
    }
    const wfText = texts.get(`${dir}/workflow.yaml`);
    const wf = wfText === undefined ? null : parseWorkflowText(wfText, name(`${dir}/workflow.yaml`));
    if (wf && !wf.ok && wf.reason === "corrupt") errors.push(wf.error);
    const nn = unit === STORY_UNIT_DIR ? null : (parseSliceDirName(unit, { loose: true })?.nn as string);
    const slice = nn === null ? null : sliceKey(story, nn);
    units.push({ key: slice ?? story, slice, state: normalizeUnitState(st.value), workflow: wf?.ok ? wf.value : null });
  }
  return { units, errors };
}
