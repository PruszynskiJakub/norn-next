/**
 * gh-195 D2, D3 (B10, B14): a story's record on `refs/norn/runs/<story>`. Pack writes the story's
 * run-state folder in the machine dir (S12) as one commit with git plumbing (blobs, a temporary index,
 * `write-tree`, `commit-tree`), its parent the previous record commit, pushed with a lease on the sha
 * this checkout last saw (as claims are, T3). The blobs are the files' bytes as they are: no filter
 * or line-ending conversion of the repository's config applies (review F1). Unpack extracts a record
 * commit into a temp folder (refusing any entry that is not a plain file inside it), parses every JSON
 * file and validates each state, pinned workflow and receipt against its schema (S2), and only then
 * renames it into place, replacing what was there (S1). `recordTreeId` names the tree a pack would
 * write without writing anything, so observe stays effect-free (H2).
 */
import { createHash } from "node:crypto";
import { type Dirent, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve, sep } from "node:path";
import type { FileError } from "@norn/core";
import { parseRoundDirName, ROUNDS_DIR, type RunStory, recordRef, STORY_UNIT_DIR, type UnitState, validate, type Workflow } from "@norn/schema";
import { fsyncTree, isErrno } from "./fsx.ts";
import { casRef, git, gitOk, gitSync, readLocalRef } from "./git.ts";
import { recordErrors } from "./record-move.ts";
import { storyRunStateDir } from "./run-state.ts";
import { parseWorkflowText } from "./unit.ts";

/**
 * Every regular file of a folder, relative and sorted (git's order is applied when trees are built).
 * A dot-named entry is a staging or temp folder of an atomic write or a move (`.x.move-<pid>`,
 * `.x.<pid>.….tmp`), never part of the record (review F7); a symlink is no part of it either.
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
 * D4: the id of the tree a pack of the story's run-state folder would write, computed from the files
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

export type RecordPushResult =
  | { ok: true; pushed: false; reason: "unchanged" | "empty"; sha: string | null }
  | { ok: true; pushed: true; sha: string; tree: string }
  | { ok: false; reason: "stale" | "rejected" | "network" | "other"; message: string };

/**
 * D2 (B10, B14): pack the story's record and push it to `refs/norn/runs/<story>` with a lease on
 * `expected` (the sha this checkout last saw; null = the ref must not exist), its parent that commit.
 * Trailers `Norn-Story`, `Norn-Branch-Commit` (when the story has a branch, B33) and `Norn-Holder`; the
 * commit time is `at` (what "record as of" shows, B13). A tree unchanged from `expected`'s pushes
 * nothing. Without a remote the local ref is the record (solo).
 */
