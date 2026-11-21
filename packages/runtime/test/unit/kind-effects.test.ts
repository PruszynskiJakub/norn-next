/** The effects the runtime hands the loader for each step kind: the core's for a kind over a slot. */
import { describe, expect, test } from "bun:test";
import { defineNornPlugin, type StepKindDefinition } from "@norn/plugin-api";
import { Type } from "@sinclair/typebox";
import { collectStepKinds } from "../../src/index.ts";

const kind = (name: string, over: Partial<StepKindDefinition>): StepKindDefinition => ({ name, configSchema: Type.Object({}), outcomes: ["done"], mode: "effect", run: async () => ({ ok: true, value: { outcome: "done" } }), ...over });

describe("collected step kinds", () => {
  test("a kind over a slot takes the core's effects, a plugin's own kind those it declares", () => {
    const forge = defineNornPlugin({ name: "other-forge", api: "^1", provides: { stepKinds: { "await-merge": kind("await-merge", { slot: "forge", mode: "wait", outcomes: ["merged"] }) } } });
    const preview = defineNornPlugin({ name: "vercel", api: "^1", provides: { stepKinds: { preview: kind("preview", { effects: ["outward"] }) } } });
    const r = collectStepKinds([forge, preview]);
    if (!r.ok) throw new Error(r.failure.message);
    expect(r.value["await-merge"]?.effects).toEqual(["forge-write"]);
    expect(r.value.preview?.effects).toEqual(["outward"]);
  });
});
