import { describe, expect, test } from "bun:test";
import type { Forge, StepKindInput } from "@norn/plugin-api";
import { integrate, push, updateBranch, verifyBase } from "../../src/index.ts";
import { commit, git, moveBase, value, type World, world } from "./world.ts";

async function story(w: World): Promise<string> {
  return value(await w.vcs.worktree.ensure("gh-12", "gh-12-login", "origin/main")).path;
}

const input = <C>(w: World, worktree: string, config: C, over: Partial<StepKindInput<C>> = {}): StepKindInput<C> => ({
  unit: "gh-12",
  story: "gh-12",
  step: "update",
  config,
  worktree,
  slots: { vcs: w.vcs },
  ...over,
});

/** A forge whose one change on the story branch is open. */
const openForge: Forge = {
  name: "test",
  capabilities: { draft: true, checks: false, raw_urls: false },
  findChanges: async (bs) => ({ ok: true, value: Object.fromEntries(bs.map((b) => [b, { id: 1, state: "open", draft: true, head_branch: b, base_branch: "main", head_sha: "x", title: "t" }])) }),
  checks: async () => ({ ok: true, value: "none" }),
  perform: async () => ({ ok: false, failure: { code: "invalid", message: "not here", retryable: false } }),
};

describe("update-branch over real git", () => {
  test("merges the fetched base without rebasing; the story's commits stay on its first-parent line", async () => {
    const w = await world();
    const wt = await story(w);
    const own = await commit(wt, "story work", { "story.txt": "s\n" });
    const p = await w.person();
    const base = await commit(p, "base moves", { "base.txt": "b\n" });
    await git(p, "push", "-q", "origin", "main");

    const r = value(await updateBranch.run(input(w, wt, {}), w.ctx));
    expect(r.outcome).toBe("done");
    const head = await git(wt, "rev-parse", "HEAD");
    expect((await git(wt, "rev-list", "--parents", "-n", "1", head)).split(" ")).toEqual([head, own, base]);
    expect(await git(wt, "log", "-1", "--format=%s")).toBe(`Update gh-12 from origin/main (${base.slice(0, 7)})`);
    expect(value(await updateBranch.run(input(w, wt, {}), w.ctx))).toMatchObject({ outcome: "done", detail: { merged: false } });
  });

  test("a conflict is aborted, leaving a clean worktree and naming the base commit and the paths", async () => {
    const w = await world();
    const wt = await story(w);
    const before = await commit(wt, "story edit", { "shared.txt": "one\nstory\nthree\n" });
    const base = await moveBase(w, { "shared.txt": "one\nbase\nthree\n" });
    const r = value(await updateBranch.run(input(w, wt, {}), w.ctx));
    expect(r).toEqual({ outcome: "conflict", detail: { base: { ref: "origin/main", sha: base }, conflicts: ["shared.txt"] } });
    expect(await git(wt, "status", "--porcelain")).toBe("");
    expect(await git(wt, "rev-parse", "HEAD")).toBe(before);
  });

  test("after the change took the branch, a clean base merge is the light path and rework is the full one", async () => {
    const w = await world();
    const wt = await story(w);
    await commit(wt, "story work", { "story.txt": "s\n" });
    await git(wt, "push", "-q", "origin", "gh-12-login");
    await moveBase(w, { "base.txt": "b\n" });
    const light = value(await updateBranch.run(input(w, wt, {}, { slots: { vcs: w.vcs, forge: openForge } }), w.ctx));
    expect(light.outcome).toBe("clean");

    await commit(wt, "rework", { "story.txt": "s2\n" });
    await moveBase(w, { "base2.txt": "b\n" });
    const full = value(await updateBranch.run(input(w, wt, {}, { slots: { vcs: w.vcs, forge: openForge } }), w.ctx));
    expect(full.outcome).toBe("done");
  });

  test("commits a person pushed to the story branch are taken in first, and never count as light", async () => {
    const w = await world();
    const wt = await story(w);
    await commit(wt, "story work", { "story.txt": "s\n" });
    await git(wt, "push", "-q", "origin", "gh-12-login");
    const p = await w.person();
    await git(p, "checkout", "-q", "gh-12-login");
    const theirs = await commit(p, "person's fix", { "fix.txt": "f\n" });
    await git(p, "push", "-q", "origin", "gh-12-login");
    const r = value(await updateBranch.run(input(w, wt, {}, { slots: { vcs: w.vcs, forge: openForge } }), w.ctx));
    expect(r).toMatchObject({ outcome: "done", detail: { took_remote: theirs } });
    expect(value(await w.vcs.isAncestor(theirs, "gh-12-login"))).toBe(true);
  });
});

