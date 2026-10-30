/** W2 integrate, BS3 update and BS3.3a remote sync (runtime/integrate.ts) against real temp repos with a bare remote (X4). */
import { afterAll, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { git as gitAdapter } from "@norn/adapters";
import type { GitPort } from "@norn/core";
import { integrate, syncRemoteBranch, update } from "../src/runtime/integrate.ts";

const { bunExec, createGit } = gitAdapter;

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

describe("integrate (W2, K6)", () => {
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

  test("conflict resolved by merging the story branch stays resolved (gh-80)", async () => {
    const { story, slice } = await storyAndSlice();
    writeFileSync(join(story, "a.txt"), "story side\n");
    await git.commit(story, { message: "story edit", trailers: {} });
    writeFileSync(join(slice, "a.txt"), "slice side\n");
    await git.commit(slice, { message: "slice edit", trailers: {} });
    expect(await integrate(git, { sliceCwd: slice, storyBranch: "gh-4-s" })).toEqual({ outcome: "conflict", files: ["a.txt"] });
    // the merge step (norn-merge: merge by default) brings the story branch in and resolves it
    expect((await bunExec(["git", "merge", "--no-ff", "gh-4-s"], { cwd: slice, env: ENV })).code).toBe(1);
    writeFileSync(join(slice, "a.txt"), "both sides\n");
    await sh(slice, "commit", "-qam", "resolve");
    expect(await git.isAncestor(slice, "gh-4-s", "HEAD")).toBe(true);
    const res = await integrate(git, { sliceCwd: slice, storyBranch: "gh-4-s" });
    expect(res.outcome).toBe("done");
    expect(await sh(story, "show", "HEAD:a.txt")).toBe("both sides");
    expect((await git.status(story)).clean).toBe(true);
  });

  test("the resolution stays when the story branch moves on after the merge step (gh-80)", async () => {
    const { story, slice } = await storyAndSlice();
    writeFileSync(join(story, "a.txt"), "story side\n");
    await git.commit(story, { message: "story edit", trailers: {} });
    writeFileSync(join(slice, "a.txt"), "slice side\n");
    await git.commit(slice, { message: "slice edit", trailers: {} });
    expect((await bunExec(["git", "merge", "--no-ff", "gh-4-s"], { cwd: slice, env: ENV })).code).toBe(1);
    writeFileSync(join(slice, "a.txt"), "both sides\n");
    await sh(slice, "commit", "-qam", "resolve");
    // another slice integrates while the merge step ran
    writeFileSync(join(story, "b.txt"), "other slice\n");
    await git.commit(story, { message: "other slice", trailers: {} });
    const res = await integrate(git, { sliceCwd: slice, storyBranch: "gh-4-s", trailers: { "Norn-Tick": "t1" } });
    expect(res.outcome).toBe("done");
    expect(await sh(story, "show", "HEAD:a.txt")).toBe("both sides");
    expect(await sh(story, "show", "HEAD:b.txt")).toBe("other slice");
    expect(await sh(story, "log", "-1", "--format=%(trailers:key=Norn-Tick,valueonly)")).toBe("t1");
    expect((await git.status(story)).clean).toBe(true);
  });
});

describe("update and remote sync (BS3, BS3.3a)", () => {
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

  test("H1: update never aborts or concludes a merge in progress", async () => {
    const { wt, head } = await midMerge();
    expect(await run(wt, await baseMoves("b.txt", "b\n"))).toEqual({ outcome: "stuck", reason: "merge in progress in the story worktree" });
    expect(await git.revParse(wt, "HEAD")).toBe(head);
    expect(await git.inProgress(wt)).toEqual({ operation: "merge", unmerged: ["a.txt"] });
  });
});
