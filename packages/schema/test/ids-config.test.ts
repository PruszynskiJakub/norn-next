import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { JSON_DIR, renderSchema } from "../scripts/emit.ts";
import {
  DEFAULT_CONFIG,
  explainConfig,
  SCHEMAS,
  type SchemaName,
  isGitSha,
  isUlid,
  parseDuration,
  parseReceiptFileName,
  parseSliceFileName,
  parseSliceKey,
  parseSpecDirName,
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
  test("spec folder and slice file names", () => {
    expect(parseSpecDirName("gh-123-fix-login")).toEqual({ story: "gh-123", slug: "fix-login" });
    expect(parseSpecDirName("gl-4-a")).toEqual({ story: "gl-4", slug: "a" });
    for (const bad of ["gh-0-x", "gh-12", "gh-1--x", "gh-1/02-x", "xx-1-a", "gh-1-Fix"]) expect(parseSpecDirName(bad)).toBeNull();
    expect(parseSliceFileName("03-add-form.md")).toEqual({ nn: "03", slug: "add-form" });
    expect(parseSliceFileName("123-x.md")).toEqual({ nn: "123", slug: "x" });
    for (const bad of ["3-x.md", "03-x.txt", "03-.md", "03-x"]) expect(parseSliceFileName(bad)).toBeNull();
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

describe("explainConfig (norn config, K2)", () => {
  const entry = (entries: ReturnType<typeof explainConfig>, key: string) => entries.find((e) => e.key === key);

  test("each resolved setting once, credited to the last layer that set the value in effect", () => {
    const e = explainConfig({ runner: { adapter: "herdr" }, default_mode: "auto", limits: { deadline: "30m" } }, { default_mode: "manual", remote: { label: "team" } });
    expect(entry(e, "runner")).toEqual({ key: "runner", value: { adapter: "herdr" }, source: "user", group: "machine" });
    expect(entry(e, "default_mode")).toMatchObject({ value: "manual", source: "repo", group: "person" });
    expect(entry(e, "limits.deadline")).toMatchObject({ value: "30m", source: "user", group: "team" });
    expect(entry(e, "limits.nudges")).toMatchObject({ value: 2, source: "built-in" });
    expect(entry(e, "remote.label")).toMatchObject({ value: "team", source: "repo" });
    expect(entry(e, "agents.claude")).toMatchObject({ source: "built-in", group: "person" });
    expect(new Set(e.map((x) => x.key)).size).toBe(e.length);
  });

  test("a repo value a machine cap rule ignores is reported, not credited", () => {
    const e = explainConfig({ max_agents: 3, slots: { min: 2 } }, { max_agents: 5, max_checks: 1, slots: { min: 1 } });
    expect(entry(e, "max_agents")).toMatchObject({ value: 3, source: "user", repo_ignored: 5 });
    expect(entry(e, "max_checks")).toMatchObject({ value: 1, source: "repo" });
    expect(entry(e, "max_checks")?.repo_ignored).toBeUndefined();
    expect(entry(e, "slots.min")).toMatchObject({ value: 2, source: "user", repo_ignored: 1 });
  });

  test("an explicit null is a value: a repo runner: null wins", () => {
    expect(entry(explainConfig({ runner: { adapter: "herdr" } }, { runner: null }), "runner")).toMatchObject({ value: null, source: "repo" });
  });
});

describe("published JSON schemas", () => {
  test.each(Object.keys(SCHEMAS) as SchemaName[])("json/%s.schema.json is up to date (bun run schema:emit)", (name) => {
    expect(readFileSync(join(JSON_DIR, `${name}.schema.json`), "utf8")).toBe(renderSchema(name));
  });
});
