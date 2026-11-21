import { describe, expect, test } from "bun:test";
import { configPaths, ExitCode, REPO_COMMITTED_FILE, REPO_LOCAL_FILE, runCli } from "../../src/index.ts";
import { HOME, LOCAL_CONFIG, machine, ROOT } from "./support.ts";

const PATHS = configPaths(HOME, ROOT);
const json = (stdout: string): Record<string, unknown> => Bun.JSONL.parse(stdout)[0] as Record<string, unknown>;

describe("norn config get", () => {
  test("a key of the merged config, a default included; a mapping prints as YAML", async () => {
    const m = machine({ seed: { [PATHS.local]: LOCAL_CONFIG } });
    expect(json((await runCli(["config", "get", "tracker.intake.label", "--json"], m.io)).stdout)).toEqual({ key: "tracker.intake.label", value: "norn", source: "local", file: PATHS.local });
    expect((await runCli(["config", "get", "vcs.use"], m.io)).stdout).toBe("git\n");
    expect((await runCli(["config", "get", "executors"], m.io)).stdout).toBe("claude:\n  harness: claude\n  runner: headless\n");
  });

  test("each key names the file that set it, the highest holding it, or the defaults", async () => {
    const m = machine({ seed: { [PATHS.local]: LOCAL_CONFIG, [PATHS.user]: "format: 1\nkernel: { mode: manual }\n" } });
    expect(json((await runCli(["config", "get", "kernel.mode", "--json"], m.io)).stdout)).toEqual({ key: "kernel.mode", value: "manual", source: "user", file: PATHS.user });
    await runCli(["config", "set", "kernel.mode", "auto"], m.io);
    expect(json((await runCli(["config", "get", "kernel.mode", "--json"], m.io)).stdout)).toEqual({ key: "kernel.mode", value: "auto", source: "local", file: PATHS.local });
    expect(json((await runCli(["config", "get", "vcs.use", "--json"], m.io)).stdout)).toEqual({ key: "vcs.use", value: "git", source: "default" });
  });

  test("a key nothing sets is refused, never printed as empty", async () => {
    const r = await runCli(["config", "get", "base_ref", "--json"], machine({ seed: { [PATHS.local]: LOCAL_CONFIG } }).io);
    expect({ exit: r.exit, body: json(r.stdout) }).toMatchObject({ exit: ExitCode.refused, body: { code: "config_key_unset", do_instead: "norn config show" } });
  });
});

