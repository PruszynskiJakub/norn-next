/**
 * Overlap between open stories as observe measures it (`storyOverlaps`): which pairs it merges
 * with `git merge-tree`, and the per-pair-of-heads cache (`overlap.json`) that spares a tick
 * where neither head moved. Git is a counting fake here; the merge itself is the git contract's.
 */
import { describe, expect, test } from "bun:test";
import type { StoryBase, StoryFacts, StoryOverlap } from "@norn/core";
import { storyOverlaps } from "../../src/runtime/observe/git-facts.ts";

const SHA = (c: string) => c.repeat(40);

/** Only what eligibility reads: base, PR, spec record, the story unit's status. */
function story(key: string, head: string, o: { ahead?: number; round?: "active" | "done"; pr?: "open" | "merged" | null } = {}): StoryFacts {
  const base: StoryBase = { ref: "refs/remotes/origin/main", sha: SHA("b"), head, merge_base: SHA("m"), behind: 0, ahead: o.ahead ?? 1, conflicts: [] };
  const status = o.round === "done" ? "done" : "waiting";
  const pr = o.pr ? { number: 1, url: "u", state: o.pr, is_draft: false, head_sha: head, base_branch: "main" } : null;
  return {
    key,
    frontmatter: { status: "active" },
    units: [{ unit: { story: key, slice: null, dir: "_story", key }, state: { status, step: status === "done" ? "$done" : "implement" } }],
    pr,
    base,
  } as unknown as StoryFacts;
}

function countingGit(conflicts: Record<string, string[]>) {
  const calls: string[] = [];
  return {
    calls,
    git: {
      async mergeTree(_cwd: string, ours: string, theirs: string) {
        calls.push(`${ours[0]}${theirs[0]}`);
        return conflicts[`${ours[0]}${theirs[0]}`] ?? [];
      },
    },
  };
}

describe("storyOverlaps", () => {
  test("each eligible pair merged once, in key order, clean pairs kept for the cache", async () => {
    const { git, calls } = countingGit({ "12": ["src/x.ts"] });
    const out = await storyOverlaps(git, "/r", [story("gh-327", SHA("2")), story("gh-326", SHA("1")), story("gh-328", SHA("3"), { round: "done", pr: "open" })], "main", []);
    expect(calls).toEqual(["12", "13", "23"]);
    expect(out).toEqual([
      { stories: ["gh-326", "gh-327"], heads: [SHA("1"), SHA("2")], paths: ["src/x.ts"] },
      { stories: ["gh-326", "gh-328"], heads: [SHA("1"), SHA("3")], paths: [] },
      { stories: ["gh-327", "gh-328"], heads: [SHA("2"), SHA("3")], paths: [] },
    ]);
  });

  test("neither head moved since the last tick: the pair is not merged again", async () => {
    const stories = [story("gh-326", SHA("1")), story("gh-327", SHA("2"))];
    const first = countingGit({ "12": ["src/x.ts"] });
    const prev = await storyOverlaps(first.git, "/r", stories, "main", []);
    const again = countingGit({});
    expect(await storyOverlaps(again.git, "/r", stories, "main", prev)).toEqual(prev);
    expect(again.calls).toEqual([]);
    // one head moved: merged again, and the pair's old entry is gone
    const moved = countingGit({});
    const next = await storyOverlaps(moved.git, "/r", [stories[0] as StoryFacts, story("gh-327", SHA("4"))], "main", prev);
    expect(moved.calls).toEqual(["14"]);
    expect(next).toEqual([{ stories: ["gh-326", "gh-327"], heads: [SHA("1"), SHA("4")], paths: [] }]);
  });

  test("stories without commits of their own, or neither in flight nor finished with an open PR, are never compared", async () => {
    const { git, calls } = countingGit({});
    const prev: StoryOverlap[] = [{ stories: ["gh-326", "gh-327"], heads: [SHA("1"), SHA("2")], paths: ["src/x.ts"] }];
    const out = await storyOverlaps(git, "/r", [story("gh-326", SHA("1")), story("gh-327", SHA("2"), { ahead: 0 }), story("gh-328", SHA("3"), { round: "done", pr: null }), story("gh-329", SHA("5"), { round: "done", pr: "merged" })], "main", prev);
    expect(calls).toEqual([]);
    // the pair that stopped being eligible drops out of the cache, so its item clears
    expect(out).toEqual([]);
  });

  test("a pair git fails on is left out, never guessed", async () => {
    const git = { mergeTree: async () => Promise.reject(new Error("boom")) };
    expect(await storyOverlaps(git, "/r", [story("gh-326", SHA("1")), story("gh-327", SHA("2"))], "main", [])).toEqual([]);
  });
});
