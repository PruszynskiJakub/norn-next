/**
 * git adapter — implements GitPort (packages/core/src/ports.ts) over the `git` CLI.
 * Commands run through an injectable Exec (X4). Failures surface as typed results where the
 * port declares them (PushResult, RebaseResult, booleans, null) and as PortError otherwise.
 */
import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { gitTimeoutMs } from "@norn/store";
import type { CommitSpec, ConflictMarker, GitFactory, GitInProgress, GitPort, MergeResult, OutgoingMarkers, PushResult, RefUpdate, WorktreeInfo, WorktreeStatus } from "@norn/core";
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

/** BS2: `git merge-tree --write-tree` (BS1 conflict detection) needs git ≥ 2.38. */
export const MIN_GIT_VERSION = [2, 38] as const;

/** `git version 2.50.1 (Apple Git-155)` → [2, 50, 1]; null when unreadable. */
export function parseGitVersion(text: string): number[] | null {
  const m = /git version (\d+)\.(\d+)(?:\.(\d+))?/.exec(text);
  return m ? [Number(m[1]), Number(m[2]), Number(m[3] ?? 0)] : null;
}

/** BS2: is this git new enough for norn (≥ 2.38)? */
export function gitVersionOk(text: string): boolean {
  const v = parseGitVersion(text);
  if (!v) return false;
  const [maj, min] = v as [number, number];
  return maj > MIN_GIT_VERSION[0] || (maj === MIN_GIT_VERSION[0] && min >= MIN_GIT_VERSION[1]);
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

/** H1: a conflict-marker line (`<<<<<<< ours`, `>>>>>>> theirs`, diff3 `||||||| base`); `=======` alone is a setext heading too. */
const MARKER = /^(<{7}|>{7}|\|{7})( |$)/;
/** PortError codes of commit (H1); the same strings as `GIT_IN_PROGRESS` / `GIT_CONFLICT_MARKERS` in @norn/core. */
const IN_PROGRESS = "git_operation_in_progress";
const CONFLICT_MARKERS = "git_conflict_markers";

/**
 * H1: files whose added lines (`git diff -U0` output) hold both an opening (`<<<<<<< `) and a closing
 * (`>>>>>>> `) conflict marker — a merge result committed unresolved.
 */
export function addedConflictMarkers(diff: string): string[] {
  const out: string[] = [];
  let file: string | null = null;
  let open = false;
  let close = false;
  const flush = () => {
    if (file && open && close) out.push(file);
  };
  for (const l of diff.split("\n")) {
    if (l.startsWith("diff --git ")) {
      flush();
      file = null;
      open = close = false;
    } else if (l.startsWith("+++ ")) file = l.slice(4).replace(/^b\//, "");
    else if (l.startsWith("+") && !l.startsWith("+++")) {
      if (/^\+<{7}( |$)/.test(l)) open = true;
      else if (/^\+>{7}( |$)/.test(l)) close = true;
    }
  }
  flush();
  return out;
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
  const run = (cwd: string, args: string[], stdin?: string) => {
    // H11: a call that reaches the remote is bounded; local ones (hooks on commit) are not
    const timeoutMs = gitTimeoutMs(args);
    return exec([bin, ...args], { cwd, env, ...(stdin === undefined ? {} : { stdin }), ...(timeoutMs === undefined ? {} : { timeoutMs }) });
  };
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

  /** H1: MERGE_HEAD, a rebase, CHERRY_PICK_HEAD or REVERT_HEAD in cwd's worktree, and the unmerged paths. */
  const inProgress = async (cwd: string): Promise<GitInProgress> => {
    // one rev-parse for every marker git leaves while an operation waits to be concluded
    const names = ["MERGE_HEAD", "rebase-merge", "rebase-apply", "REBASE_HEAD", "CHERRY_PICK_HEAD", "REVERT_HEAD"] as const;
    const [paths, u] = await Promise.all([run(cwd, ["rev-parse", ...names.flatMap((n) => ["--git-path", n])]), run(cwd, ["diff", "--name-only", "--diff-filter=U", "-z"])]);
    const found = paths.code === 0 ? lines(paths.stdout) : [];
    const has = new Set(names.filter((_, i) => !!found[i] && existsSync(resolve(cwd, found[i] as string))));
    const operation: GitInProgress["operation"] = has.has("MERGE_HEAD")
      ? "merge"
      : has.has("rebase-merge") || has.has("rebase-apply") || has.has("REBASE_HEAD")
        ? "rebase"
        : has.has("CHERRY_PICK_HEAD")
          ? "cherry-pick"
          : has.has("REVERT_HEAD")
            ? "revert"
            : null;
    const unmerged = u.code === 0 ? [...new Set(u.stdout.split("\0").filter((p) => p.length > 0))].sort() : [];
    return { operation, unmerged };
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
      // H1: never stage or commit through someone's merge or rebase — any commit would conclude it
      // (git refuses a partial commit mid-merge), with whatever the work tree holds, markers included
      const busy = await inProgress(cwd);
      if (busy.operation || busy.unmerged.length)
        throw portError(
          IN_PROGRESS,
          `${busy.operation ?? "a merge"} in progress${busy.unmerged.length ? ` (unmerged: ${busy.unmerged.join(", ")})` : ""}: nothing committed; the commit waits until it is concluded`,
        );
      const paths = spec.paths && spec.paths.length > 0 ? spec.paths : null;
      await must(cwd, paths ? ["add", "-A", "--", ...paths] : ["add", "-A"]);
      const diff = await run(cwd, ["diff", "--cached", "--quiet", ...(paths ? ["--", ...paths] : [])]);
      if (diff.code === 0 && !spec.allowEmpty) return null;
      if (diff.code !== 0 && diff.code !== 1) okOrThrow(diff, "git diff", "git");
      if (diff.code === 1) {
        // H1 last guard: a norn commit never records an unresolved merge
        const added = await must(cwd, ["diff", "--cached", "-U0", "--no-color", "--no-ext-diff", ...(paths ? ["--", ...paths] : [])]);
        const marked = addedConflictMarkers(added);
        if (marked.length) throw portError(CONFLICT_MARKERS, `conflict markers in ${marked.join(", ")}: nothing committed; resolve them first`);
      }
      const args = ["commit", "-F", "-", "--cleanup=strip"];
      if (spec.allowEmpty) args.push("--allow-empty");
      for (const [k, v] of Object.entries(spec.trailers)) args.push("--trailer", `${k}: ${v}`); // S4
      if (paths && diff.code === 1) args.push("--", ...paths);
      await must(cwd, args, spec.message);
      return line(cwd, ["rev-parse", "HEAD"]);
    },
    inProgress,
    async conflictMarkers(cwd, o) {
      if (o?.paths && o.paths.length === 0) return [];
      const args = ["grep", "-n", "-I", "-z", "--no-color", "-E", "^(<{7}|>{7}|[|]{7})( |$)"];
      if (o?.rev) args.push(o.rev);
      args.push("--", ...(o?.paths ?? []));
      const r = await run(cwd, args);
      if (r.code === 1) return [];
      okOrThrow(r, "git grep", "git");
      const prefix = o?.rev ? `${o.rev}:` : "";
      const out: ConflictMarker[] = [];
      for (const l of lines(r.stdout)) {
        // -z: <rev:>path NUL line NUL text
        const [path, n, text] = l.split("\0");
        if (!path || !n || !MARKER.test(text ?? "")) continue;
        out.push({ path: path.startsWith(prefix) ? path.slice(prefix.length) : path, line: Number(n) });
      }
      return out;
    },
    async outgoingConflictMarkers(cwd, remote, rev): Promise<OutgoingMarkers[]> {
      // BS5.2: the files the unpublished commits change — first parent only, so a merge commit counts
      // with everything it brought in (and what its author left unresolved)
      const notPushed = [rev, "--not", `--remotes=${remote}`];
      const ch = await run(cwd, ["-c", "core.quotePath=false", "log", "--format=", "--name-only", "-m", "--first-parent", ...notPushed, "--"]);
      if (ch.code !== 0) return [];
      const paths = [...new Set(lines(ch.stdout))];
      if (!paths.length) return [];
      // an opening and a closing marker with their label (`<<<<<<< HEAD`, `>>>>>>> main`); a lone
      // `=======` is a setext heading, so it never counts
      const g = await run(cwd, ["grep", "-n", "-I", "-z", "--no-color", "-E", "^(<{7}|>{7}) ", rev, "--", ...paths]);
      if (g.code === 1) return [];
      okOrThrow(g, "git grep", "git");
      const seen = new Map<string, { open: boolean; close: boolean }>();
      for (const l of lines(g.stdout)) {
        const [where, , text] = l.split("\0");
        if (!where || text === undefined) continue;
        const path = where.startsWith(`${rev}:`) ? where.slice(rev.length + 1) : where;
        const m = seen.get(path) ?? { open: false, close: false };
        if (text.startsWith("<<<<<<< ")) m.open = true;
        else if (text.startsWith(">>>>>>> ")) m.close = true;
        seen.set(path, m);
      }
      const out: OutgoingMarkers[] = [];
      for (const [path, m] of [...seen].sort(([a], [b]) => a.localeCompare(b))) {
        if (!m.open || !m.close) continue;
        out.push({ path, commit: await nullIfFail(cwd, ["log", "-1", "--format=%H", ...notPushed, "--", path]) });
      }
      return out;
    },
    async baseMergeCommit(cwd, base, head) {
      // every commit on the ancestry path descends from base: the oldest merge on it brought base in
      const r = await run(cwd, ["rev-list", "--merges", "--ancestry-path", "--reverse", `${base}..${head}`, "--"]);
      return r.code === 0 ? (lines(r.stdout)[0] ?? null) : null;
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

    async divergence(cwd, a, b) {
      const counts = (await line(cwd, ["rev-list", "--left-right", "--count", `${a}...${b}`, "--"])).split(/\s+/);
      const mb = await run(cwd, ["merge-base", a, b]);
      if (mb.code !== 0 && mb.code !== 1) okOrThrow(mb, "git merge-base", "git");
      return { merge_base: mb.code === 0 ? mb.stdout.trim() || null : null, ahead: Number(counts[0] ?? 0), behind: Number(counts[1] ?? 0) };
    },
    async mergeTree(cwd, ours, theirs) {
      // BS1: exit 0 = clean (prints the tree), 1 = conflicts (tree, then one conflicted path per line)
      const r = await run(cwd, ["merge-tree", "--write-tree", "--name-only", "--no-messages", ours, theirs]);
      if (r.code === 0) return [];
      if (r.code !== 1) okOrThrow(r, "git merge-tree", "git");
      return [...new Set(lines(r.stdout).slice(1))].sort();
    },
    async merge(cwd, rev, spec): Promise<MergeResult> {
      // H1: a merge already in progress is someone's (a resolve agent's): never abort or conclude it
      const busy = await inProgress(cwd);
      if (busy.operation || busy.unmerged.length) throw portError(IN_PROGRESS, `${busy.operation ?? "a merge"} in progress in ${cwd}: not merging ${rev}`);
      // BS3: merge without committing, so the merge commit carries the message and trailers (S4)
      const r = await run(cwd, ["merge", "--no-ff", "--no-commit", "--no-edit", rev]);
      const head = () => line(cwd, ["rev-parse", "HEAD"]);
      const inMerge = async () => {
        const p = await nullIfFail(cwd, ["rev-parse", "--git-path", "MERGE_HEAD"]);
        return !!p && existsSync(resolve(cwd, p));
      };
      if (r.code !== 0) {
        if (!(await inMerge())) okOrThrow(r, "git merge", "git"); // e.g. dirty tree: not a conflict
        const files = lines((await run(cwd, ["diff", "--name-only", "--diff-filter=U"])).stdout);
        const abort = await run(cwd, ["merge", "--abort"]);
        if (abort.code !== 0) throw portError("git_merge_abort_failed", `git merge --abort failed: ${abort.stderr.trim()}`);
        return { ok: false, conflict: true, files: [...new Set(files)].sort() };
      }
      if (!(await inMerge())) return { ok: true, head: await head() }; // already up to date
      const args = ["commit", "--no-edit", "-F", "-", "--cleanup=strip"];
      for (const [k, v] of Object.entries(spec.trailers)) args.push("--trailer", `${k}: ${v}`);
      await must(cwd, args, spec.message);
      return { ok: true, head: await head() };
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

export type UpdateResult =
  | { outcome: "done"; head: string; merged: boolean; adopted: string | null }
  | { outcome: "conflict"; files: string[]; adopted: string | null }
  | { outcome: "stuck"; reason: string };

/**
 * BS3.3a: how the local story branch took in `<remote>/<branch>` — `none` (no remote branch),
 * `local` (nothing new on the remote), `adopted` (fast-forwarded to it), `merged` (a merge commit),
 * or `conflict` (diverged and the merge was aborted, paths reported).
 */
export type RemoteSync =
  | { outcome: "none" | "local"; remote_sha: string | null }
  | { outcome: "adopted" | "merged"; remote_sha: string; head: string }
  | { outcome: "conflict"; remote_sha: string; files: string[] };

/**
 * BS3.3a (dogfood D4): bring the remote story branch into the local one checked out in `cwd` —
 * fetch it; fast-forward when the local branch is an ancestor of it (a person pressed "Update
 * branch"); when they diverged (a person pushed while norn committed locally), merge it with
 * `message` and `trailers` (never rebase: the branch is published, BS4). A conflicting merge is
 * aborted and its paths reported. The caller holds the claim (T7) and pushes afterwards.
 */
export async function syncRemoteBranch(
  git: GitPort,
  opts: { cwd: string; branch: string; remote: string; message: string; trailers: Record<string, string> },
): Promise<RemoteSync> {
  const tracking = `refs/remotes/${opts.remote}/${opts.branch}`;
  try {
    await git.fetch(opts.cwd, opts.remote, [`+refs/heads/${opts.branch}:${tracking}`]);
  } catch (e) {
    // a story branch never pushed has nothing to take in; anything else is a failed effect (R4.3)
    if (!/couldn't find remote ref|could not find remote ref/i.test((e as Error).message)) throw e;
    return { outcome: "none", remote_sha: null };
  }
  const remoteSha = await git.readRef(opts.cwd, tracking);
  const local = await git.revParse(opts.cwd, "HEAD");
  if (!remoteSha || !local || remoteSha === local || (await git.isAncestor(opts.cwd, remoteSha, local))) return { outcome: "local", remote_sha: remoteSha };
  if (await git.isAncestor(opts.cwd, local, remoteSha)) {
    const ff = await git.fastForward(opts.cwd, remoteSha);
    if (!ff.ok) throw portError("git_ff_failed", `cannot fast-forward ${opts.branch} to ${opts.remote}/${opts.branch}`);
    return { outcome: "adopted", remote_sha: remoteSha, head: remoteSha };
  }
  const m = await git.merge(opts.cwd, remoteSha, { message: opts.message, trailers: opts.trailers });
  return m.ok ? { outcome: "merged", remote_sha: remoteSha, head: m.head } : { outcome: "conflict", remote_sha: remoteSha, files: m.files };
}

/**
 * W2 `git: update` (BS3, BS4) in the story worktree `cwd`, whose branch is `branch`. The caller
 * holds the story's integrate lock (K6) and pushes afterwards (S8, T7).
 *  1. a dirty worktree → `stuck` (`worktree dirty`);
 *  3. the remote story branch ahead of the local one and descended from it (a person pressed
 *     "Update branch" on the host) → fast-forward to it first; diverged → merge it (BS3.3a), and a
 *     conflicting merge of it → `stuck`;
 *  4. nothing of `baseSha` missing → `done`, no commit;
 *  5. else `git merge --no-ff <baseSha>` with `message` and `trailers` (`Norn-Tick`, so Q6 does
 *     not report the merge as foreign) → `done`;
 *  6. a conflicting merge is aborted → `conflict` with the paths.
 * Merge, never rebase: the story branch is published (BS4).
 */
export async function update(
  git: GitPort,
  opts: { cwd: string; branch: string; baseSha: string; remote: string | null; message: string; trailers: Record<string, string> },
): Promise<UpdateResult> {
  const st = await git.status(opts.cwd);
  // H1: a merge or rebase left in progress (a resolve agent's) is never aborted or concluded here
  const busy = await git.inProgress(opts.cwd);
  if (busy.operation || busy.unmerged.length) return { outcome: "stuck", reason: `${busy.operation ?? "merge"} in progress in the story worktree` };
  if (!st.clean || st.rebase_in_progress) return { outcome: "stuck", reason: "worktree dirty" };
  if (st.branch !== opts.branch) return { outcome: "stuck", reason: `story worktree is on ${st.branch ?? "a detached HEAD"}, not ${opts.branch}` };
  let adopted: string | null = null;
  if (opts.remote) {
    const where = `${opts.remote}/${opts.branch}`;
    const r = await syncRemoteBranch(git, { cwd: opts.cwd, branch: opts.branch, remote: opts.remote, message: `Merge ${where} into ${opts.branch}`, trailers: opts.trailers });
    if (r.outcome === "conflict") return { outcome: "stuck", reason: `story branch diverged from ${where}; merging it conflicts in ${r.files.join(", ") || "?"}` };
    if (r.outcome === "adopted" || r.outcome === "merged") adopted = r.remote_sha;
  }
  const d = await git.divergence(opts.cwd, "HEAD", opts.baseSha);
  if (d.behind === 0) return { outcome: "done", head: (await git.revParse(opts.cwd, "HEAD")) as string, merged: false, adopted };
  const m = await git.merge(opts.cwd, opts.baseSha, { message: opts.message, trailers: opts.trailers });
  if (!m.ok) return { outcome: "conflict", files: m.files, adopted };
  return { outcome: "done", head: m.head, merged: true, adopted };
}

export const factory: GitFactory = () => createGit();
