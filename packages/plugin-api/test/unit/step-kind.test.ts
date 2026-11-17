import { describe, expect, test } from "bun:test";
import { Type } from "@sinclair/typebox";
import { defineNornPlugin, ok, type StepKindDefinition, stepKindAnswerProblem, stepKindProblems, WAITING_OUTCOME } from "../../src/index.ts";

function kind(over: Partial<StepKindDefinition> = {}): StepKindDefinition {
  return {
    name: "open-pr",
    configSchema: Type.Object({ draft: Type.Optional(Type.Boolean()) }),
    outcomes: ["done", "conflict"],
    mode: "effect",
    run: async () => ok({ outcome: "done" }),
    ...over,
  };
}

describe("defineNornPlugin: step kinds", () => {
  test("keeps step kinds, frozen, and a plugin written against ^1.2 still loads", () => {
    const openPr = kind();
    const awaitMerge = kind({ name: "await-merge", mode: "wait", outcomes: ["merged", "stale"], configSchema: Type.Object({}) });
    const plugin = defineNornPlugin({ name: "p", api: "^1.3", provides: { stepKinds: { "open-pr": openPr, "await-merge": awaitMerge } } });
    expect(plugin.provides.stepKinds?.["open-pr"]).toBe(openPr);
    expect(plugin.provides.stepKinds?.["await-merge"]).toBe(awaitMerge);
    expect(Object.isFrozen(plugin.provides.stepKinds)).toBe(true);
    expect(defineNornPlugin({ name: "old", api: "^1.2", provides: {} }).provides).toEqual({});
  });

  test("refuses a step kind that breaks the contract, naming the kind and every problem", () => {
    const refusal = (key: string, k: unknown) => () => defineNornPlugin({ name: "p", api: "^1", provides: { stepKinds: { [key]: k as StepKindDefinition } } });
    expect(refusal("open-pr", kind({ name: "push" }))).toThrow('norn plugin p: step kind open-pr needs name "open-pr", the key it is provided under');
    expect(refusal("open-pr", { ...kind(), run: undefined, mode: "sometimes" })).toThrow('norn plugin p: step kind open-pr mode must be "effect" or "wait"; lacks run');
    expect(refusal("gate", kind({ name: "gate" }))).toThrow("step kind gate is a name the kernel keeps for itself");
    expect(refusal("outcomes", kind({ name: "outcomes" }))).toThrow("step kind outcomes is a name the kernel keeps for itself");
    expect(refusal("Open", kind({ name: "Open" }))).toThrow("step kind Open name must match ^[a-z][a-z0-9-]*$");
    expect(refusal("", kind({ name: "" }))).toThrow("norn plugin p: provides a step kind with an empty key");
  });

  test("outcomes are declared, distinct outcome names, and never the implied waiting", () => {
    expect(stepKindProblems("open-pr", kind({ outcomes: [] }))).toEqual(["needs at least one outcome"]);
    expect(stepKindProblems("open-pr", kind({ outcomes: ["done", "done"] }))).toEqual(["outcomes repeat"]);
    expect(stepKindProblems("open-pr", kind({ outcomes: ["Done", "x y"] }))).toEqual(['outcomes "Done", "x y" are not outcome names']);
    expect(stepKindProblems("open-pr", kind({ outcomes: [WAITING_OUTCOME, "merged"], mode: "wait" }))).toEqual([
      "outcome waiting is implied for a wait kind and never declared",
    ]);
  });

  test("config keys may not shadow a step key or the head itself", () => {
    const shadow = kind({ configSchema: Type.Object({ outcomes: Type.String(), "open-pr": Type.String(), base: Type.String() }) });
    expect(stepKindProblems("open-pr", shadow)).toEqual(["config keys outcomes, open-pr clash with step keys"]);
    expect(stepKindProblems("open-pr", { ...kind(), configSchema: undefined })).toEqual(["needs a configSchema"]);
    expect(stepKindProblems("open-pr", null)).toEqual(["is not an object"]);
  });
});

describe("stepKindAnswerProblem", () => {
  const effect = kind();
  const wait = kind({ name: "await-merge", mode: "wait", outcomes: ["merged", "stale"] });

  test("a declared outcome passes, and waiting only from a wait kind", () => {
    expect(stepKindAnswerProblem(effect, { outcome: "conflict" })).toBeNull();
    expect(stepKindAnswerProblem(wait, { outcome: WAITING_OUTCOME })).toBeNull();
    expect(stepKindAnswerProblem(effect, { outcome: WAITING_OUTCOME })).toBe("step kind open-pr is an effect and cannot answer waiting");
  });

  test("an undeclared or missing outcome is named", () => {
    expect(stepKindAnswerProblem(wait, { outcome: "closed" })).toBe('step kind await-merge answered "closed", which it does not declare');
    expect(stepKindAnswerProblem(wait, { detail: 1 })).toBe("step kind await-merge answered no outcome");
    expect(stepKindAnswerProblem(wait, null)).toBe("step kind await-merge answered no outcome");
  });
});
