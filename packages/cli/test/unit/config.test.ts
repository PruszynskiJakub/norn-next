import { describe, expect, test } from "bun:test";
import { memoryFiles } from "@norn/conformance";
import { DEFAULT_KERNEL_CONFIG } from "@norn/kernel";
import {
  CliFailure,
  type ConfigProblem,
  configError,
  configPaths,
  durationMs,
  ExitCode,
  getKey,
  type LoadedConfig,
  loadConfig,
  mergeLayers,
  planSet,
  REPO_COMMITTED_FILE,
  REPO_LOCAL_FILE,
  runtimeConfigOf,
  setKeyInText,
} from "../../src/index.ts";
import { HOME, LOCAL_CONFIG, ROOT } from "./support.ts";

const PATHS = configPaths(HOME, ROOT);

async function load(files: Partial<Record<"user" | "local" | "repo", string>>) {
  const seed: Record<string, string> = {};
  for (const [layer, text] of Object.entries(files)) seed[PATHS[layer as "user" | "local" | "repo"]] = text;
  return loadConfig(memoryFiles(seed), PATHS);
}

async function loaded(files: Partial<Record<"user" | "local" | "repo", string>>): Promise<LoadedConfig> {
  const r = await load(files);
  if (!r.ok) throw new Error(JSON.stringify(r.problems));
  return r.value;
}

async function problems(files: Partial<Record<"user" | "local" | "repo", string>>): Promise<ConfigProblem[]> {
  const r = await load(files);
  if (r.ok) throw new Error("the config loaded");
  return r.problems;
}

describe("config paths", () => {
  test("user config in the norn home, repo-local and committed under the checkout's .agents", () => {
    expect(PATHS).toEqual({ user: `${HOME}/config.yaml`, local: `${ROOT}/.agents/norn.local.yaml`, repo: `${ROOT}/.agents/norn.yaml` });
  });
});

describe("merge order: defaults, then user, then repo-local, then repo-committed", () => {
  test("a higher layer's scalar wins; mappings merge key by key", async () => {
    const c = await loaded({
      user: "base: develop\nkernel: { mode: auto, max_nudges: 3 }\n",
      local: `${LOCAL_CONFIG}kernel: { max_nudges: 5 }\n`,
      repo: "base: trunk\n",
    });
    expect(c.config.base).toBe("trunk");
    expect(c.config.kernel).toEqual({ mode: "auto", max_nudges: 5 });
  });

  test("the defaults fill what no file sets: vcs git, the sdlc pack, base main", async () => {
    const c = await loaded({ local: LOCAL_CONFIG });
    expect({ vcs: c.config.vcs, packs: c.config.packs, base: c.config.base, plugins: c.config.plugins, format: c.config.format }).toEqual({
      vcs: { use: "git" },
      packs: ["sdlc"],
      base: "main",
      plugins: {},
      format: 1,
    });
  });

  test("lists are replaced whole, never appended", () => {
    expect(mergeLayers([{ packs: ["a"] }, { packs: ["b"] }])).toEqual({ packs: ["b"] });
  });

  test("a slot whose plugin changes above is replaced whole, so the old plugin's keys never reach the new one", async () => {
    const c = await loaded({
      user: "tracker: { use: github, repo: me/x, intake: { label: norn } }\n",
      local: `${LOCAL_CONFIG}`,
    });
    expect(c.config.tracker).toEqual({ use: "local", intake: { label: "norn" } });
    expect(mergeLayers([{ tracker: { use: "github", repo: "me/x" } }, { tracker: { use: "github", host: "ghe" } }])).toEqual({ tracker: { use: "github", repo: "me/x", host: "ghe" } });
  });

  test("a slot whose plugin changes above keeps norn's own keys from below and drops only the plugin's", () => {
    const merged = mergeLayers([
      { tracker: { use: "github", repo: "me/x", intake: { label: "norn", assignee: "me" } }, forge: { use: "github", repo: "me/x" } },
      { tracker: { use: "local", intake: { assignee: null } }, forge: { use: "gitlab" } },
    ]);
    expect(merged).toEqual({ tracker: { use: "local", intake: { label: "norn", assignee: null } }, forge: { use: "gitlab" } });
  });

  test("an executor set in the user config gains a model from the repo", async () => {
    const c = await loaded({ user: LOCAL_CONFIG, repo: "executors: { claude: { model: opus } }\n" });
    expect(c.config.executors.claude).toEqual({ harness: "claude", runner: "headless", model: "opus" });
    expect(c.executor).toBe("claude");
  });

  test("each layer is kept as written", async () => {
    const c = await loaded({ local: LOCAL_CONFIG, user: "base: dev\n" });
    expect(c.layers.user).toEqual({ base: "dev" });
    expect(c.layers.repo).toBeNull();
    expect(getKey(c.config, "tracker.intake.label")).toBe("norn");
    expect(getKey(c.config, "tracker.nope.deeper")).toBeUndefined();
  });
});

