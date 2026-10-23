/**
 * git adapter — implements GitPort (packages/core/src/ports.ts) over the `git` CLI.
 * Commands run through an injectable Exec (X4). Failures surface as typed results where the
 * port declares them (PushResult, RebaseResult, booleans, null) and as PortError otherwise.
 */
import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import type { CommitSpec, GitFactory, GitPort, PushResult, RefUpdate, WorktreeInfo, WorktreeStatus } from "@norn/core";
import { bunExec, isAuthError, isNetworkError, okOrThrow, portError, type Exec, type ExecResult } from "./exec.ts";

export { bunExec, fixtureExec, portError, type Exec, type ExecFixture, type ExecOptions, type ExecResult } from "./exec.ts";

export interface GitOptions {
  exec?: Exec;
  /** git binary (default `git`) */
  bin?: string;
  /** extra env for every git call */
  env?: Record<string, string>;
}

const ZERO_OID = /^0+$/;

/** Parse `Key: value` trailer lines (S4). */
export function parseTrailers(text: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const line of text.split("\n")) {
    const m = /^([A-Za-z0-9-]+):\s*(.*)$/.exec(line.trim());
    if (m) out[m[1] as string] = (m[2] as string).trim();
  }
  return out;
}

export function classifyPush(res: ExecResult): PushResult {
  if (res.code === 0) return { ok: true };
  const msg = `${res.stderr}\n${res.stdout}`.trim();
  if (/stale info/i.test(msg)) return { ok: false, reason: "stale", message: msg };
  if (/\[rejected\]|non-fast-forward|fetch first|\[remote rejected\]|failed to push/i.test(msg) && !isNetworkError(msg) && !isAuthError(msg))
    return { ok: false, reason: "rejected", message: msg };
  if (isAuthError(msg)) return { ok: false, reason: "auth", message: msg };
  if (isNetworkError(msg)) return { ok: false, reason: "network", message: msg };
  return { ok: false, reason: "other", message: msg };
}

/** Parse `git status --porcelain=v2 --branch -z` output. */
export function parseStatusV2(out: string, path: string, rebaseInProgress: boolean): WorktreeStatus {
  const st: WorktreeStatus = {
    path,
    branch: null,
    head: null,
    clean: true,
    staged: [],
    unstaged: [],
    untracked: [],
    ahead: 0,
    behind: 0,
    upstream: null,
    rebase_in_progress: rebaseInProgress,
  };
  const parts = out.split("\0");
  for (let i = 0; i < parts.length; i++) {
    const e = parts[i] as string;
    if (!e) continue;
    if (e.startsWith("# branch.oid ")) {
      const v = e.slice(13);
      st.head = v === "(initial)" ? null : v;
    } else if (e.startsWith("# branch.head ")) {
      const v = e.slice(14);
      st.branch = v === "(detached)" ? null : v;
    } else if (e.startsWith("# branch.upstream ")) st.upstream = e.slice(18);
    else if (e.startsWith("# branch.ab ")) {
      const m = /\+(\d+) -(\d+)/.exec(e);
      if (m) {
        st.ahead = Number(m[1]);
        st.behind = Number(m[2]);
      }
    } else if (e.startsWith("1 ") || e.startsWith("2 ")) {
      const f = e.split(" ");
      const xy = f[1] as string;
      const p = f.slice(e.startsWith("1 ") ? 8 : 9).join(" ");
      if (xy[0] !== ".") st.staged.push(p);
      if (xy[1] !== ".") st.unstaged.push(p);
      if (e.startsWith("2 ")) i++; // -z: original path follows as its own entry
    } else if (e.startsWith("u ")) st.unstaged.push(e.split(" ").slice(10).join(" "));
    else if (e.startsWith("? ")) st.untracked.push(e.slice(2));
  }
  st.clean = st.staged.length === 0 && st.unstaged.length === 0 && st.untracked.length === 0;
  return st;
}