describe("norn config set", () => {
  test("writes the repo-local file by default, keeping a person's comments", async () => {
    const m = machine({ seed: { [PATHS.local]: `# ours\n${LOCAL_CONFIG}` } });
    const r = await runCli(["config", "set", "base", "dev", "--json"], m.io);
    expect(json(r.stdout)).toMatchObject({ key: "base", value: "dev", layer: "local", file: PATHS.local, valid: true });
    const text = (await m.files.read(PATHS.local)) as string;
    expect(text).toStartWith("# ours\n");
    expect(text).toContain("base: dev");
  });

  test("--commit writes the committed file, --user the user file; the value is read as YAML", async () => {
    const m = machine({ seed: { [PATHS.local]: LOCAL_CONFIG } });
    await runCli(["config", "set", "kernel.max_nudges", "3", "--commit"], m.io);
    expect(await m.files.read(PATHS.repo)).toBe("format: 1\nkernel:\n  max_nudges: 3\n");
    await runCli(["config", "set", "holder", "me@desk", "--user"], m.io);
    expect(await m.files.read(PATHS.user)).toBe("format: 1\nholder: me@desk\n");
    expect(json((await runCli(["config", "get", "kernel.max_nudges", "--json"], m.io)).stdout).value).toBe(3);
  });

  test("a set that would break a valid config is a config error and writes nothing", async () => {
    const m = machine({ seed: { [PATHS.local]: LOCAL_CONFIG } });
    const r = await runCli(["config", "set", "kernel.max_nudges", "many", "--json"], m.io);
    expect(r.exit).toBe(ExitCode.config);
    expect(json(r.stdout)).toMatchObject({ code: "config_invalid" });
    expect(await m.files.read(PATHS.local)).toBe(LOCAL_CONFIG);
  });

  test("a set a higher file overrides is written, and the answer says which file wins and the value that stays", async () => {
    const m = machine({ seed: { [PATHS.local]: LOCAL_CONFIG, [PATHS.repo]: "format: 1\nkernel: { mode: manual }\n" } });
    const r = await runCli(["config", "set", "kernel.mode", "auto", "--json"], m.io);
    expect(r.exit).toBe(ExitCode.ok);
    expect(json(r.stdout)).toMatchObject({ layer: "local", overridden: { layer: "repo", file: PATHS.repo, keys: ["kernel.mode"], value: "manual" } });
    expect(await m.files.read(PATHS.local)).toContain("mode: auto");
    const md = await runCli(["config", "set", "kernel.mode", "auto"], m.io);
    expect(md.stdout).toContain(`but ${REPO_COMMITTED_FILE} sets kernel.mode too and wins over ${REPO_LOCAL_FILE}: the merged value stays "manual"`);
    expect(md.stdout).toContain("norn config set kernel.mode auto --commit");
  });

  test("a set nothing higher overrides, or one in the highest file, carries no override", async () => {
    const m = machine({ seed: { [PATHS.local]: LOCAL_CONFIG, [PATHS.repo]: "format: 1\nkernel: { mode: manual }\n" } });
    expect(json((await runCli(["config", "set", "kernel.max_nudges", "2", "--json"], m.io)).stdout).overridden).toBeUndefined();
    expect(json((await runCli(["config", "set", "kernel.mode", "auto", "--commit", "--json"], m.io)).stdout).overridden).toBeUndefined();
    expect(json((await runCli(["config", "set", "kernel.mode", "auto", "--user", "--json"], m.io)).stdout).overridden).toMatchObject({ layer: "repo" });
  });

  test("a policy set in a repo file that names more than the user's file grants is written, and the answer says only the user's file grants it", async () => {
    const m = machine({ seed: { [PATHS.local]: LOCAL_CONFIG, [PATHS.user]: "format: 1\npolicy: { stand_in: { gates: [story.ready] } }\n" } });
    const r = await runCli(["config", "set", "policy.stand_in.gates", "[story.ready, story.merge]", "--commit", "--json"], m.io);
    expect(r.exit).toBe(ExitCode.ok);
    expect(json(r.stdout)).toMatchObject({ layer: "repo", narrowed: { value: ["story.ready"] } });
    expect(json(r.stdout).overridden).toBeUndefined();
    const md = await runCli(["config", "set", "policy.stand_in.gates", "[story.ready, story.merge]"], m.io);
    expect(md.stdout).toContain('the merged value stays ["story.ready"]');
    expect(md.stdout).toContain("norn config set policy.stand_in.gates [story.ready, story.merge] --user");
    expect(json((await runCli(["config", "set", "policy.stand_in.gates", "[story.ready]", "--commit", "--json"], m.io)).stdout).narrowed).toBeUndefined();
    // a narrower repo file never overrides the user's grant: it is the user's file the set widens
    expect(json((await runCli(["config", "set", "policy.stand_in.gates", "[story.ready, story.merge]", "--user", "--json"], m.io)).stdout)).toMatchObject({ layer: "user", narrowed: { value: ["story.ready"] } });
  });

  test("a key this norn no longer reads is refused as a set and removed by --unset", async () => {
    const m = machine({ seed: { [PATHS.local]: `${LOCAL_CONFIG}kernel:\n  max_agents: 4\n` } });
    const r = await runCli(["config", "set", "kernel.max_agents", "3", "--json"], m.io);
    expect(r.exit).toBe(ExitCode.config);
    expect(json(r.stdout).error).toContain("kernel.max_agents is no longer read");
    expect(await m.files.read(PATHS.local)).toContain("max_agents: 4");
    expect((await runCli(["config", "set", "kernel.max_agents", "--unset", "--json"], m.io)).exit).toBe(ExitCode.ok);
    expect(await m.files.read(PATHS.local)).not.toContain("max_agents");
  });

  test("a set of a mapping that holds a key this norn no longer reads is refused too", async () => {
    const m = machine({ seed: { [PATHS.local]: LOCAL_CONFIG } });
    const r = await runCli(["config", "set", "kernel", "{max_agents: 3}", "--json"], m.io);
    expect(r.exit).toBe(ExitCode.config);
    expect(json(r.stdout).error).toContain("kernel.max_agents is no longer read");
    expect(await m.files.read(PATHS.local)).not.toContain("max_agents");
  });

  test("--unset removes the key", async () => {
    const m = machine({ seed: { [PATHS.local]: `${LOCAL_CONFIG}base: dev\n` } });
    const r = await runCli(["config", "set", "base", "--unset", "--json"], m.io);
    expect(json(r.stdout)).toMatchObject({ key: "base", unset: true });
    expect(await m.files.read(PATHS.local)).not.toContain("base:");
  });

  test("a config built up key by key: each set is written, and the answer names what is still missing", async () => {
    const m = machine();
    const r = await runCli(["config", "set", "tracker.use", "local", "--json"], m.io);
    expect(r.exit).toBe(ExitCode.ok);
    const body = json(r.stdout) as { valid: boolean; problems: Array<{ path: string }> };
    expect(body.valid).toBe(false);
    expect(body.problems.length).toBeGreaterThan(0);
    expect(await m.files.read(PATHS.local)).toBe("format: 1\ntracker:\n  use: local\n");
  });

  test("usage: a value and --unset together, neither, or --commit with --user", async () => {
    const io = machine({ seed: { [PATHS.local]: LOCAL_CONFIG } }).io;
    for (const args of [["base", "dev", "--unset"], ["base"], ["base", "dev", "--commit", "--user"], ["not a key", "x"]])
      expect((await runCli(["config", "set", ...args, "--json"], io)).exit).toBe(ExitCode.usage);
  });
});