describe("an invalid config is a config error, never a guess", () => {
  test("an unknown top-level key names the file and the key", async () => {
    expect(await problems({ local: `${LOCAL_CONFIG}trackr: { use: local }\n` })).toEqual([{ layer: "local", path: "", message: "unknown property 'trackr'" }]);
  });

  test("unknown keys inside norn's own mappings are refused: kernel, intake, an executor", async () => {
    const found = await problems({ repo: "kernel: { mood: auto }\ntracker: { intake: { lable: x } }\nexecutors: { claude: { harnes: claude } }\n" });
    expect(found.map((p) => `${p.layer} ${p.path} ${p.message}`).sort()).toEqual([
      "repo /executors/claude unknown property 'harnes'",
      "repo /kernel unknown property 'mood'",
      "repo /tracker/intake unknown property 'lable'",
    ]);
  });

  test("a slot's own keys beside `use` are its plugin's, left for its factory to check", async () => {
    const c = await loaded({ local: LOCAL_CONFIG.replace("store: { use: local }", "store: { use: local, anything: 1 }") });
    expect(c.config.store as Record<string, unknown>).toEqual({ use: "local", anything: 1 });
  });

  test("a wrong shape, a wrong format and broken YAML each name their file", async () => {
    expect(await problems({ user: "format: 2\n" })).toEqual([{ layer: "user", path: "/format", message: "must be 1" }]);
    expect((await problems({ repo: "kernel: { silent_after: soon }\n" }))[0]).toMatchObject({ layer: "repo", path: "/kernel/silent_after" });
    expect((await problems({ local: "tracker: [\n" }))[0]).toMatchObject({ layer: "local", path: "" });
    expect(await problems({ local: "- a\n- b\n" })).toEqual([{ layer: "local", path: "", message: "must be a mapping of keys" }]);
  });

  test("files that are each fine but leave a required key unset fail as the merged config", async () => {
    expect(await problems({ local: "base: main\n" })).toContainEqual(expect.objectContaining({ layer: "merged", path: "" }));
  });

  test("several executors need `executor` to name the default, and it must name one of them", async () => {
    const two = `${LOCAL_CONFIG}  other: { harness: claude, runner: herdr }\n`;
    expect((await problems({ local: two }))[0]).toMatchObject({ layer: "merged", path: "/executor" });
    expect((await problems({ local: `${two}executor: nobody\n` }))[0]).toMatchObject({ layer: "merged", path: "/executor" });
    expect((await loaded({ local: `${two}executor: other\n` })).executor).toBe("other");
  });

  test("the refusal is exit 6: nothing configured sends to norn init, a bad file to that file", async () => {
    const nothing = await load({});
    if (nothing.ok) throw new Error("loaded");
    const e = configError(nothing.problems, nothing.layers, PATHS);
    expect(e).toBeInstanceOf(CliFailure);
    expect({ exit: e.exit, code: e.body.code, do_instead: e.body.do_instead }).toEqual({ exit: ExitCode.config, code: "config_missing", do_instead: "norn init" });
    const bad = await load({ local: "trackr: 1\n" });
    if (bad.ok) throw new Error("loaded");
    const b = configError(bad.problems, bad.layers, PATHS);
    expect({ exit: b.exit, code: b.body.code, do_instead: b.body.do_instead, error: b.body.error }).toEqual({
      exit: ExitCode.config,
      code: "config_invalid",
      do_instead: "fix .agents/norn.local.yaml",
      error: ".agents/norn.local.yaml: unknown property 'trackr'",
    });
    expect(b.body.details).toEqual([{ layer: "local", path: "", message: "unknown property 'trackr'", file: PATHS.local }]);
  });
});

