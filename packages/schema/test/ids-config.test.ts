import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { JSON_DIR, renderSchema } from "../scripts/emit.ts";
import {
  DEFAULT_CONFIG,
  SCHEMAS,
  type SchemaName,
  isUlid,
  parseDuration,
  parseReceiptFileName,
  parseSliceKey,
  parseStoryKey,
  receiptFileName,
  resolveConfig,
  sliceBranch,
  sliceKey,
  slugify,
  storyBranch,
  storyKey,
  storyOf,
  ulid,
  ulidTime,
  validate,
} from "../src/index.ts";

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
    expect(parseReceiptFileName("0007-done.json")).toEqual({ n: 7, kind: "done" });
    expect(parseReceiptFileName("7-done.json")).toBeNull();
  });
  test("durations", () => {
    expect(parseDuration("30s")).toBe(30_000);
    expect(parseDuration("1h30m")).toBe(5_400_000);
    expect(parseDuration("250ms")).toBe(250);
    expect(() => parseDuration("10 min")).toThrow();
  });
});

describe("config", () => {
  test("defaults are a valid resolved config", () => {
    expect(validate("resolved-config", DEFAULT_CONFIG).ok).toBe(true);
    expect(resolveConfig()).toEqual(DEFAULT_CONFIG);
  });
  test("claude runs in auto permission mode unless a layer replaces its entry", () => {
    expect(resolveConfig().agents.claude?.args).toEqual(["--permission-mode", "auto"]);
    expect(resolveConfig({ agents: { claude: { adapter: "claude" } } }).agents.claude?.args).toBeUndefined();
  });
  test("layer schema", () => {
    expect(
      validate("config", {
        agents: { codex: { adapter: "codex", model: "gpt-5" } },
        runner: { adapter: "herdr" },
        remote: { provider: "glab", label: "ai" },
        slots: { max: 4, env: { DB_NAME: "app_{slot}" } },
        notifiers: [{ adapter: "ntfy", options: { topic: "norn" } }],
        limits: { stalled: "20m" },
      }).ok,
    ).toBe(true);
    expect(validate("config", { remote: { provider: "bitbucket" } }).ok).toBe(false);
    expect(validate("config", { max_agents: 0 }).ok).toBe(false);
    expect(validate("config", { maxAgents: 3 }).ok).toBe(false);
  });
  test("repo overrides user, but only lowers machine caps", () => {
    const c = resolveConfig(
      { max_agents: 3, max_checks: 2, slots: { min: 1, max: 6 }, runner: { adapter: "herdr" }, remote: { label: "mine" } },
      { max_agents: 5, max_checks: 1, slots: { min: 2, max: 8, port_base: 5000 }, remote: { provider: "glab" }, default_mode: "auto" },
    );
    expect(c.max_agents).toBe(3);
    expect(c.max_checks).toBe(1);
    expect(c.slots).toMatchObject({ min: 2, max: 6, port_base: 5000 });
    expect(c.remote).toMatchObject({ provider: "glab", label: "mine", git_remote: "origin" });
    expect(c.runner).toEqual({ adapter: "herdr" });
    expect(c.default_mode).toBe("auto");
    expect(resolveConfig({ runner: { adapter: "herdr" } }, { runner: null }).runner).toBeNull();
  });
});

describe("published JSON schemas", () => {
  test.each(Object.keys(SCHEMAS) as SchemaName[])("json/%s.schema.json is up to date (bun run schema:emit)", (name) => {
    expect(readFileSync(join(JSON_DIR, `${name}.schema.json`), "utf8")).toBe(renderSchema(name));
  });
});
