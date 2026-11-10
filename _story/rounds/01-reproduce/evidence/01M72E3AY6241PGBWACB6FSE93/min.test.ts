import { expect, test } from "bun:test";
import { decide } from "<worktree>/packages/core/src/decide/index.ts";
import { at, CONFIG, facts, HB, SOLO_WF, stateFor, storyFacts, storyUnit, T0, unitFacts, WORKFLOWS } from "<worktree>/packages/core/test/fixtures.ts";
const merged = { number: 9, url: "u", state: "merged" as const, is_draft: false, head_sha: "abc" };
function story(claim: any, pr: any = merged) {
  const u = storyUnit("gh-1");
  const s = storyFacts("gh-1", [unitFacts(u, SOLO_WF, stateFor(u, SOLO_WF, { step: "$done", status: "done" }))], { claim, pr });
  s.frontmatter = { ...s.frontmatter!, workflow: "solo", status: "active" };
  return s;
}
const kinds = (s: any) => decide(facts([s]), WORKFLOWS, CONFIG).map((d) => `${d.action.kind} ${d.rule} ${(d.action as any).reason ?? ""}`);
const blob = (hb: string) => ({ version: 1 as const, story: "gh-1", holder: "jakub@mac", heartbeat_id: hb, acquired_at: at(), renewed_at: at(), expires_at: at(T0 - 1), last_tick_id: null });
test("probe: which claim states reach cleanup_merged_story", () => {
  for (const [name, c] of [["none", { state: "none" }], ["expired-ours", { state: "expired", sha: "c1", blob: blob(HB) }], ["expired-theirs", { state: "expired", sha: "c1", blob: blob("01JEEEEEEEEEEEEEEEEEEEEEEE") }]] as const)
    console.log(name.padEnd(15), JSON.stringify(kinds(story(c))));
});
test("gh-294 minimal: round $done, claim none, PR merged → cleanup_merged_story", () => {
  expect(kinds(story({ state: "none" })).map((k) => k.split(" ")[0])).toContain("cleanup_merged_story");
});
