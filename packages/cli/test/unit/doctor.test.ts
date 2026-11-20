import { describe, expect, test } from "bun:test";
import type { ExecScript } from "@norn/conformance";
import { configPaths, ExitCode, machineDir, machineId, type PluginImporter, runCli } from "../../src/index.ts";
import { COMMON, fakeGh, GITHUB_CONFIG, HOME, LOCAL_CONFIG, machine, ROOT } from "./support.ts";

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

/** Only the listed binaries answer `--version`; with norn among them, the hook line an agent runs answers as norn's does outside a run. */
const tools =
  (...have: string[]): ExecScript =>
  (argv) => {
    if (argv[1] === "--version" && have.includes(argv[0] as string)) return { stdout: `${argv[0]} 1.0\n` };
    if (argv[0] === "sh" && argv[1] === "-c" && have.includes("norn") && argv[2]?.startsWith("norn hook ")) return { stdout: "" };
    return undefined;
  };

async function doctor(opts: { config?: string; have?: string[]; seed?: Record<string, string>; importer?: PluginImporter; args?: string[] } = {}) {
  const seed = { ...(opts.config === undefined ? {} : { [PATHS.local]: opts.config }), ...(opts.seed ?? {}) };
  const m = machine({ seed, script: tools(...(opts.have ?? ["git", "norn", "claude"])), ...(opts.importer ? { importer: opts.importer } : {}) });
  const r = await runCli(["doctor", ...(opts.args ?? []), "--json"], m.io);
  const body = Bun.JSONL.parse(r.stdout)[0] as { ok: boolean; checks: Check[] };
  const check = (name: string) => body.checks.find((c) => c.name === name) as Check;
  return { r, body, check };
}

