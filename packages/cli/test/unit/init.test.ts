import { describe, expect, test } from "bun:test";
import type { ExecScript } from "@norn/conformance";
import { SDLC_PACK } from "@norn/pack-sdlc";
import { parse } from "yaml";
import { join } from "node:path";
import { AGENTS_DIR, configPaths, REPO_COMMITTED_FILE, REPO_LOCAL_FILE, ExitCode, OLD_LOCAL_CONFIG_FILE, OLD_REPO_CONFIG_FILE, runCli } from "../../src/index.ts";
import { COMMON, fakeGh, HOME, LOCAL_CONFIG, machine, ROOT } from "./support.ts";

const PATHS = configPaths(HOME, ROOT);
const EXCLUDE = `${COMMON}/info/exclude`;
const json = (stdout: string): Record<string, unknown> => Bun.JSONL.parse(stdout)[0] as Record<string, unknown>;

interface World {
  origin?: string;
  tools?: string[];
  originHead?: string;
  branch?: string;
}

/** git answers for the remote and branches; a tool answers `--version` only when listed; the hook binary always runs. */
function world(w: World): ExecScript {
  const tools = new Set(["git", "norn", ...(w.tools ?? [])]);
  return (argv) => {
    const line = argv.join(" ");
    if (line === "git remote get-url origin") return w.origin ? { stdout: `${w.origin}\n` } : { code: 2, stderr: "error: No such remote 'origin'" };
    if (line === "git symbolic-ref --short refs/remotes/origin/HEAD") return w.originHead ? { stdout: `${w.originHead}\n` } : { code: 128 };
    if (line === "git branch --show-current") return { stdout: `${w.branch ?? "main"}\n` };
    if (argv[1] === "--version") return tools.has(argv[0] as string) ? { stdout: `${argv[0]} 1.0\n` } : undefined;
    if (argv[0] === "sh" && argv[1] === "-c" && argv[2]?.startsWith("norn hook ")) return { stdout: "" };
    if (line === "gh auth status" && tools.has("gh")) return { stdout: "" };
    return undefined;
  };
}

async function init(args: string[], opts: { w?: World; env?: Record<string, string>; seed?: Record<string, string> } = {}) {
  const m = machine({ script: world(opts.w ?? {}), ...(opts.env ? { env: opts.env } : {}), ...(opts.seed ? { seed: opts.seed } : {}) });
  const r = await runCli(["init", ...args, "--json"], m.io);
  return { m, r, body: json(r.stdout) };
}

const written = async (m: ReturnType<typeof machine>, path: string) => parse((await m.files.read(path)) ?? "null") as Record<string, unknown>;

