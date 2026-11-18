import { describe, expect, test } from "bun:test";
import { formatStoryKey, isKeyPrefix, parseStoryKey, sliceBranch, slugify, storyBranch } from "../../src/index.ts";

describe("story keys", () => {
  test("any declared prefix parses, the id a positive integer", () => {
    expect(parseStoryKey("gh-12")).toEqual({ prefix: "gh", id: 12 });
    expect(parseStoryKey("lt-3")).toEqual({ prefix: "lt", id: 3 });
    expect(parseStoryKey("jira2-40")).toEqual({ prefix: "jira2", id: 40 });
  });

  test("anything else is null, never a guess", () => {
    for (const key of ["gh-0", "gh-012", "GH-1", "1gh-2", "gh-", "-3", "gh-1-x", "abcdefghi-1", "gh_1", "gh-1/02", "gh-99999999999999999999", ""])
      expect({ key, parsed: parseStoryKey(key) }).toEqual({ key, parsed: null });
  });

  test("with a prefix, another tracker's key is null", () => {
    expect(parseStoryKey("gh-4", "gh")).toEqual({ prefix: "gh", id: 4 });
    expect(parseStoryKey("lt-4", "gh")).toBeNull();
  });

  test("formatStoryKey round-trips and refuses a bad prefix or id", () => {
    expect(formatStoryKey("lt", 7)).toBe("lt-7");
    expect(parseStoryKey(formatStoryKey("gh", 123))).toEqual({ prefix: "gh", id: 123 });
    expect(() => formatStoryKey("Gh", 1)).toThrow(RangeError);
    expect(() => formatStoryKey("toolongpx", 1)).toThrow(RangeError);
    expect(() => formatStoryKey("gh", 0)).toThrow(RangeError);
    expect(() => formatStoryKey("gh", 1.5)).toThrow(RangeError);
  });

  test("isKeyPrefix: a lowercase letter, then up to seven lowercase letters or digits", () => {
    expect(["gh", "lt", "a", "a1234567"].map(isKeyPrefix)).toEqual([true, true, true, true]);
    expect(["", "1a", "a12345678", "g-h", "GH", 3].map(isKeyPrefix)).toEqual([false, false, false, false, false, false]);
  });
});

describe("branches", () => {
  test("a story branch is the key and the slug", () => {
    expect(storyBranch("lt-3", "fix-login")).toBe("lt-3-fix-login");
    expect(storyBranch("gh-123", "fix-login")).toBe("gh-123-fix-login");
  });

  test("a slice branch pads the slice number to two digits and allows three", () => {
    expect(sliceBranch("gh-123", 3, "add-form")).toBe("gh-123/03-add-form");
    expect(sliceBranch("lt-1", "07", "x")).toBe("lt-1/07-x");
    expect(sliceBranch("lt-1", 104, "x")).toBe("lt-1/104-x");
    expect(() => sliceBranch("lt-1", 1000, "x")).toThrow(RangeError);
  });

  test("a bad key or slug is refused, so no branch is named from it", () => {
    expect(() => storyBranch("gh-0", "x")).toThrow(RangeError);
    expect(() => storyBranch("gh-1", "Fix Login")).toThrow(RangeError);
    expect(() => sliceBranch("nope", 1, "x")).toThrow(RangeError);
    expect(() => sliceBranch("gh-1", 1, "-x")).toThrow(RangeError);
  });

  test("slugify keeps the old rule: ASCII words, 40 characters at a word boundary, untitled when empty", () => {
    expect(slugify("Fix the Łódź login — again!")).toBe("fix-the-lodz-login-again");
    expect(slugify("!!!")).toBe("untitled");
    const long = slugify("one two three four five six seven eight nine ten eleven");
    expect(long.length).toBeLessThanOrEqual(40);
    expect(long).toBe("one-two-three-four-five-six-seven-eight");
    expect(slugify("abc def", 5)).toBe("abc");
  });
});
