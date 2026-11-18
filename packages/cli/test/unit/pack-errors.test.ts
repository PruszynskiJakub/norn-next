import { describe, expect, test } from "bun:test";
import { PLUGIN_API_VERSION } from "@norn/plugin-api";
import { configPaths, ExitCode, machineDir, machineId, type PluginImporter, runCli } from "../../src/index.ts";
import { COMMON, HOME, LOCAL_CONFIG, machine, ROOT } from "./support.ts";

const PATHS = configPaths(HOME, ROOT);
const LOCK = `${machineDir(HOME, machineId(COMMON))}/plugins.lock`;
const json = (stdout: string): Record<string, unknown> => Bun.JSONL.parse(stdout)[0] as Record<string, unknown>;

const GOOD = ["name: tidy", "start: work", "steps:", "  work:", "    agent: Do the work.", "    outcomes: { done: $done }", ""].join("\n");
/** An installed plugin whose pack has one workflow that loads and one whose YAML does not parse. */
const brokenPack = {
  plugin: {
    name: "packy",
    api: `^${PLUGIN_API_VERSION.split(".").slice(0, 2).join(".")}`,
    provides: { packs: { mine: { workflows: { "tidy.yaml": GOOD, "broken.yaml": "name: broken\nsteps: [unclosed\n" }, shared: {}, skills: {} } } },
  },
};
const importer: PluginImporter = async (name) => {
  if (name !== "norn-pack-mine") throw new Error(`Cannot find package '${name}'`);
  return brokenPack as unknown as Record<string, unknown>;
};
const lock = JSON.stringify({ format: 1, plugins: [{ name: "norn-pack-mine", spec: "norn-pack-mine@^1", version: "1.0.0", api: "^1.5" }] });
const config = `${LOCAL_CONFIG.replace("  intake: { label: norn }", "  intake: { label: norn }\n  user: me@box")}packs: [mine]\nplugins:\n  norn-pack-mine: norn-pack-mine@^1\nkernel: { workflow: tidy }\n`;

function broken() {
  const tools = (argv: string[]) => (argv[1] === "--version" && ["git", "norn", "claude"].includes(argv[0] as string) ? { stdout: "1.0\n" } : undefined);
  return machine({ seed: { [PATHS.local]: config, [LOCK]: lock }, importer, script: tools });
}

describe("an installed pack whose workflow file does not parse", () => {
  test("a tick is refused as pack_invalid, naming the plugin, the pack and the file, with plugin remove to do instead", async () => {
    const r = await runCli(["tick", "--json"], broken().io);
    expect(r.exit).toBe(ExitCode.refused);
    const body = json(r.stdout);
    expect(body.code).toBe("pack_invalid");
    expect(body.error).toContain("pack mine of plugin packy");
    expect(body.error).toContain("broken.yaml does not parse");
    expect(body.error).not.toContain("tidy.yaml");
    expect(body.do_instead).toContain("norn plugin remove norn-pack-mine");
  });

  test("doctor lists it as the failing workflows check; the slots still build", async () => {
    const r = await runCli(["doctor", "--json"], broken().io);
    const checks = json(r.stdout).checks as Array<{ name: string; ok: boolean; code?: string }>;
    expect(checks.find((c) => c.name === "slots")?.ok).toBe(true);
    expect(checks.find((c) => c.name === "workflows")).toMatchObject({ ok: false, code: "pack_invalid" });
    expect(r.exit).not.toBe(ExitCode.ok);
  });

  test("the commands that need no workflow still work: config, plugin list and remove's refusal, story create, help, --version", async () => {
    const m = broken();
    expect((await runCli(["config", "get", "base", "--json"], m.io)).exit).toBe(ExitCode.ok);
    expect((await runCli(["config", "show", "--json"], m.io)).exit).toBe(ExitCode.ok);
    expect((await runCli(["config", "set", "base", "trunk", "--json"], m.io)).exit).toBe(ExitCode.ok);
    expect((await runCli(["plugin", "list", "--json"], m.io)).exit).toBe(ExitCode.ok);
    const created = await runCli(["story", "create", "Tidy the docs", "--json"], m.io);
    expect({ exit: created.exit, key: json(created.stdout).key }).toEqual({ exit: ExitCode.ok, key: "lt-1" });
    expect((await runCli(["help"], m.io)).exit).toBe(ExitCode.ok);
    expect((await runCli(["--version"], m.io)).exit).toBe(ExitCode.ok);
  });
});
