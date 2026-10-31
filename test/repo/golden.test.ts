/** Refactor Phase 0.1: the golden corpus regenerates as a reviewable diff (scripts/golden.ts). */
import { expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { caseName, stableKey } from "../support/golden-harvest.ts";
import { type Candidate, caseBody, decisionChanges, type GoldenCase, harvestCommand, harvestFiles, selectNew } from "../../scripts/golden.ts";

const GOLDEN = join(import.meta.dir, "..", "..", "packages", "core", "test", "golden");

test("stableKey ignores what differs between two runs of one tick and keeps which ids are equal", () => {
  const run = (tick: string, other: string, sha: string, pid: number, start: string, ms: number, date: string) =>
    JSON.stringify({ tick_id: tick, last_tick_id: tick, heartbeat_id: other, head: sha, holder: { pid, pid_start: start }, last_commit_at: ms, at: date, now: 4072154540000 });
  const a = run("03PGFN69Z0YB41Y6GBFAX3ZHZJ", "03PGFN2B0GEJ1VGA3S0Q8C1PXN", "e18de7c837da0ea2cd2ff822cec0dd6a78665939", 46509, "Tue Oct 27 13:50:21 2026", 1793105429000, "2026-10-27T13:50:34+01:00");
  const b = run("03PGFN69Z0QQ41Y6GBFAX3ZHZK", "03PGFN2B0GKK1VGA3S0Q8C1PXM", "0ef46f6a32cb1e2c38e87daaf7b3805f2202602d", 50001, "Wed Oct 28 09:00:00 2026", 1793200000000, "2026-10-28T09:00:00+01:00");
  expect(stableKey(a)).toBe(stableKey(b));
  // the fake clock (2099) is kept, and two equal ids stay distinguishable from two different ones
  expect(stableKey(a)).toContain("4072154540000");
  const same = run("03PGFN69Z0YB41Y6GBFAX3ZHZJ", "03PGFN69Z0YB41Y6GBFAX3ZHZJ", "e18de7c837da0ea2cd2ff822cec0dd6a78665939", 1, "x", 1793105429000, "2026-10-27T13:50:34+01:00");
  expect(stableKey(same)).not.toBe(stableKey(a));
});

test("a case is named by decide's inputs, so new decisions (golden.ts --update) keep its name", () => {
  const first = readdirSync(GOLDEN).filter((n) => n.endsWith(".json")).sort()[0] as string;
  const c = JSON.parse(readFileSync(join(GOLDEN, first), "utf8")) as GoldenCase;
  const redecided: GoldenCase = { ...c, decisions: [{ unit: "u", rule: "r.other", action: { kind: "noop" } }] };
  expect(caseName(c.source, caseBody(redecided))).toBe(first);
  const otherInputs: GoldenCase = { ...c, facts: { ...c.facts, now: c.facts.now + 1 } };
  expect(caseName(c.source, caseBody(otherInputs))).not.toBe(first);
});

test("every committed golden case is named by its stable key", () => {
  const wrong = readdirSync(GOLDEN)
    .filter((n) => n.endsWith(".json"))
    .filter((n) => {
      const c = JSON.parse(readFileSync(join(GOLDEN, n), "utf8")) as GoldenCase;
      return caseName(c.source, caseBody(c)) !== n;
    });
  expect(wrong).toEqual([]);
});

test("selectNew adds only new keys that bring an under-covered rule, smallest first, whatever the input order", () => {
  const cand = (name: string, key: string, rules: string[]): Candidate => ({ name, key, rules });
  const candidates = [cand("big", "xxxxxxxx", ["r.a", "r.b"]), cand("dup", "kept", ["r.c"]), cand("small", "xx", ["r.a"]), cand("covered", "x", ["r.z"])];
  const existing = [["r.z"], ["r.z"]];
  const added = selectNew(existing, new Set(["kept"]), candidates, 2).map((c) => c.name);
  expect(added).toEqual(["small", "big"]);
  expect(selectNew(existing, new Set(["kept"]), [...candidates].reverse(), 2).map((c) => c.name)).toEqual(added);
  // a corpus that already covers every rule takes nothing
  expect(selectNew([["r.a", "r.b", "r.c", "r.z"], ["r.a", "r.b", "r.c", "r.z"]], new Set(), candidates, 2)).toEqual([]);
});

test("decisionChanges lists the decisions that went and came, not those only reordered", () => {
  const d = (rule: string, kind = "noop") => ({ unit: "gh-1", rule, action: { kind } });
  expect(decisionChanges([d("a"), d("b"), d("b")], [d("b"), d("a"), d("c", "park")])).toEqual({
    gone: ['gh-1 b {"kind":"noop"}'],
    came: ['gh-1 c {"kind":"park"}'],
  });
  expect(decisionChanges([d("a"), d("b")], [d("b"), d("a")])).toEqual({ gone: [], came: [] });
});

test("the harvest finds the harness test files in cli integration and test/e2e and runs each with its tier's config (gh-118 B19)", () => {
  const found = harvestFiles();
  expect(found.length).toBeGreaterThan(0);
  expect(found.filter((f) => !f.startsWith("packages/cli/test/integration/") && !f.startsWith("test/e2e/"))).toEqual([]);
  expect(found).toContain("test/e2e/slice-workflow.test.ts");
  expect(found).toContain("packages/cli/test/integration/agent-protocol.test.ts");
  // a file that builds no harness is not harvested
  expect(found).not.toContain("test/e2e/pinned-outputs.test.ts");
  expect(harvestCommand("test/e2e/team.test.ts")).toEqual(["bun", "test", "--config=bunfig.e2e.toml", "--timeout=20000", "./test/e2e/team.test.ts"]);
  expect(harvestCommand("packages/cli/test/integration/audit.test.ts")).toEqual([
    "bun",
    "test",
    "--config=bunfig.integration.toml",
    "--timeout=20000",
    "./packages/cli/test/integration/audit.test.ts",
  ]);
});