describe("norn init: detection", () => {
  test("origin on GitHub with gh present, claude on PATH: the github tracker and forge, claude in headless", async () => {
    const { m, r, body } = await init([], { w: { origin: "git@github.com:acme/app.git", tools: ["gh", "claude"], originHead: "origin/trunk" } });
    expect(r.exit).toBe(ExitCode.ok);
    expect(body.chose).toEqual({ tracker: "github", forge: "github", store: "local", executor: "claude", runner: "headless", mode: "auto", base: "trunk" });
    expect(await written(m, PATHS.local)).toEqual({
      format: 1,
      tracker: { use: "github", intake: { label: "norn" } },
      forge: { use: "github" },
      store: { use: "local" },
      executors: { claude: { harness: "claude", runner: "headless" } },
      base: "trunk",
      kernel: { mode: "auto" },
    });
  });

  test("origin on GitHub but no gh: the local tracker and no forge", async () => {
    const { body } = await init([], { w: { origin: "https://github.com/acme/app", tools: ["claude"] } });
    expect(body.chose).toMatchObject({ tracker: "local", forge: "none" });
    expect(body.detected).toMatchObject({ github: true, gh: false, claude: true });
  });

  test("no origin, no claude: local and none, the claude executor still named, the base from the current branch", async () => {
    const { m, body } = await init([], { w: { branch: "dev" } });
    expect(body.chose).toEqual({ tracker: "local", forge: "none", store: "local", executor: "claude", runner: "headless", mode: "auto", base: "dev" });
    expect(body.detected).toMatchObject({ origin: null, claude: false });
    // a local tracker has nobody to assign to: every labelled open item is intake
    expect((await written(m, PATHS.local)).tracker).toEqual({ use: "local", intake: { label: "norn", assignee: null } });
  });

  test("a non-GitHub origin is local even with gh present", async () => {
    const { body } = await init([], { w: { origin: "git@gitlab.com:acme/app.git", tools: ["gh", "claude"] } });
    expect(body.chose).toMatchObject({ tracker: "local", forge: "none" });
  });

  test("inside herdr: the herdr runner is offered, and taken only with --yes or --runner herdr", async () => {
    const herdr = { w: { tools: ["claude", "herdr"] }, env: { HERDR_ENV: "1" } };
    const offered = await init([], herdr);
    expect({ runner: (offered.body.chose as { runner: string }).runner, offered: offered.body.offered }).toEqual({ runner: "headless", offered: ["herdr"] });
    const taken = await init(["--yes"], herdr);
    expect({ runner: (taken.body.chose as { runner: string }).runner, offered: taken.body.offered }).toEqual({ runner: "herdr", offered: [] });
    const asked = await init(["--runner", "herdr"], herdr);
    expect((asked.body.chose as { runner: string }).runner).toBe("herdr");
    const outside = await init(["--yes"], { w: { tools: ["claude", "herdr"] } });
    expect({ runner: (outside.body.chose as { runner: string }).runner, offered: outside.body.offered }).toEqual({ runner: "headless", offered: [] });
  });

  test("the mode: auto with the headless runner, manual in herdr, a flag wins, printed with why; a mode that is neither refuses", async () => {
    const headless = await init([], { w: { tools: ["claude"] } });
    expect((await written(headless.m, PATHS.local)).kernel).toEqual({ mode: "auto" });
    const md = await runCli(["init"], machine({ script: world({ tools: ["claude"] }) }).io);
    expect(md.stdout).toContain("- mode: auto (the headless runner has nobody beside the agent");
    const herdr = await init(["--yes"], { w: { tools: ["claude", "herdr"] }, env: { HERDR_ENV: "1" } });
    expect(herdr.body.chose).toMatchObject({ runner: "herdr", mode: "manual" });
    const flagged = await init(["--mode", "manual"], { w: { tools: ["claude"] } });
    expect((await written(flagged.m, PATHS.local)).kernel).toEqual({ mode: "manual" });
    const bad = await init(["--mode", "sometimes"], { w: { tools: ["claude"] } });
    expect({ exit: bad.r.exit, code: bad.body.code }).toEqual({ exit: ExitCode.usage, code: "usage" });
  });

  test("pi alone on PATH: the pi executor, written with the pi harness, and doctor checks the pi binary", async () => {
    const { m, r, body } = await init([], { w: { tools: ["pi"] } });
    expect(r.exit).toBe(ExitCode.ok);
    expect(body.chose).toMatchObject({ executor: "pi", runner: "headless" });
    expect(body.detected).toMatchObject({ claude: false, pi: true });
    expect(body.offered).toEqual([]);
    expect((await written(m, PATHS.local)).executors).toEqual({ pi: { harness: "pi", runner: "headless" } });
    const checks = (body.doctor as { checks: Array<{ name: string; ok: boolean }> }).checks;
    expect(checks.map((c) => [c.name, c.ok])).toContainEqual(["tool pi", true]);
    expect(checks.map((c) => c.name)).not.toContain("tool claude");
  });

  test("pi beside claude: claude stays the executor and pi is offered, not taken, even with --yes", async () => {
    for (const args of [[], ["--yes"]]) {
      const { body } = await init(args, { w: { tools: ["claude", "pi"] } });
      expect({ executor: (body.chose as { executor: string }).executor, offered: body.offered }).toEqual({ executor: "claude", offered: ["pi"] });
    }
    const m = machine({ script: world({ tools: ["claude", "pi"] }) });
    const r = await runCli(["init"], m.io);
    expect(r.stdout).toContain('- offered: pi is on PATH; norn config set executors.pi "{harness: pi, runner: headless}" adds it as an executor');
  });

  test("--executor pi takes pi without offering it, and --executor claude offers nothing", async () => {
    const pi = await init(["--executor", "pi"], { w: { tools: ["claude", "pi"] } });
    expect({ executor: (pi.body.chose as { executor: string }).executor, offered: pi.body.offered }).toEqual({ executor: "pi", offered: [] });
    const claude = await init(["--executor", "claude"], { w: { tools: ["claude", "pi"] } });
    expect(claude.body.offered).toEqual([]);
  });
});