describe("norn config show", () => {
  test("the merged config and which file set each key", async () => {
    const m = machine({ seed: { [PATHS.local]: LOCAL_CONFIG, [PATHS.user]: "holder: me@desk\nbase: trunk\n", [PATHS.repo]: "base: main\n" } });
    const body = json((await runCli(["config", "show", "--json"], m.io)).stdout) as { valid: boolean; config: Record<string, unknown>; origins: Record<string, string>; files: Record<string, { path: string; exists: boolean }> };
    expect(body.valid).toBe(true);
    expect(body.config).toMatchObject({ base: "main", holder: "me@desk", vcs: { use: "git" } });
    expect(body.origins).toMatchObject({ base: "repo", holder: "user", "tracker.use": "local", "tracker.intake.label": "local", "vcs.use": "default", packs: "default" });
    expect(body.files).toEqual({ user: { path: PATHS.user, exists: true }, local: { path: PATHS.local, exists: true }, repo: { path: PATHS.repo, exists: true } });
  });

  test("an invalid config is still shown, with valid false and its problems", async () => {
    const m = machine({ seed: { [PATHS.local]: "tracker: { use: local }\n" } });
    const r = await runCli(["config", "show", "--json"], m.io);
    expect(r.exit).toBe(ExitCode.ok);
    const body = json(r.stdout) as { valid: boolean; problems: unknown[]; origins: Record<string, string> };
    expect(body.valid).toBe(false);
    expect(body.problems.length).toBeGreaterThan(0);
    expect(body.origins["tracker.use"]).toBe("local");
    expect((await runCli(["config", "show"], m.io)).stdout).toContain("**Invalid:**");
  });
});
