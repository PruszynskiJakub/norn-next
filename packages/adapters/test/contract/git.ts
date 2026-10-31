/**
 * GitPort contract (ports.ts), the subset norn's cli, store and view call today: roots and status,
 * revParse, commit with trailers (S4) and its H1 refusal, branches, worktrees, ref CAS (T2/T3),
 * push and its stale result, ancestry and divergence (BS1), merge and merge-tree (BS1/BS3),
 * conflict markers (H1), outgoing conflict markers (BS5.2), the base merge commit (BS5), diffStat
 * and fast-forward, and the reads the runtime makes (4.1): remotes, commonDir, hasRef, hasPath,
 * show, lsTree, listRefs over several prefixes, firstParentLog, revList, quiet fetch, detached
 * worktrees and prune, and what the commands call (4.2): version, remoteBranches, changedPaths,
 * checkoutPaths and untrack, and what `norn migrate` calls: move and stage. Run against real temp repos with a bare remote. Not covered: rebase, log ranges
 * beyond the last commit, and the port methods only the runtime's own wiring reaches.
 */
import { afterAll, describe, expect } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { GitPort } from "@norn/core";
import { type ContractOptions, contractTest } from "./suite.ts";

export type GitContractTest =
  | "a clone: roots, status, revParse, default branch, last commit time"
  | "commit returns the sha with its trailers; nothing to commit is null (S4)"
  | "commit refuses while a merge is in progress and says what is in progress (H1)"
  | "branches: create, push, exist locally and on the remote, delete"
  | "worktrees: add on a new branch, list, remove"
  | "refs: updateRef is compare-and-swap; readRef and listRefs see it (T2)"
  | "pushRef is compare-and-swap on the remote; a lost race is stale (T3)"
  | "push: a non-fast-forward is rejected, a lease the remote moved past is stale"
  | "ancestry and divergence (BS1)"
  | "merge: clean merges commit, conflicts abort and name the paths; mergeTree agrees (BS1, BS3)"
  | "conflictMarkers finds marker lines (H1)"
  | "outgoingConflictMarkers names marked files changed by commits not on the remote (BS5.2)"
  | "baseMergeCommit is the merge that brought base into head, or null (BS5)"
  | "diffStat summarises the files a range changes"
  | "fastForward moves only when it can"
  | "remotes and commonDir: the repo's remotes and the git dir its worktrees share"
  | "hasRef, hasPath, show and lsTree read refs and files of a revision"
  | "listRefs takes several prefixes in one call"
  | "firstParentLog: first-parent commits with dates and one trailer (Q6, C4)"
  | "revList: first-parent and ancestry-path walks, limited and reversed"
  | "fetch: quiet or not; a missing remote branch fails and says so"
  | "worktreeAddDetached checks out a detached HEAD; worktreePrune forgets removed directories"
  | "version names git; remoteBranches lists the remote's branches matching a pattern"
  | "changedPaths lists what two revisions change; checkoutPaths and untrack put paths back"
  | "move stages a rename of a tracked file and leaves an untracked one; stage adds paths to the index";

/** Deterministic git for the suite's own setup and for the port under test. */
export const GIT_ENV = {
  GIT_CONFIG_GLOBAL: "/dev/null",
  GIT_CONFIG_NOSYSTEM: "1",
  GIT_AUTHOR_NAME: "Norn Contract",
  GIT_AUTHOR_EMAIL: "contract@example.com",
  GIT_COMMITTER_NAME: "Norn Contract",
  GIT_COMMITTER_EMAIL: "contract@example.com",
};

const SHA = /^[0-9a-f]{40}$/;