describe("norn doctor", () => {
  test("a complete config with its tools present: every check passes, exit 0", async () => {
    const { r, body } = await doctor({ config: LOCAL_CONFIG });
    expect(r.exit).toBe(ExitCode.ok);
    expect(body.ok).toBe(true);
    expect(body.checks.map((c) => c.name)).toEqual(["config", "plugins", "slots", "workflows", "labels", "hooks", "skills", "tool git", "remote", "tool claude"]);
  });

  test("a forge without checks: the workflows still load, and doctor warns which await steps wait on ci kinds it never reports", async () => {
    const { r, check } = await doctor({ config: LOCAL_CONFIG });
    expect(r.exit).toBe(ExitCode.ok);
    const workflows = check("workflows") as Check & { warning?: string };
    expect(workflows.ok).toBe(true);
    expect(workflows.warning).toBe("forge none reports no checks, so these await steps never see the ci kinds they wait on: quick step ci (ci.passed, ci.failed), story step ci (ci.passed, ci.failed); each takes ci.none at once");
    const github = await doctor({ config: GITHUB_CONFIG.replace("forge: { use: none }", "forge: { use: github }"), have: ["git", "norn", "claude", "gh"] });
    expect((github.check("workflows") as Check & { warning?: string }).warning).toBeUndefined();
  });

  test("a config that still sets kernel.max_agents passes, and the config check names the key to delete", async () => {
    const { r, body, check } = await doctor({ config: `${LOCAL_CONFIG}kernel:\n  max_agents: 2\n` });
    expect(r.exit).toBe(ExitCode.ok);
    expect(body.ok).toBe(true);
    const detail = (check("config") as Check & { detail?: string }).detail;
    expect(detail).toContain("kernel.max_agents is no longer read");
    expect(detail).toContain("norn config set kernel.max_agents --unset");
  });

  test("any command run on a config that still sets kernel.max_agents runs, with a line on stderr naming the key", async () => {
    const m = machine({ seed: { [PATHS.local]: `${LOCAL_CONFIG}kernel:\n  max_agents: 2\n` }, script: tools("git", "norn", "claude") });
    const r = await runCli(["config", "get", "base", "--json"], m.io);
    expect(r.exit).toBe(ExitCode.ok);
    expect(r.stderr).toContain("kernel.max_agents is no longer read");
  });

  test("labels: doctor defines the labels norn uses on the tracker, the intake label, one per workflow and the triage set, once", async () => {
    const gh = fakeGh(["norn", "norn:wf:quick"]);
    const m = machine({ seed: { [PATHS.local]: GITHUB_CONFIG }, script: (argv, o) => gh.script(argv, o) ?? tools("git", "norn", "claude")(argv, o) });
    const r = await runCli(["doctor", "--json"], m.io);
    const labels = (Bun.JSONL.parse(r.stdout)[0] as { checks: Check[] }).checks.find((c) => c.name === "labels");
    expect(labels).toMatchObject({ ok: true });
    const made = gh.calls.filter((c) => c.startsWith("label create")).map((c) => c.slice("label create ".length));
    expect(made).toContain("norn:wf:story");
    expect(made).toContain("norn:kind:bug");
    expect(made).toContain("norn:priority:extreme");
    expect(made).not.toContain("norn");
    expect(made).not.toContain("norn:wf:quick");
    gh.calls.length = 0;
    await runCli(["doctor", "--json"], m.io);
    expect(gh.calls.filter((c) => c.startsWith("label create"))).toEqual([]);
  });

  test("labels: one the tracker cannot define fails the check, naming what to do", async () => {
    const gh = fakeGh();
    gh.refuseLabels = true;
    const m = machine({ seed: { [PATHS.local]: GITHUB_CONFIG }, script: (argv, o) => gh.script(argv, o) ?? tools("git", "norn", "claude")(argv, o) });
    const r = await runCli(["doctor", "--json"], m.io);
    const labels = (Bun.JSONL.parse(r.stdout)[0] as { checks: Check[] }).checks.find((c) => c.name === "labels");
    expect(labels).toMatchObject({ ok: false, code: "labels_undefined" });
    expect(labels?.do_instead).toContain("norn doctor");
  });

  test("--repo checks only the repo's tree: no hooks and no tools, so a machine with no agent passes", async () => {
    const { r, body } = await doctor({ config: LOCAL_CONFIG, have: [], args: ["--repo"] });
    expect(r.exit).toBe(ExitCode.ok);
    expect(body.checks.map((c) => c.name)).toEqual(["config", "plugins", "slots", "workflows"]);
  });

  test("no config: the config check fails naming norn init, the checks after it are skipped, git is still checked; exit 1", async () => {
    const { r, body, check } = await doctor();
    expect(r.exit).toBe(ExitCode.error);
    expect(check("config")).toMatchObject({ ok: false, code: "config_missing", do_instead: "norn init" });
    expect(body.checks.filter((c) => c.skipped).map((c) => c.name)).toEqual(["plugins", "slots", "workflows", "labels", "hooks", "skills"]);
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
    expect(present.body.checks.map((c) => c.name)).toEqual(["config", "plugins", "slots", "workflows", "labels", "hooks", "skills", "tool git", "remote", "tool pi"]);
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
    expect(check("hooks")).toMatchObject({ ok: false, code: "hook_not_firing" });
  });

  test("hooks: the line an agent's hook runs is run through a shell, outside any run; one that does not answer fails though norn itself runs", async () => {
    // norn answers --version, but the hook line fails as a hook run by bun without its script did
    const m = machine({
      seed: { [PATHS.local]: LOCAL_CONFIG },
      script: (argv, o) => (argv[0] === "sh" ? { code: 1, stderr: 'error: Script not found "hook"\n' } : tools("git", "norn", "claude")(argv, o)),
    });
    const r = await runCli(["doctor", "--json"], m.io);
    const hooks = (Bun.JSONL.parse(r.stdout)[0] as { checks: Check[] }).checks.find((c) => c.name === "hooks");
    expect(hooks).toMatchObject({ ok: false, code: "hook_not_firing" });
    expect(hooks?.error).toContain('Script not found "hook"');
    expect(hooks?.do_instead).toContain("norn");
    const probe = m.exec.calls.find((c) => c.argv[0] === "sh");
    expect(probe?.argv[2]).toStartWith("norn hook claude ");
    // a doctor run inside a unit must not file its probe under that unit's run
    expect(probe?.opts.env).toMatchObject({ NORN_UNIT: "", NORN_RUN_ID: "" });
    const fires = await doctor({ config: LOCAL_CONFIG });
    expect(fires.check("hooks")).toMatchObject({ ok: true });
  });

  test("git older than 2.38 fails the git check, naming the upgrade", async () => {
    const old = (version: string): ExecScript => (argv, o) => (argv[0] === "git" && argv[1] === "--version" ? { stdout: `git version ${version}\n` } : tools("norn", "claude")(argv, o));
    const m = machine({ seed: { [PATHS.local]: LOCAL_CONFIG }, script: old("2.37.1") });
    const r = await runCli(["doctor", "--json"], m.io);
    const git = (Bun.JSONL.parse(r.stdout)[0] as { checks: Check[] }).checks.find((c) => c.name === "tool git");
    expect(r.exit).toBe(ExitCode.error);
    expect(git).toMatchObject({ ok: false, code: "git_too_old" });
    expect(git?.do_instead).toContain("2.38");
    const fresh = machine({ seed: { [PATHS.local]: LOCAL_CONFIG }, script: old("2.39.3 (Apple Git-145)") });
    const ok = (Bun.JSONL.parse((await runCli(["doctor", "--json"], fresh.io)).stdout)[0] as { checks: Check[] }).checks.find((c) => c.name === "tool git");
    expect(ok).toMatchObject({ ok: true });
  });

  test("gh: with the github tracker or forge, a gh that is not logged in fails gh auth, naming gh auth login", async () => {
    const run = async (loggedOut: boolean) => {
      const gh = fakeGh();
      gh.loggedOut = loggedOut;
      const m = machine({ seed: { [PATHS.local]: GITHUB_CONFIG }, script: (argv, o) => gh.script(argv, o) ?? tools("git", "norn", "claude")(argv, o) });
      const r = await runCli(["doctor", "--json"], m.io);
      return (Bun.JSONL.parse(r.stdout)[0] as { checks: Check[] }).checks.find((c) => c.name === "gh auth");
    };
    expect(await run(true)).toMatchObject({ ok: false, code: "gh_logged_out", do_instead: "gh auth login" });
    expect(await run(false)).toMatchObject({ ok: true });
  });

  test("remote: the github forge with no git remote fails the remote check, naming git remote add; forge none needs none", async () => {
    const forge = LOCAL_CONFIG.replace("forge: { use: none }", "forge: { use: github }");
    const remote = (url: string | null): ExecScript => (argv, o) => {
      if (argv[0] === "git" && argv[1] === "remote" && argv[2] === "get-url") return url === null ? { code: 2, stderr: "error: No such remote 'origin'\n" } : { stdout: `${url}\n` };
      if (argv[0] === "gh" && argv[1] === "auth") return { stdout: "" };
      return tools("git", "norn", "claude", "gh")(argv, o);
    };
    const check = async (config: string, url: string | null) => {
      const m = machine({ seed: { [PATHS.local]: config }, script: remote(url) });
      return (Bun.JSONL.parse((await runCli(["doctor", "--json"], m.io)).stdout)[0] as { checks: Check[] }).checks.find((c) => c.name === "remote");
    };
    expect(await check(forge, null)).toMatchObject({ ok: false, code: "no_remote", do_instead: "git remote add origin <url>" });
    expect(await check(forge, "git@github.com:acme/app.git")).toMatchObject({ ok: true });
    expect(await check(LOCAL_CONFIG, null)).toMatchObject({ ok: true });
  });

  test("remote: the refs store checks its own remote, which need not be the vcs remote", async () => {
    const remotes = (have: string[]): ExecScript => (argv, o) => {
      if (argv[0] === "git" && argv[1] === "remote" && argv[2] === "get-url")
        return have.includes(argv[3] as string) ? { stdout: `git@example.com:${argv[3]}.git\n` } : { code: 2, stderr: `error: No such remote '${argv[3]}'\n` };
      if (argv[0] === "gh" && argv[1] === "auth") return { stdout: "" };
      return tools("git", "norn", "claude", "gh")(argv, o);
    };
    const remoteChecks = async (config: string, have: string[]) => {
      const m = machine({ seed: { [PATHS.local]: config }, script: remotes(have) });
      return (Bun.JSONL.parse((await runCli(["doctor", "--json"], m.io)).stdout)[0] as { checks: Check[] }).checks.filter((c) => c.name.startsWith("remote"));
    };
    const refs = LOCAL_CONFIG.replace("store: { use: local }", "store: { use: refs }");
    const alone = await remoteChecks(refs, []);
    expect(alone.map((c) => [c.name, c.ok, c.code ?? null, c.do_instead ?? null])).toEqual([["remote", false, "no_remote", "git remote add origin <url>"]]);
    expect(alone[0]?.error).toContain("the refs store");
    const upstream = LOCAL_CONFIG.replace("store: { use: local }", "store: { use: refs, remote: upstream }").replace("forge: { use: none }", "forge: { use: github }");
    const split = await remoteChecks(upstream, ["origin"]);
    expect(split.map((c) => [c.name, c.ok, c.code ?? null])).toEqual([
      ["remote origin", true, null],
      ["remote upstream", false, "no_remote"],
    ]);
    expect(split[1]?.do_instead).toBe("git remote add upstream <url>");
    expect((await remoteChecks(upstream, ["origin", "upstream"])).every((c) => c.ok)).toBe(true);
  });

  test("--repo reads the repo's own config files, never the user's", async () => {
    const seed = { [PATHS.user]: "bogus: 1\n" };
    const whole = await doctor({ config: LOCAL_CONFIG, seed });
    expect(whole.check("config")).toMatchObject({ ok: false, code: "config_invalid" });
    const repoOnly = await doctor({ config: LOCAL_CONFIG, seed, args: ["--repo"] });
    expect(repoOnly.r.exit).toBe(ExitCode.ok);
    expect(repoOnly.check("config")).toMatchObject({ ok: true });
  });

  test("the markdown names each failing check with what to do instead", async () => {
    const m = machine({ seed: { [PATHS.local]: LOCAL_CONFIG }, script: tools("git", "norn") });
    const r = await runCli(["doctor"], m.io);
    expect(r.stdout).toStartWith("# norn doctor: some checks fail\n");
    expect(r.stdout).toMatch(/- tool claude: FAILED — claude is not runnable .* — do instead: install Claude Code/);
  });
});