describe("an old key name: the refusal names the key that replaced it and the file it belongs in", () => {
  const refusal = async (files: Partial<Record<"user" | "local" | "repo", string>>) => {
    const r = await load(files);
    if (r.ok) throw new Error("loaded");
    return configError(r.problems, r.layers, PATHS).body;
  };

  test("a person's key, wherever it is written, goes in the repo-local file under its new name", async () => {
    const b = await refusal({ local: `${LOCAL_CONFIG}mode: manual\n` });
    expect(b.error).toBe(`${REPO_LOCAL_FILE} /mode: \`mode\` is the old norn's spelling: this norn reads kernel.mode, your own key`);
    expect(b.do_instead).toBe(`norn config set kernel.mode manual, then remove mode from ${REPO_LOCAL_FILE}`);
    expect((await refusal({ repo: "default_agent: pi\n", local: LOCAL_CONFIG })).do_instead).toBe(`norn config set executor pi, then remove default_agent from ${REPO_COMMITTED_FILE}`);
  });

  test("a machine key goes in the user file, a team key stays in the file it is in", async () => {
    expect((await refusal({ local: `${LOCAL_CONFIG}mode: auto\n` })).do_instead).toBe(`norn config set kernel.mode auto, then remove mode from ${REPO_LOCAL_FILE}`);
    expect((await refusal({ local: LOCAL_CONFIG, repo: "base_branch: trunk\n" })).do_instead).toBe(`norn config set base trunk --commit, then remove base_branch from ${REPO_COMMITTED_FILE}`);
  });

  test("a key with no one-to-one successor says what replaced it; a key that is gone says to remove it", async () => {
    const provider = await refusal({ local: LOCAL_CONFIG, repo: "provider: gh\n" });
    expect(provider.error).toContain("this norn reads tracker.use and forge.use (github)");
    expect(provider.do_instead).toBe(`norn config set tracker.use github --commit and norn config set forge.use github --commit, then remove provider from ${REPO_COMMITTED_FILE}`);
    const gone = await refusal({ local: `${LOCAL_CONFIG}notify: { desktop: true }\n` });
    expect(gone.error).toContain("`notify` is gone: this norn sends no notifications");
    expect(gone.do_instead).toBe(`remove notify from ${REPO_LOCAL_FILE}`);
  });

  test("an unknown key that never was norn's keeps the plain refusal", async () => {
    expect((await refusal({ local: `${LOCAL_CONFIG}trackr: 1\n` })).do_instead).toBe(`fix ${REPO_LOCAL_FILE}`);
  });
});

