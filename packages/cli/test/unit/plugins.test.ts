import { describe, expect, test } from "bun:test";
import { memoryFiles } from "@norn/conformance";
import type { WorkflowLoad } from "@norn/kernel";
import { SDLC_PACK } from "@norn/pack-sdlc";
import { defineNornPlugin, type NornPlugin, PLUGIN_API_VERSION, stepRoles } from "@norn/plugin-api";
import { AGENT_ROLES } from "@norn/schema";
import {
  BUNDLED_PLUGINS,
  bundledNames,
  CliFailure,
  configPaths,
  ExitCode,
  type InstalledLoad,
  type LockEntry,
  type LoadedConfig,
  loadConfig,
  loadInstalled,
  lockPath,
  missingStepKinds,
  type PluginImporter,
  type PluginLock,
  readLock,
  renderLock,
  picks,
  resolvePlugins,
  withEntry,
  withoutEntry,
} from "../../src/index.ts";
import { HOME, LOCAL_CONFIG, ROOT } from "./support.ts";

async function config(extra = ""): Promise<LoadedConfig["config"]> {
  const paths = configPaths(HOME, ROOT);
  const r = await loadConfig(memoryFiles({ [paths.local]: `${LOCAL_CONFIG}${extra}` }), paths);
  if (!r.ok) throw new Error(JSON.stringify(r.problems));
  return r.value.config;
}

const entry = (name: string, spec = `${name}@^1`): LockEntry => ({ name, spec, version: "1.0.0", api: "^1" });
const lockOf = (...entries: LockEntry[]): PluginLock => ({ format: 1, plugins: entries });

/** A tracker plugin providing `jira`, written against `api`. */
function jira(api = "^1.1"): NornPlugin {
  return defineNornPlugin({
    name: "norn-tracker-jira",
    api,
    provides: { tracker: { jira: { configSchema: { type: "object" } as never, create: () => ({ ok: false, failure: { code: "unknown", message: "", retryable: false } }) as never } } },
  });
}

const importerOf =
  (mods: Record<string, Record<string, unknown>>): PluginImporter =>
  async (name) => {
    const m = mods[name];
    if (!m) throw new Error(`Cannot find package '${name}'`);
    return m;
  };

function failureOf(r: ReturnType<typeof resolvePlugins>): CliFailure {
  if (r.ok) throw new Error("resolved");
  return r.failure;
}

describe("bundled plugins", () => {
  test("the roles the loader falls back to, for a pack that registers none, are the shipped pack's step roles", () => {
    expect(stepRoles(SDLC_PACK.roles ?? {})).toEqual([...AGENT_ROLES]);
  });

  test("the binary ships exactly the agreed set", () => {
    expect(bundledNames().sort()).toEqual(
      [
        "norn-forge-none",
        "norn-github",
        "norn-harness-claude",
        "norn-harness-pi",
        "norn-pack-sdlc",
        "norn-runner-headless",
        "norn-runner-herdr",
        "norn-steps-forge",
        "norn-store-local",
        "norn-store-refs",
        "norn-tracker-local",
        "norn-vcs-git",
      ].sort(),
    );
  });

  test("a config on bundled plugins alone resolves with no lock", async () => {
    const r = resolvePlugins({ config: await config(), bundled: BUNDLED_PLUGINS, lock: lockOf(), installed: [] });
    expect(r.ok && r.plugins.map((p) => p.name)).toEqual(bundledNames());
  });
});