describe("norn init: the test command", () => {
  const at = (name: string) => join(ROOT, name);
  const pkg = (test?: string) => JSON.stringify({ name: "app", scripts: test === undefined ? {} : { test } });
  const testOf = async (seed: Record<string, string>) => {
    const { m, body } = await init([], { seed });
    return { checks: (await written(m, PATHS.local)).checks, test: body.test };
  };

  test("detected from the lockfile beside package.json's test script, installing first, as a check runs in a fresh worktree", async () => {
    expect((await testOf({ [at("package.json")]: pkg("jest"), [at("package-lock.json")]: "{}" })).checks).toEqual({ test: "npm ci && npm test" });
    expect((await testOf({ [at("package.json")]: pkg("vitest"), [at("pnpm-lock.yaml")]: "" })).checks).toEqual({ test: "pnpm install --frozen-lockfile && pnpm test" });
    expect((await testOf({ [at("package.json")]: pkg("vitest"), [at("yarn.lock")]: "" })).checks).toEqual({ test: "yarn install && yarn test" });
    expect((await testOf({ [at("package.json")]: pkg("vitest") })).checks).toEqual({ test: "npm install && npm test" });
    expect((await testOf({ [at("package.json")]: pkg("bun test --bail"), [at("bun.lock")]: "" })).checks).toEqual({ test: "bun install --frozen-lockfile && bun run test" });
    expect((await testOf({ [at("package.json")]: pkg(), [at("bun.lock")]: "" })).checks).toEqual({ test: "bun install --frozen-lockfile && bun test" });
  });

  test("npm's placeholder is no test script; other build files and a Makefile's test target are read too", async () => {
    expect((await testOf({ [at("package.json")]: pkg('echo "Error: no test specified" && exit 1'), [at("package-lock.json")]: "{}" })).checks).toBeUndefined();
    expect((await testOf({ [at("Cargo.toml")]: "" })).checks).toEqual({ test: "cargo test" });
    expect((await testOf({ [at("go.mod")]: "" })).checks).toEqual({ test: "go test ./..." });
    expect((await testOf({ [at("pyproject.toml")]: "" })).checks).toEqual({ test: "pytest" });
    expect((await testOf({ [at("Makefile")]: "build:\n\tcc x.c\ntest: build\n\t./x\n" })).checks).toEqual({ test: "make test" });
    expect((await testOf({ [at("Makefile")]: "build:\n\tcc x.c\n" })).checks).toBeUndefined();
    expect((await testOf({ [at("Makefile")]: "test := unit\nbuild:\n\tcc x.c\n" })).checks).toBeUndefined();
  });

  test("the answer and the markdown name where it came from, or that the checks run the default", async () => {
    expect((await testOf({ [at("package.json")]: pkg("jest"), [at("package-lock.json")]: "{}" })).test).toEqual({ command: "npm ci && npm test", from: "package.json" });
    expect((await testOf({})).test).toBeNull();
    const found = await runCli(["init"], machine({ script: world({}), seed: { [at("go.mod")]: "" } }).io);
    expect(found.stdout).toContain("- test: go test ./... (from go.mod), as checks.test");
    const none = await runCli(["init"], machine({ script: world({}) }).io);
    expect(none.stdout).toContain('- test: none detected, so the checks run bun test; norn config set checks.test "<command>" names yours');
  });
});

describe("norn init: flags", () => {
  test("every flag wins over detection", async () => {
    const { m, body } = await init(["--tracker", "local", "--forge", "none", "--store", "refs", "--executor", "claude", "--runner", "headless", "--yes"], {
      w: { origin: "git@github.com:acme/app.git", tools: ["gh", "claude", "herdr"] },
      env: { HERDR_ENV: "1" },
    });
    expect(body.chose).toMatchObject({ tracker: "local", forge: "none", store: "refs", executor: "claude", runner: "headless" });
    expect((await written(m, PATHS.local)).store).toEqual({ use: "refs" });
  });

  test("a name no plugin provides is refused with the names that are, and nothing is written", async () => {
    const { m, r, body } = await init(["--tracker", "jira"]);
    expect(r.exit).toBe(ExitCode.refused);
    expect(body).toMatchObject({ code: "slot_unresolved" });
    expect(String(body.error)).toContain("available: github, local");
    expect(await m.files.read(PATHS.local)).toBeNull();
    expect(await m.files.read(EXCLUDE)).toBeNull();
  });

  test("a config file already there is never overwritten", async () => {
    const { m, r, body } = await init([], { seed: { [PATHS.local]: "base: dev\n" } });
    expect({ exit: r.exit, code: body.code }).toEqual({ exit: ExitCode.refused, code: "already_initialized" });
    expect(await m.files.read(PATHS.local)).toBe("base: dev\n");
  });

  test("a file holding only what plugin add wrote is completed, what it held kept, so a plugin can be added before init names it", async () => {
    const added = "# pinned by norn plugin add\nformat: 1\nplugins: {}\n";
    const { m, r, body } = await init(["--tracker", "local"], { seed: { [PATHS.local]: added } });
    expect({ exit: r.exit, layer: body.layer }).toEqual({ exit: ExitCode.ok, layer: "local" });
    const text = (await m.files.read(PATHS.local)) as string;
    expect(text.startsWith("# pinned by norn plugin add\n")).toBe(true);
    expect(parse(text)).toMatchObject({ plugins: {}, tracker: { use: "local" }, executors: { claude: { harness: "claude" } } });
  });
});

