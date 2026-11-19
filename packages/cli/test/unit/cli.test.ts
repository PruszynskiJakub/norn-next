import { describe, expect, test } from "bun:test";
import { PLUGIN_API_VERSION } from "@norn/plugin-api";
import { bundledNames, CliContext, CliFailure, COMMANDS, configPaths, ExitCode, machineDir, machineId, NOUNS, runCli } from "../../src/index.ts";
import { COMMON, HOME, LOCAL_CONFIG, machine, ROOT } from "./support.ts";

const LOCAL = configPaths(HOME, ROOT).local;
const json = (stdout: string): unknown => Bun.JSONL.parse(stdout)[0];

describe("--version and help", () => {
  test("--version prints the norn version, the plugin API version and the bundled plugins", async () => {
    const r = await runCli(["--version", "--json"], machine().io);
    expect(r.exit).toBe(ExitCode.ok);
    expect(json(r.stdout)).toEqual({ version: "9.9.9", plugin_api: PLUGIN_API_VERSION, bundled: bundledNames() });
    const text = await runCli(["--version"], machine().io);
    expect(text.stdout).toBe(`norn 9.9.9\nplugin API ${PLUGIN_API_VERSION}\nbundled: ${bundledNames().join(", ")}\n`);
  });

  test("help lists every command and noun; markdown unless --json", async () => {
    const r = await runCli(["help", "--json"], machine().io);
    const h = json(r.stdout) as { commands: Array<{ command: string }>; nouns: Array<{ command: string; verbs: Array<{ command: string }> }> };
    expect(h.commands.map((c) => c.command)).toEqual(COMMANDS.map((c) => c.name));
    expect(h.nouns.flatMap((n) => n.verbs.map((v) => v.command))).toEqual(NOUNS.flatMap((n) => n.verbs.map((v) => v.name)));
    const md = await runCli([], machine().io);
    expect(md.stdout).toStartWith("# norn\n");
    expect(md.stdout).toContain("- `norn story view <key>`: ");
  });

  test("`norn <noun>`, `norn help <noun> <verb>` and `<command> --help` show help", async () => {
    expect((await runCli(["story"], machine().io)).stdout).toStartWith("# norn story\n");
    const verb = json((await runCli(["help", "config", "set", "--json"], machine().io)).stdout) as { usage: string; options: Record<string, string> };
    expect(verb.usage).toBe("norn config set <key> [<value>] [--commit] [--user] [--unset]");
    expect(Object.keys(verb.options)).toEqual(["--commit", "--user", "--unset", "--json"]);
    expect((await runCli(["done", "--help"], machine().io)).stdout).toStartWith("# norn done\n");
  });

  test("story create's help names whatever tracker is configured, never only the local one", async () => {
    const help = (await runCli(["story", "create", "--help"], machine().io)).stdout;
    expect(help).not.toContain("local tracker");
    expect(help).toContain("Create an item on the configured tracker (a GitHub issue, a local markdown file)");
  });
});

