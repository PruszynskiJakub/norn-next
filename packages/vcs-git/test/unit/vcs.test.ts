import { describe, expect, test } from "bun:test";
import { memoryHost, type ScriptedAnswer, scriptedExec } from "@norn/conformance";
import type { HostContext, Vcs } from "@norn/plugin-api";
import { createGitVcs } from "../../src/index.ts";

const ROOT = "/repo";
const DATA = "/machine/repo";

/** Answers git calls by their argv after `git`, the first matching prefix winning; anything else is unscripted. */
function gitHost(table: Array<[string, ScriptedAnswer]>): { ctx: HostContext; calls: string[][]; cwds: (string | undefined)[] } {
  const exec = scriptedExec((argv) => {
    const line = argv.slice(1).join(" ");
    return table.find(([prefix]) => line.startsWith(prefix))?.[1];
  });
  const ctx = memoryHost({ exec, repo: { root: ROOT, dataDir: DATA } });
  return {
    ctx,
    get calls() {
      return exec.calls.map((c) => c.argv);
    },
    get cwds() {
      return exec.calls.map((c) => c.opts.cwd);
    },
  };
}

const vcsOf = (ctx: HostContext, remote?: string): Vcs => createGitVcs(ctx, remote ? { remote } : {});
const SHA = "a".repeat(40);

describe("git vcs queries", () => {
  test("head resolves a commit at the repo root, null for a ref naming none, a failure when git fails", async () => {
    const h = gitHost([
      ["rev-parse --verify --quiet --end-of-options main^{commit}", { stdout: `${SHA}\n` }],
      ["rev-parse --verify --quiet --end-of-options gone^{commit}", { code: 1 }],
      ["rev-parse --verify --quiet --end-of-options broken^{commit}", { code: 128, stderr: "fatal: not a git repository" }],
    ]);
    const vcs = vcsOf(h.ctx);
    expect(await vcs.head("main")).toEqual({ ok: true, value: SHA });
    expect(await vcs.head("gone")).toEqual({ ok: true, value: null });
    const broken = await vcs.head("broken");
    expect(broken.ok ? null : broken.failure.message).toContain("not a git repository");
    expect(h.cwds.every((c) => c === ROOT)).toBe(true);
  });

  test("remoteRef names the remote's fetched copy of a branch, and null without the remote or the copy", async () => {
    const h = gitHost([
      ["remote", { stdout: "upstream\n" }],
      ["rev-parse --verify --quiet --end-of-options refs/remotes/upstream/main^{commit}", { stdout: `${SHA}\n` }],
      ["rev-parse --verify --quiet --end-of-options refs/remotes/upstream/fresh^{commit}", { code: 1 }],
    ]);
    const vcs = vcsOf(h.ctx, "upstream");
    expect(await vcs.remoteRef?.("main")).toEqual({ ok: true, value: "upstream/main" });
    expect(await vcs.remoteRef?.("fresh")).toEqual({ ok: true, value: null });
    const bare = gitHost([["remote", { stdout: "" }]]);
    expect(await vcsOf(bare.ctx).remoteRef?.("main")).toEqual({ ok: true, value: null });
    expect(bare.calls.map((c) => c[1])).toEqual(["remote"]);
  });

  test("a ref that reads as an option is refused before git runs", async () => {
    const h = gitHost([]);
    const r = await vcsOf(h.ctx).head("--output=/etc/passwd");
    expect(r.ok ? null : r.failure.code).toBe("invalid");
    expect(h.calls).toEqual([]);
  });

  test("isAncestor and mergeBase read git's exit codes", async () => {
    const h = gitHost([
      ["merge-base --is-ancestor a b", { code: 0 }],
      ["merge-base --is-ancestor b a", { code: 1 }],
      ["merge-base a b", { stdout: `${SHA}\n` }],
      ["merge-base a z", { code: 1 }],
    ]);
    const vcs = vcsOf(h.ctx);
    expect(await vcs.isAncestor("a", "b")).toEqual({ ok: true, value: true });
    expect(await vcs.isAncestor("b", "a")).toEqual({ ok: true, value: false });
    expect(await vcs.mergeBase("a", "b")).toEqual({ ok: true, value: SHA });
    expect(await vcs.mergeBase("a", "z")).toEqual({ ok: true, value: null });
  });
});