describe("resolving the config's picks", () => {
  test("a slot no plugin provides is refused, naming the slot, what is available and how to fix it", async () => {
    const c = await config();
    c.tracker.use = "jira";
    const f = failureOf(resolvePlugins({ config: c, bundled: BUNDLED_PLUGINS, lock: lockOf(), installed: [] }));
    expect({ exit: f.exit, code: f.body.code }).toEqual({ exit: ExitCode.refused, code: "slot_unresolved" });
    expect(f.body.error).toBe("no plugin provides tracker jira (`tracker.use`); available: github, local");
    expect(f.body.do_instead).toStartWith("norn plugin add <the plugin that provides tracker jira>");
  });

  test("an executor's harness and runner, and the pack, are picks too", async () => {
    const c = await config();
    c.executors.claude = { harness: "codex", runner: "headless" };
    expect(failureOf(resolvePlugins({ config: c, bundled: BUNDLED_PLUGINS, lock: lockOf(), installed: [] })).body.details).toMatchObject({ slot: "harness", name: "codex" });
    const d = await config();
    d.executors.claude = { harness: "claude", runner: { use: "tmux" } };
    expect(failureOf(resolvePlugins({ config: d, bundled: BUNDLED_PLUGINS, lock: lockOf(), installed: [] })).body.details).toMatchObject({ slot: "runner", name: "tmux" });
    const p = await config();
    p.packs = ["ops"];
    expect(failureOf(resolvePlugins({ config: p, bundled: BUNDLED_PLUGINS, lock: lockOf(), installed: [] })).body.details).toMatchObject({ slot: "pack", name: "ops" });
  });

  test("the runner each attendance picks for an executor without its own is a pick, named at its runners: key", async () => {
    const c = await config("runners: { person: tmux }\n");
    c.executors.claude = { harness: "claude" };
    expect(picks(c).filter((p) => p.slot === "runners")).toEqual([
      { slot: "runners", noun: "runner", name: "tmux", at: "runners.person" },
      { slot: "runners", noun: "runner", name: "headless", at: "runners.agent" },
      { slot: "runners", noun: "runner", name: "headless", at: "runners.none" },
    ]);
    expect(failureOf(resolvePlugins({ config: c, bundled: BUNDLED_PLUGINS, lock: lockOf(), installed: [] })).body.details).toMatchObject({ slot: "runner", name: "tmux" });
    // an executor with a runner of its own leaves runners: unpicked
    expect(picks(await config("runners: { person: tmux }\n")).filter((p) => p.slot === "runners")).toEqual([{ slot: "runners", noun: "runner", name: "headless", at: "executors.claude.runner" }]);
  });

  test("an installed plugin fills a slot the bundled ones do not", async () => {
    const c = await config("plugins: { norn-tracker-jira: norn-tracker-jira@^1 }\n");
    c.tracker.use = "jira";
    const installed: InstalledLoad[] = [{ entry: entry("norn-tracker-jira"), ok: true, plugin: jira() }];
    const r = resolvePlugins({ config: c, bundled: BUNDLED_PLUGINS, lock: lockOf(entry("norn-tracker-jira")), installed });
    expect(r.ok && r.plugins.at(-1)?.name).toBe("norn-tracker-jira");
  });

  test("a configured plugin missing from the lock is refused with the add command for its spec", async () => {
    const f = failureOf(resolvePlugins({ config: await config("plugins: { norn-tracker-jira: 'github:me/jira#v2' }\n"), bundled: BUNDLED_PLUGINS, lock: lockOf(), installed: [] }));
    expect({ code: f.body.code, do_instead: f.body.do_instead }).toEqual({ code: "plugin_missing", do_instead: "norn plugin add github:me/jira#v2" });
  });

  test("a plugin on another plugin API is refused with the update command", async () => {
    const e = entry("norn-tracker-jira");
    const installed: InstalledLoad[] = [{ entry: e, ok: false, reason: "api", api: "^2", message: "plugin norn-tracker-jira wants plugin API ^2" }];
    const f = failureOf(resolvePlugins({ config: await config(), bundled: BUNDLED_PLUGINS, lock: lockOf(e), installed }));
    expect({ exit: f.exit, code: f.body.code, do_instead: f.body.do_instead }).toEqual({ exit: ExitCode.refused, code: "plugin_api", do_instead: "norn plugin update norn-tracker-jira" });
  });

  test("a locked plugin that cannot load is refused with the add command; two providers of one pick are refused", async () => {
    const e = entry("norn-tracker-jira", "./plugins/jira");
    const missing = failureOf(resolvePlugins({ config: await config(), bundled: BUNDLED_PLUGINS, lock: lockOf(e), installed: [{ entry: e, ok: false, reason: "missing", message: "gone" }] }));
    expect(missing.body.do_instead).toBe("norn plugin add ./plugins/jira");
    const twin = defineNornPlugin({ name: "norn-other-local", api: "^1.1", provides: { tracker: { local: jira().provides.tracker?.jira as never } } });
    const clash = failureOf(resolvePlugins({ config: await config(), bundled: BUNDLED_PLUGINS, lock: lockOf(entry("norn-other-local")), installed: [{ entry: entry("norn-other-local"), ok: true, plugin: twin }] }));
    expect({ code: clash.body.code, error: clash.body.error }).toEqual({ code: "plugin_clash", error: "tracker local is provided by norn-tracker-local and norn-other-local" });
  });

  test("a bundled plugin named under `plugins` is refused rather than replaced", async () => {
    const f = failureOf(resolvePlugins({ config: await config("plugins: { norn-github: norn-github@2 }\n"), bundled: BUNDLED_PLUGINS, lock: lockOf(), installed: [] }));
    expect(f.body.code).toBe("plugin_bundled");
  });
});