describe("the machine contract", () => {
  test("an unknown command or verb is a usage error, exit 2, as one JSON value with --json", async () => {
    const r = await runCli(["frobnicate", "--json"], machine().io);
    expect(r.exit).toBe(ExitCode.usage);
    expect(json(r.stdout)).toMatchObject({ error: "Unknown command: frobnicate", code: "unknown_command" });
    const v = await runCli(["story", "frob"], machine().io);
    expect(v.exit).toBe(ExitCode.usage);
    expect(v.stdout).toStartWith("**Usage error (unknown_command):** Unknown command: story frob");
  });

  test("an unknown flag or a wrong argument count is a usage error naming the command's help", async () => {
    const r = await runCli(["tick", "--bogus", "--json"], machine().io);
    expect(r.exit).toBe(ExitCode.usage);
    expect(json(r.stdout)).toMatchObject({ code: "usage", do_instead: "norn help tick" });
    const n = await runCli(["story", "view", "--json"], machine().io);
    expect(json(n.stdout)).toMatchObject({ code: "usage", do_instead: "norn story view <key>" });
  });

  test("the rest of the line is one argument for ask, stuck, story answer and story create", async () => {
    const one = COMMANDS.find((c) => c.name === "ask");
    expect(one?.restJoined).toBe(true);
    // parsed as one question: the refusal is ask's own (no launched run), not a usage error
    const r = await runCli(["ask", "is", "this", "right?", "--json"], machine().io);
    expect(json(r.stdout)).toMatchObject({ code: "no_run_env" });
  });

  const STUB_ARGS: Record<string, string[]> = {
    "config get": ["base"],
    "config set": ["base", "dev"],
    "plugin add": ["norn-x"],
    "plugin remove": ["norn-x"],
    "plugin update": ["norn-x"],
    "story view": ["gh-1"],
    "story create": ["A title"],
    "story approve": ["gh-1"],
    "story reject": ["gh-1"],
    "story answer": ["gh-1", "yes"],
    "story close": ["gh-1"],
    "run stop": ["gh-1"],
    done: ["done"],
    ask: ["why?"],
    stuck: ["blocked"],
  };
  /** built, with tests of their own (agent-verbs, person-verbs) */
  const AGENT_AND_PERSON_VERBS = new Set(["brief", "done", "ask", "stuck", "story create", "story approve", "story reject", "story answer", "story round", "story take", "story update-branch", "story close", "run start", "run stop", "run rerun"]);
  /** built, with tests of their own (init, doctor, config-commands, plugin-commands, tick-views, tidy) */
  const HOST_AND_READ_COMMANDS = new Set(["init", "doctor", "status", "tick", "watch", "tidy", "story list", "story view", "config get", "config set", "config show", "plugin add", "plugin list", "plugin remove", "plugin update"]);
  const stubs = [...COMMANDS, ...NOUNS.flatMap((n) => n.verbs)]
    .map((c) => c.name)
    .filter((n) => n !== "help" && n !== "hook" && !AGENT_AND_PERSON_VERBS.has(n) && !HOST_AND_READ_COMMANDS.has(n));

  if (stubs.length > 0) test.each(stubs)("%s parses its arguments and refuses as not built yet, exit 3", async (name) => {
    const r = await runCli([...name.split(" "), ...(STUB_ARGS[name] ?? []), "--json"], machine().io);
    expect({ exit: r.exit, body: json(r.stdout) }).toEqual({ exit: ExitCode.refused, body: { error: `norn ${name} is not built yet`, do_instead: null, code: "not_built" } });
  });

  test("a hook always answers its harness: a failure prints nothing, exits 0 and says why on stderr", async () => {
    const r = await runCli(["hook", "claude", "Stop", "--json"], machine({ stdin: "{}", env: { NORN_UNIT: "lt-1", NORN_RUN_ID: "r1" } }).io);
    expect({ exit: r.exit, stdout: r.stdout }).toEqual({ exit: 0, stdout: "" });
    expect(r.stderr).toStartWith("norn hook: ");
  });

  test("a hook norn fails before its guard still denies a write, naming why; anything else is let through", async () => {
    const env = { NORN_UNIT: "lt-1", NORN_RUN_ID: "r1" };
    const write = JSON.stringify({ hook_event_name: "PreToolUse", tool_use_id: "t1", tool_name: "Write", tool_input: { file_path: "/etc/passwd", content: "x" } });
    const broken = { [LOCAL]: "format: 1\ntracker: [unclosed\n" };
    const r = await runCli(["hook", "claude", "PreToolUse"], machine({ stdin: write, env, seed: broken }).io);
    expect(r.exit).toBe(0);
    const out = JSON.parse(r.stdout).hookSpecificOutput;
    expect(out.permissionDecision).toBe("deny");
    expect(out.permissionDecisionReason).toContain("norn hook: ");
    const read = JSON.stringify({ hook_event_name: "PreToolUse", tool_use_id: "t2", tool_name: "Read", tool_input: { file_path: "/etc/passwd" } });
    const allowed = await runCli(["hook", "claude", "PreToolUse"], machine({ stdin: read, env, seed: broken }).io);
    expect({ exit: allowed.exit, stdout: allowed.stdout }).toEqual({ exit: 0, stdout: "" });
  });

  test("a hook line with an argument too many (the harness named twice) still denies a write; anything else is let through", async () => {
    const env = { NORN_UNIT: "lt-1", NORN_RUN_ID: "r1" };
    const write = JSON.stringify({ hook_event_name: "PreToolUse", tool_use_id: "t1", tool_name: "Write", tool_input: { file_path: "/etc/passwd", content: "x" } });
    const r = await runCli(["hook", "claude", "claude", "PreToolUse"], machine({ stdin: write, env }).io);
    expect(r.exit).toBe(0);
    const out = JSON.parse(r.stdout).hookSpecificOutput;
    expect(out.permissionDecision).toBe("deny");
    expect(out.permissionDecisionReason).toContain("expected <harness> <hook>, got 3 argument(s)");
    const read = JSON.stringify({ hook_event_name: "PreToolUse", tool_use_id: "t2", tool_name: "Read", tool_input: { file_path: "/etc/passwd" } });
    const allowed = await runCli(["hook", "claude", "claude", "PreToolUse"], machine({ stdin: read, env }).io);
    expect({ exit: allowed.exit, stdout: allowed.stdout }).toEqual({ exit: 0, stdout: "" });
  });
});

