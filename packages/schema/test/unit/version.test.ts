import { describe, expect, test } from "bun:test";
import { compareVersions, isVersion, versionCore } from "../../src/index.ts";

describe("compareVersions", () => {
  const table: Array<[a: string, b: string, sign: -1 | 0 | 1]> = [
    ["0.36.6", "0.36.6", 0],
    ["0.36.6", "0.36.7", -1],
    ["0.37.0", "0.36.9", 1],
    ["0.9.0", "0.10.0", -1],
    ["1.0.0", "0.99.99", 1],
  ];
  for (const [a, b, sign] of table)
    test(`${a} against ${b} → ${sign}`, () => {
      expect(Math.sign(compareVersions(a, b))).toBe(sign);
    });

  test("anything but X.Y.Z is refused, never guessed at", () => {
    expect(() => compareVersions("0.36", "0.36.6")).toThrow(RangeError);
    expect(isVersion("0.36.6-dev.1")).toBe(false);
  });
});

describe("versionCore", () => {
  test("a pre-release or dev build compares by its core; a name that is no version has none", () => {
    expect(versionCore("0.36.6")).toBe("0.36.6");
    expect(versionCore("0.37.0-dev.3")).toBe("0.37.0");
    expect(versionCore("1.2.3+build.5")).toBe("1.2.3");
    expect(versionCore("dev")).toBeNull();
    expect(versionCore("01.2.3")).toBeNull();
  });
});
