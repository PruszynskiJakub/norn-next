import { describe, expect, test } from "bun:test";
import type { ExecScript } from "@norn/conformance";
import { parse } from "yaml";
import { AGENTS_DIR, configPaths, ExitCode, runCli } from "../../src/index.ts";
import { COMMON, HOME, machine, ROOT } from "./support.ts";

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

  test("--commit writes the committed config (team mode) and leaves the exclude alone", async () => {
    const { m, body } = await init(["--commit"]);
    expect({ file: body.file, team: body.team, exclude: body.exclude }).toEqual({ file: PATHS.repo, team: true, exclude: "committed" });
    expect((await written(m, PATHS.repo)).tracker).toMatchObject({ use: "local" });
    expect(await m.files.read(PATHS.local)).toBeNull();
    expect(await m.files.read(EXCLUDE)).toBeNull();
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
      ["hooks", true],
      ["tool git", true],
      ["tool claude", true],
    ]);
  });

  test("the markdown says what was chosen and what doctor found", async () => {
    const m = machine({ script: world({}) });
    const r = await runCli(["init"], m.io);
    expect(r.stdout).toContain("- tracker: local (no GitHub origin)");
    expect(r.stdout).toContain("- executor: claude in headless (claude is not on PATH)");
    expect(r.stdout).toContain("- tool claude: FAILED");
  });
});
