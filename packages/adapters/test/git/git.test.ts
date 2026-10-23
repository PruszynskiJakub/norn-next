/** git adapter against real temp repos with a bare remote (X4). */
import { afterAll, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { GitPort } from "@norn/core";
import { bunExec, classifyPush, createGit, integrate, parseStatusV2, parseWorktreeList } from "../../src/git/index.ts";

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
