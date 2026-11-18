import { describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { commit, git, moveBase, value, world } from "./world.ts";

describe("git vcs over real git", () => {
  test("worktrees live under the machine folder, are found again, and go without taking their branch", async () => {
    const w = await world();
    const { path } = value(await w.vcs.worktree.ensure("gh-12", "gh-12-login", "origin/main"));
    expect(path).toBe(join(w.dir, "machine", "worktrees", "gh-12"));
    expect(path.startsWith(w.repo)).toBe(false);
    expect(await git(path, "symbolic-ref", "--short", "HEAD")).toBe("gh-12-login");
    expect(value(await w.vcs.worktree.ensure("gh-12", "gh-12-login", "origin/main")).path).toBe(path);
    const slice = value(await w.vcs.worktree.ensure("gh-12/03", "gh-12-03-form", "gh-12-login")).path;
    expect(slice).toBe(join(w.dir, "machine", "worktrees", "gh-12-03"));

    value(await w.vcs.worktree.remove("gh-12"));
    expect(existsSync(path)).toBe(false);
    expect(value(await w.vcs.head("gh-12-login"))).not.toBeNull();
    value(await w.vcs.worktree.remove("gh-12"));
    expect(value(await w.vcs.worktree.ensure("gh-12", "gh-12-login", "origin/main")).path).toBe(path);
  });

  test("a clean merge makes a merge commit and keeps the story's own commits as they were", async () => {
    const w = await world();
    const { path } = value(await w.vcs.worktree.ensure("gh-12", "gh-12-login", "origin/main"));
    const own = await commit(path, "story work", { "story.txt": "story\n" });
    const base = await moveBase(w, { "base.txt": "base\n" });
    const { head } = value(await w.vcs.merge("gh-12-login", "origin/main")) as { head: string };
    expect((await git(path, "rev-list", "--parents", "-n", "1", head)).split(" ")).toEqual([head, own, base]);
    expect(value(await w.vcs.isAncestor(own, head))).toBe(true);
    expect(value(await w.vcs.mergeBase("gh-12-login", "origin/main"))).toBe(base);
  });

  test("a conflicting merge reports its paths and stays in progress for a resolver", async () => {
    const w = await world();
    const { path } = value(await w.vcs.worktree.ensure("gh-12", "gh-12-login", "origin/main"));
    await commit(path, "story edit", { "shared.txt": "one\nstory\nthree\n" });
    await moveBase(w, { "shared.txt": "one\nbase\nthree\n" });
    expect(value(await w.vcs.merge("gh-12-login", "origin/main"))).toEqual({ conflict: { files: ["shared.txt"] } });
    expect(await git(path, "rev-parse", "-q", "--verify", "MERGE_HEAD")).not.toBe("");
    const again = await w.vcs.merge("gh-12-login", "origin/main");
    expect(again.ok ? null : again.failure.code).toBe("conflict");
  });

  test("unfinished names a stopped merge until it is concluded, and nothing for a clean or missing checkout", async () => {
    const w = await world();
    const { path } = value(await w.vcs.worktree.ensure("gh-12", "gh-12-login", "origin/main"));
    expect(value(await w.vcs.unfinished!(path))).toBeNull();
    await commit(path, "story edit", { "shared.txt": "one\nstory\nthree\n" });
    await moveBase(w, { "shared.txt": "one\nbase\nthree\n" });
    value(await w.vcs.merge("gh-12-login", "origin/main"));
    expect(value(await w.vcs.unfinished!(path))).toEqual({ operation: "merge", unmerged: ["shared.txt"] });
    await git(path, "add", "-A");
    expect(value(await w.vcs.unfinished!(path))).toEqual({ operation: "merge", unmerged: [] });
    await git(path, "commit", "-q", "--no-edit");
    expect(value(await w.vcs.unfinished!(path))).toBeNull();
    expect(value(await w.vcs.unfinished!(join(w.dir, "machine", "worktrees", "gone")))).toBeNull();
  });

  test("uncommitted names a change or a new file git does not ignore, never what a .gitignore keeps out, and nothing once committed", async () => {
    const w = await world();
    const { path } = value(await w.vcs.worktree.ensure("gh-12", "gh-12-login", "origin/main"));
    expect(value(await w.vcs.uncommitted!(path))).toEqual([]);
    mkdirSync(join(path, ".agents", "inputs"), { recursive: true });
    writeFileSync(join(path, ".agents", "inputs", ".gitignore"), "*\n");
    writeFileSync(join(path, ".agents", "inputs", "spec.md"), "norn's copy\n");
    expect(value(await w.vcs.uncommitted!(path))).toEqual([]);
    writeFileSync(join(path, "shared.txt"), "edited\n");
    mkdirSync(join(path, "src"));
    writeFileSync(join(path, "src", "new.ts"), "export {};\n");
    expect(value(await w.vcs.uncommitted!(path))).toEqual(["shared.txt", "src/new.ts"]);
    await git(path, "add", "-A");
    await git(path, "commit", "-q", "-m", "work");
    expect(value(await w.vcs.uncommitted!(path))).toEqual([]);
    expect(value(await w.vcs.uncommitted!(join(w.dir, "machine", "worktrees", "gone")))).toEqual([]);
  });

  test("conflictMarkers names a conflict committed unresolved in a base merge, never a doc quoting part of one nor a marker the base holds", async () => {
    const w = await world();
    const { path } = value(await w.vcs.worktree.ensure("gh-12", "gh-12-login", "origin/main"));
    const [open, mid] = ["<".repeat(7), "=".repeat(7)];
    await moveBase(w, { "base-doc.md": `${open} a\n${mid}\n${">".repeat(7)} b\n` });
    await commit(path, "story edit", { "shared.txt": "one\nstory\nthree\n", "doc.md": `# How\n\n${open} ours\n${mid}\n` });
    await moveBase(w, { "shared.txt": "one\nbase\nthree\n" });
    expect(value(await w.vcs.conflictMarkers!("origin/main", "gh-12-login"))).toEqual([]);
    value(await w.vcs.merge("gh-12-login", "origin/main"));
    await git(path, "add", "-A");
    await git(path, "commit", "-q", "--no-edit");
    expect(value(await w.vcs.conflictMarkers!("origin/main", "gh-12-login"))).toEqual([{ path: "shared.txt", line: 2 }]);
    await commit(path, "resolve", { "shared.txt": "one\nstory and base\nthree\n" });
    expect(value(await w.vcs.conflictMarkers!("origin/main", "gh-12-login"))).toEqual([]);
  });

  test("with abortOnConflict a conflicting merge reports its paths and leaves the branch and worktree as they were", async () => {
    const w = await world();
    const { path } = value(await w.vcs.worktree.ensure("gh-12", "gh-12-login", "origin/main"));
    const own = await commit(path, "story edit", { "shared.txt": "one\nstory\nthree\n" });
    await moveBase(w, { "shared.txt": "one\nbase\nthree\n" });
    expect(value(await w.vcs.merge("gh-12-login", "origin/main", { abortOnConflict: true }))).toEqual({ conflict: { files: ["shared.txt"] } });
    expect(await git(path, "rev-parse", "--git-path", "MERGE_HEAD").then((p) => existsSync(join(path, p)) || existsSync(p))).toBe(false);
    expect(await git(path, "rev-parse", "HEAD")).toBe(own);
    expect(await git(path, "status", "--porcelain")).toBe("");
  });

  test("push with a lease lands on the bare remote, and a stale lease never overwrites a person's push", async () => {
    const w = await world();
    const { path } = value(await w.vcs.worktree.ensure("gh-12", "gh-12-login", "origin/main"));
    const first = await commit(path, "story work", { "story.txt": "1\n" });
    value(await w.vcs.push("gh-12-login", { lease: "" }));
    expect(await git(w.remote, "rev-parse", "refs/heads/gh-12-login")).toBe(first);

    const p = await w.person();
    await git(p, "checkout", "-q", "gh-12-login");
    const theirs = await commit(p, "person's fix", { "fix.txt": "fix\n" });
    await git(p, "push", "-q", "origin", "gh-12-login");

    await commit(path, "more story work", { "story.txt": "2\n" });
    const refused = await w.vcs.push("gh-12-login", { lease: first });
    expect(refused.ok ? null : refused.failure).toEqual({ code: "conflict", message: expect.any(String), retryable: false });
    const plain = await w.vcs.push("gh-12-login");
    expect(plain.ok ? null : plain.failure.code).toBe("conflict");
    expect(await git(w.remote, "rev-parse", "refs/heads/gh-12-login")).toBe(theirs);
  });

  test("conflicts is a trial merge: the paths a base move conflicts on, none for a clean one, and nothing moves", async () => {
    const w = await world();
    const wt = value(await w.vcs.worktree.ensure("gh-12", "gh-12-login", "origin/main"));
    const head = await commit(wt.path, "story edits shared", { "shared.txt": "one\nstory\nthree\n" });
    const clean = await moveBase(w, { "other.txt": "o\n" });
    const conflicts = w.vcs.conflicts;
    if (!conflicts) throw new Error("the git vcs tries merges");
    expect(value(await conflicts(head, clean))).toEqual([]);
    const clash = await moveBase(w, { "shared.txt": "one\nbase\nthree\n" });
    expect(value(await conflicts(head, clash))).toEqual(["shared.txt"]);
    expect(await git(wt.path, "rev-parse", "HEAD")).toBe(head);
    expect(await git(wt.path, "status", "--porcelain")).toBe("");
  });

  test("fetch brings the remote's branches into the checkout", async () => {
    const w = await world();
    const p = await w.person();
    const moved = await commit(p, "base moves", { "base.txt": "b\n" });
    await git(p, "push", "-q", "origin", "main");
    value(await w.vcs.fetch());
    expect(value(await w.vcs.head("origin/main"))).toBe(moved);
  });
});
