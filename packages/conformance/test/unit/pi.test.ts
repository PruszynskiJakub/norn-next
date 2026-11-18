/**
 * Conformance of the pi harness to the same scenarios as every harness: the payloads norn's pi
 * extension forwards go through piHarness.normalize into the kernel's reducer and classifier. pi
 * reports no subagents and no limits, so its recordings of those scenarios show the degraded reads.
 * The recordings are derived from pi's documented events (each says so); the live canary in the
 * integration tier is what catches a pi release that sends something else.
 */
import { describe, expect, test } from "bun:test";
import { eventsByStep, harnessConformance, type HookStep, project, readAt, type Scenario } from "@norn/conformance";
import { piHarness } from "@norn/harness-pi";
import { loadRecordings, SILENT_AFTER_MS } from "./recordings.ts";

const recordings = loadRecordings("pi");

harnessConformance("pi", piHarness, recordings, { silentAfterMs: SILENT_AFTER_MS });

describe("pi recordings", () => {
  test("each says it was derived, not captured", () => {
    expect(recordings.filter((s) => !s.derived_from?.startsWith("Derived, not recorded")).map((s) => s.scenario)).toEqual([]);
  });
});

describe("pi: the same dialog opened twice", () => {
  // the shape of pi's own confirm-destructive extension: a fixed title asked again later
  const SESSION = { session_id: "0199-pi", transcript_path: "/s/0199-pi.jsonl", cwd: "/w" };
  const dialog = (hook: string, at: string, extra: Record<string, unknown> = {}): HookStep => ({ hook, at, payload: { hook_event_name: hook, ...SESSION, ...extra } });
  const open = (at: string, seq: string) => dialog("ui_prompt_start", at, { kind: "confirm", title: "Clear session?", prompt_seq: seq });
  const scenario: Scenario = {
    scenario: "dialog-asked-twice",
    description: "derived: a confirm with a fixed title, answered, then asked again",
    run_id: "run-1",
    steps: [
      dialog("session_start", "2026-11-17T10:00:00.000Z", { reason: "startup" }),
      dialog("before_agent_start", "2026-11-17T10:00:01.000Z", { message_type: "user", prompt: "go" }),
      open("2026-11-17T10:00:02.000Z", "mi3k2x0a-1"),
      dialog("ui_prompt_end", "2026-11-17T10:00:03.000Z"),
      open("2026-11-17T10:05:00.000Z", "mi3k2x0a-2"),
    ],
    checks: [],
  };
  test("reads as asking the second time too, so it is never nudged while it waits on the person", () => {
    const byStep = eventsByStep(piHarness, scenario);
    expect(project(readAt(byStep, 4, "2026-11-17T10:00:04.000Z", SILENT_AFTER_MS), { activity: "" })).toEqual({ activity: "working" });
    expect(project(readAt(byStep, 5, "2026-11-17T10:30:00.000Z", SILENT_AFTER_MS), { activity: "", silent: null, ask: { question: "" } })).toEqual({
      activity: "asking",
      silent: false,
      ask: { question: "Clear session?" },
    });
  });
});
