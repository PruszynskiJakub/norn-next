import { describe, expect, test } from "bun:test";
import { check } from "@norn/schema";
import { Type } from "@sinclair/typebox";
import { BUILTIN_SIGNALS, defineNornPlugin, ok, type SignalSourceDefinition, signalSourceProblems, STEP_KEYWORDS } from "../../src/index.ts";

const ciFailed: SignalSourceDefinition = {
  params: Type.Object({ checks: Type.Optional(Type.Array(Type.String())) }, { additionalProperties: false }),
  read: async (story) => ok(story.change ? { type: "ci-failed", source: "forge", id: story.change.head_sha } : null),
};

describe("the signal source slot", () => {
  test("keeps a plugin's sources by signal name, frozen, under plugin API 1.19", () => {
    const plugin = defineNornPlugin({ name: "forge-ci", api: "^1.19", provides: { signals: { "ci-failed": ciFailed } } });
    expect(plugin.provides.signals?.["ci-failed"]).toBe(ciFailed);
    expect(Object.isFrozen(plugin.provides.signals)).toBe(true);
  });

  test("refuses a source without read, one named like no outcome, and one taking a signal the host reports itself", () => {
    expect(() => defineNornPlugin({ name: "p", api: "^1", provides: { signals: { "ci-failed": {} as unknown as SignalSourceDefinition } } })).toThrow(
      "norn plugin p: signal ci-failed lacks read",
    );
    expect(signalSourceProblems("CI Failed", ciFailed)).toEqual(["name must match ^[a-z][a-z0-9_-]*$"]);
    expect(signalSourceProblems("stale", ciFailed)).toEqual(["is a signal the host reports itself"]);
    expect(signalSourceProblems("ci-failed", { read: ciFailed.read, params: 3 })).toEqual(["params must be a schema"]);
    expect(signalSourceProblems("ci-failed", null)).toEqual(["is not an object"]);
  });

  test("refuses a source named like an outcome the kernel reserves: a wait kind's waiting, exhausted, or a built-in step's outcome", () => {
    for (const name of ["waiting", "exhausted", "approve", "reject", "pass", "fail", "done", "conflict", "stuck", "died"]) {
      expect(signalSourceProblems(name, ciFailed)).toEqual(["is an outcome the kernel reserves"]);
    }
    expect(() => defineNornPlugin({ name: "p", api: "^1.19", provides: { signals: { waiting: ciFailed } } })).toThrow("norn plugin p: signal waiting is an outcome the kernel reserves");
    expect(signalSourceProblems("ci-failed", ciFailed)).toEqual([]);
  });

  test("the host's own signals: stale and unpushed from the vcs, timeout from the clock taking after:", () => {
    expect(Object.values(BUILTIN_SIGNALS).map((s) => [s.name, s.source])).toEqual([
      ["stale", "vcs"],
      ["unpushed", "vcs"],
      ["timeout", "clock"],
    ]);
    const params = BUILTIN_SIGNALS.timeout?.params ?? Type.Never();
    expect(check(params, { after: "48h" }).ok).toBe(true);
    expect(check(params, {}).ok).toBe(false);
    expect(check(params, { after: "soon" }).ok).toBe(false);
  });

  test("`on` is a step key, so no step kind can take it as a config key", () => {
    expect(STEP_KEYWORDS).toContain("on");
  });
});
