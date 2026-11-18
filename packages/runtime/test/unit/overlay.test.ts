import { describe, expect, test } from "bun:test";
import { deepMerge, getKey, overlay, replaceWhole } from "../../src/index.ts";

describe("overlay › replaceWhole", () => {
  test("the highest layer that sets a value wins whole, and an absent layer sets nothing", () => {
    const resolved = overlay(
      [
        { label: "pack", value: ["--a", "--b"] },
        { label: "user", value: ["--c"] },
        { label: "repo", value: null },
        { label: "local", value: undefined },
      ],
      replaceWhole,
    );
    expect(resolved.value).toEqual(["--c"]);
    expect(resolved.origins).toEqual({ "": "user" });
    expect(resolved.originOf("")).toBe("user");
  });

  test("no layer sets a value: nothing resolves and no layer is its origin", () => {
    const resolved = overlay([{ label: "user", value: null }], replaceWhole);
    expect(resolved.value).toBeUndefined();
    expect(resolved.origins).toEqual({});
    expect(resolved.originOf("")).toBeNull();
  });
});

describe("overlay › deepMerge replaces lists and scalars by the replaceWhole rule", () => {
  const lower = { executor: { args: ["--a", "--b"], model: "small" }, intake: { assignee: "me", label: "norn" } };
  const upper = { executor: { args: ["--c"] }, intake: { assignee: "you" } };

  test("each list or scalar leaf a higher layer sets is the one replaceWhole resolves over the two", () => {
    const merged = overlay(
      [
        { label: "user", value: lower },
        { label: "repo", value: upper },
      ],
      deepMerge(),
    ).value;
    for (const key of ["executor.args", "intake.assignee"]) {
      const whole = overlay(
        [
          { label: "user", value: getKey(lower, key) },
          { label: "repo", value: getKey(upper, key) },
        ],
        replaceWhole,
      ).value;
      expect(getKey(merged, key)).toEqual(whole);
    }
    expect(getKey(merged, "executor.model")).toBe("small");
    expect(getKey(merged, "intake.label")).toBe("norn");
  });

  test("an explicit null in a higher layer is a value that replaces the lower one, not an absent layer", () => {
    const merged = overlay(
      [
        { label: "user", value: lower },
        { label: "repo", value: { intake: { assignee: null } } },
      ],
      deepMerge(),
    ).value;
    expect(getKey(merged, "intake.assignee")).toBeNull();
  });

  test("the merged value shares no list with a layer", () => {
    const merged = overlay([{ label: "user", value: lower }, { label: "repo", value: upper }], deepMerge()).value;
    (getKey(merged, "executor.args") as string[]).push("--x");
    expect(upper.executor.args).toEqual(["--c"]);
  });
});
