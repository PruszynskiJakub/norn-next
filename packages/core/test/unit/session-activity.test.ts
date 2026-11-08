import { describe, expect, test } from "bun:test";
import type { HookEventKind, HookFact } from "@norn/schema";
import type { PaneState } from "../../src/ports.ts";
import { hookActivity, movedSince, paneActivity, paneLeftPrompt, sessionActivity } from "../../src/session.ts";
import { at, T0 } from "../fixtures.ts";

const MIN = 60_000;
const hook = (event: HookEventKind, ms: number): HookFact => ({ event, at: at(ms), agent: "claude", native: "X", cwd: "/w" });

describe("hook activity", () => {
  test("no hooks and no pane say nothing", () => {
    expect(sessionActivity({ hooks: [], pane: null })).toEqual({ hook: { kind: "none" }, pane: null });
  });

  test("the newest hook names the activity", () => {
    const newer = hook("session_start", T0 + MIN);
    expect(hookActivity([hook("session_start", T0), newer])).toMatchObject({ kind: "starting", last: newer, at: T0 + MIN, before: "starting" });
    expect(hookActivity([hook("turn_start", T0)])).toMatchObject({ kind: "working", idle_since: T0, before: null });
    expect(hookActivity([hook("tool_use", T0)]).kind).toBe("working");
    expect(hookActivity([hook("tool_use", T0), hook("session_end", T0 + MIN)])).toMatchObject({ kind: "ended", at: T0 + MIN, before: "working" });
  });

  test("a trailing run of waits and turn ends is idle since its first hook", () => {
    expect(hookActivity([hook("tool_use", T0), hook("turn_end", T0 + MIN), hook("turn_end", T0 + 2 * MIN)])).toMatchObject({ kind: "turn_ended", at: T0 + 2 * MIN, idle_since: T0 + MIN, before: "working" });
    expect(hookActivity([hook("turn_end", T0), hook("permission_prompt", T0 + MIN)])).toMatchObject({ kind: "waiting", idle_since: T0, before: null });
    expect(hookActivity([hook("session_end", T0), hook("turn_end", T0 + MIN)])).toMatchObject({ kind: "turn_ended", idle_since: T0 + MIN, before: "ended" });
  });
});

describe("pane activity", () => {
  test("each state maps to an activity; liveness is copied, never judged", () => {
    const cases: [PaneState["state"], string | null][] = [["idle", "turn_ended"], ["done", "turn_ended"], ["waiting_input", "waiting"], ["working", "working"], ["unknown", null]];
    for (const [state, kind] of cases) {
      expect(paneActivity({ alive: true, state })).toEqual({ kind: kind as never, alive: true });
      expect(paneActivity({ alive: false, state })).toEqual({ kind: kind as never, alive: false });
    }
    expect(paneActivity(null)).toBeNull();
    expect(paneActivity(undefined)).toBeNull();
  });

  test("a pane left its prompt only when alive and showing something known that is not a prompt", () => {
    for (const state of ["idle", "done", "working"] as const) {
      expect(paneLeftPrompt({ alive: true, state })).toBe(true);
      expect(paneLeftPrompt({ alive: false, state })).toBe(false);
    }
    for (const state of ["waiting_input", "unknown"] as const) expect(paneLeftPrompt({ alive: true, state })).toBe(false);
    expect(paneLeftPrompt(null)).toBe(false);
  });
});

describe("moved since", () => {
  test("the first hook after the time that is not another wait", () => {
    expect(movedSince([hook("permission_prompt", T0 + MIN), hook("waiting_input", T0 + 2 * MIN)], T0)).toBeNull();
    const moved = hook("tool_use", T0 + 2 * MIN);
    expect(movedSince([hook("permission_prompt", T0 + MIN), moved, hook("turn_end", T0 + 3 * MIN)], T0)).toBe(moved);
    expect(movedSince([hook("tool_use", T0)], T0)).toBeNull();
  });
});
