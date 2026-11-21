import { describe, expect, test } from "bun:test";
import type { ExecScript } from "@norn/conformance";
import { PLUGIN_API_VERSION } from "@norn/plugin-api";
import { parse } from "yaml";
import { acceptedPluginPath, bundledNames, configPaths, ExitCode, homePaths, machineDir, machineId, type PluginImporter, REPO_LOCK_FILE, runCli } from "../../src/index.ts";
import { COMMON, HOME, LOCAL_CONFIG, machine, ROOT, type TestMachine } from "./support.ts";

const PATHS = configPaths(HOME, ROOT);
const LOCK = `${machineDir(HOME, machineId(COMMON))}/plugins.lock`;
const PLUGINS = homePaths(HOME).plugins;
const json = (stdout: string): Record<string, unknown> => Bun.JSONL.parse(stdout)[0] as Record<string, unknown>;

/** A plugin module providing a runner, for a slot nobody picks unless a test does. */
const pluginModule = (name: string, api = "^1.5") => ({
  plugin: { name, api, provides: { runners: { [`${name}-runner`]: { configSchema: {}, create: () => ({}) } } } },
});

/** Imports by package name what the test installed. */
function importer(mods: Record<string, unknown>): PluginImporter {
  return async (name) => {
    const mod = mods[name];
    if (!mod) throw new Error(`Cannot find package '${name}'`);
    return mod as Record<string, unknown>;
  };
}

/** `bun add <spec>` as bun does it: the dependency in the manifest, the package in node_modules. */
function bunAdd(get: () => TestMachine, installs: Record<string, { name: string; version: string }>): ExecScript {
  return async (argv, opts) => {
    if (argv[0] === "bun" && argv[1] === "add" && opts.cwd === PLUGINS) {
      const got = installs[argv[2] as string];
      if (!got) return { code: 1, stderr: `error: package "${argv[2]}" not found` };
      const files = get().files;
      const manifest = parse((await files.read(`${PLUGINS}/package.json`)) ?? "{}") as { dependencies?: Record<string, string> };
      manifest.dependencies = { ...(manifest.dependencies ?? {}), [got.name]: `^${got.version}` };
      await files.write(`${PLUGINS}/package.json`, JSON.stringify(manifest));
      await files.write(`${PLUGINS}/node_modules/${got.name}/package.json`, JSON.stringify(got));
      return { stdout: `installed ${got.name}@${got.version}\n` };
    }
    if (argv[0] === "mkdir" || argv[0] === "ln") return { stdout: "" };
    return undefined;
  };
}

function world(opts: { mods?: Record<string, unknown>; installs?: Record<string, { name: string; version: string }>; seed?: Record<string, string> } = {}) {
  let m: TestMachine | undefined;
  m = machine({ seed: { [PATHS.local]: LOCAL_CONFIG, ...(opts.seed ?? {}) }, importer: importer(opts.mods ?? {}), script: bunAdd(() => m as TestMachine, opts.installs ?? {}) });
  return m;
}

const lockOf = async (m: TestMachine, path = LOCK) => JSON.parse((await m.files.read(path)) ?? "null") as { plugins: Array<Record<string, string>> } | null;
const localConfig = async (m: TestMachine) => parse((await m.files.read(PATHS.local)) ?? "{}") as { plugins?: Record<string, string> };

