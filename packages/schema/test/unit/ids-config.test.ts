import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { JSON_DIR, renderSchema } from "../../scripts/emit.ts";
import {
  DEFAULT_CONFIG,
  HEADS_REF_PREFIX,
  headsRef,
  RecordConfig,
  SCHEMAS,
  type SchemaName,
  isGitSha,
  isUlid,
  parseDuration,
  parseReceiptFileName,
  parseSliceDirName,
  parseSliceFileName,
  parseSliceKey,
  parseSpecDirName,
  parseStoryKey,
  receiptFileName,
  receiptNumber,
  sliceBranch,
  sliceKey,
  slugify,
  storyBranch,
  storyKey,
  storyOf,
  ulid,
  ulidTime,
  validate,
} from "../../src/index.ts";

describe("ulid", () => {
  test("format, time and monotonic order", () => {
    // ahead of every id minted so far in this process: ulid() is monotonic, so an earlier time is clamped
    const now = ulidTime(ulid()) + 1;
    const ids = Array.from({ length: 1000 }, () => ulid(now));
    expect(ids.every(isUlid)).toBe(true);
    expect([...ids].sort()).toEqual(ids);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ulidTime(ids[0] as string)).toBe(now);
  });
  test("fresh ms sorts after earlier ones", () => {
    const a = ulid();
    const b = ulid(Date.now() + 5);
    expect(a < b).toBe(true);
  });
});

describe("keys and names", () => {
  test("story keys", () => {
    expect(storyKey("gh", 123)).toBe("gh-123");
    expect(storyKey("glab", 45)).toBe("gl-45");
    expect(parseStoryKey("gl-45")).toEqual({ prefix: "gl", provider: "glab", number: 45 });
    expect(parseStoryKey("gh-0")).toBeNull();
    expect(parseStoryKey("gh-12/03")).toBeNull();
    expect(() => storyKey("gh", 0)).toThrow();
  });
  test("slice keys", () => {
    expect(sliceKey("gh-123", 3)).toBe("gh-123/03");
    expect(sliceKey("gh-123", "12")).toBe("gh-123/12");
    expect(parseSliceKey("gh-123/03")).toEqual({ story: "gh-123", nn: "03" });
    expect(parseSliceKey("gh-123/3")).toBeNull();
    expect(storyOf("gh-123/03")).toBe("gh-123");
    expect(storyOf("gl-9")).toBe("gl-9");
    expect(() => storyOf("foo")).toThrow();
  });
  test("slugs", () => {
    expect(slugify("Fix login: OAuth -> SSO!")).toBe("fix-login-oauth-sso");
    expect(slugify("Zażółć gęślą jaźń")).toBe("zazolc-gesla-jazn");
    expect(slugify("   ")).toBe("untitled");
    expect(slugify("a".repeat(60))).toHaveLength(40);
    const s = slugify("one two three four five six seven eight nine ten");
    expect(s.length).toBeLessThanOrEqual(40);
    expect(s.endsWith("-")).toBe(false);
  });
  test("branches and receipts", () => {
    expect(storyBranch("gh-123", "fix-login")).toBe("gh-123-fix-login");
    expect(sliceBranch("gh-123", "3", "add-form")).toBe("gh-123/03-add-form");
    expect(receiptFileName(7, "done")).toBe("0007-done.json");
    expect(receiptNumber(7)).toBe("0007");
    expect(parseReceiptFileName("0007-done.json")).toEqual({ n: 7, kind: "done" });
    expect(parseReceiptFileName("7-done.json")).toBeNull();
  });
  test("spec folder and slice file names", () => {
    expect(parseSpecDirName("gh-123-fix-login")).toEqual({ story: "gh-123", slug: "fix-login" });
    expect(parseSpecDirName("gl-4-a")).toEqual({ story: "gl-4", slug: "a" });
    for (const bad of ["gh-0-x", "gh-12", "gh-1--x", "gh-1/02-x", "xx-1-a", "gh-1-Fix"]) expect(parseSpecDirName(bad)).toBeNull();
    expect(parseSliceFileName("03-add-form.md")).toEqual({ nn: "03", slug: "add-form" });
    expect(parseSliceFileName("123-x.md")).toEqual({ nn: "123", slug: "x" });
    for (const bad of ["3-x.md", "03-x.txt", "03-.md", "03-x"]) expect(parseSliceFileName(bad)).toBeNull();
    expect(parseSliceDirName("03-add-form")).toEqual({ nn: "03", slug: "add-form" });
    expect(parseSliceDirName("123-x")).toEqual({ nn: "123", slug: "x" });
    for (const bad of ["3-x", "1234-x", "03-", "03-Add", "03-x.md", "_story"]) expect(parseSliceDirName(bad)).toBeNull();
    expect(parseSliceDirName("03-", { loose: true })).toEqual({ nn: "03", slug: "" });
    expect(parseSliceDirName("03-Add form.md", { loose: true })).toEqual({ nn: "03", slug: "Add form.md" });
    for (const bad of ["3-x", "1234-x", "03x", "_story"]) expect(parseSliceDirName(bad, { loose: true })).toBeNull();
  });
  test("git shas", () => {
    expect(isGitSha("a".repeat(40))).toBe(true);
    expect(isGitSha("0".repeat(64))).toBe(true);
    for (const bad of ["a".repeat(39), "A".repeat(40), "g".repeat(40), null, undefined, 1]) expect(isGitSha(bad)).toBe(false);
  });
  test("durations", () => {
    expect(parseDuration("30s")).toBe(30_000);
    expect(parseDuration("1h30m")).toBe(5_400_000);
    expect(parseDuration("250ms")).toBe(250);
    expect(() => parseDuration("10 min")).toThrow();
  });
});

describe("config", () => {
  test("the built-in values are a valid resolved config", () => {
    expect(validate("resolved-config", DEFAULT_CONFIG).ok).toBe(true);
  });
  test("no config key turns the heads ref push off: the record config has only its policy, and a push key is refused everywhere", () => {
    expect(Object.keys(RecordConfig.properties)).toEqual(["policy"]);
    for (const name of ["repo-config", "user-config", "local-config"] as const) {
      expect(validate(name, { push: false }).ok).toBe(false);
      expect(validate(name, { heads_ref: false }).ok).toBe(false);
    }
    expect(validate("repo-config", { record: { policy: "local", push: false } }).ok).toBe(false);
  });
  test("the heads ref sits beside the other norn ref prefixes", () => {
    expect(headsRef("gh-7")).toBe("refs/norn/heads/gh-7");
    expect(HEADS_REF_PREFIX).toBe("refs/norn/heads/");
  });
});

describe("published JSON schemas", () => {
  test.each(Object.keys(SCHEMAS) as SchemaName[])("json/%s.schema.json is up to date (bun run schema:emit)", (name) => {
    expect(readFileSync(join(JSON_DIR, `${name}.schema.json`), "utf8")).toBe(renderSchema(name));
  });
});