describe("the runtime config derived from the person's", () => {
  test("an executor's model reaches its choice, so its agents launch on it", async () => {
    const c = await loaded({ user: LOCAL_CONFIG, repo: "executors: { claude: { model: opus } }\n" });
    expect(runtimeConfigOf(c, "me@box").executors.claude).toEqual({ name: "claude", runner: { name: "headless" }, model: "opus" });
  });

  test("an executor's args reach its choice whole, replacing a lower layer's list rather than appending to it", async () => {
    const c = await loaded({ user: LOCAL_CONFIG, local: "executors: { claude: { args: [--verbose, --debug] } }\n", repo: "executors: { claude: { args: [--permission-mode, acceptEdits] } }\n" });
    expect(runtimeConfigOf(c, "me@box").executors.claude).toEqual({ name: "claude", runner: { name: "headless" }, args: ["--permission-mode", "acceptEdits"] });
    const found = await problems({ user: LOCAL_CONFIG, repo: "executors: { claude: { args: --verbose } }\n" });
    expect(found.map((p) => `${p.layer} ${p.path}`)).toEqual(["repo /executors/claude/args"]);
  });

  test("an executor key no harness reads is a config error rather than a setting ignored", async () => {
    const found = await problems({ user: LOCAL_CONFIG, repo: "executors: { claude: { effort: high } }\n" });
    expect(found.map((p) => `${p.layer} ${p.path} ${p.message}`)).toEqual(["repo /executors/claude unknown property 'effort'"]);
  });

  test("slots split `use` from their plugin's config; intake leaves the tracker's config; executors become harness and runner choices", async () => {
    const c = await loaded({
      local: [
        "format: 1",
        "tracker: { use: local, keyPrefix: ab, intake: { label: go } }",
        "forge: { use: none }",
        "store: { use: refs }",
        "executors:",
        "  claude: { harness: claude, runner: { use: headless, kill_grace_ms: 500 } }",
        "base: trunk",
        "base_ref: origin/trunk",
        "kernel: { mode: auto, silent_after: 5m, deadline: none, lock_stale: 30s, counters: { check_fail: 9 } }",
        "",
      ].join("\n"),
    });
    const r = runtimeConfigOf(c, "me@box");
    expect(r.tracker).toEqual({ name: "local", config: { keyPrefix: "ab" } });
    expect(r.store).toEqual({ name: "refs" });
    expect(r.executors).toEqual({ claude: { name: "claude", runner: { name: "headless", config: { kill_grace_ms: 500 } } } });
    expect(r.intake).toEqual({ label: "go", assignee: "me" });
    expect({ base: r.base, baseRef: r.baseRef, holder: r.holder, pack: r.pack, lockStaleMs: r.lockStaleMs }).toEqual({
      base: "trunk",
      baseRef: "origin/trunk",
      holder: "me@box",
      pack: "sdlc",
      lockStaleMs: 30_000,
    });
    expect(r.kernel).toEqual({
      ...DEFAULT_KERNEL_CONFIG,
      mode: "auto",
      silentAfterMs: 300_000,
      deadlineMs: null,
      executor: "claude",
      base: "trunk",
      counterDefaults: { ...DEFAULT_KERNEL_CONFIG.counterDefaults, checkFail: 9 },
    });
  });

  test("an intake assignee of null takes items whoever they are assigned to; holder from the config wins", async () => {
    const c = await loaded({ local: `${LOCAL_CONFIG.replace("intake: { label: norn }", "intake: { label: norn, assignee: null }")}holder: ci\n` });
    const r = runtimeConfigOf(c, "me@box");
    expect({ intake: r.intake, holder: r.holder }).toEqual({ intake: { label: "norn", assignee: null }, holder: "ci" });
  });

  test("trace.retain: a duration in milliseconds, keep as null, absent left to the runtime's default", async () => {
    const of = async (extra: string) => runtimeConfigOf(await loaded({ local: `${LOCAL_CONFIG}${extra}` }), "me@box");
    expect((await of("trace: { retain: 3d }\n")).traceRetainMs).toBe(259_200_000);
    expect((await of("trace: { retain: keep }\n")).traceRetainMs).toBeNull();
    expect("traceRetainMs" in (await of(""))).toBe(false);
    const c = await loaded({ local: LOCAL_CONFIG });
    expect(planSet(c, LOCAL_CONFIG, "local", "trace.retain", "0").ok).toBe(false);
    expect(planSet(c, LOCAL_CONFIG, "local", "trace.retain", "forever").ok).toBe(false);
  });

  test("checks: each named command reaches the runtime, the committed file's over the local one's; a name or an empty command it refuses", async () => {
    const r = runtimeConfigOf(await loaded({ local: `${LOCAL_CONFIG}checks: { test: npm test, lint: make lint }\n`, repo: "checks: { test: pnpm test }\n" }), "me@box");
    expect(r.checks).toEqual({ test: "pnpm test", lint: "make lint" });
    expect("checks" in runtimeConfigOf(await loaded({ local: LOCAL_CONFIG }), "me@box")).toBe(false);
    const c = await loaded({ local: LOCAL_CONFIG });
    expect(planSet(c, LOCAL_CONFIG, "local", "checks.test", "").ok).toBe(false);
    expect(planSet(c, LOCAL_CONFIG, "local", "checks.Test", "x").ok).toBe(false);
  });

  test("durations", () => {
    expect([durationMs("250ms"), durationMs("30s"), durationMs("15m"), durationMs("2h"), durationMs("7d")]).toEqual([250, 30_000, 900_000, 7_200_000, 604_800_000]);
    expect(() => durationMs("15 m")).toThrow();
  });
});

