import { describe, expect, test } from "bun:test";
import { apiSatisfies, PLUGIN_API_VERSION } from "../../src/index.ts";

describe("apiSatisfies", () => {
  test("the running API is 1.20.0 and satisfies ^1 through ^1.20", () => {
    expect(PLUGIN_API_VERSION).toBe("1.20.0");
    expect(apiSatisfies("^1.1")).toBe(true);
    expect(apiSatisfies("^1.2")).toBe(true);
    expect(apiSatisfies("^1.3")).toBe(true);
    expect(apiSatisfies("^1.4")).toBe(true);
    expect(apiSatisfies("^1.5")).toBe(true);
    expect(apiSatisfies("^1.6")).toBe(true);
    expect(apiSatisfies("^1.7")).toBe(true);
    expect(apiSatisfies("^1.8")).toBe(true);
    expect(apiSatisfies("^1.9")).toBe(true);
    expect(apiSatisfies("^1.10")).toBe(true);
    expect(apiSatisfies("^1.11")).toBe(true);
    expect(apiSatisfies("^1.12")).toBe(true);
    expect(apiSatisfies("^1.13")).toBe(true);
    expect(apiSatisfies("^1.14")).toBe(true);
    expect(apiSatisfies("^1.15")).toBe(true);
    expect(apiSatisfies("^1.16")).toBe(true);
    expect(apiSatisfies("^1.17")).toBe(true);
    expect(apiSatisfies("^1.18")).toBe(true);
    expect(apiSatisfies("^1.19")).toBe(true);
    expect(apiSatisfies("^1.20")).toBe(true);
    expect(apiSatisfies("^1.21")).toBe(false);
    expect(apiSatisfies("^1")).toBe(true);
    expect(apiSatisfies("^1.0")).toBe(true);
    expect(apiSatisfies("^1.0.0")).toBe(true);
  });

  const table: Array<[range: string, version: string, expected: boolean]> = [
    ["^1", "1.4.2", true],
    ["^1.2", "1.2.0", true],
    ["^1.2", "1.9.9", true],
    ["^1.2", "1.1.9", false],
    ["^1.2", "2.0.0", false],
    ["^1.2.3", "1.2.2", false],
    ["^1.2.3", "1.2.3", true],
    ["^2", "1.9.0", false],
    ["^0.3", "0.3.7", true],
    ["^0.3", "0.4.0", false],
    ["^0.0.3", "0.0.3", true],
    ["^0.0.3", "0.0.4", false],
    ["^0", "0.9.0", true],
    ["^0", "1.0.0", false],
    ["^0.0", "0.0.9", true],
    ["^0.0", "0.1.0", false],
  ];
  for (const [range, version, expected] of table)
    test(`${range} against ${version} → ${expected}`, () => {
      expect(apiSatisfies(range, version)).toBe(expected);
    });

  test("anything but a caret range satisfies nothing", () => {
    for (const range of ["1", "1.0.0", ">=1", "~1", "^", "^x", "^1.x", "^01", "*", ""]) expect({ range, ok: apiSatisfies(range) }).toEqual({ range, ok: false });
  });
});
