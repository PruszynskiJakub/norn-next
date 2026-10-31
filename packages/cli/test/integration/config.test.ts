/** `norn config list|get|set|unset` (K2, B61–B68): the resolved config with the layer each value came from, and one-value edits of a layer file. */
import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import type { ConfigEntry } from "@norn/schema";
import { repoConfigPath } from "@norn/store";
import { type CliDeps, type CliResult } from "../../src/index.ts";
import { createHarness, FakeInteraction, type Harness } from "../../../../test/support/harness.ts";
import { runChecked } from "../../../../test/support/harness.ts";

type Listed = { entries: Array<ConfigEntry & { meaning: string }> };

describe("norn config list and get", () => {
  let h: Harness;
  beforeAll(async () => {
    h = await createHarness();
    h.write(join(h.home, "config.yaml"), "runner: { adapter: herdr }\ndefault_mode: auto\nmax_agents: 3\n");
    h.write(repoConfigPath(h.root), "runner: null\nmax_agents: 5\nlimits: { deadline: 30m }\n");
  });
  afterAll(() => h.cleanup());

  test("list --json lists every setting with its source, and notes what the layering hides", async () => {
    const r = await h.norn("config", "list", "--json");
    expect(r.exit).toBe(0);
    const v = r.value as Listed & { files: { user: { exists: boolean }; repo: { exists: boolean } }; notes: string[] };
    expect(v.files.user.exists).toBe(true);
    expect(v.files.repo.exists).toBe(true);
    const by = (k: string) => v.entries.find((e) => e.key === k);
    expect(by("runner")).toMatchObject({ value: null, source: "repo", group: "machine" });
    expect(by("default_mode")).toMatchObject({ value: "auto", source: "user", meaning: expect.stringContaining("who starts") });
    expect(by("max_agents")).toMatchObject({ value: 3, source: "user", repo_ignored: 5 });
    expect(by("limits.deadline")).toMatchObject({ value: "30m", source: "repo" });
    expect(v.notes).toEqual(
      expect.arrayContaining([
        expect.stringContaining("no `runner`"),
        expect.stringContaining("`runner` is set by the repo"),
        expect.stringContaining("`max_agents`: the repo's `5` does not apply"),
        expect.stringContaining("`--permission-mode`"),
      ]),
    );
  });

  test("list prints markdown grouped by who a setting belongs to", async () => {
    const r = await h.norn("config", "list");
    expect(r.exit).toBe(0);
    expect(r.stdout).toContain("## This machine (usually in the user file)");
    expect(r.stdout).toContain("| `runner` | none | repo |");
    expect(r.stdout).toContain("| `base_branch` | the remote's default branch | built-in |");
  });

  test("get narrows to that setting or everything under it; an unknown key is a usage error", async () => {
    const mode = await h.norn("config", "get", "default_mode", "--json");
    expect((mode.value as Listed).entries).toMatchObject([{ key: "default_mode", value: "auto", source: "user" }]);
    const one = await h.norn("config", "get", "limits", "--json");
    expect((one.value as Listed).entries.map((e) => e.key)).toEqual(["limits.deadline", "limits.nudges", "limits.retries", "limits.stalled", "limits.attended_wait"]);
    const bad = await h.norn("config", "get", "nope", "--json");
    expect(bad.exit).toBe(2);
    expect(bad.value).toMatchObject({ code: "unknown_key", do_instead: "norn config list" });
  });

  test("get prints the value and the layer that set it", async () => {
    const r = await h.norn("config", "get", "default_mode");
    expect(r.exit).toBe(0);
    expect(r.stdout).toContain("| `default_mode` | `auto` | user |");
  });

  test("the old forms are gone: `config <key>` is a usage error", async () => {
    const r = await h.norn("config", "default_mode", "--json");
    expect(r.exit).toBe(2);
  });
});

