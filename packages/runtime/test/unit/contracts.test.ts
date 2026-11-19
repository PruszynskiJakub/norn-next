import { describe, expect, test } from "bun:test";
import { memoryHost } from "@norn/conformance";
import { type Harness, ok, type Runner } from "@norn/plugin-api";
import { batchName, batchSeq, decodeLaunchHandle, encodeLaunchHandle, HarnessLauncher, runEventsDir, sentDir } from "../../src/index.ts";

describe("launch handle", () => {
  test("round-trips, keeping a runner handle that holds the separator", () => {
    const h = { executor: "claude", unit: "gh-12/03", run_id: "01JRUN", runner: "4242@Tue Nov 17 | 10:00" };
    expect(decodeLaunchHandle(encodeLaunchHandle(h))).toEqual(h);
  });
  test("refuses to encode an empty part or a separator where it would split", () => {
    expect(() => encodeLaunchHandle({ executor: "a|b", unit: "gh-1", run_id: "r", runner: "x" })).toThrow(RangeError);
    expect(() => encodeLaunchHandle({ executor: "a", unit: "gh-1", run_id: "r", runner: "" })).toThrow(RangeError);
  });
  test("a handle this launcher did not make decodes to null", () => {
    for (const s of ["h-01JRUN", "a|b|c", "a||c|d", "|b|c|d"]) expect({ s, h: decodeLaunchHandle(s) }).toEqual({ s, h: null });
  });
});

describe("event log paths", () => {
  const ctx = memoryHost({ repo: { root: "/repo", dataDir: "/m" } });
  test("one folder per unit and run under events-v2, a slice's / spelled -", () => {
    expect(runEventsDir(ctx, "gh-12/03", "r1")).toBe("/m/events-v2/gh-12-03/r1");
    expect(sentDir(ctx, "gh-12", "r1")).toBe("/m/events-v2/gh-12/r1/sent");
  });
  test("batch names sort in seq order and read back their seq", () => {
    expect(batchName(42)).toBe("000000000042.json");
    expect([batchName(100), batchName(9)].sort()).toEqual([batchName(9), batchName(100)]);
    expect(batchSeq(batchName(42))).toBe(42);
    expect(batchSeq("42.json")).toBeNull();
    expect(batchSeq(".000000000042.json.norn-tmp")).toBeNull();
  });
});

describe("harness launcher modes", () => {
  const harness = (paneInput: boolean) => ({ name: "h", capabilities: { blockStop: true, denyTool: true, injectContext: true, subagents: true, limits: true, paneInput } }) as Harness;
  const runner = (caps: Runner["capabilities"]): Runner => ({ name: "r", capabilities: caps, start: async () => ok({ handle: "x" }), alive: async () => ok(true), send: async () => ok(undefined), stop: async () => ok(undefined) });
  const launcher = new HarnessLauncher({
    ctx: memoryHost(),
    executors: {
      pane: { harness: harness(true), runner: runner({ attended: true, headless: false, paneInput: true }) },
      bg: { harness: harness(true), runner: runner({ attended: false, headless: true, paneInput: false }) },
    },
    hookCommand: ["norn", "hook"],
    renderBrief: async () => ok("brief"),
  });

  test("the launcher can do what any executor can", () => {
    expect(launcher.modes).toEqual({ headless: true, attended: true });
  });
  test("each executor's own modes; pane input needs both a pane and a harness that reads typed prompts", () => {
    expect(launcher.modesOf("pane")).toEqual({ headless: false, attended: true, paneInput: true, dialogKeys: false });
    expect(launcher.modesOf("bg")).toEqual({ headless: true, attended: false, paneInput: false, dialogKeys: false });
    expect(launcher.modesOf("nope")).toBeNull();
  });
});