describe("git vcs merge", () => {
  const wtList = `worktree ${ROOT}\nHEAD ${SHA}\nbranch refs/heads/main\n\nworktree ${DATA}/worktrees/gh-12\nHEAD ${SHA}\nbranch refs/heads/gh-12-login\n\n`;

  test("merges with a merge commit in the branch's worktree and never rebases", async () => {
    let merged = false;
    const exec = scriptedExec((argv) => {
      const line = argv.slice(1).join(" ");
      if (line.startsWith("worktree list")) return { stdout: wtList };
      if (line.startsWith("rev-parse --verify --quiet --end-of-options HEAD")) return { stdout: merged ? "b".repeat(40) : SHA };
      if (line.startsWith("rev-parse")) return { code: 1 };
      if (line.startsWith("status --porcelain")) return { stdout: "" };
      if (line.startsWith("merge --no-ff --no-edit origin/main")) {
        merged = true;
        return { code: 0 };
      }
      return undefined;
    });
    const ctx = memoryHost({ exec, repo: { root: ROOT, dataDir: DATA } });
    expect(await vcsOf(ctx).merge("gh-12-login", "origin/main")).toEqual({ ok: true, value: { head: "b".repeat(40) } });
    const mergeCall = exec.calls.find((c) => c.argv[1] === "merge");
    expect(mergeCall?.opts.cwd).toBe(`${DATA}/worktrees/gh-12`);
    expect(exec.calls.some((c) => c.argv.includes("rebase"))).toBe(false);
  });

  test("a conflict is data naming the paths, and the merge stays in progress for a resolver", async () => {
    let started = false;
    const exec = scriptedExec((argv) => {
      const line = argv.slice(1).join(" ");
      if (line.startsWith("worktree list")) return { stdout: wtList };
      if (line.startsWith("rev-parse --verify --quiet --end-of-options MERGE_HEAD")) return started ? { stdout: SHA } : { code: 1 };
      if (line.startsWith("rev-parse --verify --quiet --end-of-options HEAD")) return { stdout: SHA };
      if (line.startsWith("rev-parse")) return { code: 1 };
      if (line.startsWith("status --porcelain")) return { stdout: "" };
      if (line.startsWith("merge --no-ff")) {
        started = true;
        return { code: 1, stdout: "CONFLICT (content): Merge conflict in a.ts" };
      }
      if (line.startsWith("diff --name-only --diff-filter=U")) return { stdout: "b.ts\na.ts\n" };
      return undefined;
    });
    const ctx = memoryHost({ exec, repo: { root: ROOT, dataDir: DATA } });
    expect(await vcsOf(ctx).merge("gh-12-login", "origin/main")).toEqual({ ok: true, value: { conflict: { files: ["a.ts", "b.ts"] } } });
    expect(exec.calls.some((c) => c.argv.includes("--abort"))).toBe(false);
  });

  test("a branch checked out nowhere, or a worktree with uncommitted changes, is refused before any merge", async () => {
    const h = gitHost([
      ["worktree list", { stdout: wtList }],
      ["rev-parse", { code: 1 }],
      ["status --porcelain", { stdout: " M a.ts\n" }],
    ]);
    const vcs = vcsOf(h.ctx);
    const nowhere = await vcs.merge("gh-99-x", "origin/main");
    expect(nowhere.ok ? null : nowhere.failure.code).toBe("not_found");
    const dirty = await vcs.merge("gh-12-login", "origin/main");
    expect(dirty.ok ? null : dirty.failure).toMatchObject({ code: "conflict", retryable: false });
    expect(h.calls.some((c) => c[1] === "merge")).toBe(false);
  });
});

