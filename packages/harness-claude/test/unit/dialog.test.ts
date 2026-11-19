import { describe, expect, test } from "bun:test";
import { claudeHarness } from "../../src/index.ts";

describe("claude's dialog keys", () => {
  const keys = (answer: string, dialog?: string) => claudeHarness.dialogKeys?.(answer, dialog);

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

  // Claude Code 2.1's folder trust prompt, as the pane shows it: unnumbered, its cursor on the refusal
  const TRUST = [
    " Quick safety check: Is this a project you created or one you trust?",
    "",
    " Security guide",
    "",
    " ❯ No, exit",
    "   Yes, I trust this folder",
    "",
    " Enter to confirm · Esc to cancel",
  ].join("\n");

  test("in a menu with no numbers, yes moves the cursor to the option that says yes and confirms it, never the first option", () => {
    expect(keys("yes", TRUST)).toEqual([{ key: "down" }, { key: "enter" }]);
    expect(keys("2", TRUST)).toEqual([{ key: "down" }, { key: "enter" }]);
    expect(keys("1", TRUST)).toEqual([{ key: "enter" }]);
    const movedDown = TRUST.replace(" ❯ No, exit", "   No, exit").replace("   Yes, I trust", " ❯ Yes, I trust");
    expect(keys("1", movedDown)).toEqual([{ key: "up" }, { key: "enter" }]);
    expect(keys("3", TRUST)).toBeNull();
    expect(keys("no", TRUST)).toEqual([{ key: "esc" }]);
  });

  test("yes on a dialog read off the pane with no option that says yes, or with no menu at all, names no keys rather than guessing an option", () => {
    const reworded = TRUST.replace("Yes, I trust this folder", "Trust this folder");
    expect(keys("yes", reworded)).toBeNull();
    expect(keys("2", reworded)).toEqual([{ key: "down" }, { key: "enter" }]);
    expect(keys("yes", "Claude is thinking…")).toBeNull();
  });

  test("a numbered menu read off the pane still takes the number, and yes the option that says yes", () => {
    const numbered = ["Do you want to proceed?", "❯ 1. Yes", "  2. Yes, and don't ask again", "  3. No, and tell Claude what to do differently"].join("\n");
    expect(keys("yes", numbered)).toEqual([{ text: "1" }, { key: "enter" }]);
    expect(keys("3", numbered)).toEqual([{ text: "3" }, { key: "enter" }]);
  });
});
