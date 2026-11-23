/**
 * The snapshot a step that may not keep code is checked against, over real git: what it notes, what
 * an agent's change moves, and putting the checkout back.
 */
import { describe, expect, test } from "bun:test";
import { chmodSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, statSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { createNodeHost } from "@norn/host-node";
import { createGitVcs } from "../../src/index.ts";
import { commit, git, value, world } from "./world.ts";

const EMPTY_TREE = "4b825dc642cb6eb9a060e54bf8d69288fbee4904";

/** The worktree's own git dir, where its index and the throwaway index live. */
async function gitDir(path: string): Promise<string> {
  return git(path, "rev-parse", "--path-format=absolute", "--git-dir");
}

async function indexFile(path: string): Promise<string> {
  return git(path, "rev-parse", "--path-format=absolute", "--git-path", "index");
}

/** The throwaway index files a snapshot left behind in the worktree's git dir. */
async function leftovers(path: string, keep: readonly string[] = []): Promise<string[]> {
  return readdirSync(await gitDir(path)).filter((n) => n.startsWith("norn-snapshot-index") && !keep.includes(n));
}

/** Push a file's mtime an hour ahead: a same-second touch leaves the entry racily clean, which git refreshes anyway. */
function touchAhead(file: string): void {
  const later = new Date(Date.now() + 3_600_000);
  utimesSync(file, later, later);
}

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

  test("a tracked file touched without a change moves no part of it, and taking it writes neither the worktree's index nor a ref", async () => {
    const w = await world();
    const { path } = value(await w.vcs.worktree.ensure("gh-12", "gh-12-login", "origin/main"));
    await git(path, "update-index", "-q", "--refresh");
    const before = value(await w.vcs.snapshot!(path));
    const index = await indexFile(path);
    const bytes = readFileSync(index);
    const mtime = statSync(index).mtimeMs;
    touchAhead(join(path, "shared.txt"));
    expect(await git(path, "diff-files", "--name-only")).toBe("shared.txt");
    for (let i = 0; i < 2; i++) {
      expect(value(await w.vcs.snapshot!(path))).toEqual(before);
      expect(value(await w.vcs.changedSince!(path, before.tree))).toEqual([]);
      expect(readFileSync(index).equals(bytes)).toBe(true);
      expect(statSync(index).mtimeMs).toBe(mtime);
      expect(await git(path, "diff-files", "--name-only")).toBe("shared.txt");
      expect(await git(path, "for-each-ref", "refs/stash")).toBe("");
      expect(await leftovers(path)).toEqual([]);
    }
  });

  test("staged and unstaged edits, a staged new file, a deletion and an intent-to-add file are taken with their content; an untracked file never is", async () => {
    const w = await world();
    const { path } = value(await w.vcs.worktree.ensure("gh-12", "gh-12-login", "origin/main"));
    const before = value(await w.vcs.snapshot!(path));
    writeFileSync(join(path, "shared.txt"), "staged\n");
    await git(path, "add", "shared.txt");
    writeFileSync(join(path, "shared.txt"), "staged then edited\n");
    writeFileSync(join(path, "new.txt"), "new\n");
    await git(path, "add", "new.txt");
    rmSync(join(path, "README.md"));
    writeFileSync(join(path, "later.txt"), "intended\n");
    await git(path, "add", "-N", "later.txt");
    writeFileSync(join(path, "scratch.txt"), "untracked\n");
    const taken = value(await w.vcs.snapshot!(path));
    expect(value(await w.vcs.changedSince!(path, before.tree))).toEqual(["README.md", "later.txt", "new.txt", "shared.txt"]);
    expect(await git(path, "ls-tree", "-r", "--name-only", taken.tree)).toBe("later.txt\nnew.txt\nshared.txt");
    expect(await git(path, "cat-file", "-p", `${taken.tree}:shared.txt`)).toBe("staged then edited");
    expect(await git(path, "cat-file", "-p", `${taken.tree}:later.txt`)).toBe("intended");
    expect(await git(path, "cat-file", "-p", `${taken.tree}:new.txt`)).toBe("new");
    // the staged and unstaged parts stay apart in the worktree's own index
    expect(await git(path, "diff", "--cached", "--name-only")).toBe("new.txt\nshared.txt");
    expect(await git(path, "diff-files", "--name-only")).toBe("README.md\nlater.txt\nshared.txt");
    expect(await leftovers(path)).toEqual([]);
  });

  test("a checkout a merge stopped in on its conflicts gives no snapshot, a conflict naming the path", async () => {
    const w = await world();
    const { path } = value(await w.vcs.worktree.ensure("gh-12", "gh-12-login", "origin/main"));
    await commit(path, "ours", { "shared.txt": "ours\n" });
    await git(path, "checkout", "-q", "-b", "theirs", "HEAD~1");
    await commit(path, "theirs", { "shared.txt": "theirs\n" });
    await git(path, "checkout", "-q", "gh-12-login");
    const merge = await createNodeHost({ root: path, dataDir: path }).exec(["git", "merge", "-q", "--no-edit", "theirs"], { cwd: path });
    expect(merge.code).not.toBe(0);
    const r = await w.vcs.snapshot!(path);
    expect(r.ok ? null : r.failure.code).toBe("conflict");
    expect(r.ok ? "" : r.failure.message).toContain("unmerged paths");
    expect(r.ok ? "" : r.failure.message).toContain("shared.txt");
    expect(await leftovers(path)).toEqual([]);
    await git(path, "merge", "--abort");
    expect(value(await w.vcs.snapshot!(path)).head).toBe(await git(path, "rev-parse", "HEAD"));
  });

  test("a repo with no commit yet has no head and the empty tree, and a staged file is taken", async () => {
    const dir = realpathSync(mkdtempSync(join(tmpdir(), "norn-vcs-git-")));
    try {
      await git(dir, "init", "-q", "-b", "main", "repo");
      const repo = join(dir, "repo");
      const ctx = createNodeHost({ root: repo, dataDir: join(dir, "machine") });
      const vcs = createGitVcs(ctx, {});
      const empty = value(await vcs.snapshot!(repo));
      expect(empty.head).toBeNull();
      expect(empty.tree).toBe(EMPTY_TREE);
      writeFileSync(join(repo, "f"), "first\n");
      await git(repo, "add", "f");
      const staged = value(await vcs.snapshot!(repo));
      expect(await git(repo, "ls-tree", "--name-only", staged.tree)).toBe("f");
      expect(value(await vcs.changedSince!(repo, EMPTY_TREE))).toEqual(["f"]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("a throwaway index another snapshot left behind changes nothing, and a snapshot leaves none of its own, taken or failed", async () => {
    const w = await world();
    const { path } = value(await w.vcs.worktree.ensure("gh-12", "gh-12-login", "origin/main"));
    const before = value(await w.vcs.snapshot!(path));
    const stale = join(await gitDir(path), "norn-snapshot-index.stale");
    writeFileSync(join(path, "other.txt"), "other\n");
    const env = { ...process.env, GIT_INDEX_FILE: stale };
    const add = Bun.spawnSync(["git", "add", "other.txt"], { cwd: path, env });
    expect(add.exitCode).toBe(0);
    rmSync(join(path, "other.txt"));
    expect(value(await w.vcs.snapshot!(path))).toEqual(before);
    expect(await leftovers(path, ["norn-snapshot-index.stale"])).toEqual([]);
    // a tree git cannot write: an object store it cannot add to
    const objects = join(dirname(await indexFile(w.repo)), "objects");
    writeFileSync(join(path, "shared.txt"), "a blob git must write\n");
    chmodSync(objects, 0o555);
    const dirs = readdirSync(objects).filter((d) => d.length === 2);
    for (const d of dirs) chmodSync(join(objects, d), 0o555);
    try {
      const r = await w.vcs.snapshot!(path);
      expect(r.ok).toBe(false);
    } finally {
      for (const d of dirs) chmodSync(join(objects, d), 0o755);
      chmodSync(objects, 0o755);
    }
    expect(await leftovers(path, ["norn-snapshot-index.stale"])).toEqual([]);
  });

  test("over a split and a sparse index, a touched file leaves the index and every shared index as they were", async () => {
    for (const setting of [["core.splitIndex", "true"], ["index.sparse", "true"]] as const) {
      const w = await world();
      const { path } = value(await w.vcs.worktree.ensure("gh-12", "gh-12-login", "origin/main"));
      await git(path, "config", setting[0], setting[1]);
      if (setting[0] === "index.sparse") {
        mkdirSync(join(path, "far"));
        await commit(path, "a folder", { "far/away.txt": "away\n" });
        // the cone keeps the top level alone, so `far/` is one sparse entry in the index
        await git(path, "sparse-checkout", "set", "--cone", "--sparse-index");
      } else {
        await git(path, "update-index", "--split-index");
      }
      await git(path, "update-index", "-q", "--refresh");
      const before = value(await w.vcs.snapshot!(path));
      const dir = await gitDir(path);
      const indexes = (): Record<string, string> =>
        Object.fromEntries(readdirSync(dir).filter((n) => n === "index" || n.startsWith("sharedindex.")).map((n) => [n, readFileSync(join(dir, n)).toString("hex")]));
      const held = indexes();
      if (setting[0] === "core.splitIndex") expect(Object.keys(held).some((n) => n.startsWith("sharedindex."))).toBe(true);
      else expect((await git(path, "ls-files", "--sparse")).split("\n")).toContain("far/");
      touchAhead(join(path, "shared.txt"));
      expect(value(await w.vcs.snapshot!(path))).toEqual(before);
      expect(indexes()).toEqual(held);
      expect(await leftovers(path)).toEqual([]);
    }
  });
});
