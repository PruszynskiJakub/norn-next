import { describe, expect, test } from "bun:test";
import { readdirSync } from "node:fs";
import { decisionChanges } from "../../scripts/golden.ts";
import { type Decision, RULE_IDS } from "../../src/index.ts";
import { decideGolden, GOLDEN_DIR, readCases } from "../golden.ts";

const CASES = readCases();

describe("the golden corpus", () => {
  test("has cases, each named by its file", () => {
    expect(CASES.length).toBeGreaterThan(0);
    const files = readdirSync(GOLDEN_DIR).filter((f) => f.endsWith(".json")).sort();
    expect(CASES.map((c) => `${c.name}.json`)).toEqual(files);
  });

  // a failure here is a behaviour change: when it is meant, `bun run golden -- --update` in packages/kernel rewrites the decisions
  test.each(CASES.map((c) => [c.name, c] as const))("%s decides exactly its recorded decisions", (_name, c) => {
    expect(decideGolden(c)).toEqual(c.decisions);
  });

  test("decides each case alike twice: ids come from the tick, never from the clock or a counter kept between calls", () => {
    for (const c of CASES.slice(0, 10)) expect(decideGolden(c)).toEqual(decideGolden(c));
  });

  test("every case gives each unit at most one action", () => {
    for (const c of CASES) {
      const units = c.decisions.flatMap((d) => (d.unit === null ? [] : [d.unit]));
      expect([...new Set(units)].length).toBe(units.length);
    }
  });
});

describe("rule coverage", () => {
  const fired = new Set(CASES.flatMap((c) => c.decisions.map((d) => d.rule)));

  test("every rule id decide can emit fires in some case", () => {
    expect(RULE_IDS.filter((r) => !fired.has(r))).toEqual([]);
  });

  test("no case names a rule id missing from RULE_IDS", () => {
    expect([...fired].filter((r) => !RULE_IDS.includes(r))).toEqual([]);
  });

  test("RULE_IDS lists each id once", () => {
    expect(new Set(RULE_IDS).size).toBe(RULE_IDS.length);
  });
});

describe("the regeneration diff", () => {
  const noop = (unit: string, rule: string): Decision => ({ kind: "noop", unit, rule, reason: "x" });
  test("lists the decisions that went and came, by unit, rule and kind", () => {
    expect(decisionChanges([noop("gh-1", "a.b"), noop("gh-2", "c.d")], [noop("gh-2", "c.d"), noop("gh-1", "e.f")])).toEqual(["- gh-1 a.b noop", "+ gh-1 e.f noop"]);
    expect(decisionChanges([noop("gh-1", "a.b")], [noop("gh-1", "a.b")])).toEqual([]);
  });
});