describe("git vcs unfinished", () => {
  const wtList = `worktree ${ROOT}\nHEAD ${SHA}\nbranch refs/heads/main\n\nworktree ${DATA}/worktrees/gh-12\nHEAD ${SHA}\nbranch refs/heads/gh-12-login\n\n`;
  const WT = `${DATA}/worktrees/gh-12`;

  test("names a merge stopped in a checkout with its unmerged paths, read in that checkout", async () => {
    const h = gitHost([
      ["worktree list", { stdout: wtList }],
      ["rev-parse --verify --quiet --end-of-options MERGE_HEAD", { stdout: `${SHA}\n` }],
      ["diff --name-only --diff-filter=U", { stdout: "b.ts\na.ts\n" }],
    ]);
    expect(await vcsOf(h.ctx).unfinished?.(WT)).toEqual({ ok: true, value: { operation: "merge", unmerged: ["a.ts", "b.ts"] } });
    expect(h.cwds.slice(1).every((c) => c === WT)).toBe(true);
  });

  test("a merge resolved but not concluded is still unfinished; a rebase is named too", async () => {
    const merging = gitHost([
      ["worktree list", { stdout: wtList }],
      ["rev-parse --verify --quiet --end-of-options MERGE_HEAD", { stdout: `${SHA}\n` }],
      ["diff --name-only --diff-filter=U", { stdout: "" }],
    ]);
    expect(await vcsOf(merging.ctx).unfinished?.(WT)).toEqual({ ok: true, value: { operation: "merge", unmerged: [] } });
    const rebasing = gitHost([
      ["worktree list", { stdout: wtList }],
      ["rev-parse --verify --quiet --end-of-options REBASE_HEAD", { stdout: `${SHA}\n` }],
      ["rev-parse", { code: 1 }],
      ["diff --name-only --diff-filter=U", { stdout: "a.ts\n" }],
    ]);
    expect(await vcsOf(rebasing.ctx).unfinished?.(WT)).toEqual({ ok: true, value: { operation: "rebase", unmerged: ["a.ts"] } });
  });

  test("null for a clean checkout, and for a path that is no checkout without running git there", async () => {
    const h = gitHost([
      ["worktree list", { stdout: wtList }],
      ["rev-parse", { code: 1 }],
    ]);
    const vcs = vcsOf(h.ctx);
    expect(await vcs.unfinished?.(WT)).toEqual({ ok: true, value: null });
    const before = h.calls.length;
    expect(await vcs.unfinished?.(`${DATA}/worktrees/gone`)).toEqual({ ok: true, value: null });
    expect(h.calls.slice(before).map((c) => c[1])).toEqual(["worktree"]);
  });
});

describe("git vcs changedPaths", () => {
  test("names every path that differs between two commits, both sides of a rename, sorted", async () => {
    const h = gitHost([["diff --name-only -z --no-renames", { stdout: ["src/b.ts", ".agents/specs/gh-12/notes.md", "a file.txt", ""].join("\0") }]]);
    expect(await vcsOf(h.ctx).changedPaths?.("a1", "b2")).toEqual({ ok: true, value: [".agents/specs/gh-12/notes.md", "a file.txt", "src/b.ts"] });
    expect(h.calls.at(-1)).toEqual(expect.arrayContaining(["a1", "b2"]));
  });

  test("an option-like ref is refused without running git, and a failing diff is a failure", async () => {
    const h = gitHost([["diff", { code: 128, stderr: "fatal: bad revision" }]]);
    const vcs = vcsOf(h.ctx);
    expect((await vcs.changedPaths?.("--output=x", "b2"))?.ok).toBe(false);
    expect(h.calls.length).toBe(0);
    expect((await vcs.changedPaths?.("a1", "b2"))?.ok).toBe(false);
  });
});

