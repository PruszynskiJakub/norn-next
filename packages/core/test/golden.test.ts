/**
 * Golden decisions (refactor Phase 0.1, X4, O5). `golden/*.json` are ticks recorded by the cli
 * integration tests (`bun scripts/golden.ts` regenerates them): decide's inputs as `norn why`
 * replays them and the decisions the tick made. Each one is decided again here and must give
 * exactly the recorded decisions — a refactor of decide that changes any of them is a behaviour
 * change.
 *
 * Rule coverage: every rule id decide can emit (its literal rule strings plus the templated
 * families below) fires in at least one golden case or hand-built case (`rule-cases.ts`).
 */
import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { ResolvedConfig } from "@norn/schema";
import { GitAction, ParkKind } from "@norn/schema";
import type { Decision } from "../src/actions.ts";
import { decide, type RepoWorkflows } from "../src/decide/index.ts";
import type { Facts } from "../src/facts.ts";
import { RULE_CASES } from "./rule-cases.ts";

interface GoldenCase {
  source: string;
  tick_id: string;
  facts: Facts;
  workflows: RepoWorkflows;
  config: ResolvedConfig;
  decisions: Array<{ unit: string; rule: string; action: unknown }>;
}

const GOLDEN = join(import.meta.dir, "golden");
const cases: Array<[string, GoldenCase]> = readdirSync(GOLDEN)
  .filter((n) => n.endsWith(".json"))
  .sort()
  .map((n) => [n, JSON.parse(readFileSync(join(GOLDEN, n), "utf8")) as GoldenCase]);

/** decide's output as the trace records it: JSON-safe (`tick.start` decisions, R5.4). */
const recorded = (ds: Decision[]) => JSON.parse(JSON.stringify(ds.map((d) => ({ unit: d.unit, rule: d.rule, action: d.action })))) as GoldenCase["decisions"];

describe("golden decisions", () => {
  test("the corpus is there", () => {
    expect(cases.length).toBeGreaterThan(20);
  });
  for (const [name, c] of cases) {
    test(`${name} (tick ${c.tick_id})`, () => {
      expect(recorded(decide(c.facts, c.workflows, c.config))).toEqual(c.decisions);
    });
  }
});

// ---------------------------------------------------------------- rule coverage

const DECIDE_DIR = join(import.meta.dir, "..", "src", "decide");
/** decide's sources (`src/decide/*.ts`), concatenated: rule ids are read from all of them. */
const DECIDE_SRC = readdirSync(DECIDE_DIR)
  .filter((f) => f.endsWith(".ts"))
  .sort()
  .map((f) => readFileSync(join(DECIDE_DIR, f), "utf8"))
  .join("\n");

/** Every dotted double-quoted literal in decide/ — in decide these are all rule ids. */
const LITERALS = [...new Set([...DECIDE_SRC.matchAll(/"([a-z_]+(?:\.[a-z_-]+)+)"/g)].map((m) => m[1] as string))].sort();

/**
 * Rules routeOutcome takes as `c.rule` and only ever emits with a suffix (C1): the classify
 * receipt records the bare id, the decision `${rule}.<suffix>`.
 */
const ROUTED = ["agent.died", "agent.died.foreign", "agent.died.launch_unknown", "agent.silent", "agent.silent.launch_prompt", "agent.stalled", "agent.timeout"];
/** routeOutcome's suffixes: nudge (send / resume), surfaced nudge, retry (died / other), and the final route. */
const ROUTE_SUFFIXES = ["nudge", "nudge.resume", "surface", "retry", "retry.no_nudge", "stuck", "route"];

/** Kinds a unit parks on with status `parked` (apply.ts `park` with its default status). */
const PARKED_KINDS = ["ask", "attended", "gate"];
const GIT_ACTIONS = GitAction.anyOf.map((s) => s.const as string);
const SERIALIZED_GIT = ["integrate", "update"];

/**
 * The template literals decide/ builds rule ids from. A new one fails this test until it is
 * listed here and its ids are added to `expected` below.
 */
const TEMPLATES = ["${rule}.${res.route ?? (stuck ? \"stuck\" : \"route\")}", "${rule}.nudge", "${rule}.nudge.resume", "${rule}.resume", "${rule}.retry", "${rule}.retry.no_nudge", "${rule}.surface", "git.${step.action}", "git.${step.action}.queued", "unit.parked.${st.park?.kind ?? \"?\"}"];

/**
 * Ids decide can emit that no golden or hand-built case reaches, each with why. Keep this short:
 * prefer adding a case to `rule-cases.ts`.
 */