export async function pushRecord(
  root: string,
  remote: string | null,
  story: RunStory,
  o: { expected: string | null; holder: string; branch_commit: string | null; at: string },
): Promise<RecordPushResult> {
  const tree = await writeRecordTree(root, story);
  if (tree === null) return { ok: true, pushed: false, reason: "empty", sha: o.expected };
  if (o.expected !== null && (await readLocalRef(root, `${o.expected}^{tree}`)) === tree) return { ok: true, pushed: false, reason: "unchanged", sha: o.expected };
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

/**
 * D3 (S1, S2): extract the record commit `sha` into `dest` (a story's run-state folder). Every entry
 * must be a plain file (mode 100644 or 100755) whose path stays inside `dest`: an absolute path, an
 * empty, `.` or `..` segment, a symlink or a submodule is refused before anything is written (review
 * F2), since a record may come from another machine. The files are written into a temp folder beside
 * `dest`; every JSON file must parse, and each state, pinned workflow and receipt must pass its schema.
 * Only then is the temp folder renamed into place, replacing `dest` whole (review F3). A record that
 * fails puts nothing in place: its errors are returned instead.
 */
/** A record commit's tree entry that may be written: a plain file whose path stays inside the record. */
interface RecordEntry {
  path: string;
  blob: string;
}

/**
 * D3 (review F2): the entries of the record commit `sha`, checked before anything is read or written —
 * every entry must be a plain file (mode 100644 or 100755) whose path stays inside `base` (the folder
 * it would land in): an absolute path, an empty, `.` or `..` segment, a symlink or a submodule is
 * refused, since a record may come from another machine. `fail` names a refused entry's file.
 */
async function recordEntries(root: string, sha: string, base: string, fail: (path: string, message: string) => FileError): Promise<{ entries: RecordEntry[]; refused: FileError[] }> {
  const entries: RecordEntry[] = [];
  const refused: FileError[] = [];
  // -z: a name with a tab or a newline is read whole; the path is what follows the first tab
  for (const line of (await gitOk(root, ["ls-tree", "-r", "-z", "--full-tree", sha])).split("\0").filter(Boolean)) {
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

/** D3 (S2): every JSON file of a record must parse; `fail` names the file. */
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

/**
 * D3 (S1, S2): extract the record commit `sha` into `dest` (a story's run-state folder). Its entries
 * are checked first (`recordEntries`); the files are written into a temp folder beside `dest`; every
 * JSON file must parse, and each state, pinned workflow and receipt must pass its schema. Only then is
 * the temp folder renamed into place, replacing `dest` whole (review F3). A record that fails puts
 * nothing in place: its errors are returned instead.
 */
export async function unpackRecord(root: string, sha: string, dest: string): Promise<{ ok: true; files: number } | { ok: false; errors: FileError[] }> {
  const staging = join(dirname(dest), `.${basename(dest)}.unpack-${process.pid}`);
  const fail = (path: string, message: string): FileError => ({ file: join(dest, path), errors: [{ path: "", message }] });
  const { entries, refused } = await recordEntries(root, sha, staging, fail);
  if (refused.length) return { ok: false, errors: refused };
  rmSync(staging, { recursive: true, force: true });
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
    if (errors.length) return { ok: false, errors };
    fsyncTree(staging);
    if (!existsSync(dest)) renameSync(staging, dest);
    else {
      // rename cannot replace a non-empty folder: move the old one aside, swap, then drop it
      const old = `${staging}.old`;
      rmSync(old, { recursive: true, force: true });
      renameSync(dest, old);
      try {
        renameSync(staging, dest);
      } catch (err) {
        renameSync(old, dest);
        throw err;
      }
      rmSync(old, { recursive: true, force: true });
    }
    return { ok: true, files: entries.length };
  } finally {
    rmSync(staging, { recursive: true, force: true });
  }
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
 * gh-195 D6 (B10, B17; S2): the record commit `sha` read from git objects into memory, writing
 * nothing — what a view of a story held elsewhere reads. Its entries pass the same checks as an
 * unpack (`recordEntries`, `jsonErrors`); each unit's state (the story's current round), pinned
 * workflow and receipts are validated against their schemas, and a file that fails is reported in
 * `errors` (its unit is left out), never skipped silently.
 */
export async function readRecordObjects(root: string, story: string, sha: string): Promise<{ units: RecordObjectUnit[]; errors: FileError[] }> {
  const name = (path: string) => `${recordRef(story)}:${path}`;
  const fail = (path: string, message: string): FileError => ({ file: name(path), errors: [{ path: "", message }] });
  const { entries, refused } = await recordEntries(root, sha, "/record", fail);
  if (refused.length) return { units: [], errors: refused };
  // the text files a reader needs: states, pinned workflows, receipts (never evidence or logs)
  const wanted = entries.filter((e) => /(^|\/)(state\.json|workflow\.yaml)$/.test(e.path) || /(^|\/)receipts\/[^/]+\.json$/.test(e.path));
  const texts = new Map<string, string>();
  if (wanted.length) {
    const out = gitSync(root, ["cat-file", "--batch"], new TextEncoder().encode(`${wanted.map((e) => e.blob).join("\n")}\n`));
    if (out.code !== 0) return { units: [], errors: [fail("", `git cat-file failed: ${out.stderr.toString().trim()}`)] };
    let pos = 0;
    for (const e of wanted) {
      const nl = out.stdout.indexOf(0x0a, pos);
      const size = Number(out.stdout.subarray(pos, nl).toString().split(" ")[2]);
      texts.set(e.path, out.stdout.subarray(nl + 1, nl + 1 + size).toString("utf8"));
      pos = nl + 1 + size + 1;
    }
  }
  const errors = jsonErrors([...texts].map(([path, text]) => ({ path, text })), fail);
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
    } else if (top && sub === undefined && /^[0-9]{2,3}-/.test(top)) folders.set(top, dir);
  }
  const units: RecordObjectUnit[] = [];
  for (const unit of [...folders.keys()].sort((a, b) => (a === STORY_UNIT_DIR ? -1 : b === STORY_UNIT_DIR ? 1 : a.localeCompare(b)))) {
    const dir = folders.get(unit) as string;
    const statePath_ = `${dir}/state.json`;
    if (bad.has(name(statePath_))) continue;
    const st = validate("state", JSON.parse(texts.get(statePath_) as string));
    if (!st.ok) {
      errors.push({ file: name(statePath_), errors: st.errors });
      continue;
    }
    const wfText = texts.get(`${dir}/workflow.yaml`);
    const wf = wfText === undefined ? null : parseWorkflowText(wfText, name(`${dir}/workflow.yaml`));
    if (wf && !wf.ok && wf.reason === "corrupt") errors.push(wf.error);
    const nn = unit === STORY_UNIT_DIR ? null : (unit.split("-")[0] as string);
    units.push({ key: nn === null ? story : `${story}/${nn}`, slice: nn === null ? null : `${story}/${nn}`, state: st.value, workflow: wf?.ok ? wf.value : null });
  }
  return { units, errors };
}