describe("git vcs untracked", () => {
  const wtList = `worktree ${ROOT}\nHEAD ${SHA}\nbranch refs/heads/main\n\nworktree ${DATA}/worktrees/gh-12\nHEAD ${SHA}\nbranch refs/heads/gh-12-login\n\n`;
  const WT = `${DATA}/worktrees/gh-12`;

  test("names the files git neither tracks nor ignores, sorted, read in that checkout; nothing for a path that is no checkout", async () => {
    const h = gitHost([
      ["worktree list", { stdout: wtList }],
      ["ls-files --others --exclude-standard -z", { stdout: ["package-lock.json", "a file.txt", "coverage/out.json", ""].join("\0") }],
    ]);
    expect(await vcsOf(h.ctx).untracked?.(WT)).toEqual({ ok: true, value: ["a file.txt", "coverage/out.json", "package-lock.json"] });
    expect(h.cwds.slice(1).every((c) => c === WT)).toBe(true);
    expect(await vcsOf(h.ctx).untracked?.(`${DATA}/worktrees/gone`)).toEqual({ ok: true, value: [] });
  });
});

describe("git vcs uncommitted", () => {
  const wtList = `worktree ${ROOT}\nHEAD ${SHA}\nbranch refs/heads/main\n\nworktree ${DATA}/worktrees/gh-12\nHEAD ${SHA}\nbranch refs/heads/gh-12-login\n\n`;
  const WT = `${DATA}/worktrees/gh-12`;

  test("names every path git does not ignore with a change not committed (staged, unstaged, untracked, both sides of a rename), sorted, read in that checkout", async () => {
    const status = [" M src/b.ts", "A  src/new.ts", "?? notes/todo.md", "R  src/moved.ts", "src/old.ts", "?? a file.txt", ""].join("\0");
    const h = gitHost([
      ["worktree list", { stdout: wtList }],
      ["status --porcelain=v1 -z --untracked-files=all", { stdout: status }],
    ]);
    expect(await vcsOf(h.ctx).uncommitted?.(WT)).toEqual({ ok: true, value: ["a file.txt", "notes/todo.md", "src/b.ts", "src/moved.ts", "src/new.ts", "src/old.ts"] });
    expect(h.cwds.slice(1).every((c) => c === WT)).toBe(true);
  });

  test("a rename on the worktree's side (after `git add -N`) names its from-path whole too", async () => {
    const status = [" R src/moved.ts", "src/old.ts", " M src/c.ts", ""].join("\0");
    const h = gitHost([
      ["worktree list", { stdout: wtList }],
      ["status --porcelain=v1 -z --untracked-files=all", { stdout: status }],
    ]);
    expect(await vcsOf(h.ctx).uncommitted?.(WT)).toEqual({ ok: true, value: ["src/c.ts", "src/moved.ts", "src/old.ts"] });
  });

  test("empty for a clean checkout, and for a path that is no checkout without running git there; a failing status is a failure", async () => {
    const h = gitHost([
      ["worktree list", { stdout: wtList }],
      ["status", { stdout: "" }],
    ]);
    const vcs = vcsOf(h.ctx);
    expect(await vcs.uncommitted?.(WT)).toEqual({ ok: true, value: [] });
    const before = h.calls.length;
    expect(await vcs.uncommitted?.(`${DATA}/worktrees/gone`)).toEqual({ ok: true, value: [] });
    expect(h.calls.slice(before).map((c) => c[1])).toEqual(["worktree"]);
    const broken = gitHost([
      ["worktree list", { stdout: wtList }],
      ["status", { code: 128, stderr: "fatal: index file corrupt" }],
    ]);
    expect((await vcsOf(broken.ctx).uncommitted?.(WT))?.ok).toBe(false);
  });
});

