/**
 * GitPort contract (ports.ts), the subset norn's cli, store and view call today: roots and status,
 * revParse, commit with trailers (S4) and its H1 refusal, branches, worktrees, ref CAS (T2/T3),
 * push and its stale result, ancestry and divergence (BS1), merge and merge-tree (BS1/BS3),
 * conflict markers (H1) and fast-forward. Run against real temp repos with a bare remote.
 */
import { afterAll, describe, expect } from "bun:test";
import { mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
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
  | "fastForward moves only when it can";

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
      expect(await git.worktreeRoot(root)).toBe(root);
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
      expect(await git.worktreeRoot(wt)).toBe(wt);
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
  });
}