describe("norn plugin add", () => {
  test("a local path is linked into the plugins folder and pinned: lock entry and plugins.<name> in the config", async () => {
    const m = world({ mods: { "norn-plugin-fancy": pluginModule("fancy") }, seed: { "/src/fancy/package.json": JSON.stringify({ name: "norn-plugin-fancy", version: "0.3.0" }) } });
    const r = await runCli(["plugin", "add", "../../src/fancy", "--json"], { ...m.io, cwd: ROOT });
    expect(r.exit).toBe(ExitCode.ok);
    expect(json(r.stdout)).toMatchObject({ name: "norn-plugin-fancy", plugin: "fancy", version: "0.3.0", api: "^1.5", provides: { runners: ["fancy-runner"] }, lock: LOCK });
    expect((await lockOf(m))?.plugins).toEqual([{ name: "norn-plugin-fancy", spec: "/src/fancy", version: "0.3.0", api: "^1.5" }]);
    expect((await localConfig(m)).plugins).toEqual({ "norn-plugin-fancy": "/src/fancy" });
    expect(m.exec.calls.map((c) => c.argv)).toContainEqual(["ln", "-sfn", "/src/fancy", `${PLUGINS}/node_modules/norn-plugin-fancy`]);
    // the plugins folder became a bun project first
    expect(await m.files.read(`${PLUGINS}/package.json`)).toContain("norn-plugins");
    // and every later command loads it
    const list = json((await runCli(["plugin", "list", "--json"], m.io)).stdout) as { plugins: Array<{ name: string; source: string; loads?: boolean }> };
    expect(list.plugins.find((p) => p.name === "norn-plugin-fancy")).toMatchObject({ source: "installed", loads: true });
  });

  test("an npm spec runs bun add in the plugins folder, and the version it resolved is pinned", async () => {
    const m = world({ mods: { "@acme/norn-plugin-y": pluginModule("y") }, installs: { "@acme/norn-plugin-y@^2": { name: "@acme/norn-plugin-y", version: "2.4.1" } } });
    const r = await runCli(["plugin", "add", "@acme/norn-plugin-y@^2", "--json"], m.io);
    expect(r.exit).toBe(ExitCode.ok);
    expect(m.exec.calls.find((c) => c.argv[0] === "bun")).toMatchObject({ argv: ["bun", "add", "@acme/norn-plugin-y@^2"], opts: { cwd: PLUGINS } });
    expect((await lockOf(m))?.plugins).toEqual([{ name: "@acme/norn-plugin-y", spec: "@acme/norn-plugin-y@^2", version: "2.4.1", api: "^1.5" }]);
  });

  test("a git URL is named by the dependency bun added", async () => {
    const url = "git+https://example.com/acme/norn-plugin-z.git";
    const m = world({ mods: { "norn-plugin-z": pluginModule("z") }, installs: { [url]: { name: "norn-plugin-z", version: "0.1.0" } } });
    const r = await runCli(["plugin", "add", url, "--json"], m.io);
    expect(json(r.stdout)).toMatchObject({ name: "norn-plugin-z", spec: url });
  });

  test("a plugin written for another plugin API is refused and nothing is pinned", async () => {
    const m = world({ mods: { "norn-plugin-old": pluginModule("old", "^0.9") }, installs: { "norn-plugin-old": { name: "norn-plugin-old", version: "0.9.0" } } });
    const r = await runCli(["plugin", "add", "norn-plugin-old", "--json"], m.io);
    expect(r.exit).toBe(ExitCode.refused);
    expect(json(r.stdout)).toMatchObject({ code: "plugin_api", details: { plugin: "norn-plugin-old", wants: "^0.9", implements: PLUGIN_API_VERSION } });
    expect(String(json(r.stdout).do_instead)).toContain(`written for plugin API ${PLUGIN_API_VERSION}`);
    expect(await lockOf(m)).toBeNull();
    expect((await localConfig(m)).plugins).toBeUndefined();
  });

  test("bun add failing is refused with its error; a folder with no package is refused", async () => {
    const m = world();
    const r = await runCli(["plugin", "add", "norn-plugin-nope", "--json"], m.io);
    expect(json(r.stdout)).toMatchObject({ code: "plugin_install_failed" });
    expect(String(json(r.stdout).error)).toContain('package "norn-plugin-nope" not found');
    const local = await runCli(["plugin", "add", "/nowhere", "--json"], m.io);
    expect(json(local.stdout)).toMatchObject({ code: "plugin_not_a_package" });
  });

  test("in team mode the lock is committed beside the repo config, and plugins.<name> goes there too", async () => {
    const m = world({ mods: { "norn-plugin-y": pluginModule("y") }, installs: { "norn-plugin-y": { name: "norn-plugin-y", version: "1.0.0" } }, seed: { [PATHS.repo]: "base: main\n" } });
    const r = await runCli(["plugin", "add", "norn-plugin-y", "--json"], m.io);
    expect(json(r.stdout)).toMatchObject({ team: true, lock: `${ROOT}/${REPO_LOCK_FILE}`, config: PATHS.repo });
    expect((await lockOf(m, `${ROOT}/${REPO_LOCK_FILE}`))?.plugins.map((p) => p.name)).toEqual(["norn-plugin-y"]);
    expect(await m.files.read(PATHS.repo)).toContain("norn-plugin-y: norn-plugin-y");
  });
});