describe("git vcs conflictMarkers", () => {
  // built, never written out, so no line of this file reads as a conflict marker itself
  const OPEN = "<".repeat(7);
  const MID = "=".repeat(7);
  const CLOSE = ">".repeat(7);
  const DIFF = [
    "diff --git a/src/a.ts b/src/a.ts",
    "index 1111111..2222222 100644",
    "--- a/src/a.ts",
    "+++ b/src/a.ts",
    "@@ -3,0 +4 @@ export const x = 1;",
    `+${OPEN} HEAD`,
    "@@ -5 +6,3 @@",
    "-ours",
    `+${MID}`,
    "+theirs",
    `+${CLOSE} origin/main`,
    "diff --git a/docs/merge.md b/docs/merge.md",
    "--- a/docs/merge.md",
    "+++ b/docs/merge.md",
    "@@ -1,0 +2,2 @@",
    `+${OPEN} ours`,
    `+${MID}`,
    "diff --git a/README.md b/README.md",
    "--- a/README.md",
    "+++ b/README.md",
    "@@ -9,0 +10,2 @@",
    "+Title",
    `+${MID}`,
    "diff --git a/new file.txt b/new file.txt",
    "new file mode 100644",
    "--- /dev/null",
    "+++ b/new file.txt",
    "@@ -0,0 +1,7 @@",
    `+${OPEN}`,
    "+a",
    `+${MID}`,
    "+b",
    `+${CLOSE}`,
    `+${OPEN}${OPEN} not a marker`,
    `+${CLOSE} x`,
    "",
  ].join("\n");

  test("names the opening line of each conflict the head's commits added whole (open, separator, close), never a file that only quotes a marker or a setext heading, read from the diff since the merge base", async () => {
    const h = gitHost([["-c core.quotePath=false diff", { stdout: DIFF }]]);
    expect(await vcsOf(h.ctx).conflictMarkers?.("origin/main", "gh-12-login")).toEqual({
      ok: true,
      value: [
        { path: "new file.txt", line: 1 },
        { path: "src/a.ts", line: 4 },
      ],
    });
    const call = h.calls[0] as string[];
    expect(call.slice(-1)).toEqual(["origin/main...gh-12-login"]);
    expect(call).toContain("-U0");
    expect(call).toContain("--no-ext-diff");
    expect(call).toContain("--no-textconv");
    expect(h.cwds).toEqual([ROOT]);
  });

  test("a conflict git wrote with a CRLF file's own line endings is found", async () => {
    const crlf = ["diff --git a/f.bat b/f.bat", "--- a/f.bat", "+++ b/f.bat", "@@ -2 +2,5 @@", "-old\r", `+${OPEN} HEAD\r`, "+ours\r", `+${MID}\r`, "+theirs\r", `+${CLOSE} main\r`, ""].join("\n");
    const h = gitHost([["-c core.quotePath=false diff", { stdout: crlf }]]);
    expect(await vcsOf(h.ctx).conflictMarkers?.("main", "side")).toEqual({ ok: true, value: [{ path: "f.bat", line: 2 }] });
  });

  test("an added line that reads as a file header inside a hunk is content, so a later conflict keeps its own file's path", async () => {
    const diff = ["diff --git a/notes.md b/notes.md", "--- a/notes.md", "+++ b/notes.md", "@@ -0,0 +1,5 @@", "+++ x", `+${OPEN} HEAD`, "+a", `+${MID}`, `+${CLOSE} main`, ""].join("\n");
    const h = gitHost([["-c core.quotePath=false diff", { stdout: diff }]]);
    expect(await vcsOf(h.ctx).conflictMarkers?.("main", "side")).toEqual({ ok: true, value: [{ path: "notes.md", line: 2 }] });
  });

  test("empty when the diff adds no conflict; a ref that reads as an option is refused before git runs; a failing diff is a failure", async () => {
    const h = gitHost([["-c core.quotePath=false diff", { stdout: "" }]]);
    expect(await vcsOf(h.ctx).conflictMarkers?.("main", "gh-12-login")).toEqual({ ok: true, value: [] });
    const refused = await vcsOf(h.ctx).conflictMarkers?.("--output=/tmp/x", "gh-12-login");
    expect(refused?.ok ? null : refused?.failure.code).toBe("invalid");
    expect(h.calls).toHaveLength(1);
    const broken = gitHost([["-c core.quotePath=false diff", { code: 128, stderr: "fatal: bad revision" }]]);
    expect((await vcsOf(broken.ctx).conflictMarkers?.("main", "gone"))?.ok).toBe(false);
  });
});

