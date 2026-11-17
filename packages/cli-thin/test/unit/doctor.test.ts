import { describe, expect, test } from "bun:test";
import type { ExecScript } from "@norn/conformance";
import { configPaths, ExitCode, machineDir, machineId, type PluginImporter, runCli } from "../../src/index.ts";
import { COMMON, HOME, LOCAL_CONFIG, machine, ROOT } from "./support.ts";

const PATHS = configPaths(HOME, ROOT);
const LOCK = `${machineDir(HOME, machineId(COMMON))}/plugins.lock`;

interface Check {
  name: string;
  ok: boolean;
  skipped?: boolean;
  error?: string;
  do_instead?: string | null;
  code?: string;
}

/** Only the listed binaries answer `--version`. */
const tools =
  (...have: string[]): ExecScript =>
  (argv) =>
    argv[1] === "--version" && have.includes(argv[0] as string) ? { stdout: `${argv[0]} 1.0\n` } : undefined;

async function doctor(opts: { config?: string; have?: string[]; seed?: Record<string, string>; importer?: PluginImporter } = {}) {
  const seed = { ...(opts.config === undefined ? {} : { [PATHS.local]: opts.config }), ...(opts.seed ?? {}) };
  const m = machine({ seed, script: tools(...(opts.have ?? ["git", "norn", "claude"])), ...(opts.importer ? { importer: opts.importer } : {}) });
  const r = await runCli(["doctor", "--json"], m.io);
  const body = Bun.JSONL.parse(r.stdout)[0] as { ok: boolean; checks: Check[] };
  const check = (name: string) => body.checks.find((c) => c.name === name) as Check;
  return { r, body, check };
}

describe("norn doctor", () => {
  test("a complete config with its tools present: every check passes, exit 0", async () => {
    const { r, body } = await doctor({ config: LOCAL_CONFIG });
    expect(r.exit).toBe(ExitCode.ok);
    expect(body.ok).toBe(true);
    expect(body.checks.map((c) => c.name)).toEqual(["config", "plugins", "slots", "workflows", "hooks", "tool git", "tool claude"]);
  });

  test("no config: the config check fails naming norn init, the checks after it are skipped, git is still checked; exit 1", async () => {
    const { r, body, check } = await doctor();
    expect(r.exit).toBe(ExitCode.error);
    expect(check("config")).toMatchObject({ ok: false, code: "config_missing", do_instead: "norn init" });
    expect(body.checks.filter((c) => c.skipped).map((c) => c.name)).toEqual(["plugins", "slots", "workflows", "hooks"]);
    expect(check("tool git").ok).toBe(true);
  });

  test("a tool the config needs that is missing names how to get it", async () => {
    const { r, check } = await doctor({ config: LOCAL_CONFIG, have: ["git", "norn"] });
    expect(r.exit).toBe(ExitCode.error);
    expect(check("tool claude")).toMatchObject({ ok: false, code: "tool_missing" });
    expect(check("tool claude").do_instead).toContain("Claude Code");
  });

  test("pi is needed when an executor runs the pi harness, and claude only when one runs claude", async () => {
    const pi = LOCAL_CONFIG.replace("harness: claude", "harness: pi");
    expect(pi).not.toBe(LOCAL_CONFIG);
    const missing = await doctor({ config: pi, have: ["git", "norn", "claude"] });
    expect(missing.check("tool pi")).toMatchObject({ ok: false, code: "tool_missing" });
    expect(missing.check("tool pi").do_instead).toContain("pi coding agent");
    expect(missing.check("tool claude")).toBeUndefined();
    const present = await doctor({ config: pi, have: ["git", "norn", "pi"] });
    expect(present.body.ok).toBe(true);
    expect(present.body.checks.map((c) => c.name)).toEqual(["config", "plugins", "slots", "workflows", "hooks", "tool git", "tool pi"]);
  });

  test("gh is needed with the github tracker or forge, herdr with the herdr runner", async () => {
    const github = LOCAL_CONFIG.replace("forge: { use: none }", "forge: { use: github }").replace("runner: headless", "runner: herdr");
    const { check } = await doctor({ config: github, have: ["git", "norn", "claude"] });
    expect(check("tool gh")).toMatchObject({ ok: false, code: "tool_missing" });
    expect(check("tool gh").do_instead).toContain("gh auth login");
    expect(check("tool herdr")).toMatchObject({ ok: false, code: "tool_missing" });
  });

  test("a config error names the file to fix; a slot's config its plugin refuses fails the slots check", async () => {
    const typo = await doctor({ config: `${LOCAL_CONFIG}bogus: 1\n` });
    expect(typo.check("config")).toMatchObject({ ok: false, code: "config_invalid" });
    expect(typo.check("config").do_instead).toStartWith("fix ");
    const slot = await doctor({ config: LOCAL_CONFIG.replace("store: { use: local }", "store: { use: local, nonsense: 1 }") });
    expect(slot.check("slots")).toMatchObject({ ok: false, code: "slot_config_invalid", do_instead: "norn doctor" });
    expect(slot.check("workflows").skipped).toBe(true);
  });

  test("an installed plugin written for another plugin API fails the plugins check, naming plugin update", async () => {
    const lock = JSON.stringify({ format: 1, plugins: [{ name: "norn-plugin-old", spec: "norn-plugin-old@1", version: "1.0.0", api: "^0.9" }] });
    const old = { plugin: { name: "old", api: "^0.9", provides: {} } };
    const { check } = await doctor({ config: LOCAL_CONFIG, seed: { [LOCK]: lock }, importer: async () => old });
    expect(check("plugins")).toMatchObject({ ok: false, code: "plugin_api", do_instead: "norn plugin update norn-plugin-old" });
  });

  test("a hook command that cannot run fails the hooks check", async () => {
    const { check } = await doctor({ config: LOCAL_CONFIG, have: ["git", "claude"] });
    expect(check("hooks")).toMatchObject({ ok: false, code: "hook_command_missing" });
  });

  test("the markdown names each failing check with what to do instead", async () => {
    const m = machine({ seed: { [PATHS.local]: LOCAL_CONFIG }, script: tools("git", "norn") });
    const r = await runCli(["doctor"], m.io);
    expect(r.stdout).toStartWith("# norn doctor: some checks fail\n");
    expect(r.stdout).toMatch(/- tool claude: FAILED — claude is not runnable .* — do instead: install Claude Code/);
  });
});