describe("norn plugin list, update and remove", () => {
  const LOCKED = JSON.stringify({ format: 1, plugins: [{ name: "norn-plugin-y", spec: "norn-plugin-y@^1", version: "1.0.0", api: "^1.5" }] });

  test("list shows every bundled plugin and each installed one, with what it provides or why it does not load", async () => {
    const m = world({ seed: { [LOCK]: LOCKED } });
    const r = await runCli(["plugin", "list", "--json"], m.io);
    const body = json(r.stdout) as { plugin_api: string; plugins: Array<{ name: string; source: string; provides: Record<string, string[]>; loads?: boolean; do_instead?: string }> };
    expect(body.plugins.filter((p) => p.source === "bundled").map((p) => p.name)).toEqual(bundledNames());
    expect(body.plugins.find((p) => p.name === "tracker-local" || p.provides.tracker?.includes("local"))?.provides.tracker).toContain("local");
    expect(body.plugins.find((p) => p.name === "norn-plugin-y")).toMatchObject({ source: "installed", loads: false, do_instead: "norn plugin add norn-plugin-y@^1" });
  });

  test("update re-runs bun add of the pinned spec and pins what it resolved now", async () => {
    const m = world({ mods: { "norn-plugin-y": pluginModule("y") }, installs: { "norn-plugin-y@^1": { name: "norn-plugin-y", version: "1.7.0" } }, seed: { [LOCK]: LOCKED } });
    const r = await runCli(["plugin", "update", "norn-plugin-y", "--json"], m.io);
    expect(r.exit).toBe(ExitCode.ok);
    expect((await lockOf(m))?.plugins).toEqual([{ name: "norn-plugin-y", spec: "norn-plugin-y@^1", version: "1.7.0", api: "^1.5" }]);
  });

  test("update refuses a bundled plugin and one this repo has not pinned", async () => {
    const m = world();
    expect(json((await runCli(["plugin", "update", bundledNames()[0] as string, "--json"], m.io)).stdout)).toMatchObject({ code: "plugin_bundled" });
    expect(json((await runCli(["plugin", "update", "norn-plugin-q", "--json"], m.io)).stdout)).toMatchObject({ code: "plugin_not_installed", do_instead: "norn plugin list" });
  });

  test("remove unpins the plugin and drops plugins.<name> from the config; the package stays installed", async () => {
    const m = world({ mods: { "norn-plugin-y": pluginModule("y") }, seed: { [LOCK]: LOCKED, [PATHS.local]: `${LOCAL_CONFIG}plugins:\n  norn-plugin-y: norn-plugin-y@^1\n` } });
    const r = await runCli(["plugin", "remove", "norn-plugin-y", "--json"], m.io);
    expect(r.exit).toBe(ExitCode.ok);
    expect((await lockOf(m))?.plugins).toEqual([]);
    expect((await localConfig(m)).plugins).toEqual({});
    expect(m.exec.calls.some((c) => c.argv[0] === "bun")).toBe(false);
  });

  test("remove refuses a plugin the config still picks a slot from, naming the key", async () => {
    const config = LOCAL_CONFIG.replace("runner: headless", "runner: y-runner");
    const m = world({ mods: { "norn-plugin-y": pluginModule("y") }, seed: { [LOCK]: LOCKED, [PATHS.local]: config } });
    const r = await runCli(["plugin", "remove", "norn-plugin-y", "--json"], m.io);
    expect(r.exit).toBe(ExitCode.refused);
    expect(json(r.stdout)).toMatchObject({ code: "plugin_in_use", do_instead: "norn config set executors.claude.runner <another runner>" });
    expect(await m.files.read(LOCK)).toBe(LOCKED);
  });
});