export function gitContract(name: string, make: () => GitPort, opts: ContractOptions<GitContractTest> = {}): void {
  describe(`GitPort contract: ${name}`, () => {
    const dirs: string[] = [];
    afterAll(() => {
      for (const d of dirs) rmSync(d, { recursive: true, force: true });
    });
    const sh = (cwd: string, ...args: string[]): string => {
      const r = Bun.spawnSync(["git", ...args], { cwd, env: { ...process.env, ...GIT_ENV }, stdout: "pipe", stderr: "pipe" });
      if (r.exitCode !== 0) throw new Error(`git ${args.join(" ")}: ${r.stderr.toString()}`);
      return r.stdout.toString().trim();
    };
    const commitFile = (cwd: string, file: string, text: string, msg = `edit ${file}`): string => {
      writeFileSync(join(cwd, file), text);
      sh(cwd, "add", "-A");
      sh(cwd, "commit", "-q", "-m", msg);
      return sh(cwd, "rev-parse", "HEAD");
    };
    /** a bare remote and a clone of it with one commit on main */
    const repo = () => {
      const base = realpathSync(mkdtempSync(join(tmpdir(), "norn-git-contract-")));
      dirs.push(base);
      const remote = join(base, "remote.git");
      const root = join(base, "repo");
      sh(base, "init", "-q", "--bare", "-b", "main", remote);
      sh(base, "init", "-q", "-b", "main", root);
      sh(root, "remote", "add", "origin", remote);
      commitFile(root, "a.txt", "one\n", "init");
      sh(root, "push", "-q", "-u", "origin", "main");
      sh(root, "remote", "set-head", "origin", "-a");
      return { base, remote, root, git: make() };
    };
    const t = (n: GitContractTest, fn: () => Promise<void>) => contractTest(opts, n, fn);

    t("a clone: roots, status, revParse, default branch, last commit time", async () => {
      const { root, git } = repo();
      expect(await git.repoRoot(root)).toBe(root);
      expect(await git.commonDir(root)).toBe(join(root, ".git"));
      expect(await git.status(root)).toMatchObject({ path: root, branch: "main", clean: true, staged: [], unstaged: [], untracked: [], upstream: "origin/main", ahead: 0, behind: 0, rebase_in_progress: false });
      expect(await git.revParse(root, "HEAD")).toBe(sh(root, "rev-parse", "HEAD"));
      expect(await git.revParse(root, "no-such-branch")).toBeNull();
      expect(await git.defaultBranch(root, "origin")).toBe("main");
      expect(await git.lastCommitTime(root)).toBe(Number(sh(root, "log", "-1", "--format=%ct")) * 1000);
      writeFileSync(join(root, "a.txt"), "two\n");
      writeFileSync(join(root, "b.txt"), "new\n");
      expect(await git.status(root)).toMatchObject({ clean: false, unstaged: ["a.txt"], untracked: ["b.txt"] });
    });

    t("commit returns the sha with its trailers; nothing to commit is null (S4)", async () => {
      const { root, git } = repo();
      writeFileSync(join(root, "a.txt"), "two\n");
      writeFileSync(join(root, "b.txt"), "left out\n");
      const sha = await git.commit(root, { message: "Edit a", trailers: { "Norn-Story": "gh-1", "Norn-Step": "implement" }, paths: ["a.txt"] });
      expect(sha).toMatch(SHA);
      expect(sha).toBe(sh(root, "rev-parse", "HEAD"));
      const [last] = await git.log(root, "HEAD", 1);
      expect(last).toMatchObject({ sha, subject: "Edit a", trailers: { "Norn-Story": "gh-1", "Norn-Step": "implement" } });
      expect((await git.status(root)).untracked).toEqual(["b.txt"]);
      expect(await git.commit(root, { message: "nothing", trailers: {}, paths: ["a.txt"] })).toBeNull();
    });

    t("commit refuses while a merge is in progress and says what is in progress (H1)", async () => {
      const { root, git } = repo();
      expect(await git.inProgress(root)).toEqual({ operation: null, unmerged: [] });
      sh(root, "checkout", "-q", "-b", "side");
      commitFile(root, "a.txt", "side\n");
      sh(root, "checkout", "-q", "main");
      commitFile(root, "a.txt", "main\n");
      Bun.spawnSync(["git", "merge", "--no-edit", "side"], { cwd: root, env: { ...process.env, ...GIT_ENV } });
      expect(await git.inProgress(root)).toEqual({ operation: "merge", unmerged: ["a.txt"] });
      writeFileSync(join(root, "b.txt"), "x\n");
      const err = await git.commit(root, { message: "x", trailers: {}, paths: ["b.txt"] }).then(() => null, (e: unknown) => e);
      expect(err).toMatchObject({ code: "git_operation_in_progress" });
    });

    t("branches: create, push, exist locally and on the remote, delete", async () => {
      const { root, git } = repo();
      await git.createBranch(root, "gh-1-x", "main");
      expect(await git.branchExists(root, "gh-1-x")).toBe(true);
      expect(await git.branchExists(root, "gh-1-x", "remote", "origin")).toBe(false);
      expect(await git.push(root, "origin", "gh-1-x:refs/heads/gh-1-x")).toEqual({ ok: true });
      await git.fetch(root, "origin", ["+refs/heads/*:refs/remotes/origin/*"]);
      expect(await git.branchExists(root, "gh-1-x", "remote", "origin")).toBe(true);
      await git.deleteBranch(root, "gh-1-x");
      expect(await git.branchExists(root, "gh-1-x")).toBe(false);
      expect(await git.deleteRemoteBranch(root, "origin", "gh-1-x")).toEqual({ ok: true });
    });

    t("worktrees: add on a new branch, list, remove", async () => {
      const { base, root, git } = repo();
      const wt = join(base, "wt");
      await git.worktreeAdd(root, wt, "gh-1-wt", { from: "main" });
      expect(await git.status(wt)).toMatchObject({ path: wt, branch: "gh-1-wt" });
      expect(await git.repoRoot(wt)).toBe(root);
      expect((await git.worktreeList(root)).find((w) => w.path === wt)).toMatchObject({ branch: "gh-1-wt", head: sh(root, "rev-parse", "main"), locked: false, prunable: false });
      await git.worktreeRemove(root, wt);
      expect((await git.worktreeList(root)).map((w) => w.path)).toEqual([root]);
    });

    t("refs: updateRef is compare-and-swap; readRef and listRefs see it (T2)", async () => {
      const { root, git } = repo();
      const head = sh(root, "rev-parse", "HEAD");
      const ref = "refs/norn/claims/gh-1";
      expect(await git.readRef(root, ref)).toBeNull();
      expect(await git.updateRef(root, { ref, sha: head, expected: null })).toBe(true);
      expect(await git.updateRef(root, { ref, sha: head, expected: null })).toBe(false);
      expect(await git.readRef(root, ref)).toBe(head);
      expect(await git.listRefs(root, "refs/norn/claims/")).toEqual([{ ref, sha: head }]);
      expect(await git.updateRef(root, { ref, sha: null, expected: "0".repeat(39) + "1" })).toBe(false);
      expect(await git.updateRef(root, { ref, sha: null, expected: head })).toBe(true);
      expect(await git.readRef(root, ref)).toBeNull();
    });

    t("pushRef is compare-and-swap on the remote; a lost race is stale (T3)", async () => {
      const { root, git } = repo();
      const one = sh(root, "rev-parse", "HEAD");
      const two = commitFile(root, "a.txt", "two\n");
      const ref = "refs/norn/claims/gh-1";
      expect(await git.pushRef(root, "origin", { ref, sha: one, expected: null })).toEqual({ ok: true });
      const lost = await git.pushRef(root, "origin", { ref, sha: two, expected: null });
      expect(lost.ok === false && lost.reason).toBe("stale");
      expect(await git.pushRef(root, "origin", { ref, sha: two, expected: one })).toEqual({ ok: true });
      expect(await git.pushRef(root, "origin", { ref, sha: null, expected: two })).toEqual({ ok: true });
    });

    t("push: a non-fast-forward is rejected, a lease the remote moved past is stale", async () => {
      const { base, remote, root, git } = repo();
      const seen = sh(root, "rev-parse", "origin/main");
      const other = join(base, "other");
      sh(base, "clone", "-q", remote, other);
      commitFile(other, "b.txt", "theirs\n");
      sh(other, "push", "-q", "origin", "main");
      const mine = commitFile(root, "c.txt", "mine\n");
      const rejected = await git.push(root, "origin", "HEAD:refs/heads/main");
      expect(rejected.ok === false && rejected.reason).toBe("rejected");
      const stale = await git.push(root, "origin", "HEAD:refs/heads/main", { forceWithLease: `refs/heads/main:${seen}` });
      expect(stale.ok === false && stale.reason).toBe("stale");
      expect(await git.revParse(root, "HEAD")).toBe(mine);
      expect(sh(remote, "rev-parse", "main")).toBe(sh(other, "rev-parse", "HEAD"));
    });

    t("ancestry and divergence (BS1)", async () => {
      const { root, git } = repo();
      const init = sh(root, "rev-parse", "HEAD");
      sh(root, "checkout", "-q", "-b", "side");
      commitFile(root, "b.txt", "b\n");
      sh(root, "checkout", "-q", "main");
      commitFile(root, "c.txt", "c\n");
      commitFile(root, "d.txt", "d\n");
      expect(await git.isAncestor(root, init, "side")).toBe(true);
      expect(await git.isAncestor(root, "side", "main")).toBe(false);
      expect(await git.divergence(root, "main", "side")).toEqual({ merge_base: init, ahead: 2, behind: 1 });
      expect(await git.divergence(root, "main", "main")).toMatchObject({ ahead: 0, behind: 0 });
    });

    t("merge: clean merges commit, conflicts abort and name the paths; mergeTree agrees (BS1, BS3)", async () => {
      const { root, git } = repo();
      sh(root, "checkout", "-q", "-b", "clean");
      commitFile(root, "b.txt", "b\n");
      sh(root, "checkout", "-q", "main");
      sh(root, "checkout", "-q", "-b", "clash");
      commitFile(root, "a.txt", "clash\n");
      sh(root, "checkout", "-q", "main");
      commitFile(root, "a.txt", "main\n");
      expect(await git.mergeTree(root, "main", "clean")).toEqual([]);
      expect(await git.mergeTree(root, "main", "clash")).toEqual(["a.txt"]);
      const merged = await git.merge(root, "clean", { message: "Merge clean", trailers: { "Norn-Story": "gh-1" } });
      expect(merged).toEqual({ ok: true, head: sh(root, "rev-parse", "HEAD") });
      expect(sh(root, "log", "-1", "--format=%P").split(" ")).toHaveLength(2);
      const before = sh(root, "rev-parse", "HEAD");
      expect(await git.merge(root, "clash", { message: "Merge clash", trailers: {} })).toEqual({ ok: false, conflict: true, files: ["a.txt"] });
      expect(await git.inProgress(root)).toEqual({ operation: null, unmerged: [] });
      expect(sh(root, "rev-parse", "HEAD")).toBe(before);
      expect((await git.status(root)).clean).toBe(true);
    });

    t("conflictMarkers finds marker lines (H1)", async () => {
      const { root, git } = repo();
      writeFileSync(join(root, "a.txt"), "<<<<<<< ours\none\n=======\ntwo\n>>>>>>> theirs\n");
      expect(await git.conflictMarkers(root, { paths: ["a.txt"] })).toEqual([
        { path: "a.txt", line: 1 },
        { path: "a.txt", line: 5 },
      ]);
      expect(await git.conflictMarkers(root, { paths: [] })).toEqual([]);
      expect(await git.conflictMarkers(root, { rev: "HEAD" })).toEqual([]);
    });

    t("outgoingConflictMarkers names marked files changed by commits not on the remote (BS5.2)", async () => {
      const { root, git } = repo();
      const marked = "<<<<<<< HEAD\none\n=======\ntwo\n>>>>>>> main\n";
      // a pushed file with markers is not outgoing
      commitFile(root, "pushed.txt", marked);
      sh(root, "push", "-q", "origin", "main");
      expect(await git.outgoingConflictMarkers(root, "origin", "HEAD")).toEqual([]);
      // an unpushed commit leaving markers is; a lone `=======` (setext heading) is not a marker
      const bad = commitFile(root, "b.txt", marked);
      commitFile(root, "c.md", "Title\n=======\n");
      expect(await git.outgoingConflictMarkers(root, "origin", "HEAD")).toEqual([{ path: "b.txt", commit: bad }]);
      // resolved before the push: nothing to report
      commitFile(root, "b.txt", "resolved\n");
      expect(await git.outgoingConflictMarkers(root, "origin", "HEAD")).toEqual([]);
      sh(root, "push", "-q", "origin", "main");
      expect(await git.outgoingConflictMarkers(root, "origin", "HEAD")).toEqual([]);
    });

    t("baseMergeCommit is the merge that brought base into head, or null (BS5)", async () => {
      const { root, git } = repo();
      sh(root, "checkout", "-q", "-b", "feature");
      commitFile(root, "b.txt", "b\n");
      // base not merged into head yet
      sh(root, "checkout", "-q", "main");
      commitFile(root, "c.txt", "c\n");
      expect(await git.baseMergeCommit(root, "main", "feature")).toBeNull();
      // head merges base in, then moves on and merges base again: the first merge is the one
      sh(root, "checkout", "-q", "feature");
      sh(root, "merge", "-q", "--no-ff", "--no-edit", "main");
      const first = sh(root, "rev-parse", "HEAD");
      commitFile(root, "d.txt", "d\n");
      sh(root, "checkout", "-q", "main");
      commitFile(root, "e.txt", "e\n");
      const baseTip = sh(root, "rev-parse", "HEAD");
      sh(root, "checkout", "-q", "feature");
      sh(root, "merge", "-q", "--no-ff", "--no-edit", "main");
      expect(await git.baseMergeCommit(root, baseTip, "feature")).toBe(sh(root, "rev-parse", "HEAD"));
      expect(await git.baseMergeCommit(root, sh(root, "rev-parse", "main~1"), "feature")).toBe(first);
      // reached without a merge (a fast-forward descendant): null
      sh(root, "checkout", "-q", "-b", "linear", "main");
      commitFile(root, "f.txt", "f\n");
      expect(await git.baseMergeCommit(root, "main", "linear")).toBeNull();
    });

    t("diffStat summarises the files a range changes", async () => {
      const { root, git } = repo();
      const init = sh(root, "rev-parse", "HEAD");
      commitFile(root, "a.txt", "one\ntwo\n");
      commitFile(root, "b.txt", "b\n");
      const stat = await git.diffStat(root, `${init}..HEAD`);
      expect(stat).toContain("a.txt");
      expect(stat).toContain("b.txt");
      expect(stat).toContain("2 files changed");
      expect((await git.diffStat(root, "HEAD..HEAD")).trim()).toBe("");
    });

    t("fastForward moves only when it can", async () => {
      const { root, git } = repo();
      const init = sh(root, "rev-parse", "HEAD");
      sh(root, "checkout", "-q", "-b", "ahead");
      const tip = commitFile(root, "b.txt", "b\n");
      sh(root, "checkout", "-q", "main");
      expect(await git.fastForward(root, "ahead")).toEqual({ ok: true });
      expect(sh(root, "rev-parse", "HEAD")).toBe(tip);
      sh(root, "checkout", "-q", "-b", "behind", init);
      commitFile(root, "c.txt", "c\n");
      expect(await git.fastForward(root, "ahead")).toEqual({ ok: false });
    });

    t("remotes and commonDir: the repo's remotes and the git dir its worktrees share", async () => {
      const { base, root, git } = repo();
      expect(await git.remotes(root)).toEqual(["origin"]);
      sh(root, "remote", "add", "upstream", join(base, "remote.git"));
      expect((await git.remotes(root)).sort()).toEqual(["origin", "upstream"]);
      expect(await git.commonDir(root)).toBe(join(root, ".git"));
      const wt = join(base, "wt");
      await git.worktreeAdd(root, wt, "gh-1-wt", { from: "main" });
      expect(await git.commonDir(wt)).toBe(join(root, ".git"));
    });

    t("hasRef, hasPath, show and lsTree read refs and files of a revision", async () => {
      const { root, git } = repo();
      sh(root, "checkout", "-q", "-b", "side");
      mkdirSync(join(root, "d", "e"), { recursive: true });
      writeFileSync(join(root, "d", "x.txt"), "x\n");
      writeFileSync(join(root, "d", "e", "y.txt"), "y\n");
      commitFile(root, "a.txt", "side\n");
      sh(root, "checkout", "-q", "main");
      expect(await git.hasRef(root, "refs/heads/side")).toBe(true);
      expect(await git.hasRef(root, "refs/remotes/origin/main")).toBe(true);
      expect(await git.hasRef(root, "refs/heads/nope")).toBe(false);
      expect(await git.hasPath(root, "refs/heads/side", "d/x.txt")).toBe(true);
      expect(await git.hasPath(root, "refs/heads/main", "d/x.txt")).toBe(false);
      expect(await git.hasPath(root, "refs/heads/nope", "a.txt")).toBe(false);
      expect(await git.show(root, "refs/heads/side", "a.txt")).toBe("side\n");
      expect(await git.show(root, "refs/heads/main", "a.txt")).toBe("one\n");
      expect(await git.show(root, "refs/heads/main", "d/x.txt")).toBeNull();
      expect(await git.lsTree(root, "refs/heads/side", "d/")).toEqual(["e", "x.txt"]);
      expect(await git.lsTree(root, "refs/heads/main", "d/")).toBeNull();
    });

    t("listRefs takes several prefixes in one call", async () => {
      const { root, git } = repo();
      const head = sh(root, "rev-parse", "HEAD");
      await git.createBranch(root, "gh-1-x", "main");
      sh(root, "update-ref", "refs/norn/claims/gh-1", head);
      const refs = await git.listRefs(root, ["refs/heads/", "refs/remotes/"]);
      expect(refs.map((r) => r.ref).sort()).toEqual(["refs/heads/gh-1-x", "refs/heads/main", "refs/remotes/origin/HEAD", "refs/remotes/origin/main"]);
      expect(refs.every((r) => r.sha === head)).toBe(true);
      expect(await git.listRefs(root, "refs/heads/")).toEqual(refs.filter((r) => r.ref.startsWith("refs/heads/")));
    });

    t("firstParentLog: first-parent commits with dates and one trailer (Q6, C4)", async () => {
      const { root, git } = repo();
      const init = sh(root, "rev-parse", "HEAD");
      sh(root, "checkout", "-q", "-b", "side");
      const sideTip = commitFile(root, "s.txt", "s\n");
      sh(root, "checkout", "-q", "main");
      const tagged = await git.commit(root, { message: "norn: tick", trailers: { "Norn-Tick": "01TICK" }, paths: [], allowEmpty: true });
      commitFile(root, "b.txt", "b\n", "person edit");
      sh(root, "merge", "-q", "--no-ff", "--no-edit", "side");
      const log = await git.firstParentLog(root, "HEAD", { exclude: init, limit: 10, trailer: "Norn-Tick" });
      expect(log.map((c) => c.subject)).toEqual(["Merge branch 'side'", "person edit", "norn: tick"]);
      expect(log.map((c) => c.sha)).not.toContain(sideTip);
      expect(log[2]).toMatchObject({ sha: tagged, author: "Norn Contract", trailer: "01TICK" });
      expect(log[1]?.trailer).toBe("");
      for (const c of log) {
        expect(Number.isNaN(Date.parse(c.authored_at))).toBe(false);
        expect(Number.isNaN(Date.parse(c.committed_at))).toBe(false);
      }
      expect(await git.firstParentLog(root, "HEAD", { limit: 1, trailer: "Norn-Tick" })).toHaveLength(1);
      expect(await git.firstParentLog(root, "HEAD", { exclude: "HEAD", limit: 10, trailer: "Norn-Tick" })).toEqual([]);
    });

    t("revList: first-parent and ancestry-path walks, limited and reversed", async () => {
      const { root, git } = repo();
      const init = sh(root, "rev-parse", "HEAD");
      sh(root, "checkout", "-q", "-b", "side");
      const side = commitFile(root, "s.txt", "s\n");
      sh(root, "checkout", "-q", "main");
      const b = commitFile(root, "b.txt", "b\n");
      sh(root, "merge", "-q", "--no-ff", "--no-edit", "side");
      const merge = sh(root, "rev-parse", "HEAD");
      const c = commitFile(root, "c.txt", "c\n");
      expect(await git.revList(root, "HEAD", { firstParent: true })).toEqual([c, merge, b, init]);
      expect(await git.revList(root, "HEAD", { firstParent: true, limit: 2 })).toEqual([c, merge]);
      expect(await git.revList(root, `${side}..HEAD`, { ancestryPath: true, firstParent: true, reverse: true })).toEqual([merge, c]);
      expect(await git.revList(root, "HEAD..HEAD")).toEqual([]);
    });

    t("fetch: quiet or not; a missing remote branch fails and says so", async () => {
      const { base, remote, root, git } = repo();
      const other = join(base, "other");
      sh(base, "clone", "-q", remote, other);
      const tip = commitFile(other, "o.txt", "o\n");
      sh(other, "push", "-q", "origin", "HEAD:refs/heads/gh-2-o");
      await git.fetch(root, "origin", ["+refs/heads/gh-2-o:refs/remotes/origin/gh-2-o"], { quiet: true });
      expect(await git.readRef(root, "refs/remotes/origin/gh-2-o")).toBe(tip);
      await git.fetch(root, "origin", [], { quiet: true });
      await git.fetch(root, "origin", ["+refs/heads/main:refs/remotes/origin/main"]);
      const err = await git.fetch(root, "origin", ["+refs/heads/gh-9-none:refs/remotes/origin/gh-9-none"], { quiet: true }).then(() => null, (e: unknown) => e as Error);
      expect(err?.message).toMatch(/couldn't find remote ref/i);
    });

    t("worktreeAddDetached checks out a detached HEAD; worktreePrune forgets removed directories", async () => {
      const { base, root, git } = repo();
      const head = sh(root, "rev-parse", "HEAD");
      const wt = join(base, "detached");
      await git.worktreeAddDetached(root, wt, "refs/remotes/origin/main");
      expect((await git.worktreeList(root)).find((w) => w.path === wt)).toMatchObject({ branch: null, head });
      expect((await git.status(wt)).branch).toBeNull();
      rmSync(wt, { recursive: true, force: true });
      expect((await git.worktreeList(root)).find((w) => w.path === wt)?.prunable).toBe(true);
      await git.worktreePrune(root);
      expect((await git.worktreeList(root)).map((w) => w.path)).toEqual([root]);
    });

    t("version names git; remoteBranches lists the remote's branches matching a pattern", async () => {
      const { base, root, git } = repo();
      expect(await git.version(root)).toMatch(/^git version \d+\.\d+/);
      sh(root, "push", "-q", "origin", "main:refs/heads/gh-4-one", "main:refs/heads/gh-4/01-a", "main:refs/heads/gh-40-x");
      expect(await git.remoteBranches(root, "origin", "refs/heads/gh-4-*")).toEqual(["gh-4-one"]);
      expect(await git.remoteBranches(root, "origin", "refs/heads/gh-5-*")).toEqual([]);
      const err = await git.remoteBranches(root, join(base, "nowhere.git"), "refs/heads/*").then(() => null, (e: unknown) => e as Error);
      expect(err?.message).toMatch(/ls-remote/);
    });

    t("changedPaths lists what two revisions change; checkoutPaths and untrack put paths back", async () => {
      const { root, git } = repo();
      const from = sh(root, "rev-parse", "HEAD");
      writeFileSync(join(root, "new file.txt"), "x\n");
      commitFile(root, "a.txt", "changed\n", "two");
      expect((await git.changedPaths(root, from, "HEAD")).sort()).toEqual(["a.txt", "new file.txt"]);
      await git.checkoutPaths(root, from, ["a.txt"]);
      expect(readFileSync(join(root, "a.txt"), "utf8")).toBe("one\n");
      await git.untrack(root, ["new file.txt", "not-tracked.txt"]);
      expect(sh(root, "ls-files", "--", "new file.txt")).toBe("");
      expect(readFileSync(join(root, "new file.txt"), "utf8")).toBe("x\n");
    });

    t("move stages a rename of a tracked file and leaves an untracked one; stage adds paths to the index", async () => {
      const { root, git } = repo();
      mkdirSync(join(root, "to"));
      expect(await git.move(root, "a.txt", "to/a.txt")).toBe(true);
      expect(readFileSync(join(root, "to/a.txt"), "utf8")).toBe("one\n");
      expect(sh(root, "status", "--porcelain")).toBe("R  a.txt -> to/a.txt");
      writeFileSync(join(root, "loose.txt"), "l\n");
      expect(await git.move(root, "loose.txt", "to/loose.txt")).toBe(false);
      expect(readFileSync(join(root, "loose.txt"), "utf8")).toBe("l\n");
      await git.stage(root, ["loose.txt"]);
      expect(sh(root, "status", "--porcelain")).toBe("A  loose.txt\nR  a.txt -> to/a.txt");
      expect(sh(root, "rev-list", "--count", "HEAD")).toBe("1");
    });
  });
}