const UNREACHABLE: Record<string, string> = {};

/** Template literals on decide/ lines that set a rule (`rule`, `noop(`) whose fixed text is rule-like. */
function templatesInSource(): string[] {
  const out = new Set<string>();
  for (const line of DECIDE_SRC.split("\n")) {
    if (!/\brule\b|noop\(/.test(line)) continue;
    for (const m of line.matchAll(/`((?:[^`$\\]|\$\{[^}`]*\})*)`/g)) {
      const t = m[1] as string;
      const fixed = t.replace(/\$\{[^}]*\}/g, "");
      if (t.includes("${") && /^[a-z_.-]+$/.test(fixed) && fixed.includes(".")) out.add(t);
    }
  }
  return [...out].sort();
}

/** The rule ids decide can emit, grouped: each group is covered when any id in it fires. */
function expected(): Array<{ id: string; anyOf: string[] }> {
  const groups: Array<{ id: string; anyOf: string[] }> = [];
  for (const lit of LITERALS) if (!ROUTED.includes(lit)) groups.push({ id: lit, anyOf: [lit] });
  // each routed base fires with some suffix, and each suffix with some routed base
  for (const base of ROUTED) groups.push({ id: `${base}.*`, anyOf: ROUTE_SUFFIXES.map((s) => `${base}.${s}`) });
  for (const s of ROUTE_SUFFIXES) groups.push({ id: `*.${s}`, anyOf: ROUTED.map((b) => `${b}.${s}`) });
  for (const k of PARKED_KINDS) groups.push({ id: `unit.parked.${k}`, anyOf: [`unit.parked.${k}`] });
  for (const a of GIT_ACTIONS) groups.push({ id: `git.${a}`, anyOf: [`git.${a}`] });
  for (const a of SERIALIZED_GIT) groups.push({ id: `git.${a}.queued`, anyOf: [`git.${a}.queued`] });
  groups.push({ id: "receipts.apply.resume", anyOf: ["receipts.apply.resume"] });
  return groups;
}

/** Rules a decision fires: its own, and those of the slice starts a `start_slices` carries. */
function rulesOf(ds: Decision[]): string[] {
  return ds.flatMap((d) => [d.rule, ...(d.action.kind === "start_slices" ? d.action.starts.map((s) => s.rule) : [])]);
}

/** Every rule fired by the golden and hand-built cases. */
function firedRules(): Set<string> {
  const fired = new Set<string>();
  for (const [, c] of cases) for (const r of rulesOf(decide(c.facts, c.workflows, c.config))) fired.add(r);
  for (const c of RULE_CASES) for (const r of rulesOf(decide(c.facts, c.workflows, c.config))) fired.add(r);
  return fired;
}

describe("rule coverage", () => {
  test("decide/ builds rule ids from exactly the known templates", () => {
    expect(templatesInSource()).toEqual([...TEMPLATES].sort());
  });

  test("every routed base is a literal in decide/ and parked kinds are park kinds", () => {
    for (const b of ROUTED) expect(LITERALS).toContain(b);
    const kinds = ParkKind.anyOf.map((s) => s.const as string);
    for (const k of PARKED_KINDS) expect(kinds).toContain(k);
    expect(LITERALS.length).toBeGreaterThan(50);
  });

  for (const c of RULE_CASES) {
    test(`hand-built: ${c.name} fires ${c.rule}`, () => {
      expect(rulesOf(decide(c.facts, c.workflows, c.config))).toContain(c.rule);
    });
  }

  test("every rule id fires in a golden or hand-built case, or is listed unreachable with a reason", () => {
    const fired = firedRules();
    const missing = expected()
      .filter((g) => !g.anyOf.some((r) => fired.has(r)))
      .map((g) => g.id)
      .filter((id) => !(id in UNREACHABLE));
    expect(missing).toEqual([]);
    // an allowlisted id that now fires must leave the allowlist
    const reached = Object.keys(UNREACHABLE).filter((id) => expected().find((g) => g.id === id)?.anyOf.some((r) => fired.has(r)));
    expect(reached).toEqual([]);
    // and every allowlisted id is one decide can emit
    const ids = new Set(expected().map((g) => g.id));
    expect(Object.keys(UNREACHABLE).filter((id) => !ids.has(id))).toEqual([]);
  });

  test("every rule that fires is one the catalogue knows", () => {
    const known = new Set(expected().flatMap((g) => g.anyOf));
    expect([...firedRules()].filter((r) => !known.has(r))).toEqual([]);
  });
});
