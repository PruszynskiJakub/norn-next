/**
 * `norn config list|get|set|unset` (K2, gh-64 B1–B8, B13–B17, B21, B22, B29, B31, B39, B46, B53,
 * B54, D4; B61–B68): three files, each with its own keys; every setting with its value and source;
 * config errors under their own title and exit code; one-value edits of a file.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { chmodSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { CONFIG_FILES, type ConfigEntry, ExitCode } from "@norn/schema";
import { repoConfigPath } from "@norn/store";
import { type CliDeps, type CliResult } from "../../src/index.ts";
import { createHarness, FakeInteraction, type Harness, runChecked, sh } from "../../../../test/support/harness.ts";

type Listed = { entries: Array<ConfigEntry & { meaning: string }> };

const localFile = (h: Harness) => join(h.root, ".agents", "norn.config.local.yaml");
const userFile = (h: Harness) => join(h.home, "config.yaml");
const entries = async (h: Harness, deps?: Partial<CliDeps>) => {
  const r = deps ? await runChecked(["config", "list", "--json"], { ...h.deps, ...deps }) : await h.norn("config", "list", "--json");
  expect(r.exit).toBe(0);
  return (r.value as Listed).entries;
};
const by = (list: ConfigEntry[], key: string) => list.find((e) => e.key === key);

describe("three files and where keys belong (B1–B8)", () => {
  let h: Harness;
  beforeAll(async () => {
    h = await createHarness();
  });
  beforeEach(() => {
    for (const f of [userFile(h), localFile(h), repoConfigPath(h.root)]) rmSync(f, { force: true });
  });
  afterAll(() => h.cleanup());

  test("B1: no file written → every setting built in or derived", async () => {
    const e = await entries(h);
    expect(e.every((x) => x.source === "built-in" || x.source === "derived")).toBe(true);
    expect(by(e, "agent")).toMatchObject({ value: "claude", source: "built-in" });
    expect(by(e, "mode")).toMatchObject({ value: "manual", source: "built-in" });
    expect(by(e, "runner")).toMatchObject({ value: "headless", source: "derived", reason: "herdr not on PATH" });
    expect(by(e, "label")).toMatchObject({ value: "norn", source: "built-in" });
    expect(by(e, "max_agents")).toMatchObject({ value: 9, source: "built-in" });
    expect(by(e, "claim.lease")).toMatchObject({ value: "10m", source: "derived", reason: "interval 30s" });
    expect(by(e, "claim.renew")).toMatchObject({ value: "3m20s", source: "derived" });
  });

  test("B2, B4, B14: the user and team files take their keys, shown with their source", async () => {
    h.write(userFile(h), "max_agents: 4\nmode: auto\nagents: { claude: { model: claude-opus-5-5 } }\n");
    h.write(repoConfigPath(h.root), "base_branch: develop\nworkflow: story\n");
    const e = await entries(h);
    expect(by(e, "max_agents")).toMatchObject({ value: 4, source: "user" });
    expect(by(e, "mode")).toMatchObject({ value: "auto", source: "user" });
    expect(by(e, "agents.claude.model")).toMatchObject({ value: "claude-opus-5-5", source: "user" });
    // B14: setting a model keeps the built-in args
    expect(by(e, "agents.claude.args")).toMatchObject({ value: ["--permission-mode", "auto"], source: "built-in" });
    expect(by(e, "base_branch")).toMatchObject({ value: "develop", source: "repo" });
    expect(by(e, "workflow")).toMatchObject({ value: "story", source: "repo" });
  });

  test("B3, B16: the local file overrides the user file for this repo, agent entries field by field", async () => {
    h.write(userFile(h), "mode: manual\nagents: { claude: { args: [--permission-mode, plan] } }\n");
    h.write(localFile(h), "mode: auto\nagents: { claude: { model: claude-sonnet-5-5 } }\n");
    const e = await entries(h);
    expect(by(e, "mode")).toMatchObject({ value: "auto", source: "local" });
    expect(by(e, "agents.claude.args")).toMatchObject({ value: ["--permission-mode", "plan"], source: "user" });
    expect(by(e, "agents.claude.model")).toMatchObject({ value: "claude-sonnet-5-5", source: "local" });
    const md = await h.norn("config", "get", "mode");
    expect(md.stdout).toContain("| `mode` | `auto` | local |");
  });

  test("B15: args replace the built-in list whole", async () => {
    h.write(userFile(h), "agents: { claude: { args: [] } }\n");
    expect(by(await entries(h), "agents.claude.args")).toMatchObject({ value: [], source: "user" });
  });

  test("B5: a key in the wrong file is config_wrong_file naming the file that takes it", async () => {
    const cases: Array<[string, string, string]> = [
      [repoConfigPath(h.root), "max_agents: 4\n", "`.agents/norn.config.yaml`: `max_agents` belongs in `~/.norn/config.yaml` (machine key)"],
      [userFile(h), "provider: glab\n", "`~/.norn/config.yaml`: `provider` belongs in `.agents/norn.config.yaml` (team key)"],
      [localFile(h), "max_agents: 4\n", "`.agents/norn.config.local.yaml`: `max_agents` belongs in `~/.norn/config.yaml` (machine key)"],
      [repoConfigPath(h.root), "trace: { retain: 30d }\n", "`.agents/norn.config.yaml`: `trace` belongs in `~/.norn/config.yaml` (machine key)"],
    ];
    for (const [file, text, error] of cases) {
      h.write(file, text);
      const r = await h.norn("config", "list", "--json");
      expect(r.exit).toBe(ExitCode.config);
      expect(r.value).toMatchObject({ code: "config_wrong_file", error });
      rmSync(file);
    }
  });

  test("B6, B17, B19, B53: a mistyped key or value is config_invalid naming the file, the key and what is wrong", async () => {
    const cases: Array<[string, string]> = [
      ["max_agent: 4\n", "`~/.norn/config.yaml`: unknown key `max_agent`"],
      ["mode: automatic\n", "`~/.norn/config.yaml`: `mode` must be manual or auto"],
      ["agent: claud\n", "`~/.norn/config.yaml`: `agent` must be one of claude, codex, opencode, gemini"],
      ["agents: { aider: {} }\n", "`~/.norn/config.yaml`: unknown agent `aider`: `agents` takes claude, codex, opencode, gemini"],
      ["max_agents: 12\n", "`~/.norn/config.yaml`: `max_agents` must be 1–9 (there are 9 slots)"],
      ["notify: { webhook: not-a-url }\n", "`~/.norn/config.yaml`: `notify.webhook` must be an http or https URL"],
      // D2: the file's own schema decides, the one an editor checks it with (B50)
      ["notify:\n", "`~/.norn/config.yaml`: `notify` must be a map with `os`, `ntfy`, `webhook`"],
      ["agents: { claude: null }\n", "`~/.norn/config.yaml`: `agents.claude` must be a map with `model` and `args`"],
      ["agents: { codex: { args: [1] } }\n", "`~/.norn/config.yaml`: `agents.codex.args` must be a list of strings"],
      ["agents: { claude: { flags: [] } }\n", "`~/.norn/config.yaml`: unknown key `agents.claude.flags`"],
    ];
    for (const [text, error] of cases) {
      h.write(userFile(h), text);
      const r = await h.norn("config", "list", "--json");
      expect(r.exit).toBe(ExitCode.config);
      expect(r.value).toMatchObject({ code: "config_invalid", error });
    }
  });

  test("B7: every command that loads config shows a config error under its own title, never corrupt", async () => {
    h.write(localFile(h), "mode: automatic\n");
    const tick = await h.norn("tick", "--json");
    expect(tick).toMatchObject({ exit: ExitCode.config, value: { code: "config_invalid" } });
    const r = await h.norn("config", "list");
    expect(r.exit).toBe(ExitCode.config);
    expect(r.stdout).toContain("**Config error (config_invalid):** `.agents/norn.config.local.yaml`: `mode` must be manual or auto");
    expect(r.stdout).not.toContain("Corrupt");
  });

  test("B7: status and story list refuse a config error with its title and exit code", async () => {
    h.write(userFile(h), "max_agent: 4\n");
    for (const argv of [["status"], ["story", "list"]]) {
      const json = await h.norn(...argv, "--json");
      expect(json).toMatchObject({ exit: ExitCode.config, value: { code: "config_invalid" } });
      const r = await h.norn(...argv);
      expect(r.exit).toBe(ExitCode.config);
      expect(r.stdout).toContain("**Config error (config_invalid):**");
    }
  });

  test("B8: an empty or missing file sets nothing", async () => {
    h.write(localFile(h), "");
    h.write(userFile(h), "# only comments\n");
    expect(by(await entries(h), "mode")).toMatchObject({ value: "manual", source: "built-in" });
  });

  test("B39: an old key is config_moved naming its replacement and norn upgrade", async () => {
    const cases: Array<[string, string, string]> = [
      [userFile(h), "default_agent: codex\n", "`~/.norn/config.yaml`: `default_agent` is now `agent`; run `norn upgrade`"],
      [repoConfigPath(h.root), "remote: { label: x }\n", "`.agents/norn.config.yaml`: `remote.label` is gone: the label is always `norn`; run `norn upgrade`"],
      [userFile(h), "runner: { adapter: herdr }\n", "`~/.norn/config.yaml`: `runner` is gone: norn detects it; run `norn upgrade`"],
      [userFile(h), "agents: { claude: { capabilities: [browser] } }\n", "`~/.norn/config.yaml`: `agents.claude.capabilities` is gone, with criteria `needs`; run `norn upgrade`"],
      [repoConfigPath(h.root), "limits: { deadline: 45m }\n", "`.agents/norn.config.yaml`: `limits` moved to each workflow's `defaults:`; run `norn upgrade`"],
    ];
    for (const [file, text, error] of cases) {
      h.write(file, text);
      const r = await h.norn("config", "list", "--json");
      expect(r.exit).toBe(ExitCode.config);
      expect(r.value).toMatchObject({ code: "config_moved", error, do_instead: "norn upgrade" });
      rmSync(file);
    }
  });

  test("B21: trace.retain is a user-file key, 14d by default", async () => {
    expect(by(await entries(h), "trace.retain")).toMatchObject({ value: "14d", source: "built-in", meaning: expect.stringContaining("norn tidy") });
    h.write(userFile(h), "trace: { retain: 30d }\n");
    expect(by(await entries(h), "trace.retain")).toMatchObject({ value: "30d", source: "user" });
  });

  test("B29: herdr on the env's PATH → runner herdr (derived)", async () => {
    const bin = join(h.dir, "bin");
    mkdirSync(bin, { recursive: true });
    writeFileSync(join(bin, "herdr"), "#!/bin/sh\n");
    chmodSync(join(bin, "herdr"), 0o755);
    const e = await entries(h, { env: { ...h.deps.env, PATH: `${bin}:${h.deps.env?.PATH ?? ""}` } });
    expect(by(e, "runner")).toMatchObject({ value: "herdr", source: "derived", reason: "herdr on PATH" });
    const inside = await entries(h, { env: { ...h.deps.env, HERDR_ENV: "1" } });
    expect(by(inside, "runner")).toMatchObject({ value: "herdr", reason: "inside Herdr" });
  });

  test("B22, B54: provider from the remote URL; a host that is neither GitHub nor GitLab is refused", async () => {
    const origin = sh(h.root, ["remote", "get-url", "origin"]).trim();
    try {
      sh(h.root, ["remote", "set-url", "origin", "git@gitlab.com:acme/app.git"]);
      expect(by(await entries(h), "provider")).toMatchObject({ value: "glab", source: "derived", reason: "remote URL" });
      h.write(repoConfigPath(h.root), "provider: gh\n");
      expect(by(await entries(h), "provider")).toMatchObject({ value: "gh", source: "repo" });
      rmSync(repoConfigPath(h.root));
      sh(h.root, ["remote", "set-url", "origin", "git@git.acme.internal:app.git"]);
      const r = await h.norn("config", "list", "--json");
      expect(r.exit).toBe(ExitCode.config);
      expect(r.value).toMatchObject({ code: "config_invalid", error: "`.agents/norn.config.yaml`: can't tell the provider from `git.acme.internal`: set `provider` in `.agents/norn.config.yaml`" });
    } finally {
      sh(h.root, ["remote", "set-url", "origin", origin]);
    }
  });

  test("B31: the git remote is the one the base branch tracks", async () => {
    const remote = sh(h.root, ["remote", "get-url", "origin"]).trim();
    sh(h.root, ["remote", "add", "upstream", remote]);
    sh(h.root, ["config", "branch.main.remote", "upstream"]);
    try {
      expect(by(await entries(h), "git_remote")).toMatchObject({ value: "upstream", source: "derived", reason: "tracked by main" });
    } finally {
      sh(h.root, ["config", "branch.main.remote", "origin"]);
      sh(h.root, ["remote", "remove", "upstream"]);
    }
  });

  test("B46: list prints every setting grouped by the file it belongs in, derived ones with their reason", async () => {
    const r = await h.norn("config", "list");
    expect(r.exit).toBe(0);
    expect(r.stdout).toContain("## This machine (~/.norn/config.yaml)");
    expect(r.stdout).toContain("| `runner` | `headless` | derived: herdr not on PATH |");
    expect(r.stdout).toContain("| `claim.lease` | `10m` | derived: interval 30s |");
    expect(r.stdout).toContain("| `label` | `norn` | built-in |");
    expect(r.stdout).toContain("| `base_branch` | the remote's default branch | built-in |");
  });

  test("get narrows to a setting or everything under it; an unknown key is a usage error", async () => {
    const claim = await h.norn("config", "get", "claim", "--json");
    expect((claim.value as Listed).entries.map((e) => e.key)).toEqual(["claim.lease", "claim.renew"]);
    const bad = await h.norn("config", "get", "nope", "--json");
    expect(bad.exit).toBe(2);
    expect(bad.value).toMatchObject({ code: "unknown_key", do_instead: "norn config list" });
    expect((await h.norn("config", "mode", "--json")).exit).toBe(2);
  });
});

describe("two repos, one user home (B3)", () => {
  let a: Harness;
  let b: Harness;
  beforeAll(async () => {
    [a, b] = await Promise.all([createHarness(), createHarness()]);
  });
  afterAll(() => {
    a.cleanup();
    b.cleanup();
  });

  test("B3: my local file sets mode auto in one repo; in another the user file's manual holds", async () => {
    a.write(userFile(a), "mode: manual\n");
    a.write(localFile(a), "mode: auto\n");
    // b runs with a's home: the same user file, no local file of its own
    const inB = { ...b.deps, env: { ...b.deps.env, NORN_HOME_DIR: a.home } };
    expect(by(await entries(a), "mode")).toMatchObject({ value: "auto", source: "local" });
    expect(by(await entries(b, inB), "mode")).toMatchObject({ value: "manual", source: "user" });
  });
});

describe("norn config set and unset (B62–B68, D4)", () => {
  let h: Harness;
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
    for (const f of [userFile(h), localFile(h), repoConfigPath(h.root)]) rmSync(f, { force: true });
  });
  afterAll(() => h.cleanup());

  test("--user, --local and --repo write their file; get shows the source (B62, D4)", async () => {
    expect((await h.norn("config", "set", "mode", "auto", "--user", "--json")).value).toMatchObject({ file: "user", key: "mode", value: "auto" });
    // B50: a file config set creates starts with the modeline naming its schema copy
    expect(read(userFile(h))).toBe("# yaml-language-server: $schema=config.schema.json\nmode: auto\n");
    expect((await h.norn("config", "set", "mode", "manual", "--local")).exit).toBe(0);
    expect(read(localFile(h))).toBe("# yaml-language-server: $schema=norn.config.local.schema.json\nmode: manual\n");
    expect(await get("mode")).toMatchObject([{ value: "manual", source: "local" }]);
    expect((await h.norn("config", "set", "workflow", "story", "--repo")).exit).toBe(0);
    expect(read(repoConfigPath(h.root))).toBe("# yaml-language-server: $schema=norn.config.schema.json\nworkflow: story\n");
  });

  test("D4: a key the file does not take is refused with config_wrong_file or config_moved; nothing written", async () => {
    const wrong = await h.norn("config", "set", "max_agents", "4", "--repo", "--json");
    expect(wrong).toMatchObject({ exit: 3, value: { code: "config_wrong_file", error: "`.agents/norn.config.yaml`: `max_agents` belongs in `~/.norn/config.yaml` (machine key)", do_instead: "norn config set max_agents 4 --user" } });
    const moved = await h.norn("config", "set", "default_mode", "auto", "--user", "--json");
    expect(moved).toMatchObject({ exit: 3, value: { code: "config_moved" } });
    expect(read(repoConfigPath(h.root))).toBeNull();
    expect(read(userFile(h))).toBeNull();
  });

  test("dotted keys and YAML values; a map key merges, a list is replaced whole (B63)", async () => {
    expect((await h.norn("config", "set", "agents.claude.model", "opus", "--local")).exit).toBe(0);
    expect((await h.norn("config", "set", "notify.ntfy", "https://ntfy.sh/x", "--user")).exit).toBe(0);
    expect((await h.norn("config", "set", "agents.claude.args", "[--verbose]", "--user")).exit).toBe(0);
    expect(await get("agents.claude.model")).toMatchObject([{ value: "opus", source: "local" }]);
    expect(await get("agents.claude.args")).toMatchObject([{ value: ["--verbose"], source: "user" }]);
    expect(await get("notify")).toMatchObject([
      { key: "notify.os", value: true, source: "built-in" },
      { key: "notify.ntfy", value: "https://ntfy.sh/x", source: "user" },
    ]);
  });

  test("at a terminal without a file flag it asks which file and writes the chosen one (B64)", async () => {
    const term = new FakeInteraction();
    term.answers = ["local"];
    const r = await norn({ interaction: term }, "config", "set", "mode", "auto");
    expect(r.exit).toBe(0);
    expect(term.picks).toMatchObject([{ question: "Write to which file?", choices: [{ value: "user" }, { value: "local" }, { value: "repo" }] }]);
    expect(read(localFile(h))).toBe("# yaml-language-server: $schema=norn.config.local.schema.json\nmode: auto\n");
  });

  test("leaving the prompt writes nothing", async () => {
    const term = new FakeInteraction();
    term.answers = [null];
    const r = await norn({ interaction: term }, "config", "set", "mode", "auto");
    expect(r).toMatchObject({ exit: 3, value: { code: "cancelled" } });
    expect(read(userFile(h))).toBeNull();
  });

  test("without a file flag under --json or with no TTY: usage error (B65)", async () => {
    for (const [deps, argv] of [
      [{ interaction: new FakeInteraction() }, ["--json"]],
      [{ interaction: new FakeInteraction(false) }, []],
      [{ interaction: null }, []],
    ] as const) {
      const r = await norn(deps, "config", "set", "mode", "auto", ...argv);
      expect(r.exit).toBe(2);
      if (argv.length) expect(r.value).toMatchObject({ do_instead: "pass --user, --local or --repo" });
      else expect(r.stdout).toContain("pass --user, --local or --repo");
    }
    const both = await h.norn("config", "set", "mode", "auto", "--user", "--local", "--json");
    expect(both).toMatchObject({ exit: 2, value: { error: "--user and --local together: pick one file" } });
  });

  test("an invalid value or an unknown key is refused and the file is left byte-for-byte (B66)", async () => {
    const text = "# mine\nmax_agents: 3\n";
    h.write(userFile(h), text);
    const bad = await h.norn("config", "set", "max_agents", "lots", "--user", "--json");
    expect(bad).toMatchObject({ exit: 3, value: { code: "invalid_value", error: expect.stringContaining("`max_agents` must be 1–9") } });
    expect((await h.norn("config", "set", "notify.nope", "3", "--user", "--json")).value).toMatchObject({ code: "unknown_key" });
    expect((await h.norn("config", "set", "nope", "3", "--user", "--json")).value).toMatchObject({ code: "unknown_key" });
    expect(read(userFile(h))).toBe(text);
  });

  test("a commented file keeps its comments and key order; only the changed line differs (B67)", async () => {
    const before = ["# my norn", "mode: manual # who starts unattended steps", "", "# how I hear", "notify:", "  ntfy: https://ntfy.sh/a # phone", "  os: true", ""].join("\n");
    h.write(userFile(h), before);
    expect((await h.norn("config", "set", "notify.ntfy", "https://ntfy.sh/b", "--user")).exit).toBe(0);
    const changed = before.split("\n").map((l, i) => [l, (read(userFile(h)) as string).split("\n")[i]]).filter(([x, y]) => x !== y);
    expect(changed).toEqual([["  ntfy: https://ntfy.sh/a # phone", "  ntfy: https://ntfy.sh/b # phone"]]);
  });

  test("setting a key the file lacks adds only its lines (B67)", async () => {
    const before = "# mine\nmode: manual   # who starts\nnotify:\n  os: false  # quiet\n\n# the end\n";
    h.write(userFile(h), before);
    expect((await h.norn("config", "set", "notify.webhook", "https://example.com/h", "--user")).exit).toBe(0);
    expect(read(userFile(h))).toBe("# mine\nmode: manual   # who starts\nnotify:\n  os: false  # quiet\n  webhook: https://example.com/h\n\n# the end\n");
  });

  test("unset removes the key; get shows the next file's value (B68)", async () => {
    h.write(userFile(h), "# mine\nmode: auto\nmax_agents: 2\n");
    h.write(localFile(h), "mode: manual\n");
    expect(await get("mode")).toMatchObject([{ value: "manual", source: "local" }]);
    const r = await h.norn("config", "unset", "mode", "--local", "--json");
    expect(r).toMatchObject({ exit: 0, value: { file: "local", key: "mode", removed: true } });
    expect(await get("mode")).toMatchObject([{ value: "auto", source: "user" }]);
    expect((await h.norn("config", "unset", "mode", "--user")).exit).toBe(0);
    expect(read(userFile(h))).toBe("# mine\nmax_agents: 2\n");
    expect(await get("mode")).toMatchObject([{ value: "manual", source: "built-in" }]);
  });

  test("an old or misplaced key can be unset by hand; an unknown one is refused (B68)", async () => {
    h.write(userFile(h), "default_mode: auto\nmax_agents: 2\n");
    expect((await h.norn("config", "unset", "default_mode", "--user")).exit).toBe(0);
    expect(read(userFile(h))).toBe("max_agents: 2\n");
    expect((await h.norn("config", "unset", "limits.deadline", "--user", "--json")).value).toMatchObject({ removed: false });
    expect(await h.norn("config", "unset", "nope", "--user", "--json")).toMatchObject({ exit: 3, value: { code: "unknown_key" } });
  });
});

describe("the team's norn version (gh-61 B3, B4, D4)", () => {
  let h: Harness;
  const read = (path: string) => {
    try {
      return readFileSync(path, "utf8");
    } catch {
      return null;
    }
  };
  beforeAll(async () => {
    h = await createHarness();
  });
  beforeEach(() => {
    for (const f of [userFile(h), localFile(h), repoConfigPath(h.root)]) rmSync(f, { force: true });
  });
  afterAll(() => h.cleanup());

  test("B3: a malformed norn_version in the team file is config_invalid naming the file and the key, exit 6", async () => {
    h.write(repoConfigPath(h.root), "norn_version: banana\n");
    const r = await h.norn("tick", "--json");
    expect(r.exit).toBe(ExitCode.config);
    expect(r.value).toMatchObject({ code: "config_invalid", error: `\`${CONFIG_FILES.repo}\`: \`norn_version\` must be a version like 0.19.0` });
  });

  test("B3: norn_version in the local or user file is config_wrong_file naming the team file", async () => {
    for (const file of [localFile(h), userFile(h)]) {
      h.write(file, "norn_version: 0.19.0\n");
      const r = await h.norn("tick", "--json");
      expect(r.exit).toBe(ExitCode.config);
      expect(r.value).toMatchObject({ code: "config_wrong_file" });
      expect((r.value as { error: string }).error).toContain(`\`norn_version\` belongs in \`${CONFIG_FILES.repo}\` (team key)`);
      rmSync(file);
    }
  });

  test("B4: config get shows the recorded version from repo; list includes it", async () => {
    h.write(repoConfigPath(h.root), "norn_version: 0.19.0\n");
    const got = await h.norn("config", "get", "norn_version", "--json");
    expect((got.value as Listed).entries).toMatchObject([{ key: "norn_version", value: "0.19.0", source: "repo" }]);
    expect(by(await entries(h), "norn_version")).toMatchObject({ value: "0.19.0", source: "repo" });
    const md = await h.norn("config", "get", "norn_version");
    expect(md.stdout).toContain("| `norn_version` | `0.19.0` | repo |");
  });

  test("B4: without the key, get shows no value and that norn upgrade records it", async () => {
    const got = await h.norn("config", "get", "norn_version", "--json");
    expect((got.value as Listed).entries).toMatchObject([{ key: "norn_version", value: null, source: "built-in" }]);
    const md = await h.norn("config", "get", "norn_version");
    expect(md.exit).toBe(0);
    expect(md.stdout).toContain("| `norn_version` | not recorded: `norn upgrade` records it |");
  });

  test("D4, K8: config set and unset of norn_version are refused, exit 3, naming norn upgrade; the file is unchanged", async () => {
    const before = "# team\nnorn_version: 0.19.0\n";
    h.write(repoConfigPath(h.root), before);
    for (const argv of [
      ["config", "set", "norn_version", "0.20.0", "--repo"],
      ["config", "set", "norn_version", "0.20.0"],
      ["config", "unset", "norn_version", "--repo"],
      ["config", "unset", "norn_version", "--user"],
    ]) {
      const r = await h.norn(...argv, "--json");
      expect(r.exit).toBe(ExitCode.refused);
      expect(r.value).toMatchObject({ do_instead: "norn upgrade" });
      expect(read(repoConfigPath(h.root))).toBe(before);
    }
  });
});