/** Parse `git worktree list --porcelain -z`. */
export function parseWorktreeList(out: string): WorktreeInfo[] {
  const list: WorktreeInfo[] = [];
  let cur: (WorktreeInfo & { bare?: boolean }) | null = null;
  const flush = () => {
    if (cur && !cur.bare) list.push({ path: cur.path, branch: cur.branch, head: cur.head, locked: cur.locked, prunable: cur.prunable });
    cur = null;
  };
  for (const e of out.split("\0")) {
    if (e === "") {
      flush();
      continue;
    }
    if (e.startsWith("worktree ")) {
      flush();
      cur = { path: e.slice(9), branch: null, head: null, locked: false, prunable: false };
    } else if (!cur) continue;
    else if (e.startsWith("HEAD ")) cur.head = ZERO_OID.test(e.slice(5)) ? null : e.slice(5);
    else if (e.startsWith("branch ")) cur.branch = e.slice(7).replace(/^refs\/heads\//, "");
    else if (e === "bare") cur.bare = true;
    else if (e === "locked" || e.startsWith("locked ")) cur.locked = true;
    else if (e === "prunable" || e.startsWith("prunable ")) cur.prunable = true;
  }
  flush();
  return list;
}

export function createGit(opts: GitOptions = {}): GitPort {
  const exec = opts.exec ?? bunExec;
  const bin = opts.bin ?? "git";
  const env = { GIT_TERMINAL_PROMPT: "0", GIT_EDITOR: "true", ...(opts.env ?? {}) };
  const run = (cwd: string, args: string[], stdin?: string) =>
    exec([bin, ...args], stdin === undefined ? { cwd, env } : { cwd, env, stdin });
  const must = async (cwd: string, args: string[], stdin?: string) => okOrThrow(await run(cwd, args, stdin), `git ${args[0]}`, "git");
  const line = async (cwd: string, args: string[]) => (await must(cwd, args)).trim();
  const lines = (s: string) => s.split("\n").filter((l) => l.length > 0);
  const nullIfFail = async (cwd: string, args: string[]) => {
    const r = await run(cwd, args);
    return r.code === 0 && r.stdout.trim() ? r.stdout.trim() : null;
  };

  const worktreeRoot = (cwd: string) => line(cwd, ["rev-parse", "--show-toplevel"]);

  const rebaseInProgress = async (cwd: string) => {
    for (const d of ["rebase-merge", "rebase-apply"]) {
      const p = await nullIfFail(cwd, ["rev-parse", "--git-path", d]);
      if (p && existsSync(resolve(cwd, p))) return true;
    }
    return false;
  };

  const git: GitPort = {
    async repoRoot(cwd) {
      const common = await line(cwd, ["rev-parse", "--path-format=absolute", "--git-common-dir"]);
      return common.endsWith("/.git") ? dirname(common) : common;
    },
    worktreeRoot,
    async status(cwd) {
      const root = await worktreeRoot(cwd);
      const out = await must(cwd, ["status", "--porcelain=v2", "--branch", "-z", "--untracked-files=all"]);
      return parseStatusV2(out, root, await rebaseInProgress(cwd));
    },
    revParse: (cwd, rev) => nullIfFail(cwd, ["rev-parse", "--verify", "--quiet", "--end-of-options", rev]),
    async defaultBranch(cwd, remote) {
      const sym = await nullIfFail(cwd, ["symbolic-ref", "--short", `refs/remotes/${remote}/HEAD`]);
      if (sym) return sym.slice(remote.length + 1);
      const r = await run(cwd, ["ls-remote", "--symref", remote, "HEAD"]);
      const m = r.code === 0 ? /^ref: refs\/heads\/(\S+)\tHEAD/m.exec(r.stdout) : null;
      if (m) return m[1] as string;
      for (const b of ["main", "master"]) if (await nullIfFail(cwd, ["rev-parse", "--verify", "--quiet", `refs/remotes/${remote}/${b}`])) return b;
      throw portError("git_no_default_branch", `cannot determine default branch of ${remote}`);
    },
    async lastCommitTime(cwd) {
      const t = await nullIfFail(cwd, ["log", "-1", "--format=%ct", "HEAD"]);
      return t ? Number(t) * 1000 : null;
    },
    diffStat: (cwd, range) => must(cwd, ["diff", "--stat", range]),
    async log(cwd, range, limit) {
      const args = ["log", "--format=%H%x1f%s%x1f%ct%x1f%(trailers:only,unfold)%x1e"];
      if (limit !== undefined) args.push(`-n${limit}`);
      const out = await must(cwd, [...args, range, "--"]);
      return out
        .split("\x1e")
        .map((r) => r.replace(/^\n/, ""))
        .filter((r) => r.length > 0)
        .map((r) => {
          const [sha, subject, at, trailers] = r.split("\x1f");
          return { sha: sha as string, subject: subject ?? "", at: Number(at) * 1000, trailers: parseTrailers(trailers ?? "") };
        });
    },

    async branchExists(cwd, branch, where = "local", remote = "origin") {
      if (where === "local") return (await run(cwd, ["show-ref", "--verify", "--quiet", `refs/heads/${branch}`])).code === 0;
      const r = await run(cwd, ["ls-remote", "--exit-code", "--heads", remote, `refs/heads/${branch}`]);
      if (r.code === 0) return true;
      if (r.code === 2) return false;
      okOrThrow(r, "git ls-remote", "git");
      return false;
    },
    async createBranch(cwd, branch, from) {
      await must(cwd, ["branch", "--no-track", branch, from]);
    },
    async deleteBranch(cwd, branch, o) {
      await must(cwd, ["branch", o?.force ? "-D" : "-d", branch]);
    },
    async deleteRemoteBranch(cwd, remote, branch) {
      const r = await run(cwd, ["push", remote, "--delete", `refs/heads/${branch}`]);
      if (r.code !== 0 && /remote ref does not exist/i.test(r.stderr)) return { ok: true }; // idempotent (GR6)
      return classifyPush(r);
    },

    async worktreeList(cwd) {
      return parseWorktreeList(await must(cwd, ["worktree", "list", "--porcelain", "-z"]));
    },
    async worktreeAdd(cwd, path, branch, o) {
      if (o?.from) await must(cwd, ["worktree", "add", "-b", branch, path, o.from]);
      else await must(cwd, ["worktree", "add", path, branch]);
    },
    async worktreeRemove(cwd, path, o) {
      await must(cwd, ["worktree", "remove", ...(o?.force ? ["--force"] : []), path]);
    },

    async commit(cwd, spec: CommitSpec) {
      const paths = spec.paths && spec.paths.length > 0 ? spec.paths : null;
      await must(cwd, paths ? ["add", "-A", "--", ...paths] : ["add", "-A"]);
      const diff = await run(cwd, ["diff", "--cached", "--quiet", ...(paths ? ["--", ...paths] : [])]);
      if (diff.code === 0 && !spec.allowEmpty) return null;
      if (diff.code !== 0 && diff.code !== 1) okOrThrow(diff, "git diff", "git");
      const args = ["commit", "-F", "-", "--cleanup=strip"];
      if (spec.allowEmpty) args.push("--allow-empty");
      for (const [k, v] of Object.entries(spec.trailers)) args.push("--trailer", `${k}: ${v}`); // S4
      if (paths && diff.code === 1) args.push("--", ...paths);
      await must(cwd, args, spec.message);
      return line(cwd, ["rev-parse", "HEAD"]);
    },
    async push(cwd, remote, refspec, o) {
      const args = ["push", "--porcelain"];
      if (o?.forceWithLease !== undefined) args.push(o.forceWithLease ? `--force-with-lease=${o.forceWithLease}` : "--force-with-lease");
      if (o?.setUpstream) args.push("--set-upstream");
      return classifyPush(await run(cwd, [...args, remote, refspec]));
    },
    async fetch(cwd, remote, refspecs) {
      await must(cwd, ["fetch", "--no-tags", remote, ...refspecs]);
    },
    async fastForward(cwd, onto) {
      return { ok: (await run(cwd, ["merge", "--ff-only", "--no-edit", onto])).code === 0 };
    },
    async rebase(cwd, onto) {
      const r = await run(cwd, ["rebase", onto]);
      if (r.code === 0) return { ok: true, head: await line(cwd, ["rev-parse", "HEAD"]) };
      if (!(await rebaseInProgress(cwd))) okOrThrow(r, "git rebase", "git"); // e.g. dirty tree: not a conflict
      const files = lines((await run(cwd, ["diff", "--name-only", "--diff-filter=U"])).stdout);
      const abort = await run(cwd, ["rebase", "--abort"]);
      if (abort.code !== 0) throw portError("git_rebase_abort_failed", `git rebase --abort failed: ${abort.stderr.trim()}`);
      return { ok: false, conflict: true, files };
    },
    async isAncestor(cwd, ancestor, descendant) {
      const r = await run(cwd, ["merge-base", "--is-ancestor", ancestor, descendant]);
      if (r.code === 0) return true;
      if (r.code === 1) return false;
      okOrThrow(r, "git merge-base", "git");
      return false;
    },

    readRef: (cwd, ref) => nullIfFail(cwd, ["rev-parse", "--verify", "--quiet", "--end-of-options", ref]),
    async listRefs(cwd, prefix) {
      const out = await must(cwd, ["for-each-ref", "--format=%(refname) %(objectname)", prefix]);
      return lines(out)
        .map((l) => {
          const [ref, sha] = l.split(" ");
          return { ref: ref as string, sha: sha as string };
        })
        .filter((r) => r.ref.startsWith(prefix));
    },
    async listRemoteRefs(cwd, remote, prefix) {
      const out = okOrThrow(await run(cwd, ["ls-remote", "--refs", remote]), "git ls-remote", "git");
      return lines(out)
        .map((l) => {
          const [sha, ref] = l.split("\t");
          return { ref: ref as string, sha: sha as string };
        })
        .filter((r) => r.ref.startsWith(prefix));
    },
    readBlob: (cwd, sha) => must(cwd, ["cat-file", "blob", sha]),
    async writeBlob(cwd, content) {
      return (await must(cwd, ["hash-object", "-w", "--stdin"], content)).trim();
    },
    async updateRef(cwd, u: RefUpdate) {
      const args = u.sha === null ? ["update-ref", "-d", u.ref] : ["update-ref", u.ref, u.sha];
      if (u.expected !== undefined) args.push(u.expected ?? "");
      return (await run(cwd, args)).code === 0;
    },
    async pushRef(cwd, remote, u: RefUpdate) {
      // T3: compare-and-swap via --force-with-lease=<ref>:<expected> ("" = must not exist).
      const args = ["push", "--porcelain"];
      let spec: string;
      if (u.expected === undefined) spec = u.sha === null ? `:${u.ref}` : `+${u.sha}:${u.ref}`;
      else {
        args.push(`--force-with-lease=${u.ref}:${u.expected ?? ""}`);
        spec = u.sha === null ? `:${u.ref}` : `${u.sha}:${u.ref}`;
      }
      return classifyPush(await run(cwd, [...args, remote, spec]));
    },
  };
  return git;
}

export type IntegrateResult = { outcome: "done"; head: string } | { outcome: "conflict"; files: string[] };

/**
 * W2 `git: integrate`: rebase the slice branch (checked out in `sliceCwd`) onto the story
 * branch, then fast-forward the story branch to it. A conflicting rebase is aborted cleanly
 * and yields `conflict` (K6). The caller serializes integrations per story (K6).
 * If the story branch is checked out in a worktree it is fast-forwarded there (keeps that
 * checkout in sync); otherwise its ref is moved with a compare-and-swap.
 */
export async function integrate(git: GitPort, opts: { sliceCwd: string; storyBranch: string; storyCwd?: string }): Promise<IntegrateResult> {
  const rb = await git.rebase(opts.sliceCwd, opts.storyBranch);
  if (!rb.ok) return { outcome: "conflict", files: rb.files };
  const storyRef = `refs/heads/${opts.storyBranch}`;
  let storyCwd = opts.storyCwd;
  if (!storyCwd) storyCwd = (await git.worktreeList(opts.sliceCwd)).find((w) => w.branch === opts.storyBranch)?.path;
  if (storyCwd) {
    const ff = await git.fastForward(storyCwd, rb.head);
    if (!ff.ok) throw portError("git_ff_failed", `cannot fast-forward ${opts.storyBranch} to ${rb.head} in ${storyCwd}`);
    return { outcome: "done", head: rb.head };
  }
  const old = await git.readRef(opts.sliceCwd, storyRef);
  if (old === null) throw portError("git_no_branch", `story branch ${opts.storyBranch} does not exist`);
  if (!(await git.isAncestor(opts.sliceCwd, old, rb.head)) || !(await git.updateRef(opts.sliceCwd, { ref: storyRef, sha: rb.head, expected: old })))
    throw portError("git_ff_failed", `cannot fast-forward ${opts.storyBranch} to ${rb.head}`, true);
  return { outcome: "done", head: rb.head };
}

export const factory: GitFactory = () => createGit();