describe("norn init: what stays out of git", () => {
  test("the repo-local config: .agents/ is added to .git/info/exclude once, after what was there", async () => {
    const { m, body } = await init([], { seed: { [EXCLUDE]: "# git ls-files --others --exclude-from=.git/info/exclude\n*.log" } });
    expect(body.exclude).toBe("added");
    const text = (await m.files.read(EXCLUDE)) as string;
    expect(text.startsWith("# git ls-files --others --exclude-from=.git/info/exclude\n*.log\n")).toBe(true);
    expect(text.split("\n").filter((l) => l === AGENTS_DIR)).toHaveLength(1);
    // run again (the config removed by hand): the line is there, so nothing is added
    await m.files.remove(PATHS.local);
    const again = await runCli(["init", "--json"], m.io);
    expect(json(again.stdout).exclude).toBe("present");
    expect(await m.files.read(EXCLUDE)).toBe(text);
  });

  test("an exclude that already names .agents/ is left as it is", async () => {
    const { m, body } = await init([], { seed: { [EXCLUDE]: ".agents/\n" } });
    expect(body.exclude).toBe("present");
    expect(await m.files.read(EXCLUDE)).toBe(".agents/\n");
  });

  test("a repo whose team commits .agents/ gets only the repo-local config excluded, so new specs and workflows stay visible to git", async () => {
    const { m, body } = await init([], { seed: { [PATHS.repo]: "format: 1\n", [EXCLUDE]: "*.log\n" } });
    expect({ exclude: body.exclude, excluded: body.excluded }).toEqual({ exclude: "added", excluded: REPO_LOCAL_FILE });
    const lines = ((await m.files.read(EXCLUDE)) as string).split("\n");
    expect(lines).toContain(REPO_LOCAL_FILE);
    expect(lines).not.toContain(AGENTS_DIR);
  });

  test("--commit writes the committed config (team mode) and keeps only the repo-local file out of git", async () => {
    const { m, body } = await init(["--commit"]);
    expect({ file: body.file, team: body.team, exclude: body.exclude, excluded: body.excluded }).toEqual({ file: PATHS.repo, team: true, exclude: "added", excluded: REPO_LOCAL_FILE });
    expect((await written(m, PATHS.repo)).tracker).toMatchObject({ use: "local" });
    const lines = ((await m.files.read(EXCLUDE)) as string).split("\n");
    expect(lines).toContain(REPO_LOCAL_FILE);
    expect(lines).not.toContain(AGENTS_DIR);
  });

  test("--commit keeps the mode out of the committed file, which wins over every person's: it goes in the repo-local file", async () => {
    const { m, body } = await init(["--commit", "--mode", "manual"]);
    expect((await written(m, PATHS.repo)).kernel).toBeUndefined();
    expect(await written(m, PATHS.local)).toEqual({ format: 1, kernel: { mode: "manual" } });
    expect(body.local_file).toBe(PATHS.local);
    // a repo-local file there already keeps what it holds, its own mode included
    const kept = await init(["--commit"], { seed: { [PATHS.local]: "format: 1\nkernel: { mode: auto }\nholder: me@desk\n" } });
    expect(await written(kept.m, PATHS.local)).toEqual({ format: 1, kernel: { mode: "auto" }, holder: "me@desk" });
  });
});

describe("norn init: doctor", () => {
  test("init runs doctor on what it wrote: every check passes when the tools are there", async () => {
    const { r, body } = await init([], { w: { tools: ["claude"] } });
    const doctor = body.doctor as { ok: boolean; checks: Array<{ name: string; ok: boolean }> };
    expect(r.exit).toBe(ExitCode.ok);
    expect(doctor.checks.map((c) => [c.name, c.ok])).toEqual([
      ["config", true],
      ["plugins", true],
      ["slots", true],
      ["workflows", true],
      ["labels", true],
      ["hooks", true],
      ["skills", true],
      ["tool git", true],
      ["remote", true],
      ["tool claude", true],
    ]);
  });

  test("on GitHub, init defines the labels norn puts on issues, so the first story create takes them", async () => {
    const gh = fakeGh();
    const m = machine({ script: (argv, o) => gh.script(argv, o) ?? world({ origin: "git@github.com:acme/app.git", tools: ["gh", "claude"] })(argv, o) });
    const r = await runCli(["init", "--json"], m.io);
    const checks = (json(r.stdout).doctor as { checks: Array<{ name: string; ok: boolean }> }).checks;
    expect(checks.find((c) => c.name === "labels")?.ok).toBe(true);
    expect(gh.labels).toContain("norn");
    expect(gh.labels).toContain("norn:wf:quick");
  });

  test("the markdown says what was chosen and what doctor found", async () => {
    const m = machine({ script: world({}) });
    const r = await runCli(["init"], m.io);
    expect(r.stdout).toContain("- tracker: local (no GitHub origin)");
    expect(r.stdout).toContain("- executor: claude in headless (claude is not on PATH)");
    expect(r.stdout).toContain("- tool claude: FAILED");
  });
});

