import { describe, expect, test } from "bun:test";
import { Decisions, STORY_ACTIONS, type StoryFacts } from "../../src/index.ts";
import {
  CONFIG,
  caps,
  change,
  claim,
  decideAll,
  facts,
  item,
  letter,
  minutesAgo,
  minutesAhead,
  receipt,
  state,
  story,
  unit,
  workflows,
} from "./decide-story-fixtures.ts";

/** Stories that exercise every story rule at once, with units the unit rules also look at. */
function busyStories(): StoryFacts[] {
  return [
    story({
      claim: claim({ expires_at: minutesAhead(2) }),
      mailbox: [letter("m1", { unit: "gh-1", receipt: { kind: "mode.changed", mode: "auto", by: "ann" } })],
      units: [unit("gh-1", state("gh-1", "split")), unit("gh-1/01", state("gh-1/01", "build")), unit("gh-1/02", null)],
      plan: { slices: [{ unit: "gh-1/01", depends_on: [] }, { unit: "gh-1/02", depends_on: ["gh-1/01"] }] },
    }),
    story({ key: "gh-2", item: item(2), claim: claim({ story: "gh-2", holder: "machine-b" }), units: [unit("gh-2", state("gh-2", "plan")), unit("gh-2/01", state("gh-2/01", "build"))] }),
    story({ key: "gh-3", item: item(3), claim: claim({ story: "gh-3" }), change: change({ state: "merged" }), units: [unit("gh-3", state("gh-3", "plan", { unit: "gh-3", story: "gh-3" }))] }),
    story({ key: "gh-4", item: item(4), claim: null, units: [] }),
    story({ key: "gh-5", item: item(5), claim: claim({ story: "gh-5" }), units: [unit("gh-5", state("gh-5", "split", { ended: "done" }))] }),
    story({
      key: "gh-6",
      item: item(6),
      claim: claim({ story: "gh-6" }),
      units: [unit("gh-6", state("gh-6", "plan"), { receipts: [receipt(1, { kind: "mode.changed", mode: "auto", by: "ann" })] }), unit("gh-6/01", null, { corrupt: "bad receipt" })],
    }),
  ];
}

describe("one action per unit per tick", () => {
  const f = facts(busyStories(), { capabilities: caps({ shared: true, claims: "distributed" }), intake: [item(7), item(1)] });
  const ds = decideAll(f);

  test("no unit gets two decisions, and every decision names its rule", () => {
    const units = ds.flatMap((d) => (d.unit === null ? [] : [d.unit]));
    expect(new Set(units).size).toBe(units.length);
    for (const d of ds) expect(d.rule.length).toBeGreaterThan(0);
  });

  test("story and tick actions carry no unit, so they never take a unit's action", () => {
    for (const d of ds) if (STORY_ACTIONS.includes(d.kind)) expect(d.unit).toBeNull();
  });

  test("a story held elsewhere gets only the story rule's noops, never a unit rule's action", () => {
    expect(ds.filter((d) => d.unit?.startsWith("gh-2")).map((d) => [d.unit, d.rule])).toEqual([
      ["gh-2", "claim.held_elsewhere"],
      ["gh-2/01", "claim.held_elsewhere"],
    ]);
  });

  test("a held story renews first and flushes after its units; a finished one flushes then releases; intake comes last", () => {
    const idx = (rule: string, unitOrStory?: string) => ds.findIndex((d) => d.rule === rule && (unitOrStory === undefined || d.unit === unitOrStory || ("story" in d && d.story === unitOrStory)));
    expect(idx("claim.renew", "gh-1")).toBe(0);
    const lastGh1 = Math.max(...ds.flatMap((d, i) => (d.unit?.startsWith("gh-1") ? [i] : [])));
    expect(idx("store.flush", "gh-1")).toBeGreaterThan(lastGh1);
    expect(idx("claim.release", "gh-5")).toBeGreaterThan(idx("store.flush", "gh-5"));
    expect(ds.at(-1)).toMatchObject({ kind: "intake_story", rule: "intake.story" });
    expect(ds.filter((d) => d.kind === "intake_story").map((d) => (d.kind === "intake_story" ? d.item.key : ""))).toEqual(["gh-7"]);
  });

  test("story rules decide what they own and leave the rest to the unit rules", () => {
    const by = (u: string) => ds.find((d) => d.unit === u)?.rule;
    expect(by("gh-1")).toBe("slices.wait");
    expect(by("gh-1/02")).toBe("slice.not_started");
    expect(by("gh-3")).toBe("story.change_merged");
    expect(by("gh-4")).toBe("claim.pending");
    // finished: its ended units are left alone
    expect(by("gh-5")).toBeUndefined();
    expect(by("gh-6/01")).toBe("unit.corrupt");
    expect(by("gh-6")).not.toBeUndefined();
    expect(ds.some((d) => d.rule === "mailbox.import")).toBe(true);
  });

  test("the same facts decide the same, ids included", () => {
    expect(decideAll(structuredClone(f))).toEqual(ds);
  });

  test("a claim taken this tick holds the story's units until it is in", () => {
    const fresh = decideAll(facts([story({ claim: null, units: [unit("gh-1", null)] })]));
    expect(fresh.map((d) => [d.unit, d.rule])).toEqual([
      [null, "claim.take"],
      ["gh-1", "claim.pending"],
    ]);
  });

  test("an expired claim of this machine is reacquired and nothing else of the story moves", () => {
    const s = story({ claim: claim({ expires_at: minutesAgo(1) }), units: [unit("gh-1", state("gh-1", "plan"))] });
    expect(decideAll(facts([s])).map((d) => d.rule)).toEqual(["claim.reacquire", "claim.pending"]);
  });
});

test("a second action for a unit is a defect decide refuses loudly", () => {
  const out = new Decisions();
  out.add({ kind: "noop", unit: "gh-1", rule: "a", reason: "" });
  out.add({ kind: "flush", unit: null, rule: "store.flush", story: "gh-1" });
  out.add({ kind: "flush", unit: null, rule: "store.flush", story: "gh-1" });
  expect(() => out.add({ kind: "noop", unit: "gh-1", rule: "b", reason: "" })).toThrow("second action for gh-1 (b)");
});