describe("git vcs push and fetch", () => {
  test("push names the branch on both sides, carries the lease, and is bounded", async () => {
    const exec = scriptedExec((argv) => (argv[1] === "remote" ? { stdout: "origin\n" } : argv[1] === "push" ? { code: 0 } : undefined));
    const ctx = memoryHost({ exec, repo: { root: ROOT, dataDir: DATA } });
    expect(await vcsOf(ctx).push("gh-12-login", { lease: SHA })).toEqual({ ok: true, value: undefined });
    const call = exec.calls.find((c) => c.argv[1] === "push");
    expect(call?.argv).toEqual(["git", "push", "--porcelain", `--force-with-lease=refs/heads/gh-12-login:${SHA}`, "origin", "refs/heads/gh-12-login:refs/heads/gh-12-login"]);
    expect(call?.opts.timeoutMs).toBeGreaterThan(0);
    expect(call?.opts.env?.GIT_TERMINAL_PROMPT).toBe("0");
  });

  test("a refused push is a conflict nobody retries; an unreachable remote may pass later", async () => {
    const rejected = scriptedExec((argv) =>
      argv[1] === "remote" ? { stdout: "upstream\n" } : { code: 1, stdout: "To x\n!\trefs/heads/b:refs/heads/b\t[rejected] (stale info)\nDone\n" },
    );
    const r = await vcsOf(memoryHost({ exec: rejected }), "upstream").push("b", { lease: "" });
    expect(r.ok ? null : r.failure).toMatchObject({ code: "conflict", retryable: false });
    const down = scriptedExec((argv) => (argv[1] === "remote" ? { stdout: "origin\n" } : { code: 128, stderr: "fatal: unable to access" }));
    const d = await vcsOf(memoryHost({ exec: down })).push("b");
    expect(d.ok ? null : d.failure).toMatchObject({ code: "unavailable", retryable: true });
  });

  test("a repo without the remote has nothing to push or fetch", async () => {
    const h = gitHost([["remote", { stdout: "" }]]);
    const vcs = vcsOf(h.ctx);
    expect((await vcs.push("b")).ok).toBe(true);
    expect((await vcs.fetch()).ok).toBe(true);
    expect(h.calls.map((c) => c[1])).toEqual(["remote", "remote"]);
  });

  test("remoteHead reads the fetched remote-tracking ref; no remote or no remote branch is null", async () => {
    const h = gitHost([
      ["remote", { stdout: "upstream\n" }],
      [`rev-parse --verify --quiet --end-of-options refs/remotes/upstream/gh-12-login^{commit}`, { stdout: `${SHA}\n` }],
      ["rev-parse", { code: 1 }],
    ]);
    const vcs = vcsOf(h.ctx, "upstream");
    expect(await vcs.remoteHead?.("gh-12-login")).toEqual({ ok: true, value: SHA });
    expect(await vcs.remoteHead?.("gh-13-other")).toEqual({ ok: true, value: null });
    expect(await vcsOf(gitHost([["remote", { stdout: "" }]]).ctx).remoteHead?.("gh-12-login")).toEqual({ ok: true, value: null });
    expect((await vcs.remoteHead?.("--all"))?.ok).toBe(false);
  });

  test("fetch prunes, takes no tags, and brings the published heads beside the branches", async () => {
    const h = gitHost([
      ["remote", { stdout: "origin\n" }],
      ["fetch", { code: 0 }],
    ]);
    expect((await vcsOf(h.ctx).fetch()).ok).toBe(true);
    expect(h.calls[1]).toEqual(["git", "fetch", "--quiet", "--no-tags", "--prune", "origin", "+refs/heads/*:refs/remotes/origin/*", "+refs/norn/heads/*:refs/norn/remote-heads/origin/*"]);
  });
});