describe("norn init: the person's own skills in the main checkout", () => {
  const FSD = SDLC_PACK.skills["norn-fsd"]?.["SKILL.md"] as string;

  test("the pack's skills, the person-run fsd skills among them, land in the checkout's .agents/skills, linked from the harness's folder", async () => {
    const { m } = await init([], { w: { tools: ["claude"] } });
    for (const name of ["norn-fsd", "norn-fsd-round", "norn-retro", "norn-triage", "norn-interview"]) {
      expect(await m.files.read(`${ROOT}/.agents/skills/${name}/SKILL.md`)).toBe(SDLC_PACK.skills[name]?.["SKILL.md"] as string);
      expect(await m.files.readLink(`${ROOT}/.claude/skills/${name}`)).toBe(`../../.agents/skills/${name}`);
    }
    // norn's copies stay out of git without touching the repo's own ignore files
    expect((await m.files.read(`${ROOT}/.agents/skills/norn-fsd/.gitignore`))?.split("\n")).toContain("*");
    expect((await m.files.read(`${ROOT}/.claude/skills/.gitignore`))?.split("\n")).toContain("/norn-fsd");
    expect(await m.files.read(`${ROOT}/.gitignore`)).toBeNull();
  });

  test("a person's own folder of a pack skill's name is left as it is, in .agents/skills and in the harness's folder", async () => {
    const { m } = await init([], { w: { tools: ["claude"] }, seed: { [`${ROOT}/.agents/skills/norn-retro/SKILL.md`]: "my retro\n", [`${ROOT}/.claude/skills/norn-triage/SKILL.md`]: "my triage\n" } });
    expect(await m.files.read(`${ROOT}/.agents/skills/norn-retro/SKILL.md`)).toBe("my retro\n");
    expect(await m.files.read(`${ROOT}/.agents/skills/norn-retro/.gitignore`)).toBeNull();
    expect(await m.files.read(`${ROOT}/.claude/skills/norn-triage/SKILL.md`)).toBe("my triage\n");
    expect(await m.files.readLink(`${ROOT}/.claude/skills/norn-triage`)).toBeNull();
    expect(await m.files.read(`${ROOT}/.agents/skills/norn-fsd/SKILL.md`)).toBe(FSD);
  });

  test("norn doctor brings norn's copy up to date, as after an upgrade, and leaves the person's own", async () => {
    const { m } = await init([], { w: { tools: ["claude"] } });
    await m.files.write(`${ROOT}/.agents/skills/norn-fsd/SKILL.md`, "an older norn's fsd\n");
    await m.files.write(`${ROOT}/.agents/skills/norn-retro/SKILL.md`, "my retro\n");
    await m.files.remove(`${ROOT}/.agents/skills/norn-retro/.gitignore`);
    const r = await runCli(["doctor", "--json"], m.io);
    const skills = (json(r.stdout).checks as Array<{ name: string; ok: boolean; detail?: string }>).find((c) => c.name === "skills");
    expect(skills?.ok).toBe(true);
    expect(await m.files.read(`${ROOT}/.agents/skills/norn-fsd/SKILL.md`)).toBe(FSD);
    expect(await m.files.read(`${ROOT}/.agents/skills/norn-retro/SKILL.md`)).toBe("my retro\n");
  });

  test("norn doctor removes a skill and a skill file the pack no longer has, and its link, and leaves the repo's own", async () => {
    const { m } = await init([], { w: { tools: ["claude"] } });
    // what an older norn left: its marked copy of a skill this pack dropped, linked and listed in the harness folder's ignore file
    const mark = (await m.files.read(`${ROOT}/.agents/skills/norn-fsd/.gitignore`)) as string;
    await m.files.write(`${ROOT}/.agents/skills/norn-gone/.gitignore`, mark);
    await m.files.write(`${ROOT}/.agents/skills/norn-gone/SKILL.md`, "# gone\n");
    await m.files.write(`${ROOT}/.agents/skills/norn-gone/refs/more.md`, "more\n");
    await m.files.symlink?.("../../.agents/skills/norn-gone", `${ROOT}/.claude/skills/norn-gone`);
    const ignore = (await m.files.read(`${ROOT}/.claude/skills/.gitignore`)) as string;
    await m.files.write(`${ROOT}/.claude/skills/.gitignore`, `${ignore}/norn-gone\n`);
    await m.files.write(`${ROOT}/.agents/skills/norn-fsd/dropped.md`, "a file the pack dropped\n");
    // the repo's own skill, not the pack's, linked the same way and committed
    await m.files.write(`${ROOT}/.agents/skills/mine/SKILL.md`, "# mine\n");
    await m.files.symlink?.("../../.agents/skills/mine", `${ROOT}/.claude/skills/mine`);

    const r = await runCli(["doctor", "--json"], m.io);
    expect((json(r.stdout).checks as Array<{ name: string; ok: boolean }>).find((c) => c.name === "skills")?.ok).toBe(true);
    expect(await m.files.list(`${ROOT}/.agents/skills/norn-gone`)).toEqual([]);
    expect(await m.files.readLink(`${ROOT}/.claude/skills/norn-gone`)).toBeNull();
    expect((await m.files.read(`${ROOT}/.claude/skills/.gitignore`))?.split("\n")).not.toContain("/norn-gone");
    expect(await m.files.read(`${ROOT}/.agents/skills/norn-fsd/dropped.md`)).toBeNull();
    expect(await m.files.read(`${ROOT}/.agents/skills/norn-fsd/SKILL.md`)).toBe(FSD);
    expect(await m.files.read(`${ROOT}/.agents/skills/mine/SKILL.md`)).toBe("# mine\n");
    expect(await m.files.readLink(`${ROOT}/.claude/skills/mine`)).toBe("../../.agents/skills/mine");
  });

  test("the skills check names the folders it kept as the repo's own, and how to take norn's copy instead", async () => {
    const { body } = await init([], { w: { tools: ["claude"] }, seed: { [`${ROOT}/.agents/skills/norn-retro/SKILL.md`]: "my retro\n" } });
    const skills = (body.doctor as { checks: Array<{ name: string; ok: boolean; detail?: string }> }).checks.find((c) => c.name === "skills");
    expect(skills?.ok).toBe(true);
    const count = Object.keys(SDLC_PACK.skills).length;
    expect(skills?.detail).toContain(`${count - 1} of ${count} pack skills`);
    expect(skills?.detail).toContain("norn-retro");
    expect(skills?.detail).toContain("delete");
  });

  test("a skills folder norn cannot write fails the check, with what to do", async () => {
    const m = machine({ script: world({ tools: ["claude"] }) });
    await runCli(["init", "--json"], m.io);
    await m.files.write(`${ROOT}/.agents/skills/norn-fsd/SKILL.md`, "an older norn's fsd\n");
    m.files.failWrites(true);
    const r = await runCli(["doctor", "--json"], m.io);
    m.files.failWrites(false);
    const skills = (json(r.stdout).checks as Array<{ name: string; ok: boolean; do_instead?: string }>).find((c) => c.name === "skills");
    expect(skills?.ok).toBe(false);
    expect(skills?.do_instead).toBe(`make ${ROOT} writable, then norn doctor`);
  });
});

