/**
 * gh-195 D2, D3 (B10, B14): a story's record on `refs/norn/runs/<story>`. Pack writes the story's
 * run-state folder in the machine dir (S12) as one commit with git plumbing (blobs, a temporary index,
 * `write-tree`, `commit-tree`), its parent the previous record commit, pushed with a lease on the sha
 * this checkout last saw (as claims are, T3). Unpack extracts a record commit into a temp folder,
 * validates every JSON file (S2) and only then puts it in place (S1). `recordTreeId` names the tree a
 * pack would write without writing anything, so observe stays effect-free (H2).
 */
import { createHash } from "node:crypto";
import { type Dirent, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join } from "node:path";
import type { FileError } from "@norn/core";
import { type RunStory, recordRef } from "@norn/schema";
import { atomicCopyDir, isErrno } from "./fsx.ts";
import { casRef, git, gitOk, gitSync, readLocalRef } from "./git.ts";
import { recordErrors } from "./record-move.ts";
import { storyRunStateDir } from "./run-state.ts";

/** Every file of a folder, relative and sorted (git's order is applied when trees are built). */
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
  const shas = (await gitOk(root, ["hash-object", "-w", "--stdin-paths"], `${files.map((f) => join(base, f)).join("\n")}\n`)).trim().split("\n");
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
 * D3 (S1, S2): extract the record commit `sha` into `dest` (a story's run-state folder): written into
 * a temp folder beside it, every unit folder's JSON validated, and only then put in place. A record
 * that fails validation is not put in place: its errors are returned instead.
 */
export async function unpackRecord(root: string, sha: string, dest: string): Promise<{ ok: true; files: number } | { ok: false; errors: FileError[] }> {
  const list = (await gitOk(root, ["ls-tree", "-r", "-z", "--full-tree", sha])).split("\0").filter(Boolean);
  const staging = join(dirname(dest), `.${basename(dest)}.unpack-${process.pid}`);
  rmSync(staging, { recursive: true, force: true });
  try {
    for (const line of list) {
      const [meta, path] = line.split("\t") as [string, string];
      const [, type, blob] = meta.split(" ") as [string, string, string];
      if (type !== "blob") continue;
      // binary-safe: evidence holds images
      const out = gitSync(root, ["cat-file", "blob", blob]);
      if (out.code !== 0) throw new Error(`git cat-file ${blob} failed: ${out.stderr.trim()}`);
      mkdirSync(dirname(join(staging, path)), { recursive: true });
      writeFileSync(join(staging, path), out.stdout);
    }
    mkdirSync(staging, { recursive: true });
    const errors = readdirSync(staging, { withFileTypes: true })
      .filter((d) => d.isDirectory())
      .flatMap((d) => recordErrors(join(staging, d.name)))
      .map((e) => ({ ...e, file: e.file.replace(staging, dest) }));
    if (errors.length) return { ok: false, errors };
    atomicCopyDir(staging, dest);
    return { ok: true, files: list.length };
  } finally {
    rmSync(staging, { recursive: true, force: true });
  }
}