describe("loading an installed plugin", () => {
  test("the module's one norn plugin export, whatever its name", async () => {
    const r = await loadInstalled(entry("jira"), "/h/plugins", importerOf({ jira: { jiraPlugin: jira(), helper: 1 } }), PLUGIN_API_VERSION);
    expect(r.ok && r.plugin.name).toBe("norn-tracker-jira");
  });

  test("a plugin whose API range excludes this norn's is an api failure, not a broken plugin", async () => {
    const spec = { name: "norn-tracker-jira", api: "^2", provides: {} };
    const r = await loadInstalled(entry("jira"), "/h/plugins", importerOf({ jira: { plugin: spec } }), PLUGIN_API_VERSION);
    expect(r).toMatchObject({ ok: false, reason: "api", api: "^2" });
  });

  test("a package that is not installed, or exports no single plugin, is named", async () => {
    expect(await loadInstalled(entry("gone"), "/h/plugins", importerOf({}), PLUGIN_API_VERSION)).toMatchObject({ ok: false, reason: "missing" });
    expect(await loadInstalled(entry("none"), "/h/plugins", importerOf({ none: { x: 1 } }), PLUGIN_API_VERSION)).toMatchObject({ ok: false, reason: "invalid" });
    expect(await loadInstalled(entry("two"), "/h/plugins", importerOf({ two: { a: jira(), b: jira() } }), PLUGIN_API_VERSION)).toMatchObject({ ok: false, reason: "invalid" });
    const broken = { name: "x", api: "^1", provides: { harness: { h: {} } } };
    expect(await loadInstalled(entry("broken"), "/h/plugins", importerOf({ broken: { broken } }), PLUGIN_API_VERSION)).toMatchObject({ ok: false, reason: "invalid" });
  });
});

describe("the plugin lock", () => {
  test("in the machine dir, or committed beside the repo config in team mode", () => {
    expect(lockPath("/work/repo", "/h/repos/repo-1", false)).toBe("/h/repos/repo-1/plugins.lock");
    expect(lockPath("/work/repo", "/h/repos/repo-1", true)).toBe("/work/repo/.agents/norn.plugins.lock");
  });

  test("absent reads as empty; written sorted; entries replace by name", async () => {
    const files = memoryFiles();
    expect(await readLock(files, "/l")).toEqual({ format: 1, plugins: [] });
    const lock = withEntry(withEntry(lockOf(entry("b")), entry("a")), { ...entry("b"), version: "1.1.0" });
    const text = renderLock(lock);
    await files.write("/l", text);
    expect((await readLock(files, "/l")).plugins.map((p) => `${p.name}@${p.version}`)).toEqual(["a@1.0.0", "b@1.1.0"]);
    expect(withoutEntry(lock, "a").plugins.map((p) => p.name)).toEqual(["b"]);
  });

  test("a lock that does not validate is corrupt, exit 4, never read past", async () => {
    const e = await readLock(memoryFiles({ "/l": '{"format":1,"plugins":[{"name":"x"}]}' }), "/l").catch((x: unknown) => x);
    expect(e).toBeInstanceOf(CliFailure);
    expect({ exit: (e as CliFailure).exit, code: (e as CliFailure).body.code }).toEqual({ exit: ExitCode.corrupt, code: "lock_corrupt" });
  });
});

describe("workflow step kinds", () => {
  test("a workflow naming a step kind no plugin provides refuses, naming the kind and the workflow", () => {
    const byName: Record<string, WorkflowLoad> = {
      story: { ok: false, errors: [{ path: "/steps/deploy", message: "unknown step kind", missing_kind: "deploy" }] },
      quick: { ok: false, errors: [{ path: "/steps/x", message: "bad" }] },
    };
    const f = missingStepKinds(byName);
    expect({ code: f?.body.code, error: f?.body.error, do_instead: f?.body.do_instead }).toEqual({
      code: "step_kind_missing",
      error: "workflow story uses step kind deploy, which no configured plugin provides",
      do_instead: "norn plugin add <the plugin that provides step kind deploy>",
    });
    expect(missingStepKinds({ quick: byName.quick as WorkflowLoad })).toBeNull();
  });
});