describe("the old norn's repo-local config", () => {
  const OLD_LOCAL = join(ROOT, OLD_LOCAL_CONFIG_FILE);
  const OLD_LOCAL_TEXT = ["mode: manual", "agent: claude", "agents:", "  claude: { model: opus, args: [--verbose] }", "  codex: { model: o3 }", ""].join("\n");

  test("a set-up repo moves it into the repo-local file on the next command, once, with a one-line notice, the old text kept", async () => {
    const m = machine({ script: world({ tools: ["claude"] }), seed: { [PATHS.local]: LOCAL_CONFIG, [OLD_LOCAL]: OLD_LOCAL_TEXT } });
    const r = await runCli(["config", "get", "kernel.mode", "--json"], m.io);
    expect(json(r.stdout)).toEqual({ key: "kernel.mode", value: "manual" });
    expect(r.stderr?.trim().split("\n")).toHaveLength(1);
    expect(r.stderr).toContain(`moved ${OLD_LOCAL_CONFIG_FILE} (the old norn's) into ${REPO_LOCAL_FILE}: took mode → kernel.mode, agent → executor, agents.claude.model → executors.claude.model, agents.claude.args → executors.claude.args`);
    expect(r.stderr).toContain("ignored agents.codex: no executor codex is configured");
    expect(await written(m, PATHS.local)).toMatchObject({ executor: "claude", kernel: { mode: "manual" }, executors: { claude: { harness: "claude", runner: "headless", model: "opus", args: ["--verbose"] } } });
    expect(await m.files.read(OLD_LOCAL)).toBeNull();
    expect(await m.files.read(`${OLD_LOCAL}.old`)).toBe(OLD_LOCAL_TEXT);
    const again = await runCli(["config", "get", "kernel.mode", "--json"], m.io);
    expect(again.stderr ?? "").toBe("");
  });

  test("a key the repo-local file sets already keeps its value", async () => {
    const m = machine({ script: world({ tools: ["claude"] }), seed: { [PATHS.local]: `${LOCAL_CONFIG}kernel: { mode: auto }\n`, [OLD_LOCAL]: "mode: manual\n" } });
    const r = await runCli(["config", "get", "kernel.mode", "--json"], m.io);
    expect(json(r.stdout).value).toBe("auto");
    expect(r.stderr).toContain(`ignored mode: ${REPO_LOCAL_FILE} sets kernel.mode already`);
  });

  test("a key the committed file sets is left out, named as the committed file's, since that file wins", async () => {
    const m = machine({ script: world({ tools: ["claude"] }), seed: { [PATHS.repo]: `${LOCAL_CONFIG}kernel: { mode: auto }\n`, [OLD_LOCAL]: "mode: manual\n" } });
    const r = await runCli(["config", "get", "kernel.mode", "--json"], m.io);
    expect(json(r.stdout).value).toBe("auto");
    expect(r.stderr).toContain(`took nothing; ignored mode: ${REPO_COMMITTED_FILE} sets kernel.mode (auto), and it wins`);
    expect(await m.files.read(PATHS.local)).toBeNull();
    expect(await m.files.read(`${OLD_LOCAL}.old`)).toBe("mode: manual\n");
  });

  test("init --commit beside a repo-local file that names its own mode keeps that mode and says so, never the old one", async () => {
    const { m, body } = await init(["--commit"], { w: { tools: ["claude"] }, seed: { [PATHS.local]: "format: 1\nkernel: { mode: auto }\n", [OLD_LOCAL]: "mode: manual\n" } });
    expect(await written(m, PATHS.local)).toEqual({ format: 1, kernel: { mode: "auto" } });
    expect(body.chose).toMatchObject({ mode: "auto" });
    expect(body.local_migrated).toMatchObject({ mapped: [], ignored: [`mode: ${REPO_LOCAL_FILE} sets kernel.mode already`] });
  });

  test("before init it stays, and init takes its mode over detection and moves the rest", async () => {
    const m = machine({ script: world({ tools: ["claude"] }), seed: { [OLD_LOCAL]: OLD_LOCAL_TEXT } });
    const before = await runCli(["status", "--json"], m.io);
    expect(json(before.stdout)).toMatchObject({ code: "config_missing", do_instead: "norn init" });
    expect(await m.files.read(OLD_LOCAL)).toBe(OLD_LOCAL_TEXT);
    const r = await runCli(["init", "--json"], m.io);
    const body = json(r.stdout);
    expect(body.chose).toMatchObject({ runner: "headless", mode: "manual" });
    expect(body.local_migrated).toMatchObject({ file: OLD_LOCAL, backup: `${OLD_LOCAL}.old` });
    expect((await written(m, PATHS.local)).executors).toEqual({ claude: { harness: "claude", runner: "headless", model: "opus", args: ["--verbose"] } });
    expect(await m.files.read(OLD_LOCAL)).toBeNull();
  });
});

