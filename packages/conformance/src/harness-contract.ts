/**
 * The harness contract as a reusable suite: every harness replays a recording of each scenario in
 * one catalogue through its own normalize into the one kernel reducer and classifier. A harness that
 * lacks a capability records the same situation as its agent shows it, and the suite asserts the
 * kernel reads it the degraded way that capability implies. The suite reads `capabilities`, never
 * `name`: a new harness with the same capabilities is held to the same reads.
 */
import { describe, expect, test } from "bun:test";
import { classifySession, reduceSession, type SessionActivity } from "@norn/kernel";
import { type Harness, type HarnessCapabilities, type HarnessEvent, isHarnessEvent } from "@norn/plugin-api";
import { type ContractOptions, contractTest } from "./contract.ts";
import { eventsByStep, project, readAt } from "./replay.ts";
import type { Scenario } from "./scenario.ts";

/** A capability whose absence the kernel can see in what a harness reports. */
export type ReportedCapability = "subagents" | "limits";

export interface HarnessScenarioSpec {
  scenario: string;
  /** what every recording of it shows the kernel reading */
  promise: string;
  /** the capability the situation leans on; a harness without it still records the situation */
  needs?: ReportedCapability;
}

export const HARNESS_SCENARIOS: readonly HarnessScenarioSpec[] = Object.freeze([
  { scenario: "plain-done", promise: "tool calls come and go, the report reads as reported, and it outlasts the turn's end" },
  { scenario: "turn-end-without-report", promise: "a turn that ends without a report stays turn_ended, never working or silent" },
  { scenario: "ask-question", promise: "the agent's question reads as asking until the person answers it in the pane" },
  { scenario: "parallel-tools-ask", promise: "an ask among parallel tool calls keeps one id while the others come and go" },
  { scenario: "permission-prompt", promise: "a call waiting on the person's approval reads as waiting on them, and its approval lets it run" },
  { scenario: "elicitation-answered", promise: "a dialog raised inside a tool call reads as asking, and its answer leaves the call running" },
  { scenario: "elicitation-answered-unnoticed", promise: "a dialog whose answer is never heard closes once the agent acts again" },
  { scenario: "person-types-in-pane", promise: "a prompt the person types counts as a pane answer; a prompt norn sends never does" },
  { scenario: "context-compaction", promise: "a compaction mid-turn is counted and nothing reads as idle" },
  { scenario: "crash-mid-turn", promise: "the end the host records drops every pending call" },
  { scenario: "background-subagents", promise: "a long wait on delegated work is a wait with a reason, never silence", needs: "subagents" },
  { scenario: "usage-limit", promise: "a stop on a provider's limit is never read as a silent agent", needs: "limits" },
  { scenario: "logged-out-login-nudge", promise: "an agent that lost its login stops for a person, and norn's nudge after /login starts it again" },
]);

/**
 * What the kernel never sees from a harness without the capability: the events it cannot send, and
 * the activity only those events lead to.
 */
export const UNREPORTED: Readonly<Record<ReportedCapability, { events: readonly HarnessEvent["type"][]; activity: SessionActivity }>> = Object.freeze({
  subagents: { events: ["subagent.started", "subagent.finished"], activity: "awaiting_subagents" },
  limits: { events: ["limit.hit"], activity: "limited" },
});

/** A test of one scenario's recording, named `<scenario>: <test>`, for ContractOptions' `failing`. */
export type HarnessConformanceTest = `${string}: ${string}`;

export interface HarnessConformanceOptions extends ContractOptions<HarnessConformanceTest> {
  /** the classifier's quiet threshold every recording's checks are written against */
  silentAfterMs: number;
}

const absent = (caps: HarnessCapabilities): ReportedCapability[] => (Object.keys(UNREPORTED) as ReportedCapability[]).filter((c) => !caps[c]);