describe("the context a command runs with", () => {
  test("the repo: its root, its machine dir under the norn home, and the host over both", async () => {
    const ctx = new CliContext(machine({ cwd: `${ROOT}/src` }).io);
    const w = await ctx.repo();
    expect({ home: w.home, root: w.repo.root, machine: w.machine, dataDir: w.ctx.repo.dataDir }).toEqual({
      home: HOME,
      root: ROOT,
      machine: machineDir(HOME, machineId(COMMON)),
      dataDir: machineDir(HOME, machineId(COMMON)),
    });
  });

  test("no config at all: a config error, exit 6, sending to norn init", async () => {
    const e = await new CliContext(machine().io).config().catch((x: unknown) => x);
    expect(e).toBeInstanceOf(CliFailure);
    expect({ exit: (e as CliFailure).exit, code: (e as CliFailure).body.code, do_instead: (e as CliFailure).body.do_instead }).toEqual({
      exit: ExitCode.config,
      code: "config_missing",
      do_instead: "norn init",
    });
  });

  test("a config on bundled plugins wires the runtime: slots resolved, the pack's workflows loaded", async () => {
    const ctx = new CliContext(machine({ seed: { [LOCAL]: LOCAL_CONFIG } }).io);
    const env = await ctx.runtimeEnv();
    expect(env.config.holder).toBe("me@box");
    expect(env.config.pack).toBe("sdlc");
    expect(Object.keys(env.workflows)).toContain("story");
    expect(Object.keys(env.slots.executors)).toEqual(["claude"]);
    expect(typeof (await ctx.runtime()).tick).toBe("function");
  });

  test("a slot's config its plugin refuses is a config error too", async () => {
    const ctx = new CliContext(machine({ seed: { [LOCAL]: LOCAL_CONFIG.replace("store: { use: local }", "store: { use: local, nonsense: 1 }") } }).io);
    const e = await ctx.runtimeEnv().catch((x: unknown) => x);
    expect(e).toBeInstanceOf(CliFailure);
    expect({ exit: (e as CliFailure).exit, code: (e as CliFailure).body.code }).toEqual({ exit: ExitCode.config, code: "slot_config_invalid" });
  });
});