describe("norn init: a repo still on the old norn's config", () => {
  const OLD = join(ROOT, OLD_REPO_CONFIG_FILE);
  const OLD_TEXT = ["# the old team config", "norn_version: 0.35.0", "provider: gh", "base_branch: trunk", "workflow: triage", "mode: manual", "regenerate:", "  - { paths: [x], run: y }", ""].join("\n");

  test("its keys it can map win over detection: provider gh is the github tracker and forge, base_branch the base, workflow and mode the kernel's", async () => {
    const { m, r, body } = await init(["--commit"], { w: { tools: ["claude"], branch: "main" }, seed: { [OLD]: OLD_TEXT } });
    expect(r.exit).toBe(ExitCode.ok);
    expect(body.chose).toMatchObject({ tracker: "github", forge: "github", mode: "manual", base: "trunk" });
    expect(await written(m, PATHS.repo)).toEqual({
      format: 1,
      tracker: { use: "github", intake: { label: "norn" } },
      forge: { use: "github" },
      store: { use: "local" },
      executors: { claude: { harness: "claude", runner: "headless" } },
      base: "trunk",
      kernel: { workflow: "triage" },
    });
    expect((await written(m, PATHS.local)).kernel).toEqual({ mode: "manual" });
    expect(body.migrated).toEqual({ file: OLD_REPO_CONFIG_FILE, mapped: ["provider", "base_branch", "workflow", "mode"], ignored: ["norn_version", "regenerate"], notes: [] });
    // the old file is left for the person to delete
    expect(await m.files.read(OLD)).toBe(OLD_TEXT);
  });

  test("a key the old file left out takes the old default where this norn's differs: triage and manual, each named in the notes", async () => {
    const { m, body } = await init(["--commit"], { w: { tools: ["claude"], branch: "main" }, seed: { [OLD]: "provider: gh\n" } });
    expect(body.chose).toMatchObject({ mode: "manual" });
    expect(((await written(m, PATHS.repo)) as { kernel?: unknown }).kernel).toEqual({ workflow: "triage" });
    expect(((await written(m, PATHS.local)) as { kernel?: unknown }).kernel).toEqual({ mode: "manual" });
    const migrated = body.migrated as { mapped: string[]; notes: string[] };
    expect(migrated.mapped).toEqual(["provider"]);
    expect(migrated.notes).toEqual([expect.stringContaining("workflow: "), expect.stringContaining("mode: ")]);
    expect(migrated.notes.join(" ")).toContain("old default, triage");
    expect(migrated.notes.join(" ")).toContain("old default, manual");
  });

  test("a flag still wins over the old file", async () => {
    const { body } = await init(["--tracker", "local", "--forge", "none", "--mode", "auto"], { w: { tools: ["claude"] }, seed: { [OLD]: OLD_TEXT } });
    expect(body.chose).toMatchObject({ tracker: "local", forge: "none", mode: "auto", base: "trunk" });
  });

  test("provider glab is not carried over: init says GitLab is not supported yet and detects the tracker", async () => {
    const { body } = await init([], { w: { tools: ["claude"] }, seed: { [OLD]: "provider: glab\n" } });
    expect(body.chose).toMatchObject({ tracker: "local", forge: "none" });
    const migrated = body.migrated as { mapped: string[]; ignored: string[]; notes: string[] };
    expect(migrated.ignored).toEqual(["provider"]);
    expect(migrated.notes.join(" ")).toContain("no GitLab tracker or forge yet");
  });

  test("the markdown names the keys it took and those it ignored, and that the old file is never read", async () => {
    const m = machine({ script: world({ tools: ["claude"] }), seed: { [OLD]: OLD_TEXT } });
    const r = await runCli(["init"], m.io);
    expect(r.stdout).toContain(`- ${OLD_REPO_CONFIG_FILE} (the old norn's config): took provider, base_branch, workflow, mode; ignored norn_version, regenerate`);
    expect(r.stdout).toContain(`this norn never reads ${OLD_REPO_CONFIG_FILE}`);
  });

  test("before init, every command that needs a config refuses naming norn init; help and init itself still run", async () => {
    const m = machine({ script: world({ tools: ["claude"] }), seed: { [OLD]: OLD_TEXT } });
    for (const argv of [["tick"], ["status"], ["config", "get", "base"], ["story", "list"]]) {
      const r = await runCli([...argv, "--json"], m.io);
      const err = json(r.stdout);
      expect({ argv, exit: r.exit, code: err.code }).toEqual({ argv, exit: ExitCode.config, code: "config_old" });
      expect(err.error).toContain(OLD_REPO_CONFIG_FILE);
      expect(err.do_instead).toContain("norn init");
    }
    const doctor = json((await runCli(["doctor", "--json"], m.io)).stdout) as { checks: Array<{ name: string; code?: string }> };
    expect(doctor.checks.find((c) => c.name === "config")?.code).toBe("config_old");
    expect((await runCli(["help"], m.io)).exit).toBe(ExitCode.ok);
    expect((await runCli(["init", "--json"], m.io)).exit).toBe(ExitCode.ok);
    expect((await runCli(["config", "show", "--json"], m.io)).exit).toBe(ExitCode.ok);
  });

  test("once a config of this norn is there, the old file no longer stops any command", async () => {
    const { m } = await init([], { w: { tools: ["claude"] }, seed: { [OLD]: OLD_TEXT } });
    expect((await runCli(["config", "show", "--json"], m.io)).exit).toBe(ExitCode.ok);
  });
});

