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

  test("fetch prunes and takes no tags", async () => {
    const h = gitHost([
      ["remote", { stdout: "origin\n" }],
      ["fetch", { code: 0 }],
    ]);
    expect((await vcsOf(h.ctx).fetch()).ok).toBe(true);
    expect(h.calls[1]).toEqual(["git", "fetch", "--quiet", "--no-tags", "--prune", "origin"]);
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
      ["rev-parse --verify --quiet --end-of-options refs/remotes/upstream/gh-12-login", { stdout: SHA }],
      ["worktree add", {}],
    ]);
    expect((await vcsOf(h.ctx, "upstream").worktree.ensure("gh-12", "gh-12-login", "origin/main")).ok).toBe(true);
    expect(h.calls.at(-1)).toEqual(["git", "worktree", "add", "--quiet", "-b", "gh-12-login", `${DATA}/worktrees/gh-12`, "refs/remotes/upstream/gh-12-login"]);
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
