/**
 * The git plumbing the refs store stands on, run through the host's exec only. Every command the
 * store issues is spelled here, so the argv shape is one module's concern.
 */
import { type ExecOutput, fail, type HostContext, ok, type PluginResult } from "@norn/plugin-api";
import { parseCatFileBatch } from "./batch.ts";

/**
 * Settings that keep a user's config from changing what the store writes or how long it blocks:
 * a signing hook would make commit-tree prompt, an auto gc could prune objects a racer is about to
 * reference, and a ref lock held by a racing writer is waited for rather than failed at once.
 */
const SAFE_CONFIG = [
  "-c",
  "core.filesRefLockTimeout=2000",
  "-c",
  "core.packedRefsTimeout=2000",
  "-c",
  "commit.gpgSign=false",
  "-c",
  "gc.auto=0",
  "-c",
  "maintenance.auto=false",
  "-c",
  "fetch.recurseSubmodules=false",
];

const LOCAL_TIMEOUT_MS = 30_000;
const REMOTE_TIMEOUT_MS = 120_000;

export interface GitCall {
  input?: string;
  env?: Record<string, string>;
  remote?: boolean;
}

export type Git = (args: string[], call?: GitCall) => Promise<ExecOutput>;

export function gitRunner(ctx: HostContext): Git {
  return (args, call = {}) =>
    ctx.exec(["git", ...SAFE_CONFIG, ...args], {
      cwd: ctx.repo.root,
      env: { GIT_TERMINAL_PROMPT: "0", ...(call.env ?? {}) },
      ...(call.input === undefined ? {} : { input: call.input }),
      timeoutMs: call.remote ? REMOTE_TIMEOUT_MS : LOCAL_TIMEOUT_MS,
    });
}

export function gitFailure<T>(what: string, out: ExecOutput): PluginResult<T> {
  const why = out.timedOut ? "timed out" : `exited ${out.code}`;
  return fail("unavailable", `refs store: git ${what} ${why}: ${out.stderr.trim() || out.stdout.trim()}`);
}

const SHA_RE = /^[0-9a-f]{40}(?:[0-9a-f]{24})?$/;

function sha(what: string, out: ExecOutput): PluginResult<string> {
  if (out.code !== 0) return gitFailure(what, out);
  const s = out.stdout.trim();
  return SHA_RE.test(s) ? ok(s) : fail("unknown", `refs store: git ${what} printed no object id: ${JSON.stringify(s.slice(0, 80))}`, false);
}

/** The commit a local ref names, or null when there is no such ref. */
export async function refHead(git: Git, ref: string): Promise<PluginResult<string | null>> {
  const out = await git(["rev-parse", "-q", "--verify", `${ref}^{commit}`]);
  if (out.code === 1 && out.stdout.trim() === "") return ok(null);
  return sha(`rev-parse ${ref}`, out);
}

/** Local refs under `prefix`, as `[name, commit]`. */
export async function listRefs(git: Git, prefix: string): Promise<PluginResult<Array<[string, string]>>> {
  const out = await git(["for-each-ref", "--format=%(refname) %(objectname)", prefix]);
  if (out.code !== 0) return gitFailure(`for-each-ref ${prefix}`, out);
  const refs: Array<[string, string]> = [];
  for (const line of out.stdout.split("\n")) {
    const cut = line.lastIndexOf(" ");
    if (cut > 0) refs.push([line.slice(0, cut), line.slice(cut + 1)]);
  }
  return ok(refs);
}

export async function hashBlob(git: Git, text: string): Promise<PluginResult<string>> {
  return sha("hash-object", await git(["hash-object", "-w", "--stdin"], { input: text }));
}

/** Blob texts by object id, read in one process. */
export async function readBlobs(git: Git, shas: string[]): Promise<PluginResult<Map<string, string>>> {
  const wanted = [...new Set(shas)];
  if (wanted.length === 0) return ok(new Map());
  const out = await git(["cat-file", "--batch"], { input: `${wanted.join("\n")}\n` });
  if (out.code !== 0) return gitFailure("cat-file --batch", out);
  const parsed = parseCatFileBatch(out.stdout, wanted);
  return typeof parsed === "string" ? fail("invalid", `refs store: ${parsed}`, false) : ok(parsed);
}

export interface TreeEntry {
  mode: string;
  type: string;
  sha: string;
  /** full path from the root tree, `/`-separated */
  path: string;
}