/**
 * Register the suite for one harness: `recordings` holds that harness's recording of every
 * scenario in HARNESS_SCENARIOS, read from wherever its fixtures live.
 */
export function harnessConformance(label: string, harness: Harness, recordings: readonly Scenario[], opts: HarnessConformanceOptions): void {
  const missing = absent(harness.capabilities);

  describe(`${label} harness conformance`, () => {
    test("every scenario the contract promises has exactly one recording", () => {
      expect(recordings.map((s) => s.scenario).sort()).toEqual(HARNESS_SCENARIOS.map((s) => s.scenario).sort());
    });

    const dialogKeys = harness.dialogKeys;
    if (dialogKeys) {
      // a person answers a dialog the way `norn story answer` offers: an option's number, yes or no
      test("dialog keys: the first option, yes and no each name keys, and free text names none, so it is never typed into a dialog", () => {
        for (const answer of ["1", "yes", "no"]) {
          const keys = dialogKeys(answer);
          expect({ answer, some: (keys?.length ?? 0) > 0 }).toEqual({ answer, some: true });
          for (const k of keys ?? []) expect("text" in k ? typeof k.text : ["enter", "up", "down", "esc"].includes(k.key)).toBe("text" in k ? "string" : true);
        }
        expect(dialogKeys("please go ahead and do it")).toBeNull();
      });
    }
  });

  describe.each(recordings.map((s) => [s.scenario, s] as const))(`${label} conformance: %s`, (_name, s) => {
    const byStep = eventsByStep(harness, s);
    const all = byStep.flat();
    const spec = HARNESS_SCENARIOS.find((x) => x.scenario === s.scenario);
    const readings = () => s.checks.map((c) => ({ c, ...readAt(byStep, c.after, c.now, opts.silentAfterMs) }));

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
      const reading = readAt(byStep, c.after, c.now, opts.silentAfterMs);
      expect({ after: c.after, now: c.now, ...project(reading, c.expect) }).toEqual({ after: c.after, now: c.now, ...c.expect });
    });

    test("an ask or a permission keeps one id at every instant it is open, so it never flickers", () => {
      const seen = new Map<string, Set<string>>();
      const note = (key: string, id: string) => seen.set(key, (seen.get(key) ?? new Set()).add(id));
      for (const { facts } of readings()) {
        if (facts.ask) note(`ask:${facts.ask.question}`, facts.ask.id);
        if (facts.permission) note(`permission:${facts.permission.prompt}`, facts.permission.id);
      }
      for (const [what, ids] of seen) expect({ what, ids: ids.size }).toEqual({ what, ids: 1 });
    });

    test("the hooks replayed out of order and twice over give the same view", () => {
      // a hook can be delivered late or retried; the reducer reads the log, not the arrival order
      const replayed = [...all].reverse().concat(all.filter((_, i) => i % 2 === 0));
      expect(reduceSession(replayed)).toEqual(reduceSession(all));
    });

    for (const c of missing) {
      contractTest(opts, `${s.scenario}: without ${c}: none of its events, and never its activity`, async () => {
        const { events, activity } = UNREPORTED[c];
        expect(all.filter((e) => events.includes(e.type))).toEqual([]);
        // every instant a check names, and an hour past the last step: no read leads to the activity
        const last = s.steps.at(-1)?.at as string;
        const late = new Date(Date.parse(last) + 3_600_000).toISOString();
        const activities = [...readings().map((r) => r.facts.activity), classifySession(reduceSession(all), late, opts).activity];
        expect(activities.filter((a) => a === activity)).toEqual([]);
      });
    }

    const needs = spec?.needs;
    if (needs !== undefined && !harness.capabilities[needs]) {
      contractTest(opts, `${s.scenario}: without ${needs}, the situation still reads as a wait with a reason, never as a silent agent`, async () => {
        expect(readings().filter((r) => r.facts.silent).map((r) => ({ after: r.c.after, now: r.c.now }))).toEqual([]);
      });
    }
  });
}
