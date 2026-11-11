/**
 * Overlap between open stories through `buildInbox`: scripted Facts (`overlaps`, each story's
 * base and PR) in, Check items out. Which stories observe compares is `overlapEligible`.
 */
import { describe, expect, test } from "bun:test";
import type { Facts, StoryBase, StoryFacts, StoryOverlap } from "../../src/facts.ts";
import { buildInbox } from "../../src/inbox/items.ts";
import { overlapEligible } from "../../src/overlap.ts";
import { CONFIG, facts, STORY_WF, stateFor, storyFacts, storyUnit, unitFacts } from "../fixtures.ts";

const SHA = (c: string) => c.repeat(40);

function base(key: string, patch: Partial<StoryBase> = {}): StoryBase {
  return { ref: "refs/remotes/origin/main", sha: SHA("b"), head: SHA(key.endsWith("26") ? "1" : "2"), merge_base: SHA("m"), behind: 0, ahead: 2, conflicts: [], ...patch };
}

/** A story with a unit in flight and commits of its own. */
function inFlight(key: string, patch: Partial<StoryFacts> = {}): StoryFacts {
  const u = unitFacts(storyUnit(key), STORY_WF, stateFor(storyUnit(key), STORY_WF));
  return storyFacts(key, [u], { base: base(key), ...patch });
}

/** A story whose round finished (`$done`), with or without an open PR. */
function finished(key: string, pr: "open" | "merged" | null, patch: Partial<StoryFacts> = {}): StoryFacts {
  const u = unitFacts(storyUnit(key), STORY_WF, stateFor(storyUnit(key), STORY_WF, { status: "done", step: "$done", park: null, run: null }));
  const p: StoryFacts["pr"] = pr === null ? null : { number: 9, url: "https://github.com/o/r/pull/9", state: pr, is_draft: false, head_sha: base(key).head, base_branch: "main" };
  return storyFacts(key, [u], { base: base(key), pr: p, ...patch });
}

function overlap(a: StoryFacts, b: StoryFacts, paths: string[]): StoryOverlap {
  return { stories: [a.key, b.key], heads: [a.base?.head ?? "", b.base?.head ?? ""], paths };
}

const checks = (f: Facts) => buildInbox(f, CONFIG).groups.check.filter((i) => i.id.startsWith("overlap:"));

describe("overlap between open stories", () => {
  test("two stories whose heads conflict outside their spec folders: one Check item naming both and the paths", () => {
    const a = inFlight("gh-326");
    const b = finished("gh-327", "open");
    const items = checks(facts([a, b], { overlaps: [overlap(a, b, ["packages/cli/test/ci-check.test.ts", "src/x.ts"])] }));
    expect(items.length).toBe(1);
    const it = items[0]!;
    expect(it.id).toBe("overlap:gh-326:gh-327");
    expect(it.title).toBe("gh-326 and gh-327 both change packages/cli/test/ci-check.test.ts, src/x.ts; whichever merges second needs a resolve");
    expect(it.story).toBe("gh-326");
  });

  test("the item offers no dismiss and suggests no merge order", () => {
    const a = inFlight("gh-326");
    const b = inFlight("gh-327");
    const it = checks(facts([a, b], { overlaps: [overlap(a, b, ["src/x.ts"])] }))[0]!;
    expect(it.command).not.toMatch(/dismiss|merge first|before/i);
    expect(`${it.title} ${it.detail ?? ""}`).not.toMatch(/merge (gh-\d+ )?first|before gh-/i);
  });

  test("conflicts only inside the two stories' own spec folders: no item", () => {
    const a = inFlight("gh-326");
    const b = inFlight("gh-327");
    const paths = [`${a.spec_dir}/handoffs/01.md`, `${b.spec_dir}/spec.md`];
    expect(checks(facts([a, b], { overlaps: [overlap(a, b, paths)] }))).toEqual([]);
    // a spec-folder path is dropped from the item that real code overlap raises
    const it = checks(facts([a, b], { overlaps: [overlap(a, b, [...paths, "src/x.ts"])] }))[0]!;
    expect(it.title).toBe("gh-326 and gh-327 both change src/x.ts; whichever merges second needs a resolve");
  });

  test("the item clears itself when a story lands or the heads stop conflicting", () => {
    const a = inFlight("gh-326");
    const b = finished("gh-327", "open");
    // the heads stopped conflicting: observe reports the pair with no paths, or not at all
    expect(checks(facts([a, b], { overlaps: [overlap(a, b, [])] }))).toEqual([]);
    expect(checks(facts([a, b]))).toEqual([]);
    // gh-327's PR merged, or its spec records done
    const merged = finished("gh-327", "merged");
    expect(checks(facts([a, merged], { overlaps: [overlap(a, merged, ["src/x.ts"])] }))).toEqual([]);
    const landed = finished("gh-327", "open", { frontmatter: { ...b.frontmatter!, status: "done" } });
    expect(checks(facts([a, landed], { overlaps: [overlap(a, landed, ["src/x.ts"])] }))).toEqual([]);
  });
});

describe("overlapEligible: which stories are compared", () => {
  test("a unit in flight with commits of its own", () => {
    expect(overlapEligible(inFlight("gh-326"), "main")).toBe(true);
  });
  test("a finished round with an open PR (pr_seen counts when not fetched this tick)", () => {
    expect(overlapEligible(finished("gh-326", "open"), "main")).toBe(true);
    const seen = finished("gh-326", "open");
    const stale = { ...seen, pr: undefined, pr_seen: { pr: seen.pr ?? null, observed_at: 0 } };
    expect(overlapEligible(stale, "main")).toBe(true);
  });
  test("no commits of its own beyond its base, or no base measured: never compared", () => {
    expect(overlapEligible(inFlight("gh-326", { base: base("gh-326", { ahead: 0 }) }), "main")).toBe(false);
    const { base: _, ...noBase } = inFlight("gh-326");
    expect(overlapEligible(noBase, "main")).toBe(false);
  });
  test("neither a unit in flight nor a finished round with an open PR: never compared", () => {
    expect(overlapEligible(finished("gh-326", null), "main")).toBe(false);
    expect(overlapEligible(finished("gh-326", "merged"), "main")).toBe(false);
    expect(overlapEligible(storyFacts("gh-326", [], { base: base("gh-326") }), "main")).toBe(false);
  });
  test("an ineligible story raises nothing even when an overlap names it", () => {
    const a = inFlight("gh-326");
    const b = finished("gh-327", null);
    expect(checks(facts([a, b], { overlaps: [overlap(a, b, ["src/x.ts"])] }))).toEqual([]);
  });
});
