/**
 * Conformance of the Claude Code harness to the session contract, end to end: recorded native hook
 * calls go through claudeHarness.normalize into the kernel's reducer and classifier, and each
 * scenario pins the activity a host would read at given instants. In-process only: a unit test.
 */
import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { eventsByStep, project, readAt, type Scenario } from "@norn/conformance";
import { claudeHarness } from "@norn/harness-claude";
import { reduceSession } from "@norn/kernel";
import { isHarnessEvent } from "@norn/plugin-api";

const FIXTURES = join(import.meta.dir, "fixtures", "claude");
const SILENT_AFTER_MS = 5 * 60 * 1000;

function loadScenario(file: string): Scenario {
  const s = JSON.parse(readFileSync(join(FIXTURES, file), "utf8")) as Scenario;
  expect({ file, name: typeof s.scenario, steps: Array.isArray(s.steps), checks: Array.isArray(s.checks) }).toEqual({ file, name: "string", steps: true, checks: true });
  return s;
}

const SCENARIOS = readdirSync(FIXTURES)
  .filter((f) => f.endsWith(".json"))
  .sort()
  .map(loadScenario);

test("every scenario the contract promises has a recording", () => {
  expect(SCENARIOS.map((s) => s.scenario).sort()).toEqual([
    "ask-question",
    "background-subagents",
    "context-compaction",
    "crash-mid-turn",
    "elicitation-answered",
    "elicitation-answered-unnoticed",
    "logged-out-login-nudge",
    "parallel-tools-ask",
    "permission-prompt",
    "person-types-in-pane",
    "plain-done",
    "turn-end-without-report",
    "usage-limit",
  ]);
});

describe.each(SCENARIOS.map((s) => [s.scenario, s] as const))("claude conformance: %s", (_name, s) => {
  const byStep = eventsByStep(claudeHarness, s);
  const all = byStep.flat();

  test("every event satisfies the contract, numbered 0, 1, 2, ... with its hook's run and instant", () => {
    expect(all.filter((e) => !isHarnessEvent(e))).toEqual([]);
    expect(all.map((e) => e.seq)).toEqual(all.map((_, i) => i));
    byStep.forEach((events, i) => {
      for (const e of events) expect({ step: i, run_id: e.run_id, at: e.at }).toEqual({ step: i, run_id: s.run_id, at: s.steps[i]?.at as string });
    });
  });

  test("no hook call is misread as a hook error", () => {
    expect(all.filter((e) => e.type === "hook.error")).toEqual([]);
  });

  test.each(s.checks.map((c, i) => [i, c] as const))("check %i", (_i, c) => {
    const reading = readAt(byStep, c.after, c.now, SILENT_AFTER_MS);
    expect({ after: c.after, now: c.now, ...project(reading, c.expect) }).toEqual({ after: c.after, now: c.now, ...c.expect });
  });

  test("an ask or a permission keeps one id at every instant it is open, so it never flickers", () => {
    const seen = new Map<string, Set<string>>();
    for (const c of s.checks) {
      const { facts } = readAt(byStep, c.after, c.now, SILENT_AFTER_MS);
      if (facts.ask) seen.set(`ask:${facts.ask.question}`, (seen.get(`ask:${facts.ask.question}`) ?? new Set()).add(facts.ask.id));
      if (facts.permission) seen.set(`permission:${facts.permission.prompt}`, (seen.get(`permission:${facts.permission.prompt}`) ?? new Set()).add(facts.permission.id));
    }
    for (const [what, ids] of seen) expect({ what, ids: ids.size }).toEqual({ what, ids: 1 });
  });

  test("the hooks replayed out of order and twice over give the same view", () => {
    // a hook can be delivered late or retried; the reducer reads the log, not the arrival order
    const replayed = [...all].reverse().concat(all.filter((_, i) => i % 2 === 0));
    expect(reduceSession(replayed)).toEqual(reduceSession(all));
  });
});
