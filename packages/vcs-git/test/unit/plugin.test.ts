import { describe, expect, test } from "bun:test";
import { memoryHost } from "@norn/conformance";
import { createVcs, vcsProblems } from "@norn/plugin-api";
import { gitVcsFactory, vcsGitPlugin, worktreePath } from "../../src/index.ts";

describe("norn-vcs-git", () => {
  test("provides vcs git and the git step kinds", () => {
    expect(Object.keys(vcsGitPlugin.provides.vcs ?? {})).toEqual(["git"]);
    expect(Object.keys(vcsGitPlugin.provides.stepKinds ?? {}).sort()).toEqual(["integrate", "push", "update-branch", "verify-base"]);
  });

  test("its step kinds work over the vcs slot, so a workflow names them vcs.<kind>", () => {
    expect(Object.values(vcsGitPlugin.provides.stepKinds ?? {}).map((k) => k.slot)).toEqual(["vcs", "vcs", "vcs", "vcs"]);
  });

  test("the git vcs fits the contract and keeps worktrees under the machine folder, a slice beside its story", () => {
    const ctx = memoryHost();
    const made = createVcs(gitVcsFactory, ctx, {});
    if (!made.ok) throw new Error(made.failure.message);
    expect(vcsProblems(made.value)).toEqual([]);
    expect(made.value.worktree.path("gh-12/03")).toBe(worktreePath(ctx, "gh-12/03"));
    expect(worktreePath(ctx, "gh-12/03")).toBe(`${ctx.repo.dataDir}/worktrees/gh-12-03`);
    expect(createVcs(gitVcsFactory, ctx, { remot: "x" }).ok).toBe(false);
  });
});