describe("integrate over real git", () => {
  test("merges a finished slice into the story branch in the story's worktree", async () => {
    const w = await world();
    const wt = await story(w);
    const sliceWt = value(await w.vcs.worktree.ensure("gh-12/03", "gh-12-03-form", "gh-12-login")).path;
    const work = await commit(sliceWt, "slice work", { "form.txt": "f\n" });
    await commit(wt, "story moves", { "other.txt": "o\n" });
    const r = value(await integrate.run(input<Record<string, never>>(w, sliceWt, {}, { unit: "gh-12/03", step: "integrate" }), w.ctx));
    expect(r.outcome).toBe("done");
    expect(value(await w.vcs.isAncestor(work, "gh-12-login"))).toBe(true);
    expect(await git(sliceWt, "rev-parse", "HEAD")).toBe(work);
    const again = value(await integrate.run(input<Record<string, never>>(w, sliceWt, {}, { unit: "gh-12/03", step: "integrate" }), w.ctx));
    expect(again).toMatchObject({ outcome: "done", detail: { merged: false } });
  });

  test("a conflicting slice is aborted with its paths and the story branch is untouched", async () => {
    const w = await world();
    const wt = await story(w);
    const sliceWt = value(await w.vcs.worktree.ensure("gh-12/03", "gh-12-03-form", "gh-12-login")).path;
    await commit(sliceWt, "slice edit", { "shared.txt": "one\nslice\nthree\n" });
    const storyHead = await commit(wt, "story edit", { "shared.txt": "one\nstory\nthree\n" });
    const r = value(await integrate.run(input<Record<string, never>>(w, sliceWt, {}, { unit: "gh-12/03", step: "integrate" }), w.ctx));
    expect(r).toMatchObject({ outcome: "conflict", detail: { conflicts: ["shared.txt"] } });
    expect(await git(wt, "rev-parse", "HEAD")).toBe(storyHead);
    expect(await git(wt, "status", "--porcelain")).toBe("");
  });
});

describe("push over real git", () => {
  test("pushes the branch, and refuses once a person pushed since it was last seen", async () => {
    const w = await world();
    const wt = await story(w);
    const first = await commit(wt, "story work", { "story.txt": "1\n" });
    expect(value(await push.run(input(w, wt, {}, { step: "push" }), w.ctx)).outcome).toBe("done");
    expect(await git(w.remote, "rev-parse", "refs/heads/gh-12-login")).toBe(first);
    expect(value(await push.run(input(w, wt, {}, { step: "push" }), w.ctx)).outcome).toBe("done");

    const p = await w.person();
    await git(p, "checkout", "-q", "gh-12-login");
    const theirs = await commit(p, "person's fix", { "fix.txt": "f\n" });
    await git(p, "push", "-q", "origin", "gh-12-login");
    await commit(wt, "more", { "story.txt": "2\n" });
    const refused = await push.run(input(w, wt, {}, { step: "push" }), w.ctx);
    expect(refused.ok ? null : refused.failure.code).toBe("conflict");
    expect(await git(w.remote, "rev-parse", "refs/heads/gh-12-login")).toBe(theirs);
  });

  test("a person's push fetched before ours is merged in, never forced over", async () => {
    const w = await world();
    const wt = await story(w);
    await commit(wt, "story work", { "story.txt": "1\n" });
    expect(value(await push.run(input(w, wt, {}, { step: "push" }), w.ctx)).outcome).toBe("done");

    const p = await w.person();
    await git(p, "checkout", "-q", "gh-12-login");
    const theirs = await commit(p, "person's fix", { "fix.txt": "f\n" });
    await git(p, "push", "-q", "origin", "gh-12-login");
    // the tick fetches before the step, so the tracking ref already holds the person's commit
    value(await w.vcs.fetch());
    expect(await git(wt, "rev-parse", "refs/remotes/origin/gh-12-login")).toBe(theirs);
    const ours = await commit(wt, "more", { "story.txt": "2\n" });
    expect(value(await push.run(input(w, wt, {}, { step: "push" }), w.ctx)).outcome).toBe("done");
    const pushed = await git(w.remote, "rev-parse", "refs/heads/gh-12-login");
    // a merge commit with both sides as parents: the person's commit kept, ours on top, nothing rebased
    expect((await git(w.remote, "rev-list", "--parents", "-n", "1", pushed)).split(" ").slice(1).sort()).toEqual([ours, theirs].sort());
  });
});

describe("verify-base over real git", () => {
  const check = { command: "test -f story.txt && ! grep -q broken base.txt" };

  test("a base move is tested once on the merged tree: green verified, red broken, the same pair waits", async () => {
    const w = await world();
    const wt = await story(w);
    const head = await commit(wt, "story work", { "story.txt": "s\n" });
    const step = (cfg = check) => verifyBase.run(input(w, wt, cfg, { step: "verify" }), w.ctx);

    expect(value(await step())).toMatchObject({ outcome: "waiting", detail: { reason: "the story holds the base" } });
    await moveBase(w, { "base.txt": "fine\n" });
    expect(value(await step()).outcome).toBe("verified");
    expect(value(await step()).outcome).toBe("waiting");

    await moveBase(w, { "base.txt": "broken\n" });
    const red = value(await step());
    expect(red).toMatchObject({ outcome: "broken", detail: { exit: 1, head } });
    expect(await git(wt, "rev-parse", "HEAD")).toBe(head);
    expect(await git(w.repo, "worktree", "list", "--porcelain")).not.toContain(".verify-");
  });

  test("a base that conflicts with the story is left to the stale route", async () => {
    const w = await world();
    const wt = await story(w);
    await commit(wt, "story edit", { "shared.txt": "one\nstory\nthree\n", "story.txt": "s\n" });
    await moveBase(w, { "shared.txt": "one\nbase\nthree\n" });
    expect(value(await verifyBase.run(input(w, wt, check, { step: "verify" }), w.ctx))).toMatchObject({ outcome: "waiting", detail: { conflicts: ["shared.txt"] } });
  });
});