/** Every blob and tree under `commit`, recursively. */
export async function lsTree(git: Git, commit: string): Promise<PluginResult<TreeEntry[]>> {
  const out = await git(["ls-tree", "-r", "-t", "-z", "--full-tree", commit]);
  if (out.code !== 0) return gitFailure(`ls-tree ${commit}`, out);
  const entries: TreeEntry[] = [];
  for (const rec of out.stdout.split("\0")) {
    if (rec === "") continue;
    const tab = rec.indexOf("\t");
    const [mode, type, oid] = rec.slice(0, tab).split(" ");
    if (tab < 0 || !mode || !type || !oid) return fail("invalid", `refs store: unreadable ls-tree record ${JSON.stringify(rec.slice(0, 80))}`, false);
    entries.push({ mode, type, sha: oid, path: rec.slice(tab + 1) });
  }
  return ok(entries);
}

export interface MkTreeEntry {
  mode: string;
  type: string;
  sha: string;
  name: string;
}

export async function mkTree(git: Git, entries: MkTreeEntry[]): Promise<PluginResult<string>> {
  const input = entries.map((e) => `${e.mode} ${e.type} ${e.sha}\t${e.name}\0`).join("");
  return sha("mktree", await git(["mktree", "-z"], { input }));
}

/** A commit of `tree` on `parent`, dated by the host clock so a replay writes the same dates. */
export async function commitTree(git: Git, tree: string, parent: string | null, message: string, at: string): Promise<PluginResult<string>> {
  const date = `@${Math.floor(Date.parse(at) / 1000)} +0000`;
  const env = {
    GIT_AUTHOR_NAME: "norn",
    GIT_AUTHOR_EMAIL: "norn@localhost",
    GIT_AUTHOR_DATE: date,
    GIT_COMMITTER_NAME: "norn",
    GIT_COMMITTER_EMAIL: "norn@localhost",
    GIT_COMMITTER_DATE: date,
  };
  const args = ["commit-tree", tree, ...(parent ? ["-p", parent] : []), "-m", message];
  return sha("commit-tree", await git(args, { env }));
}

/**
 * Move a local ref from `old` (null: it must not exist) to `next`, as git's own compare-and-swap.
 * False when the ref was not where `old` says, or a racing writer held its lock past the timeout.
 */
export async function updateRef(git: Git, ref: string, next: string, old: string | null): Promise<boolean> {
  return (await git(["update-ref", ref, next, old ?? ""])).code === 0;
}

export async function isAncestor(git: Git, older: string, newer: string): Promise<PluginResult<boolean>> {
  const out = await git(["merge-base", "--is-ancestor", older, newer]);
  if (out.code === 0) return ok(true);
  if (out.code === 1) return ok(false);
  return gitFailure("merge-base --is-ancestor", out);
}

export async function hasObject(git: Git, oid: string): Promise<boolean> {
  return (await git(["cat-file", "-e", `${oid}^{commit}`])).code === 0;
}

/** The commit `ref` names on the remote, or null when the remote has no such ref. */
export async function lsRemote(git: Git, remote: string, ref: string): Promise<PluginResult<string | null>> {
  const out = await git(["ls-remote", "--refs", remote, ref], { remote: true });
  if (out.code !== 0) return gitFailure(`ls-remote ${remote}`, out);
  for (const line of out.stdout.split("\n")) {
    const [oid, name] = line.split("\t");
    if (name === ref && oid && SHA_RE.test(oid)) return ok(oid);
  }
  return ok(null);
}

/** Fetch `refspecs` from the remote, objects only unless a refspec names a local destination. */
export async function fetchRefs(git: Git, remote: string, refspecs: string[], prune = false): Promise<PluginResult<null>> {
  const out = await git(["fetch", "--no-write-fetch-head", "--no-tags", "--quiet", ...(prune ? ["--prune"] : []), remote, ...refspecs], { remote: true });
  return out.code === 0 ? ok(null) : gitFailure(`fetch ${remote}`, out);
}

/**
 * Push `next` to the remote's `ref` only if the remote still has `old` there (null: no such ref).
 * The lease is the distributed compare-and-swap: the remote, not this machine, decides who won.
 * `rejected` is a lost lease (or a ref the remote had locked for a racing push); anything else that
 * stops the push is a failure, so an unreachable remote is never mistaken for a lost race.
 */
export async function pushLeased(git: Git, remote: string, next: string, ref: string, old: string | null): Promise<PluginResult<"pushed" | "rejected">> {
  const out = await git(["push", "--atomic", "--porcelain", "--no-verify", remote, `${next}:${ref}`, `--force-with-lease=${ref}:${old ?? ""}`], {
    remote: true,
  });
  if (out.code === 0) return ok("pushed");
  const rejected = out.stdout.split("\n").some((line) => line.startsWith("!\t") && line.split("\t")[1]?.endsWith(`:${ref}`));
  return rejected ? ok("rejected") : gitFailure(`push ${remote} ${ref}`, out);
}
