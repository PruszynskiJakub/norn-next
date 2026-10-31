/** git adapter against real temp repos with a bare remote (X4). */
import { afterAll, beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { GitPort } from "@norn/core";
import { NETWORK_TIMEOUT_MS } from "@norn/store";
import { bunExec, createGit } from "../../../src/git/index.ts";

const ENV = {
  GIT_CONFIG_GLOBAL: "/dev/null",
  GIT_CONFIG_NOSYSTEM: "1",
  GIT_AUTHOR_NAME: "Norn Test",
  GIT_AUTHOR_EMAIL: "norn@example.com",
  GIT_COMMITTER_NAME: "Norn Test",
  GIT_COMMITTER_EMAIL: "norn@example.com",
};
const git: GitPort = createGit({ env: ENV });
const tmps: string[] = [];

async function sh(cwd: string, ...args: string[]): Promise<string> {
  const r = await bunExec(["git", ...args], { cwd, env: ENV });
  if (r.code !== 0) throw new Error(`git ${args.join(" ")}: ${r.stderr}`);
  return r.stdout.trim();
}

function tmp(): string {
  const d = realpathSync(mkdtempSync(join(tmpdir(), "norn-git-")));
  tmps.push(d);
  return d;
}

/** bare remote + clone with one commit on main pushed. */
async function setup(): Promise<{ root: string; remote: string; base: string }> {
  const base = tmp();
  const remote = join(base, "remote.git");
  const root = join(base, "repo");
  await sh(base, "init", "--bare", "-b", "main", remote);
  await sh(base, "init", "-b", "main", root);
  await sh(root, "remote", "add", "origin", remote);
  writeFileSync(join(root, "a.txt"), "one\n");
  await sh(root, "add", "-A");
  await sh(root, "commit", "-m", "init");
  await sh(root, "push", "-u", "origin", "main");
  await sh(root, "remote", "set-head", "origin", "-a");
  return { root, remote, base };
}

afterAll(() => {
  for (const d of tmps) rmSync(d, { recursive: true, force: true });
});

let R: { root: string; remote: string; base: string };
beforeEach(async () => {
  R = await setup();
});

describe("git adapter: repo and status", () => {
  test("roots, status, revParse, default branch, lastCommitTime", async () => {
    expect(await git.repoRoot(R.root)).toBe(R.root);
    expect(await git.version(R.root)).toMatch(/^git version \d/);
    expect(await createGit({ env: ENV, bin: join(R.base, "no-git") }).version(R.root)).toBeNull();
    const st = await git.status(R.root);
    expect(st).toMatchObject({ branch: "main", clean: true, upstream: "origin/main", ahead: 0, behind: 0, rebase_in_progress: false });
    writeFileSync(join(R.root, "a.txt"), "two\n");
    writeFileSync(join(R.root, "new file.txt"), "x\n");
    const dirty = await git.status(R.root);
    expect(dirty.clean).toBe(false);
    expect(dirty.unstaged).toEqual(["a.txt"]);
    expect(dirty.untracked).toEqual(["new file.txt"]);
    expect(await git.revParse(R.root, "HEAD")).toMatch(/^[0-9a-f]{40}$/);
    expect(await git.revParse(R.root, "nope")).toBeNull();
    expect(await git.defaultBranch(R.root, "origin")).toBe("main");
    const t = await git.lastCommitTime(R.root);
    expect(typeof t).toBe("number");
    expect(Math.abs((t as number) - Date.now())).toBeLessThan(60_000);
  });

  test("missing cwd yields a typed PortError", async () => {
    const err = await git.commonDir(join(R.base, "missing")).catch((e) => e);
    expect(err.code).toMatch(/^git_/);
    expect(typeof err.retryable).toBe("boolean");
  });
});

describe("git adapter: branches, worktrees, commits", () => {
  test("worktree add/list/remove and branch lifecycle", async () => {
    const wt = join(R.base, "wt-story");
    await git.worktreeAdd(R.root, wt, "gh-1-story", { from: "main" });
    expect(await git.branchExists(R.root, "gh-1-story")).toBe(true);
    const list = await git.worktreeList(R.root);
    expect(list.map((w) => [w.path, w.branch])).toEqual([
      [R.root, "main"],
      [wt, "gh-1-story"],
    ]);
    expect(await git.repoRoot(wt)).toBe(R.root);
    expect(await git.status(wt)).toMatchObject({ path: wt, branch: "gh-1-story" });
    await git.worktreeRemove(R.root, wt);
    expect((await git.worktreeList(R.root)).length).toBe(1);
    await git.createBranch(R.root, "gh-1/01-x", "main");
    expect(await git.branchExists(R.root, "gh-1/01-x")).toBe(true);
    await git.deleteBranch(R.root, "gh-1/01-x");
    await git.deleteBranch(R.root, "gh-1-story", { force: true });
    expect(await git.branchExists(R.root, "gh-1-story")).toBe(false);
  });

  test("commit with trailers (S4), nothing to commit, paths, log", async () => {
    expect(await git.commit(R.root, { message: "noop", trailers: {} })).toBeNull();
    writeFileSync(join(R.root, "a.txt"), "two\n");
    writeFileSync(join(R.root, "b.txt"), "b\n");
    const sha = await git.commit(R.root, {
      message: "step done",
      trailers: { "Norn-Story": "gh-1", "Norn-Slice": "gh-1/01", "Norn-Step": "implement", "Norn-Tick": "01J" },
      paths: ["b.txt"],
    });
    expect(sha).toMatch(/^[0-9a-f]{40}$/);
    const st = await git.status(R.root);
    expect(st.unstaged).toEqual(["a.txt"]); // only b.txt was committed
    const [top] = await git.log(R.root, "HEAD", 1);
    expect(top).toMatchObject({ sha, subject: "step done" });
    expect(top?.trailers).toEqual({ "Norn-Story": "gh-1", "Norn-Slice": "gh-1/01", "Norn-Step": "implement", "Norn-Tick": "01J" });
    const empty = await git.commit(R.root, { message: "empty", trailers: {}, paths: ["b.txt"], allowEmpty: true });
    expect(empty).not.toBe(sha);
    expect((await git.log(R.root, "main~2..main")).length).toBe(2);
    expect(await git.diffStat(R.root, "main~2..main")).toContain("b.txt");
  });
});

describe("git adapter: remote", () => {
  test("push, fetch, branchExists remote, deleteRemoteBranch, stale lease", async () => {
    await git.createBranch(R.root, "gh-2-s", "main");
    expect(await git.push(R.root, "origin", "refs/heads/gh-2-s:refs/heads/gh-2-s")).toEqual({ ok: true });
    expect(await git.branchExists(R.root, "gh-2-s", "remote", "origin")).toBe(true);
    await git.fetch(R.root, "origin", ["+refs/heads/*:refs/remotes/origin/*"]);
    expect(await git.revParse(R.root, "refs/remotes/origin/gh-2-s")).not.toBeNull();
    // lease against a wrong expectation is stale
    writeFileSync(join(R.root, "a.txt"), "x\n");
    await git.commit(R.root, { message: "m", trailers: {} });
    const stale = await git.push(R.root, "origin", "HEAD:refs/heads/gh-2-s", { forceWithLease: `refs/heads/gh-2-s:${"1".repeat(40)}` });
    expect(stale.ok === false && stale.reason).toBe("stale");
    // non-fast-forward is rejected
    await sh(R.root, "reset", "--hard", "HEAD~1");
    writeFileSync(join(R.root, "c.txt"), "c\n");
    await git.commit(R.root, { message: "other", trailers: {} });
    await git.push(R.root, "origin", "HEAD:refs/heads/main");
    await sh(R.root, "reset", "--hard", "HEAD~1");
    writeFileSync(join(R.root, "d.txt"), "d\n");
    await git.commit(R.root, { message: "diverge", trailers: {} });
    const rej = await git.push(R.root, "origin", "HEAD:refs/heads/main");
    expect(rej.ok === false && rej.reason).toBe("rejected");
    expect(await git.deleteRemoteBranch(R.root, "origin", "gh-2-s")).toEqual({ ok: true });
    expect(await git.deleteRemoteBranch(R.root, "origin", "gh-2-s")).toEqual({ ok: true }); // idempotent
    expect(await git.branchExists(R.root, "gh-2-s", "remote", "origin")).toBe(false);
    const net = await git.push(R.root, join(R.base, "nowhere.git"), "HEAD:refs/heads/x");
    expect(net.ok).toBe(false);
  });

  test("refs, blobs and CAS push (T2, T3)", async () => {
    const ref = "refs/norn/claims/gh-3";
    const blob = async (content: string) => (await bunExec(["git", "hash-object", "-w", "--stdin"], { cwd: R.root, env: ENV, stdin: content })).stdout.trim();
    const remoteRefs = async () => (await sh(R.root, "ls-remote", "--refs", "origin", "refs/norn/*")).split("\n").filter(Boolean).map((l) => l.split("\t")[1]);
    const b1 = await blob('{"holder":"a"}');
    expect(await git.readRef(R.root, ref)).toBeNull();
    expect(await git.updateRef(R.root, { ref, sha: b1, expected: null })).toBe(true);
    expect(await git.updateRef(R.root, { ref, sha: b1, expected: null })).toBe(false); // must not exist
    expect(await git.listRefs(R.root, "refs/norn/claims/")).toEqual([{ ref, sha: b1 }]);
    // acquire on remote: must not exist
    expect(await git.pushRef(R.root, "origin", { ref, sha: b1, expected: null })).toEqual({ ok: true });
    const other = await blob('{"holder":"b"}');
    const lost = await git.pushRef(R.root, "origin", { ref, sha: other, expected: null });
    expect(lost.ok === false && lost.reason).toBe("stale");
    expect(await remoteRefs()).toEqual([ref]);
    // renew with CAS
    const b2 = await blob('{"holder":"a","n":2}');
    expect(await git.pushRef(R.root, "origin", { ref, sha: b2, expected: b1 })).toEqual({ ok: true });
    const stale = await git.pushRef(R.root, "origin", { ref, sha: other, expected: b1 });
    expect(stale.ok === false && stale.reason).toBe("stale");
    // unconditional and CAS delete
    expect(await git.pushRef(R.root, "origin", { ref, sha: null, expected: b2 })).toEqual({ ok: true });
    expect(await remoteRefs()).toEqual([]);
    expect(await git.pushRef(R.root, "origin", { ref, sha: b1 })).toEqual({ ok: true });
    expect(await git.pushRef(R.root, "origin", { ref, sha: null })).toEqual({ ok: true });
    expect(await git.updateRef(R.root, { ref, sha: null, expected: b1 })).toBe(true);
    expect(await git.readRef(R.root, ref)).toBeNull();
  });
});

describe("git adapter: base sync (BS1, BS3)", () => {
  /** story worktree on gh-5-s cut from main and pushed; returns its path */
  async function story(): Promise<string> {
    const wt = join(R.base, "story");
    await git.worktreeAdd(R.root, wt, "gh-5-s", { from: "main" });
    writeFileSync(join(wt, "s.txt"), "story\n");
    await git.commit(wt, { message: "story work", trailers: { "Norn-Tick": "T" } });
    await sh(wt, "push", "-q", "origin", "gh-5-s");
    return wt;
  }
  /** a sibling merged into main: commit `file` = `text` on main and push it */
  async function baseMoves(file: string, text: string): Promise<string> {
    writeFileSync(join(R.root, file), text);
    return (await git.commit(R.root, { message: `base: ${file}`, trailers: {} })) as string;
  }
  const TRAILERS = { "Norn-Story": "gh-5", "Norn-Step": "update", "Norn-Tick": "01JBQ6ZK3E8Y4V5W6X7Y8Z9ABC" };

  test("divergence and merge-tree: behind/ahead, clean vs conflicting paths", async () => {
    const wt = await story();
    const clean = await baseMoves("b.txt", "b\n");
    expect(await git.divergence(R.root, "gh-5-s", clean)).toMatchObject({ ahead: 1, behind: 1 });
    expect((await git.divergence(R.root, "gh-5-s", clean)).merge_base).toMatch(/^[0-9a-f]{40}$/);
    expect(await git.mergeTree(R.root, "gh-5-s", clean)).toEqual([]);
    writeFileSync(join(wt, "a.txt"), "story side\n");
    await git.commit(wt, { message: "story edits a", trailers: {} });
    const conflicting = await baseMoves("a.txt", "base side\n");
    expect(await git.mergeTree(R.root, "gh-5-s", conflicting)).toEqual(["a.txt"]);
    expect(await git.divergence(R.root, "gh-5-s", "gh-5-s")).toMatchObject({ ahead: 0, behind: 0 });
  });

  test("BS5.2 (dogfood D5): outgoingConflictMarkers finds markers an unpushed merge commit left, and only those", async () => {
    const wt = await story();
    expect(await git.outgoingConflictMarkers(wt, "origin", "refs/heads/gh-5-s")).toEqual([]);
    // a pushed file with markers (say, a fixture) is not the outgoing commits' doing
    writeFileSync(join(wt, "fixture.txt"), ["<<<<<<< HEAD", "a", "=======", "b", ">>>>>>> x", ""].join("\n"));
    await sh(wt, "add", "-A");
    await sh(wt, "commit", "-q", "-m", "fixture");
    await sh(wt, "push", "-q", "origin", "gh-5-s");
    // an agent concludes a conflicting merge with the markers still in a.txt, then adds a setext heading
    writeFileSync(join(wt, "a.txt"), "story side\n");
    await git.commit(wt, { message: "story edits a", trailers: {} });
    await baseMoves("a.txt", "base side\n");
    expect((await bunExec(["git", "merge", "--no-ff", "main"], { cwd: wt, env: ENV })).code).not.toBe(0);
    await sh(wt, "add", "-A");
    await sh(wt, "commit", "-q", "--no-edit");
    const merge = await sh(wt, "rev-parse", "HEAD");
    // log -p shows a merge no diff; the scan still finds it (first parent)
    expect(await git.outgoingConflictMarkers(wt, "origin", "refs/heads/gh-5-s")).toEqual([{ path: "a.txt", commit: merge }]);
    writeFileSync(join(wt, "doc.md"), "Title\n=======\n\n>>>>>>>no label\n");
    await git.commit(wt, { message: "doc", trailers: {} });
    expect((await git.outgoingConflictMarkers(wt, "origin", "refs/heads/gh-5-s")).map((m) => m.path)).toEqual(["a.txt"]);
    // fixed in a follow-up commit: the head is clean, nothing held
    writeFileSync(join(wt, "a.txt"), "story side\nbase side\n");
    await git.commit(wt, { message: "resolve a", trailers: {} });
    expect(await git.outgoingConflictMarkers(wt, "origin", "refs/heads/gh-5-s")).toEqual([]);
  });

  /** H1: a resolve agent's merge left mid-way: a.txt conflicts, MERGE_HEAD set, markers in the work tree */
  async function midMerge(): Promise<{ wt: string; base: string; head: string }> {
    const wt = await story();
    writeFileSync(join(wt, "a.txt"), "story side\n");
    const head = (await git.commit(wt, { message: "story edits a", trailers: {} })) as string;
    const base = await baseMoves("a.txt", "base side\n");
    const r = await bunExec(["git", "merge", "--no-ff", base], { cwd: wt, env: ENV });
    expect(r.code).not.toBe(0);
    return { wt, base, head };
  }

  test("H1: commit mid-merge stages nothing, concludes nothing and says why", async () => {
    const { wt, head } = await midMerge();
    expect(await git.inProgress(wt)).toEqual({ operation: "merge", unmerged: ["a.txt"] });
    mkdirSync(join(wt, "runs"), { recursive: true });
    writeFileSync(join(wt, "runs", "state.json"), "{}\n");
    for (const spec of [{}, { paths: ["runs"] }])
      await expect(git.commit(wt, { message: "norn: gh-5 resolve waits for input", trailers: TRAILERS, ...spec })).rejects.toMatchObject({ code: "git_operation_in_progress" });
    expect(await git.revParse(wt, "HEAD")).toBe(head);
    expect(await git.inProgress(wt)).toEqual({ operation: "merge", unmerged: ["a.txt"] });
    expect(await sh(wt, "diff", "--cached", "--name-only", "--", "runs")).toBe("");
    await expect(git.merge(wt, "main", { message: "m", trailers: {} })).rejects.toMatchObject({ code: "git_operation_in_progress" });
    expect(await git.inProgress(wt)).toMatchObject({ operation: "merge" });
  });

  test("H1: staged and resolved but not concluded is still in progress", async () => {
    const { wt } = await midMerge();
    writeFileSync(join(wt, "a.txt"), "both sides\n");
    await sh(wt, "add", "a.txt");
    expect(await git.inProgress(wt)).toEqual({ operation: "merge", unmerged: [] });
    await expect(git.commit(wt, { message: "norn", trailers: TRAILERS })).rejects.toMatchObject({ code: "git_operation_in_progress" });
  });

  test("H1: a commit adding conflict markers is refused; markers are found in the tree", async () => {
    const { wt, base } = await midMerge();
    // the agent concluded the merge with markers still in a.txt
    await sh(wt, "add", "-A");
    await sh(wt, "commit", "-q", "--no-edit");
    const merge = await git.revParse(wt, "HEAD");
    expect(await git.inProgress(wt)).toEqual({ operation: null, unmerged: [] });
    expect(await git.baseMergeCommit(wt, base, "HEAD")).toBe(merge);
    expect(await git.conflictMarkers(wt, { paths: ["a.txt"] })).toEqual([
      { path: "a.txt", line: 1 },
      { path: "a.txt", line: 5 },
    ]);
    expect((await git.conflictMarkers(wt, { rev: "HEAD" })).map((m) => m.path)).toEqual(["a.txt", "a.txt"]);
    expect(await git.conflictMarkers(wt, { paths: [] })).toEqual([]);
    // norn's own commit of a file that gained both markers is refused, nothing committed
    writeFileSync(join(wt, "c.txt"), ["<<<<<<< HEAD", "ours", "=======", "theirs", ">>>>>>> main", ""].join("\n"));
    await expect(git.commit(wt, { message: "norn: park", trailers: TRAILERS })).rejects.toMatchObject({ code: "git_conflict_markers" });
    expect(await git.revParse(wt, "HEAD")).toBe(merge);
    // a lone `=======` (a setext heading) is no marker
    writeFileSync(join(wt, "c.txt"), "Title\n=======\n");
    expect(await git.commit(wt, { message: "norn: heading", trailers: TRAILERS })).toMatch(/^[0-9a-f]{40}$/);
    expect(readFileSync(join(wt, "c.txt"), "utf8")).toBe("Title\n=======\n");
  });
});

describe("git adapter: network timeouts (H11)", () => {
  test("fetch, push and ls-remote have the network timeout; local calls have none", async () => {
    const seen: Array<[string, number | undefined]> = [];
    const timed = createGit({ exec: async (argv, opts) => (seen.push([argv[1] as string, opts?.timeoutMs]), { code: 0, stdout: "", stderr: "" }) });
    await timed.fetch("/repo", "origin", ["+refs/heads/main:refs/remotes/origin/main"]);
    await timed.push("/repo", "origin", "refs/heads/x:refs/heads/x");
    await timed.branchExists("/repo", "x", "remote", "origin").catch(() => null);
    await timed.branchExists("/repo", "x", "local").catch(() => null);
    const by = new Map(seen);
    expect(by.get("fetch")).toBe(NETWORK_TIMEOUT_MS);
    expect(by.get("push")).toBe(NETWORK_TIMEOUT_MS);
    expect(by.get("ls-remote")).toBe(NETWORK_TIMEOUT_MS);
    expect(by.get("show-ref")).toBeUndefined();
  });
});