describe("norn config set and unset", () => {
  let h: Harness;
  const userFile = () => join(h.home, "config.yaml");
  const repoFile = () => repoConfigPath(h.root);
  const read = (path: string) => {
    try {
      return readFileSync(path, "utf8");
    } catch {
      return null;
    }
  };
  const norn = (deps: Partial<CliDeps>, ...argv: string[]): Promise<CliResult> => runChecked(argv, { ...h.deps, ...deps });
  const get = async (key: string) => ((await h.norn("config", "get", key, "--json")).value as Listed).entries;

  beforeAll(async () => {
    h = await createHarness();
  });
  beforeEach(() => {
    rmSync(userFile(), { force: true });
    rmSync(repoFile(), { force: true });
  });
  afterAll(() => h.cleanup());

  test("--user writes the user file; get shows it from the user layer (B62)", async () => {
    const r = await h.norn("config", "set", "default_mode", "auto", "--user", "--json");
    expect(r.exit).toBe(0);
    expect(r.value).toMatchObject({ file: "user", key: "default_mode", value: "auto" });
    expect(read(userFile())).toBe("default_mode: auto\n");
    expect(read(repoFile())).toBeNull();
    expect(await get("default_mode")).toMatchObject([{ value: "auto", source: "user" }]);
  });

  test("--repo writes the repo config file (B62)", async () => {
    const r = await h.norn("config", "set", "default_mode", "auto", "--repo");
    expect(r.exit).toBe(0);
    expect(r.stdout).toContain("default_mode");
    expect(read(repoFile())).toBe("default_mode: auto\n");
    expect(await get("default_mode")).toMatchObject([{ value: "auto", source: "repo" }]);
  });

  test("dotted keys and YAML values; a list is replaced whole (B63)", async () => {
    h.write(userFile(), "notifiers:\n  - adapter: ntfy\n  - adapter: webhook\n");
    expect((await h.norn("config", "set", "agents.claude.model", "opus", "--repo")).exit).toBe(0);
    expect((await h.norn("config", "set", "limits.deadline", "90m", "--repo")).exit).toBe(0);
    expect((await h.norn("config", "set", "notifiers", "[{adapter: os}]", "--user")).exit).toBe(0);
    expect(await get("agents.claude.model")).toMatchObject([{ value: "opus", source: "repo" }]);
    expect(await get("limits.deadline")).toMatchObject([{ value: "90m", source: "repo" }]);
    expect(await get("notifiers")).toMatchObject([{ value: [{ adapter: "os" }], source: "user" }]);
  });

  test("at a terminal without a file flag it asks which file and writes the chosen one (B64)", async () => {
    const term = new FakeInteraction();
    term.answers = ["repo"];
    const r = await norn({ interaction: term }, "config", "set", "default_mode", "auto");
    expect(r.exit).toBe(0);
    expect(term.picks).toMatchObject([
      { question: "Write to user (~/.norn/config.yaml) or repo (.agents/norn.config.yaml)?", choices: [{ value: "user" }, { value: "repo" }] },
    ]);
    expect(read(repoFile())).toBe("default_mode: auto\n");
    expect(read(userFile())).toBeNull();
  });

  test("leaving the prompt writes nothing", async () => {
    const term = new FakeInteraction();
    term.answers = [null];
    const r = await norn({ interaction: term }, "config", "set", "default_mode", "auto");
    expect(r.exit).toBe(3);
    expect(r.value).toMatchObject({ code: "cancelled" });
    expect(read(repoFile())).toBeNull();
    expect(read(userFile())).toBeNull();
  });

  test("without a file flag under --json or with no TTY: usage error (B65)", async () => {
    for (const [deps, argv] of [
      [{ interaction: new FakeInteraction() }, ["--json"]],
      [{ interaction: new FakeInteraction(false) }, []],
      [{ interaction: null }, []],
    ] as const) {
      const r = await norn(deps, "config", "set", "default_mode", "auto", ...argv);
      expect(r.exit).toBe(2);
      if (argv.length) expect(r.value).toMatchObject({ do_instead: "pass --user or --repo" });
      else expect(r.stdout).toContain("pass --user or --repo");
    }
    expect(read(repoFile())).toBeNull();
    expect(read(userFile())).toBeNull();
  });

  test("an invalid value or an unknown key is refused and the file is left byte-for-byte (B66)", async () => {
    const text = "# team settings\nslots: { max: 9 }\n";
    h.write(repoFile(), text);
    const bad = await h.norn("config", "set", "slots.max", "lots", "--repo", "--json");
    expect(bad.exit).toBe(3);
    expect(bad.value).toMatchObject({ code: "invalid_value", error: expect.stringContaining("slots/max") });
    const unknown = await h.norn("config", "set", "slots.nope", "3", "--repo", "--json");
    expect(unknown.exit).toBe(3);
    expect(unknown.value).toMatchObject({ code: "unknown_key" });
    const top = await h.norn("config", "set", "nope", "3", "--repo", "--json");
    expect(top.value).toMatchObject({ code: "unknown_key" });
    expect(read(repoFile())).toBe(text);
  });

  test("a commented file keeps its comments and key order; only the changed line differs (B67)", async () => {
    const before = [
      "# norn repo config",
      "default_mode: manual # who starts unattended steps",
      "",
      "# limits for every step",
      "limits:",
      "  deadline: 30m # long enough for a slice",
      "  nudges: 2",
      "",
    ].join("\n");
    h.write(repoFile(), before);
    expect((await h.norn("config", "set", "limits.deadline", "90m", "--repo")).exit).toBe(0);
    const after = read(repoFile()) as string;
    const a = before.split("\n");
    const b = after.split("\n");
    expect(b).toHaveLength(a.length);
    const changed = a.map((l, i) => [l, b[i]]).filter(([x, y]) => x !== y);
    expect(changed).toEqual([["  deadline: 30m # long enough for a slice", "  deadline: 90m # long enough for a slice"]]);
  });

  test("setting a key the file lacks adds only its lines; padded comments stay as typed (B67)", async () => {
    const before = "# norn repo config\ndefault_mode: manual   # who starts\nlimits:\n  deadline: 30m  # long enough\n\n# the end\n";
    h.write(repoFile(), before);
    expect((await h.norn("config", "set", "limits.retries", "4", "--repo")).exit).toBe(0);
    const nested = "# norn repo config\ndefault_mode: manual   # who starts\nlimits:\n  deadline: 30m  # long enough\n  retries: 4\n\n# the end\n";
    expect(read(repoFile())).toBe(nested);
    expect((await h.norn("config", "set", "max_agents", "1", "--repo")).exit).toBe(0);
    expect(read(repoFile())).toBe(`${nested}max_agents: 1\n`);
    expect((await h.norn("config", "set", "slots.max", "3", "--repo")).exit).toBe(0);
    expect(read(repoFile())).toBe(`${nested}max_agents: 1\nslots:\n  max: 3\n`);
    h.write(repoFile(), "default_mode: manual   # who starts");
    expect((await h.norn("config", "set", "max_agents", "1", "--repo")).exit).toBe(0);
    expect(read(repoFile())).toBe("default_mode: manual   # who starts\nmax_agents: 1\n");
  });

  test("replacing a list or map rewrites only that value's lines; padded comments stay as typed (B63, B67)", async () => {
    const head = "# norn repo config\ndefault_mode: manual   # who starts\n";
    const tail = "\n# limits\nlimits:\n  deadline: 30m  # long enough\n  nudges: 2\n";
    h.write(repoFile(), `${head}notifiers:\n  - adapter: ntfy\n  - adapter: webhook\n${tail}`);
    expect((await h.norn("config", "set", "notifiers", "[{adapter: os}, {adapter: os}]", "--repo")).exit).toBe(0);
    expect(read(repoFile())).toBe(`${head}notifiers:\n  - adapter: os\n  - adapter: os\n${tail}`);
    expect((await h.norn("config", "set", "limits", "{deadline: 90m}", "--repo")).exit).toBe(0);
    expect(read(repoFile())).toBe(`${head}notifiers:\n  - adapter: os\n  - adapter: os\n\n# limits\nlimits:\n  deadline: 90m\n`);
    h.write(repoFile(), `${head}max_agents: 2  # two\nslots:\n  max: 3\n`);
    expect((await h.norn("config", "set", "max_agents", "[1]", "--repo", "--json")).exit).toBe(3);
    expect((await h.norn("config", "set", "slots", "{max: 4}", "--repo")).exit).toBe(0);
    expect(read(repoFile())).toBe(`${head}max_agents: 2  # two\nslots:\n  max: 4\n`);
  });

  test("a new agents.<name> entry starts from the agent the layers below resolve to", async () => {
    h.write(userFile(), "agents:\n  claude:\n    adapter: claude\n    args: [--mine]\n");
    expect((await h.norn("config", "set", "agents.claude.model", "opus", "--repo")).exit).toBe(0);
    expect(await get("agents.claude")).toMatchObject([{ value: { args: ["--mine"], model: "opus" }, source: "repo" }]);
    rmSync(repoFile());
    rmSync(userFile());
    expect((await h.norn("config", "set", "agents.claude.model", "opus", "--repo")).exit).toBe(0);
    expect(await get("agents.claude")).toMatchObject([{ value: { args: ["--permission-mode", "auto"], model: "opus" }, source: "repo" }]);
  });

  test("--user and --repo together is a usage error", async () => {
    const r = await h.norn("config", "set", "default_mode", "auto", "--user", "--repo", "--json");
    expect(r.exit).toBe(2);
    expect(r.value).toMatchObject({ do_instead: expect.stringContaining("--user or --repo") });
    expect(read(repoFile())).toBeNull();
    expect(read(userFile())).toBeNull();
  });

  test("unset in a commented file removes only the key's line (B67, B68)", async () => {
    const before = ["# norn repo config", "default_mode: manual # who starts unattended steps", "", "# limits for every step", "limits:", "  deadline: 30m", "  nudges: 2", ""];
    h.write(repoFile(), before.join("\n"));
    expect((await h.norn("config", "unset", "default_mode", "--repo")).exit).toBe(0);
    expect(read(repoFile())).toBe(before.filter((l) => !l.startsWith("default_mode")).join("\n"));
    expect((await h.norn("config", "unset", "limits.deadline", "--repo")).exit).toBe(0);
    expect((await h.norn("config", "unset", "limits.nudges", "--repo")).exit).toBe(0);
    expect(read(repoFile())).toBe("# norn repo config\n\n# limits for every step\n");
  });

  test("unset removes the key; get shows the next layer's value (B68)", async () => {
    h.write(userFile(), "# mine\ndefault_mode: auto\nmax_agents: 2\n");
    expect(await get("default_mode")).toMatchObject([{ value: "auto", source: "user" }]);
    const r = await h.norn("config", "unset", "default_mode", "--user", "--json");
    expect(r.exit).toBe(0);
    expect(r.value).toMatchObject({ file: "user", key: "default_mode", removed: true });
    expect(read(userFile())).toBe("# mine\nmax_agents: 2\n");
    expect(await get("default_mode")).toMatchObject([{ value: "manual", source: "built-in" }]);
  });

  test("unsetting a key the file lacks changes nothing, exit 0 (B68)", async () => {
    const text = "# mine\nmax_agents: 2\n";
    h.write(userFile(), text);
    const r = await h.norn("config", "unset", "limits.deadline", "--user", "--json");
    expect(r.exit).toBe(0);
    expect(r.value).toMatchObject({ removed: false });
    expect(read(userFile())).toBe(text);
    const none = await h.norn("config", "unset", "default_mode", "--repo", "--json");
    expect(none.exit).toBe(0);
    expect(read(repoFile())).toBeNull();
  });

  test("unset follows the file-flag rules of set (B68)", async () => {
    h.write(userFile(), "default_mode: auto\n");
    const scripted = await h.norn("config", "unset", "default_mode", "--json");
    expect(scripted.exit).toBe(2);
    expect(scripted.value).toMatchObject({ do_instead: "pass --user or --repo" });
    const term = new FakeInteraction();
    term.answers = ["user"];
    const r = await norn({ interaction: term }, "config", "unset", "default_mode");
    expect(r.exit).toBe(0);
    expect(term.picks).toHaveLength(1);
    expect(read(userFile())).toBe("");
    const unknown = await h.norn("config", "unset", "nope", "--user", "--json");
    expect(unknown).toMatchObject({ exit: 3, value: { code: "unknown_key" } });
  });

  test("trace.retain: a machine setting, 14d by default (B23, D11)", async () => {
    const r = await h.norn("config", "get", "trace", "--json");
    expect(r.exit).toBe(0);
    expect((r.value as { entries: Array<ConfigEntry & { meaning: string }> }).entries).toEqual([
      expect.objectContaining({ key: "trace.retain", value: "14d", source: "built-in", group: "machine", meaning: expect.stringContaining("norn tidy") }),
    ]);
  });
});