describe("a key this norn no longer reads", () => {
  test("kernel.max_agents loads, is left out of the config, and is named with the command that deletes it", async () => {
    const c = await loaded({ user: "kernel: { mode: auto, max_agents: 4 }\n", local: LOCAL_CONFIG });
    expect(c.config.kernel).toEqual({ mode: "auto" });
    expect(c.retired).toEqual([
      {
        layer: "user",
        path: "/kernel/max_agents",
        message: "kernel.max_agents is no longer read: norn starts every due agent and check, with no cap",
        do_instead: "norn config set kernel.max_agents --unset --user",
      },
    ]);
  });

  test("a top-level max_agents, the old norn's spelling, is gone and says to remove it", async () => {
    const r = await load({ local: `${LOCAL_CONFIG}max_agents: 4\n` });
    if (r.ok) throw new Error("loaded");
    const b = configError(r.problems, r.layers, PATHS).body;
    expect(b.error).toBe(`${REPO_LOCAL_FILE} /max_agents: \`max_agents\` is gone: norn starts every due agent and check, with no cap`);
    expect(b.do_instead).toBe(`remove max_agents from ${REPO_LOCAL_FILE}`);
  });
});

describe("writing a config file", () => {
  test("a set keeps the file's comments and order; a new file starts with format", () => {
    const text = "# mine\nformat: 1\nbase: main # trunk soon\n";
    expect(setKeyInText(text, "kernel.mode", "auto")).toBe("# mine\nformat: 1\nbase: main # trunk soon\nkernel:\n  mode: auto\n");
    expect(setKeyInText(null, "base", "dev")).toBe("format: 1\nbase: dev\n");
    expect(setKeyInText("format: 1\nbase: dev\n", "base", undefined)).toBe("format: 1\n");
  });

  test("a set that would break the config is refused before anything is written", async () => {
    const c = await loaded({ local: LOCAL_CONFIG });
    const bad = planSet(c, LOCAL_CONFIG, "local", "kernel.max_nudges", -1);
    expect(bad.ok).toBe(false);
    if (!bad.ok) expect(bad.problems[0]).toMatchObject({ layer: "local", path: "/kernel/max_nudges" });
    const good = planSet(c, LOCAL_CONFIG, "local", "kernel.max_nudges", 2);
    if (!good.ok) throw new Error(JSON.stringify(good.problems));
    expect(good.next.config.kernel).toEqual({ max_nudges: 2 });
    expect(good.text).toContain("kernel:\n  max_nudges: 2\n");
  });

  test("a set in the committed file merges over the repo-local one", async () => {
    const c = await loaded({ local: LOCAL_CONFIG });
    const r = planSet(c, null, "repo", "base", "trunk");
    if (!r.ok) throw new Error(JSON.stringify(r.problems));
    expect({ base: r.next.config.base, repo: r.next.layers.repo }).toEqual({ base: "trunk", repo: { format: 1, base: "trunk" } });
  });
});