describe("norn init: a machine still on the old norn's user config", () => {
  const OLD_USER = ["# norn user layer — machine-wide defaults", "max_agents: 4", "mode: auto", "trace: { retain: 14d }", "notify: { os: false }", ""].join("\n");

  test("any other command refuses with config_old and sends the person to norn init", async () => {
    const m = machine({ seed: { [PATHS.user]: "max_agents: 4\n", [PATHS.local]: LOCAL_CONFIG } });
    const r = await runCli(["status", "--json"], m.io);
    expect(r.exit).toBe(ExitCode.config);
    expect(json(r.stdout)).toMatchObject({ code: "config_old", do_instead: expect.stringContaining("norn init") });
  });

  test("init rewrites it in this norn's keys, keeps the old text beside it and names what it left behind", async () => {
    const { m, r, body } = await init([], { w: { tools: ["claude"] }, seed: { [PATHS.user]: OLD_USER } });
    expect(r.exit).toBe(ExitCode.ok);
    expect(await written(m, PATHS.user)).toEqual({ kernel: { max_agents: 4, mode: "auto" }, trace: { retain: "14d" } });
    expect(await m.files.read(`${PATHS.user}.old`)).toBe(OLD_USER);
    expect(body.user_migrated).toMatchObject({
      backup: `${PATHS.user}.old`,
      mapped: ["max_agents → kernel.max_agents", "mode → kernel.mode", "trace.retain → trace.retain"],
      ignored: [expect.stringContaining("notify: ")],
    });
    // and the next command loads it
    expect((await runCli(["status", "--json"], m.io)).exit).toBe(ExitCode.ok);
  });

  test("in a repo set up already, init still rewrites it and leaves the repo's config as it is", async () => {
    const { m, r, body } = await init([], { w: { tools: ["claude"] }, seed: { [PATHS.user]: "max_agents: 2\n", [PATHS.local]: LOCAL_CONFIG } });
    expect(r.exit).toBe(ExitCode.ok);
    expect(await written(m, PATHS.user)).toEqual({ kernel: { max_agents: 2 } });
    expect(await m.files.read(PATHS.local)).toBe(LOCAL_CONFIG);
    expect(body.user_migrated).toMatchObject({ mapped: ["max_agents → kernel.max_agents"] });
  });

  test("an old backup is never overwritten", async () => {
    const { m } = await init([], { w: { tools: ["claude"] }, seed: { [PATHS.user]: "max_agents: 3\n", [`${PATHS.user}.old`]: "kept\n" } });
    expect(await m.files.read(`${PATHS.user}.old`)).toBe("kept\n");
    expect(await m.files.read(`${PATHS.user}.old-2`)).toBe("max_agents: 3\n");
  });

  test("a user config that is merely wrong is not taken for the old one", async () => {
    const m = machine({ seed: { [PATHS.user]: "max_agents: 4\nnot_a_key: 1\n", [PATHS.local]: LOCAL_CONFIG } });
    const r = await runCli(["status", "--json"], m.io);
    expect(json(r.stdout)).toMatchObject({ code: "config_invalid" });
  });
});