describe("git vcs worktrees", () => {
  const listing = (extra = "") => ({ stdout: `worktree ${ROOT}\nHEAD ${SHA}\nbranch refs/heads/main\n\n${extra}` });

  test("ensure cuts a new branch from the base under the machine folder", async () => {
    const h = gitHost([
      ["worktree prune", {}],
      ["worktree list", listing()],
      ["rev-parse", { code: 1 }],
      ["worktree add", {}],
    ]);
    expect(await vcsOf(h.ctx).worktree.ensure("gh-12", "gh-12-login", "origin/main")).toEqual({ ok: true, value: { path: `${DATA}/worktrees/gh-12` } });
    expect(h.calls.at(-1)).toEqual(["git", "worktree", "add", "--quiet", "-b", "gh-12-login", `${DATA}/worktrees/gh-12`, "origin/main"]);
  });

  test("ensure cuts a branch this clone lacks from the remote's copy, which another machine pushed", async () => {
    const h = gitHost([
      ["worktree prune", {}],
      ["worktree list", listing()],
      ["rev-parse --verify --quiet --end-of-options refs/heads/", { code: 1 }],
      ["rev-parse --verify --quiet --end-of-options refs/norn/remote-heads/", { code: 1 }],
      ["rev-parse --verify --quiet --end-of-options refs/remotes/upstream/gh-12-login", { stdout: SHA }],
      ["worktree add", {}],
    ]);
    expect((await vcsOf(h.ctx, "upstream").worktree.ensure("gh-12", "gh-12-login", "origin/main")).ok).toBe(true);
    expect(h.calls.at(-1)).toEqual(["git", "worktree", "add", "--quiet", "-b", "gh-12-login", `${DATA}/worktrees/gh-12`, "refs/remotes/upstream/gh-12-login"]);
  });

  test("ensure cuts a branch this clone lacks from its published head, the work another holder finished", async () => {
    const h = gitHost([
      ["worktree prune", {}],
      ["worktree list", listing()],
      ["rev-parse --verify --quiet --end-of-options refs/heads/", { code: 1 }],
      ["rev-parse --verify --quiet --end-of-options refs/norn/remote-heads/upstream/gh-12-login", { stdout: SHA }],
      ["rev-parse --verify --quiet --end-of-options refs/remotes/upstream/gh-12-login", { code: 1 }],
      ["worktree add", {}],
    ]);
    expect((await vcsOf(h.ctx, "upstream").worktree.ensure("gh-12", "gh-12-login", "origin/main")).ok).toBe(true);
    expect(h.calls.at(-1)).toEqual(["git", "worktree", "add", "--quiet", "-b", "gh-12-login", `${DATA}/worktrees/gh-12`, "refs/norn/remote-heads/upstream/gh-12-login"]);
  });

  test("ensure checks out an existing branch as it is, and finds a worktree already there", async () => {
    const add = gitHost([
      ["worktree prune", {}],
      ["worktree list", listing()],
      ["rev-parse", { stdout: SHA }],
      ["worktree add", {}],
    ]);
    expect((await vcsOf(add.ctx).worktree.ensure("gh-12/03", "gh-12-03-form", "origin/main")).ok).toBe(true);
    expect(add.calls.at(-1)).toEqual(["git", "worktree", "add", "--quiet", `${DATA}/worktrees/gh-12-03`, "gh-12-03-form"]);

    const there = gitHost([
      ["worktree prune", {}],
      ["worktree list", listing(`worktree /private${DATA}/worktrees/gh-12\nHEAD ${SHA}\nbranch refs/heads/gh-12-login\n\n`)],
      // no other clone carried the unit on, so the worktree there stays as it is
      ["rev-parse --verify --quiet --end-of-options refs/norn/remote-heads/", { code: 1 }],
      ["rev-parse --verify --quiet --end-of-options refs/remotes/", { code: 1 }],
    ]);
    expect(await vcsOf(there.ctx).worktree.ensure("gh-12", "gh-12-login", "origin/main")).toEqual({ ok: true, value: { path: `${DATA}/worktrees/gh-12` } });
    expect(there.calls.some((c) => c[2] === "add")).toBe(false);
  });

  test("ensure refuses a worktree on another branch and a branch checked out elsewhere", async () => {
    const other = gitHost([
      ["worktree prune", {}],
      ["worktree list", listing(`worktree ${DATA}/worktrees/gh-12\nHEAD ${SHA}\nbranch refs/heads/other\n\n`)],
    ]);
    const a = await vcsOf(other.ctx).worktree.ensure("gh-12", "gh-12-login", "origin/main");
    expect(a.ok ? null : a.failure.code).toBe("conflict");
    const elsewhere = gitHost([
      ["worktree prune", {}],
      ["worktree list", listing(`worktree /elsewhere\nHEAD ${SHA}\nbranch refs/heads/gh-12-login\n\n`)],
    ]);
    const b = await vcsOf(elsewhere.ctx).worktree.ensure("gh-12", "gh-12-login", "origin/main");
    expect(b.ok ? null : b.failure.message).toContain("/elsewhere");
  });

  test("remove forces out a registered worktree and is fine with a missing one", async () => {
    const h = gitHost([
      ["worktree list", listing(`worktree ${DATA}/worktrees/gh-12\nHEAD ${SHA}\nbranch refs/heads/gh-12-login\n\n`)],
      ["worktree remove", {}],
      ["worktree prune", {}],
    ]);
    expect((await vcsOf(h.ctx).worktree.remove("gh-12")).ok).toBe(true);
    expect(h.calls[1]).toEqual(["git", "worktree", "remove", "--force", "--force", `${DATA}/worktrees/gh-12`]);
    const missing = gitHost([
      ["worktree list", listing()],
      ["worktree prune", {}],
    ]);
    expect((await vcsOf(missing.ctx).worktree.remove("gh-12")).ok).toBe(true);
    expect(missing.calls.some((c) => c[2] === "remove")).toBe(false);
  });
});

