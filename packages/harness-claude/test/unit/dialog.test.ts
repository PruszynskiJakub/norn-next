import { describe, expect, test } from "bun:test";
import { claudeHarness } from "../../src/index.ts";

describe("claude's dialog keys", () => {
  const keys = (answer: string) => claudeHarness.dialogKeys?.(answer);

  test("an option's number is typed and confirmed, as Claude Code's numbered menus take it", () => {
    expect(keys("1")).toEqual([{ text: "1" }, { key: "enter" }]);
    expect(keys(" 2 ")).toEqual([{ text: "2" }, { key: "enter" }]);
  });

  test("yes picks the first option, and no dismisses the dialog, which Claude Code reads as a refusal", () => {
    expect(keys("yes")).toEqual([{ text: "1" }, { key: "enter" }]);
    expect(keys("Y")).toEqual([{ text: "1" }, { key: "enter" }]);
    expect(keys("no")).toEqual([{ key: "esc" }]);
  });

  test("anything else names no keys, so it is refused rather than typed into the dialog", () => {
    for (const a of ["", "0", "12", "allow it", "maybe"]) expect([a, keys(a)]).toEqual([a, null]);
  });
});
