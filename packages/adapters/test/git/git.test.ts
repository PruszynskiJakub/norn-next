/** git adapter against real temp repos with a bare remote (X4). */
import { afterAll, beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { GitPort } from "@norn/core";
import { addedConflictMarkers, bunExec, classifyPush, createGit, gitVersionOk, integrate, parseGitVersion, parseStatusV2, parseWorktreeList, syncRemoteBranch, update } from "../../src/git/index.ts";

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
    expect(await git.worktreeRoot(R.root)).toBe(R.root);
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
    const err = await git.worktreeRoot(join(R.base, "missing")).catch((e) => e);
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
    expect(await git.worktreeRoot(wt)).toBe(wt);
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
    const b1 = await git.writeBlob(R.root, '{"holder":"a"}');
    expect(await git.readBlob(R.root, b1)).toBe('{"holder":"a"}');
    expect(await git.readRef(R.root, ref)).toBeNull();
    expect(await git.updateRef(R.root, { ref, sha: b1, expected: null })).toBe(true);
    expect(await git.updateRef(R.root, { ref, sha: b1, expected: null })).toBe(false); // must not exist
    expect(await git.listRefs(R.root, "refs/norn/claims/")).toEqual([{ ref, sha: b1 }]);
    // acquire on remote: must not exist
    expect(await git.pushRef(R.root, "origin", { ref, sha: b1, expected: null })).toEqual({ ok: true });
    const other = await git.writeBlob(R.root, '{"holder":"b"}');
    const lost = await git.pushRef(R.root, "origin", { ref, sha: other, expected: null });
    expect(lost.ok === false && lost.reason).toBe("stale");
    expect(await git.listRemoteRefs(R.root, "origin", "refs/norn/")).toEqual([{ ref, sha: b1 }]);
    // renew with CAS
    const b2 = await git.writeBlob(R.root, '{"holder":"a","n":2}');
    expect(await git.pushRef(R.root, "origin", { ref, sha: b2, expected: b1 })).toEqual({ ok: true });
    const stale = await git.pushRef(R.root, "origin", { ref, sha: other, expected: b1 });
    expect(stale.ok === false && stale.reason).toBe("stale");
    // unconditional and CAS delete
    expect(await git.pushRef(R.root, "origin", { ref, sha: null, expected: b2 })).toEqual({ ok: true });
    expect(await git.listRemoteRefs(R.root, "origin", "refs/norn/")).toEqual([]);
    expect(await git.pushRef(R.root, "origin", { ref, sha: b1 })).toEqual({ ok: true });
    expect(await git.pushRef(R.root, "origin", { ref, sha: null })).toEqual({ ok: true });
    expect(await git.updateRef(R.root, { ref, sha: null, expected: b1 })).toBe(true);
    expect(await git.readRef(R.root, ref)).toBeNull();
  });
});

