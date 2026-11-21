import { describe, expect, test } from "bun:test";
import { Type } from "@sinclair/typebox";
import { defineNornPlugin, ok, type StepKindDefinition, stepKindAnswerProblem, stepKindProblems, type Vcs, WAITING_OUTCOME } from "../../src/index.ts";

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

  test("`produces` and `writes` are step keys (plugin API 1.20), so no step kind takes either as its name or a config key", () => {
    for (const key of ["produces", "writes"]) {
      expect(stepKindProblems("open-pr", kind({ configSchema: Type.Object({ [key]: Type.String() }) }))).toEqual([`config keys ${key} clash with step keys`]);
      expect(stepKindProblems(key, kind({ name: key }))).toEqual(["is a name the kernel keeps for itself"]);
    }
  });
});

describe("step kind reads (plugin API 1.20)", () => {
  test("a kind may declare what it reads: a name an earlier step must produce, or one with the fallback it takes without it", () => {
    expect(stepKindProblems("open-pr", kind({ reads: ["pr_body", { name: "notes", fallback: "opens the change with no notes" }] }))).toEqual([]);
    expect(stepKindProblems("open-pr", kind({ reads: [] }))).toEqual([]);
    const plugin = defineNornPlugin({ name: "p", api: "^1.20", provides: { stepKinds: { "open-pr": kind({ reads: ["pr_body"] }) } } });
    expect(plugin.provides.stepKinds?.["open-pr"]?.reads).toEqual(["pr_body"]);
  });

  test("a read is an input name, named once, and an optional one says what the kind does without it", () => {
    expect(stepKindProblems("open-pr", kind({ reads: "pr_body" as never }))).toEqual(["reads must be a list"]);
    expect(stepKindProblems("open-pr", kind({ reads: ["PR body", { name: "x y", fallback: "f" }] }))).toEqual(['reads "PR body", "x y" are not input names']);
    expect(stepKindProblems("open-pr", kind({ reads: ["pr_body", { name: "pr_body", fallback: "f" }] }))).toEqual(["reads repeat"]);
    expect(stepKindProblems("open-pr", kind({ reads: [{ name: "pr_body", fallback: " " }, 7 as never] }))).toEqual(["a read is a name, or {name, fallback} with the fallback it takes without it"]);
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

describe("step kind slots", () => {
  test("a kind reads the configured slots from its input without naming a provider, and runs without them", async () => {
    const pushKind = kind({
      name: "push",
      outcomes: ["pushed", "no-vcs"],
      run: async (input) => ok({ outcome: input.slots?.vcs ? "pushed" : "no-vcs", detail: input.slots?.vcs?.name }),
    });
    const ctx = {} as Parameters<StepKindDefinition["run"]>[1];
    const base = { unit: "gh-1", story: "gh-1", step: "push", config: {} };
    const vcs = { name: "git" } as unknown as Vcs;
    expect(await pushKind.run({ ...base, slots: { vcs } }, ctx)).toEqual(ok({ outcome: "pushed", detail: "git" }));
    expect(await pushKind.run(base, ctx)).toEqual(ok({ outcome: "no-vcs", detail: undefined }));
  });
});
