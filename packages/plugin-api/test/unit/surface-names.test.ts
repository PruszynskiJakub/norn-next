import { describe, expect, test } from "bun:test";
import { Type } from "@sinclair/typebox";
import {
  BUILTIN_SIGNALS,
  defineNornPlugin,
  ok,
  PLUGIN_NAMESPACES_RESERVED,
  type SignalSourceDefinition,
  signalSourceProblems,
  STEP_KEYS,
  STEP_KEYWORDS,
  type StepKindDefinition,
  stepKindProblems,
} from "../../src/index.ts";

const kind = (over: Partial<StepKindDefinition> = {}): StepKindDefinition => ({
  name: "preview",
  configSchema: Type.Object({}),
  outcomes: ["done"],
  mode: "effect",
  run: async () => ok({ outcome: "done" }),
  ...over,
});
const source: SignalSourceDefinition = { read: async () => ok(null) };

describe("a step kind's surface name (plugin API 1.21)", () => {
  test("a kind over a slot says which, and a workflow names it <slot>.<kind>; any other kind is named after its plugin", () => {
    for (const slot of ["vcs", "forge", "tracker"] as const) expect(stepKindProblems("open-pr", kind({ name: "open-pr", slot }))).toEqual([]);
    expect(stepKindProblems("preview", kind())).toEqual([]);
  });

  test("a slot a kind cannot work over is refused", () => {
    expect(stepKindProblems("preview", kind({ slot: "store" as never }))).toEqual(['slot must be "vcs", "forge" or "tracker"']);
  });

  test("a signal source over a slot says which, as a kind does", () => {
    expect(signalSourceProblems("ci-failed", { ...source, slot: "forge" })).toEqual([]);
    expect(signalSourceProblems("ci-failed", { ...source, slot: "clock" as never })).toEqual(['slot must be "vcs", "forge" or "tracker"']);
  });

  test("the host's signals are vcs.stale, vcs.unpushed and norn.timeout", () => {
    expect(Object.values(BUILTIN_SIGNALS).map((s) => `${s.namespace}.${s.name}`)).toEqual(["vcs.stale", "vcs.unpushed", "norn.timeout"]);
  });

  test("a plugin may not be named like a slot or the core, whose names lead a surface name", () => {
    expect(PLUGIN_NAMESPACES_RESERVED).toEqual(["norn", "vcs", "forge", "tracker", "store", "harness", "runner", "pack"]);
    for (const name of PLUGIN_NAMESPACES_RESERVED)
      expect(() => defineNornPlugin({ name, api: "^1", provides: {} })).toThrow(`norn plugin ${name}: is named like the ${name === "norn" ? "core" : "slot"} ${name}, which leads a surface name`);
    expect(defineNornPlugin({ name: "vercel", api: "^1.21", provides: { stepKinds: { preview: kind() }, signals: { deployed: source } } }).name).toBe("vercel");
  });
});

describe("the closed step keys", () => {
  test("a step is written with thirteen keys, and the set never grows: a kind's settings go under with:", () => {
    expect(STEP_KEYS).toEqual(["by", "do", "with", "reads", "produces", "allow", "attended", "limits", "outcomes", "on", "description", "use", "like"]);
  });

  test("every step key, and every key of the older form a pinned document holds, is kept from a step kind's name and config keys", () => {
    for (const key of STEP_KEYS) expect(STEP_KEYWORDS).toContain(key);
    for (const key of ["do", "with", "reads", "allow", "limits"]) {
      expect(stepKindProblems(key, kind({ name: key }))).toEqual(["is a name the kernel keeps for itself"]);
      expect(stepKindProblems("preview", kind({ configSchema: Type.Object({ [key]: Type.String() }) }))).toEqual([`config keys ${key} clash with step keys`]);
    }
  });
});