describe("git vcs deleteBranch", () => {
  test("deletes the local branch whatever it holds, at the repo root, and is fine with a missing one", async () => {
    const h = gitHost([
      ["rev-parse --verify --quiet --end-of-options refs/heads/norn/gh-12^{commit}", { stdout: `${SHA}\n` }],
      ["rev-parse --verify --quiet --end-of-options refs/heads/norn/gone^{commit}", { code: 1 }],
      ["branch -D", {}],
    ]);
    const vcs = vcsOf(h.ctx);
    expect(await vcs.deleteBranch?.("norn/gh-12")).toEqual({ ok: true, value: undefined });
    expect(h.calls.at(-1)).toEqual(["git", "branch", "-D", "--end-of-options", "norn/gh-12"]);
    expect(await vcs.deleteBranch?.("norn/gone")).toEqual({ ok: true, value: undefined });
    expect(h.calls.filter((c) => c[1] === "branch")).toHaveLength(1);
    expect(h.cwds.every((c) => c === ROOT)).toBe(true);
  });

  test("a branch that reads as an option is refused before git runs; a branch git will not delete is a failure", async () => {
    const h = gitHost([
      ["rev-parse", { stdout: `${SHA}\n` }],
      ["branch -D", { code: 1, stderr: "error: cannot delete branch 'norn/gh-12' used by worktree at '/x'" }],
    ]);
    const vcs = vcsOf(h.ctx);
    const option = await vcs.deleteBranch?.("-D");
    expect(option?.ok ? null : option?.failure.code).toBe("invalid");
    const used = await vcs.deleteBranch?.("norn/gh-12");
    expect(used?.ok ? null : used?.failure.message).toContain("used by worktree");
  });
});

describe("git vcs snapshots", () => {
  test("a snapshot git cannot take is a failure naming the call, never a partial snapshot", async () => {
    const h = gitHost([
      ["rev-parse --path-format=absolute --git-common-dir", { stdout: "/repo/.git\n" }],
      ["rev-parse --verify --quiet --end-of-options HEAD^{commit}", { stdout: `${SHA}\n` }],
      ["stash create", { code: 128, stderr: "fatal: index file corrupt" }],
    ]);
    const r = await vcsOf(h.ctx).snapshot?.("/wt");
    expect(r?.ok ? null : r?.failure.message).toBe("git stash: fatal: index file corrupt");
    expect(h.cwds.every((c) => c === "/wt")).toBe(true);
  });

  test("a tree or commit git would read as an option is refused before git runs", async () => {
    const h = gitHost([]);
    const vcs = vcsOf(h.ctx);
    expect((await vcs.changedSince?.("/wt", "--output=x"))?.ok).toBe(false);
    expect((await vcs.restore?.("/wt", { head: "-x", tree: SHA }, ["a"]))?.ok).toBe(false);
    expect(h.calls).toEqual([]);
  });
});