describe("git adapter: integrate (W2, K6)", () => {
  async function storyAndSlice() {
    const story = join(R.base, "story");
    const slice = join(R.base, "slice");
    await git.worktreeAdd(R.root, story, "gh-4-s", { from: "main" });
    await git.worktreeAdd(R.root, slice, "gh-4/01-a", { from: "gh-4-s" });
    return { story, slice };
  }

  test("clean: rebase + fast-forward story branch checked out in a worktree", async () => {
    const { story, slice } = await storyAndSlice();
    writeFileSync(join(story, "s.txt"), "story\n");
    await git.commit(story, { message: "story moves", trailers: {} });
    writeFileSync(join(slice, "x.txt"), "slice\n");
    await git.commit(slice, { message: "slice work", trailers: { "Norn-Slice": "gh-4/01" } });
    const res = await integrate(git, { sliceCwd: slice, storyBranch: "gh-4-s" });
    expect(res.outcome).toBe("done");
    const head = res.outcome === "done" ? res.head : "";
    expect(await git.revParse(story, "HEAD")).toBe(head);
    expect((await git.status(story)).clean).toBe(true);
    expect(await git.isAncestor(R.root, "main", head)).toBe(true);
  });

  test("clean: story branch not checked out moves by CAS", async () => {
    const { story, slice } = await storyAndSlice();
    await git.worktreeRemove(R.root, story);
    writeFileSync(join(slice, "x.txt"), "slice\n");
    await git.commit(slice, { message: "slice work", trailers: {} });
    const res = await integrate(git, { sliceCwd: slice, storyBranch: "gh-4-s" });
    expect(res.outcome).toBe("done");
    expect(await git.readRef(R.root, "refs/heads/gh-4-s")).toBe(res.outcome === "done" ? res.head : "x");
  });

  test("conflict: rebase aborted cleanly, files reported, branches untouched", async () => {
    const { story, slice } = await storyAndSlice();
    writeFileSync(join(story, "a.txt"), "story side\n");
    await git.commit(story, { message: "story edit", trailers: {} });
    writeFileSync(join(slice, "a.txt"), "slice side\n");
    const sliceSha = await git.commit(slice, { message: "slice edit", trailers: {} });
    const storySha = await git.revParse(story, "HEAD");
    const res = await integrate(git, { sliceCwd: slice, storyBranch: "gh-4-s" });
    expect(res).toEqual({ outcome: "conflict", files: ["a.txt"] });
    const st = await git.status(slice);
    expect(st).toMatchObject({ clean: true, rebase_in_progress: false, branch: "gh-4/01-a" });
    expect(await git.revParse(slice, "HEAD")).toBe(sliceSha);
    expect(await git.revParse(story, "HEAD")).toBe(storySha);
    expect(await git.fastForward(story, "gh-4/01-a")).toEqual({ ok: false });
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
  const run = (wt: string, baseSha: string, remote: string | null = "origin") =>
    update(git, { cwd: wt, branch: "gh-5-s", baseSha, remote, message: `Update gh-5 from main (${baseSha.slice(0, 7)})`, trailers: TRAILERS });

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

  test("behind with no conflict → one merge commit with the Norn-Tick trailer (acceptance 1)", async () => {
    const wt = await story();
    const base = await baseMoves("b.txt", "b\n");
    const res = await run(wt, base);
    expect(res).toMatchObject({ outcome: "done", merged: true, adopted: null });
    const head = await git.revParse(wt, "HEAD");
    expect(await git.isAncestor(wt, base, head as string)).toBe(true);
    expect(await sh(wt, "log", "-1", "--format=%P")).toContain(base);
    const [c] = await git.log(wt, "-1");
    expect(c?.subject).toBe(`Update gh-5 from main (${base.slice(0, 7)})`);
    expect(c?.trailers["Norn-Tick"]).toBe(TRAILERS["Norn-Tick"]);
    expect((await git.status(wt)).clean).toBe(true);
    // up to date now: done, no commit
    expect(await run(wt, base)).toMatchObject({ outcome: "done", merged: false, head });
  });

  test("conflict → merge aborted, paths reported, worktree clean and head unchanged", async () => {
    const wt = await story();
    writeFileSync(join(wt, "a.txt"), "story side\n");
    const before = await git.commit(wt, { message: "story edits a", trailers: {} });
    const base = await baseMoves("a.txt", "base side\n");
    expect(await run(wt, base)).toEqual({ outcome: "conflict", files: ["a.txt"], adopted: null });
    expect(await git.status(wt)).toMatchObject({ clean: true });
    expect(await git.revParse(wt, "HEAD")).toBe(before);
  });

  test("dirty worktree → stuck", async () => {
    const wt = await story();
    const base = await baseMoves("b.txt", "b\n");
    writeFileSync(join(wt, "wip.txt"), "x\n");
    expect(await run(wt, base)).toEqual({ outcome: "stuck", reason: "worktree dirty" });
  });

  test("remote story branch fast-forwarded by a person → adopted first; diverged → stuck (acceptance 7)", async () => {
    const wt = await story();
    const base = await baseMoves("b.txt", "b\n");
    // a person pressed "Update branch" on the host: the remote story branch has a commit on top
    const other = join(R.base, "other");
    await sh(R.base, "clone", "-q", "-b", "gh-5-s", R.remote, other);
    writeFileSync(join(other, "host.txt"), "host\n");
    await sh(other, "add", "-A");
    await sh(other, "commit", "-q", "-m", "host update");
    await sh(other, "push", "-q", "origin", "gh-5-s");
    const hostSha = await sh(other, "rev-parse", "HEAD");
    const res = await run(wt, base);
    expect(res).toMatchObject({ outcome: "done", merged: true, adopted: hostSha });
    expect(await git.isAncestor(wt, hostSha, (await git.revParse(wt, "HEAD")) as string)).toBe(true);

    // diverged: a local commit and a different remote commit
    await sh(wt, "push", "-q", "origin", "gh-5-s");
    writeFileSync(join(wt, "local.txt"), "l\n");
    await git.commit(wt, { message: "local", trailers: {} });
    await sh(other, "pull", "-q", "--no-rebase", "origin", "gh-5-s");
    writeFileSync(join(other, "remote.txt"), "r\n");
    await sh(other, "add", "-A");
    await sh(other, "commit", "-q", "-m", "remote");
    await sh(other, "push", "-q", "origin", "gh-5-s");
    // BS3.3a (dogfood D4): diverged without a conflict → the remote branch is merged in first (never rebased)
    const remoteSha = await sh(other, "rev-parse", "HEAD");
    const moved = await run(wt, await baseMoves("c.txt", "c\n"));
    expect(moved).toMatchObject({ outcome: "done", merged: true, adopted: remoteSha });
    const take = (await git.log(wt, "-3")).find((c) => c.subject === "Merge origin/gh-5-s into gh-5-s");
    expect(take?.trailers["Norn-Tick"]).toBe(TRAILERS["Norn-Tick"]);
    expect(await git.isAncestor(wt, remoteSha, (await git.revParse(wt, "HEAD")) as string)).toBe(true);

    // diverged into a conflict → stuck naming the paths, the merge aborted and the worktree clean
    await sh(wt, "push", "-q", "origin", "gh-5-s");
    await sh(other, "pull", "-q", "--no-rebase", "origin", "gh-5-s");
    writeFileSync(join(wt, "local.txt"), "local side\n");
    await git.commit(wt, { message: "local again", trailers: {} });
    writeFileSync(join(other, "local.txt"), "remote side\n");
    await sh(other, "commit", "-q", "-am", "remote again");
    await sh(other, "push", "-q", "origin", "gh-5-s");
    expect(await run(wt, await baseMoves("d.txt", "d\n"))).toEqual({ outcome: "stuck", reason: "story branch diverged from origin/gh-5-s; merging it conflicts in local.txt" });
    expect(await git.inProgress(wt)).toEqual({ operation: null, unmerged: [] });
    expect((await git.status(wt)).clean).toBe(true);
  });

  test("BS3.3a: syncRemoteBranch — none, local, adopted, merged", async () => {
    const wt = await story();
    const sync = () => syncRemoteBranch(git, { cwd: wt, branch: "gh-5-s", remote: "origin", message: "Merge origin/gh-5-s into gh-5-s", trailers: TRAILERS });
    expect(await sync()).toMatchObject({ outcome: "local" });
    expect(await syncRemoteBranch(git, { cwd: wt, branch: "nope", remote: "origin", message: "m", trailers: {} })).toEqual({ outcome: "none", remote_sha: null });
    const other = join(R.base, "other2");
    await sh(R.base, "clone", "-q", "-b", "gh-5-s", R.remote, other);
    writeFileSync(join(other, "p.txt"), "person\n");
    await sh(other, "add", "-A");
    await sh(other, "commit", "-q", "-m", "person");
    await sh(other, "push", "-q", "origin", "gh-5-s");
    const p1 = await sh(other, "rev-parse", "HEAD");
    expect(await sync()).toEqual({ outcome: "adopted", remote_sha: p1, head: p1 });
    writeFileSync(join(other, "q.txt"), "person 2\n");
    await sh(other, "add", "-A");
    await sh(other, "commit", "-q", "-m", "person 2");
    await sh(other, "push", "-q", "origin", "gh-5-s");
    writeFileSync(join(wt, "n.txt"), "norn\n");
    await git.commit(wt, { message: "norn: state", trailers: TRAILERS });
    const merged = await sync();
    expect(merged).toMatchObject({ outcome: "merged", remote_sha: await sh(other, "rev-parse", "HEAD") });
    expect((await sh(wt, "log", "-1", "--format=%P")).split(" ")).toHaveLength(2);
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

  test("no remote (host-less, acceptance 11): merges the local base", async () => {
    const wt = await story();
    const base = await baseMoves("b.txt", "b\n");
    expect(await run(wt, base, null)).toMatchObject({ outcome: "done", merged: true });
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
    // the merge is the agent's: update never aborts or concludes it
    expect(await run(wt, await baseMoves("b.txt", "b\n"))).toEqual({ outcome: "stuck", reason: "merge in progress in the story worktree" });
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

  test("H1: addedConflictMarkers needs both an opening and a closing marker in one file", () => {
    const diff = (file: string, ...added: string[]) => [`diff --git a/${file} b/${file}`, `--- a/${file}`, `+++ b/${file}`, "@@ -0,0 +1 @@", ...added.map((l) => `+${l}`)].join("\n");
    expect(addedConflictMarkers([diff("x.ts", "<<<<<<< HEAD", "a", "=======", "b", ">>>>>>> main"), diff("y.md", "<<<<<<< only an opening")].join("\n"))).toEqual(["x.ts"]);
    expect(addedConflictMarkers(diff("z.md", "Heading", "=======", ">>>>>>>no space"))).toEqual([]);
  });

  test("git version gate (BS2)", () => {
    expect(parseGitVersion("git version 2.50.1 (Apple Git-155)")).toEqual([2, 50, 1]);
    expect(gitVersionOk("git version 2.38.0")).toBe(true);
    expect(gitVersionOk("git version 2.37.9")).toBe(false);
    expect(gitVersionOk("git version 3.0")).toBe(true);
    expect(gitVersionOk("nope")).toBe(false);
  });
});

describe("git adapter: parsers", () => {
  test("status v2 rename and unmerged entries", () => {
    const out = ["# branch.oid (initial)", "# branch.head (detached)", "2 R. N... 100644 100644 100644 a b R100 new.txt", "old.txt", "u UU N... 1 1 1 1 a b c both.txt", ""].join("\0");
    const st = parseStatusV2(out, "/r", true);
    expect(st).toMatchObject({ head: null, branch: null, staged: ["new.txt"], unstaged: ["both.txt"], clean: false, rebase_in_progress: true });
  });
  test("worktree list skips bare, flags locked/prunable", () => {
    const out = ["worktree /b", "bare", "", "worktree /w", "HEAD " + "0".repeat(40), "detached", "locked why", "prunable gone", "", ""].join("\0");
    expect(parseWorktreeList(out)).toEqual([{ path: "/w", branch: null, head: null, locked: true, prunable: true }]);
  });
  test("push classification", () => {
    expect(classifyPush({ code: 128, stdout: "", stderr: "fatal: unable to access 'https://x': Could not resolve host: x" }).ok).toBe(false);
    expect(classifyPush({ code: 128, stdout: "", stderr: "fatal: Authentication failed for 'https://x'" })).toMatchObject({ reason: "auth" });
    expect(classifyPush({ code: 128, stdout: "", stderr: "fatal: Could not resolve host: x" })).toMatchObject({ reason: "network" });
  });
});
