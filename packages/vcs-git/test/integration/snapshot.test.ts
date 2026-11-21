/**
 * The snapshot a step that may not keep code is checked against, over real git: what it notes, what
 * an agent's change moves, and putting the checkout back.
 */
import { describe, expect, test } from "bun:test";
import { chmodSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { commit, git, value, world } from "./world.ts";

describe("a snapshot of a unit's checkout", () => {
  test("is the same while nothing changes, and a tracked edit, a commit, a branch, a config or a hook each moves its part alone", async () => {
    const w = await world();
    const { path } = value(await w.vcs.worktree.ensure("gh-12", "gh-12-login", "origin/main"));
    const before = value(await w.vcs.snapshot!(path));
    expect(value(await w.vcs.snapshot!(path))).toEqual(before);
    expect(before.head).toBe(await git(path, "rev-parse", "HEAD"));
    // an untracked file is no tracked change
    writeFileSync(join(path, "notes.txt"), "scratch\n");
    expect(value(await w.vcs.snapshot!(path))).toEqual(before);
    writeFileSync(join(path, "shared.txt"), "edited\n");
    const edited = value(await w.vcs.snapshot!(path));
    expect({ ...edited, tree: before.tree }).toEqual(before);
    expect(edited.tree).not.toBe(before.tree);
    expect(value(await w.vcs.changedSince!(path, before.tree))).toEqual(["shared.txt"]);
    await git(path, "branch", "agent-side");
    expect(value(await w.vcs.snapshot!(path)).refs).not.toBe(before.refs);
    await git(path, "config", "core.hooksPath", "/tmp/elsewhere");
    expect(value(await w.vcs.snapshot!(path)).config).not.toBe(before.config);
    const hook = join(w.repo, ".git", "hooks", "pre-commit");
    writeFileSync(hook, "#!/bin/sh\nexit 0\n");
    chmodSync(hook, 0o755);
    expect(value(await w.vcs.snapshot!(path)).hooks).not.toBe(before.hooks);
  });

  test("a fetch moves no part of it: norn's own and the remote's refs are left out", async () => {
    const w = await world();
    const { path } = value(await w.vcs.worktree.ensure("gh-12", "gh-12-login", "origin/main"));
    const before = value(await w.vcs.snapshot!(path));
    const p = await w.person();
    await commit(p, "base moves", { "other.txt": "x\n" });
    await git(p, "push", "-q", "origin", "main");
    await git(w.repo, "fetch", "-q", "origin");
    await git(w.repo, "update-ref", "refs/norn/v2/runs/gh-12", await git(w.repo, "rev-parse", "HEAD"));
    expect(value(await w.vcs.snapshot!(path))).toEqual(before);
  });

  test("another unit's worktree coming and its branch going move no part of it: the tracking config git writes for a branch is left out", async () => {
    const w = await world();
    const { path } = value(await w.vcs.worktree.ensure("gh-12", "gh-12-login", "origin/main"));
    const before = value(await w.vcs.snapshot!(path));
    const other = value(await w.vcs.worktree.ensure("gh-13", "gh-13-signup", "origin/main"));
    expect(await git(w.repo, "config", "--get", "branch.gh-13-signup.merge")).toBe("refs/heads/main");
    expect(value(await w.vcs.snapshot!(path)).config).toBe(before.config);
    await git(w.repo, "worktree", "remove", "--force", other.path);
    await git(w.repo, "branch", "-D", "gh-13-signup");
    expect(value(await w.vcs.snapshot!(path)).config).toBe(before.config);
    // a key that can redirect a push is still noted
    await git(path, "config", "branch.gh-12-login.pushRemote", "elsewhere");
    expect(value(await w.vcs.snapshot!(path)).config).not.toBe(before.config);
  });

  test("restore drops a commit and puts the paths back as the snapshot held them, a file it lacked removed; again it changes nothing", async () => {
    const w = await world();
    const { path } = value(await w.vcs.worktree.ensure("gh-12", "gh-12-login", "origin/main"));
    const before = value(await w.vcs.snapshot!(path));
    const head = before.head as string;
    await commit(path, "a stub", { "shared.txt": "stubbed\n", "added.ts": "export {};\n" });
    writeFileSync(join(path, "README.md"), "edited after\n");
    const changed = value(await w.vcs.changedSince!(path, before.tree));
    expect(changed).toEqual(["README.md", "added.ts", "shared.txt"]);
    expect(value(await w.vcs.restore!(path, { head, tree: before.tree }, changed))).toBeUndefined();
    expect(await git(path, "rev-parse", "HEAD")).toBe(head);
    expect(value(await w.vcs.changedSince!(path, before.tree))).toEqual([]);
    expect(value(await w.vcs.uncommitted!(path))).toEqual([]);
    expect(value(await w.vcs.restore!(path, { head, tree: before.tree }, changed))).toBeUndefined();
    expect(value(await w.vcs.snapshot!(path))).toEqual(before);
  });
});