describe("the effects a plugin's step kinds declare, accepted at plugin add", () => {
  const kindModule = (effects: string[]) => ({
    plugin: {
      name: "vercel",
      api: "^1.24",
      provides: { stepKinds: { preview: { name: "preview", configSchema: {}, outcomes: ["done"], mode: "effect", effects, run: async () => ({ ok: true, value: { outcome: "done" } }) } } },
    },
  });
  const SPEC = { "/src/vercel/package.json": JSON.stringify({ name: "norn-plugin-vercel", version: "1.0.0" }) };

  test("are named when the plugin is added and recorded as the person's acceptance in the norn home", async () => {
    const m = world({ mods: { "norn-plugin-vercel": kindModule(["outward"]) }, seed: SPEC });
    const r = await runCli(["plugin", "add", "/src/vercel", "--json"], m.io);
    expect(r.exit).toBe(ExitCode.ok);
    expect(json(r.stdout)).toMatchObject({ effects: { "vercel.preview": ["outward"] } });
    expect(JSON.parse((await m.files.read(acceptedPluginPath(HOME, "norn-plugin-vercel"))) ?? "null")).toMatchObject({ plugin: "vercel", version: "1.0.0", effects: { "vercel.preview": ["outward"] } });
    expect((await runCli(["plugin", "add", "/src/vercel"], m.io)).stdout).toContain("vercel.preview: outward");
    expect((await runCli(["tick", "--json"], m.io)).exit).toBe(ExitCode.ok);
  });

  test("a plugin whose kinds declare other effects than the person accepted is refused until they accept them again", async () => {
    const mods: Record<string, unknown> = { "norn-plugin-vercel": kindModule(["outward"]) };
    const m = world({ mods, seed: SPEC });
    await runCli(["plugin", "add", "/src/vercel", "--json"], m.io);
    mods["norn-plugin-vercel"] = kindModule([]);
    const r = await runCli(["tick", "--json"], m.io);
    expect({ exit: r.exit, body: json(r.stdout) }).toMatchObject({ exit: ExitCode.refused, body: { code: "plugin_effects", do_instead: "norn plugin update norn-plugin-vercel" } });
    expect(String(json(r.stdout).error)).toContain("vercel.preview declares no effects, where you accepted outward");
  });

  test("a plugin added before acceptance existed loads while its kinds declare no effect, and is refused once one does", async () => {
    const mods: Record<string, unknown> = { "norn-plugin-vercel": kindModule([]) };
    const lock = JSON.stringify({ format: 1, plugins: [{ name: "norn-plugin-vercel", spec: "/src/vercel", version: "1.0.0", api: "^1.24" }] });
    const m = world({ mods, seed: { ...SPEC, [LOCK]: lock } });
    expect((await runCli(["tick", "--json"], m.io)).exit).toBe(ExitCode.ok);
    mods["norn-plugin-vercel"] = kindModule(["cost"]);
    expect(json((await runCli(["tick", "--json"], m.io)).stdout)).toMatchObject({ code: "plugin_effects" });
  });

  test("only a person adds a plugin or updates one: an agent's session is refused", async () => {
    const m = world({ mods: { "norn-plugin-vercel": kindModule(["outward"]) }, seed: SPEC });
    const r = await runCli(["plugin", "add", "/src/vercel", "--json"], { ...m.io, env: { ...m.io.env, NORN_UNIT: "gh-1", NORN_RUN_ID: "r" } });
    expect(json(r.stdout)).toMatchObject({ code: "person_only" });
  });
});
