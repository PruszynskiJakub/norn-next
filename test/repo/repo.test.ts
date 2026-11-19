/** Repo-wide rules: dependency direction and banned glossary synonyms. */
import { describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import { allDocs, CODE_SPAN, textFiles, URL } from "../support/docs.ts";

const ROOT = join(import.meta.dir, "..", "..");
const PKGS = join(ROOT, "packages");

/** schema ← plugin-api ← kernel ← runtime ← cli; every plugin reads only schema and plugin-api; cli wires them all. */
const ALLOWED: Record<string, string[]> = {
  schema: [],
  "plugin-api": ["schema"],
  kernel: ["schema", "plugin-api"],
  "harness-claude": ["schema", "plugin-api"],
  "harness-pi": ["schema", "plugin-api"],
  conformance: ["schema", "plugin-api", "kernel"],
  "plugin-github": ["schema", "plugin-api"],
  "tracker-local": ["schema", "plugin-api"],
  "forge-none": ["schema", "plugin-api"],
  "host-node": ["schema", "plugin-api"],
  "store-local": ["schema", "plugin-api"],
  "store-refs": ["schema", "plugin-api"],
  runtime: ["schema", "plugin-api", "kernel"],
  "vcs-git": ["schema", "plugin-api"],
  "pack-sdlc": ["plugin-api"],
  "runner-headless": ["schema", "plugin-api"],
  "runner-herdr": ["schema", "plugin-api"],
  cli: [
    "schema",
    "plugin-api",
    "kernel",
    "runtime",
    "host-node",
    "vcs-git",
    "plugin-github",
    "tracker-local",
    "forge-none",
    "store-local",
    "store-refs",
    "harness-claude",
    "harness-pi",
    "runner-headless",
    "runner-herdr",
    "pack-sdlc",
  ],
};

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((n) => {
    const p = join(dir, n);
    return statSync(p).isDirectory() ? (n === "node_modules" ? [] : files(p)) : p.endsWith(".ts") ? [p] : [];
  });
}

describe("dependency direction", () => {
  test("packages are exactly the known set", () => {
    expect(readdirSync(PKGS).sort()).toEqual(Object.keys(ALLOWED).sort());
  });
  test.each(Object.keys(ALLOWED))("@norn/%s imports only allowed packages, all declared", (pkg) => {
    const manifest = JSON.parse(readFileSync(join(PKGS, pkg, "package.json"), "utf8"));
    const declared = Object.keys(manifest.dependencies ?? {}).filter((d) => d.startsWith("@norn/"));
    expect(declared.map((d) => d.slice(6)).every((d) => ALLOWED[pkg]?.includes(d))).toBe(true);
    for (const f of files(join(PKGS, pkg, "src"))) {
      for (const m of readFileSync(f, "utf8").matchAll(/from\s+["']@norn\/([a-z-]+)/g)) {
        const dep = m[1] as string;
        expect({ file: relative(ROOT, f), dep, ok: ALLOWED[pkg]?.includes(dep) && declared.includes(`@norn/${dep}`) }).toEqual({
          file: relative(ROOT, f),
          dep,
          ok: true,
        });
      }
    }
  });

  /** Root test code (`test/`, `scripts/`) may import any package, by name, only when the root declares it. */
  function undeclaredRootImports(root: string): { file: string; dep: string }[] {
    const manifest = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
    const declared = new Set(Object.keys(manifest.devDependencies ?? {}));
    return ["test", "scripts"].flatMap((d) =>
      existsSync(join(root, d))
        ? files(join(root, d)).flatMap((f) =>
            [...readFileSync(f, "utf8").matchAll(/(?:from|import)\s*\(?\s*["'](@norn\/[a-z-]+)/g)]
              .map((m) => m[1] as string)
              .filter((dep) => !declared.has(dep))
              .map((dep) => ({ file: relative(root, f), dep })),
          )
        : [],
    );
  }
  test("the root declares every package as a dev dependency", () => {
    const declared = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8")).devDependencies ?? {};
    for (const pkg of Object.keys(ALLOWED)) expect({ pkg, spec: declared[`@norn/${pkg}`] }).toEqual({ pkg, spec: "workspace:*" });
  });
  test("root test/ and scripts/ import only packages the root declares", () => {
    expect(undeclaredRootImports(ROOT)).toEqual([]);
  });
  test("an undeclared import in root test code fails, naming the file and the import", () => {
    const root = mkdtempSync(join(tmpdir(), "norn-root-deps-"));
    writeFileSync(join(root, "package.json"), JSON.stringify({ devDependencies: { "@norn/schema": "workspace:*" } }));
    for (const d of ["test", "scripts"]) mkdirSync(join(root, d));
    writeFileSync(join(root, "test", "ok.test.ts"), `import { ulid } from "@norn/schema";\n`);
    // the undeclared names are spelled in pieces so this file is not itself a hit
    const [a, b] = ["@norn/" + "gone", "@norn/" + "never"];
    writeFileSync(join(root, "scripts", "x.ts"), `import { decide } from "${a}";\nconst s = await import("${b}");\n`);
    expect(undeclaredRootImports(root)).toEqual([
      { file: join("scripts", "x.ts"), dep: a },
      { file: join("scripts", "x.ts"), dep: b },
    ]);
  });
});

/**
 * Banned synonyms. Only unambiguous ones are linted; "state"/"status"/"lease" are context-dependent.
 * Word boundaries keep identifiers like `run_job` or `tasks_total` clear (`_` is a word character).
 */
const BANNED: Array<[RegExp, string]> = [
  [/\b(task|tasks|job|jobs|ticket|tickets)\b/i, "story / slice"],
  [/\binteractive steps?\b/i, "attended step"],
  [/\bapproved\b/i, "approve (outcomes are spelled as typed)"],
];

/**
 * Banned-synonym hits in one line. URLs are never prose. In docs and assets (md/yaml/json), inline
 * code spans quote identifiers or name a banned word on purpose (AGENTS.md's glossary rule); in .ts,
 * backticks are template strings — prose shown to people — so they stay linted.
 */
function glossaryHits(line: string, file: string): string[] {
  let text = line.replace(URL, " ");
  if (!file.endsWith(".ts")) text = text.replace(CODE_SPAN, " ");
  return BANNED.filter(([re]) => re.test(text)).map(([, say]) => say);
}

const DOCS = [".md", ".yaml", ".yml", ".json"];
const GLOSSARY_FILES = (): string[] => [
  ...files(PKGS).filter((p) => p.includes("/src/")),
  ...textFiles(join(PKGS, "pack-sdlc", "assets"), DOCS),
  ...textFiles(join(PKGS, "schema", "json"), DOCS),
  // Every doc (README, CONTRIBUTING, docs/, AGENTS.md)
  ...allDocs(ROOT),
];

/**
 * The docs a person reads describe only the new config keys and files. A removed or
 * renamed key named in any of them is a hit. CHANGELOG and story specs keep their history; `norn upgrade`'s
 * own messages and the moved-key table name old keys on purpose and live in sources, not here.
 */
// `notifiers` only as the key (`notifiers:`, `notifiers[]`, in backticks): as a noun it names the O3 concept
const REMOVED_KEYS = /\bcapability this session lacks\b|\bcapability gating\b|\bnotifiers(?=[:[`])|`notifiers\b|\b(default_mode|default_agent|default_workflow|default_slice_workflow|max_checks|watch_interval|attended_wait|ports_per_slot|sync_interval)\b|\blimits\.(deadline|nudges|retries|stalled)\b|\bremote\.(provider|label|git_remote|host)\b|\bcapabilities: \[/;
const CONFIG_DOCS = (): string[] => [
  ...textFiles(join(PKGS, "pack-sdlc", "assets"), DOCS),
  join(PKGS, "cli", "src", "commands", "help.ts"),
  // The README, CONTRIBUTING, docs/ and AGENTS.md
  ...allDocs(ROOT),
];

describe("config docs", () => {
  test("help, every doc and the shipped skills and workflows name no removed config key or check", () => {
    const hits: string[] = [];
    for (const f of CONFIG_DOCS())
      readFileSync(f, "utf8")
        .split("\n")
        .forEach((line, i) => {
          if (REMOVED_KEYS.test(line)) hits.push(`${relative(ROOT, f)}:${i + 1}: ${line.trim().slice(0, 120)}`);
        });
    expect(hits).toEqual([]);
  });
});

describe("glossary", () => {
  test("matcher: word boundaries, URLs and doc code spans are not prose", () => {
    expect(glossaryHits("pick the next job", "README.md")).toEqual(["story / slice"]);
    expect(glossaryHits("Tickets pile up", "a.ts")).toEqual(["story / slice"]);
    expect(glossaryHits("an interactive step", "a.md")).toEqual(["attended step"]);
    expect(glossaryHits("review approved it", "a.yaml")).toEqual(["approve (outcomes are spelled as typed)"]);
    expect(glossaryHits("const run_job = jobless + taskbar", "a.ts")).toEqual([]);
    expect(glossaryHits("see https://example.com/jobs/1?task=2", "README.md")).toEqual([]);
    expect(glossaryHits("banned: `task`/`job` → story", "AGENTS.md")).toEqual([]);
    expect(glossaryHits("throw refuse(`no job here`)", "a.ts")).toEqual(["story / slice"]);
  });

  test("no banned synonyms in sources, assets, JSON schemas and every doc", () => {
    const hits: string[] = [];
    for (const f of GLOSSARY_FILES()) {
      readFileSync(f, "utf8")
        .split("\n")
        .forEach((line, i) => {
          for (const say of glossaryHits(line, f)) hits.push(`${relative(ROOT, f)}:${i + 1} → say ${say}: ${line.trim()}`);
        });
    }
    expect(hits).toEqual([]);
  });
});

/** The root package.json's scripts. */
function rootScripts(): Record<string, string> {
  return JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8")).scripts;
}

/** The `[test]` table of a bunfig at the repo root. */
function bunfig(name: string): { root?: string; preload?: string[]; pathIgnorePatterns?: string[] } {
  return (Bun.TOML.parse(readFileSync(join(ROOT, name), "utf8")) as { test?: object }).test ?? {};
}

/** Every `*.test .ts` under `root`, relative to it; skips node_modules and dot folders. */
function testFilesUnder(root: string, dir = root): string[] {
  return readdirSync(dir)
    .flatMap((n) => {
      const p = join(dir, n);
      if (statSync(p).isDirectory()) return n === "node_modules" || n.startsWith(".") ? [] : testFilesUnder(root, p);
      return n.endsWith(".test.ts") ? [relative(root, p)] : [];
    })
    .sort();
}

/**
 * The test files `bun test --config=<config>` runs, as bun 1.3.13 picks them: under the config's `root`
 * and matching no `pathIgnorePatterns` glob, where a glob that matches a folder ignores all below it.
 */
function tierSelection(config: string): string[] {
  const { root = ".", pathIgnorePatterns = [] } = bunfig(config);
  const globs = pathIgnorePatterns.map((p) => new Bun.Glob(p));
  const ignored = (f: string) => {
    const parts = f.split("/");
    return parts.some((_, i) => globs.some((g) => g.match(parts.slice(0, i + 1).join("/"))));
  };
  const under = root === "." ? "" : `${root.replace(/^\.\//, "").replace(/\/$/, "")}/`;
  return testFilesUnder(ROOT).filter((f) => f.startsWith(under) && !ignored(f));
}

const TIER_FOLDERS = "unit/, integration/, test/repo/";

/** Every `*.test .ts` under `root` that sits in no tier folder, as the repo rule's message. */
function untieredTests(root: string): string[] {
  const tiered = (f: string) => /^packages\/[^/]+\/test\/(unit|integration)\//.test(f) || f.startsWith("test/repo/");
  return testFilesUnder(root)
    .filter((f) => !tiered(f))
    .map((f) => `${f} is not in a tier folder (${TIER_FOLDERS})`);
}

describe("test layout (AGENTS.md)", () => {
  test("tests and fixtures live under packages/<pkg>/test, never in src", () => {
    const inSrc = files(PKGS)
      .filter((p) => p.includes("/src/") && p.endsWith(".test.ts"))
      .map((p) => relative(ROOT, p));
    const fixtureDirs = files(PKGS)
      .filter((p) => /\/src\/(?:.*\/)?fixtures\//.test(p))
      .map((p) => relative(ROOT, p));
    expect({ inSrc, fixtureDirs }).toEqual({ inSrc: [], fixtureDirs: [] });
  });

  test("gh-118 B14: every test file sits in a tier folder", () => {
    expect(untieredTests(ROOT)).toEqual([]);
  });

  test("gh-118 B14: a test file outside a tier folder fails, naming the file", () => {
    const root = mkdtempSync(join(tmpdir(), "norn-tiers-"));
    const put = (rel: string) => {
      mkdirSync(join(root, rel, ".."), { recursive: true });
      writeFileSync(join(root, rel), "");
    };
    put("packages/kernel/test/unit/a.test.ts");
    put("packages/runtime/test/integration/b.test.ts");
    put("packages/runner-herdr/test/unit/herdr/herdr.test.ts");
    put("packages/conformance/test/contract/suite.ts");
    put("test/repo/d.test.ts");
    put("test/e2e/c.test.ts");
    put("packages/cli/test/foo.test.ts");
    put("packages/kernel/test/fixtures/x.test.ts");
    put("test/support/e.test.ts");
    put("test/f.test.ts");
    expect(untieredTests(root)).toEqual([
      "packages/cli/test/foo.test.ts is not in a tier folder (unit/, integration/, test/repo/)",
      "packages/kernel/test/fixtures/x.test.ts is not in a tier folder (unit/, integration/, test/repo/)",
      "test/e2e/c.test.ts is not in a tier folder (unit/, integration/, test/repo/)",
      "test/f.test.ts is not in a tier folder (unit/, integration/, test/repo/)",
      "test/support/e.test.ts is not in a tier folder (unit/, integration/, test/repo/)",
    ]);
  });

  test("AC1: the old split scripts are gone from package.json and from every live file", () => {
    // spelled in pieces so this file is not itself a hit
    const old = [["test", "fast"].join(":"), ["test", "cli"].join(":")];
    const scripts = rootScripts();
    expect(old.filter((s) => s in scripts)).toEqual([]);
    const exts = [...DOCS, ".ts", ".sh", ".toml"];
    const live = [
      join(ROOT, "package.json"),
      join(ROOT, "AGENTS.md"),
      join(ROOT, "README.md"),
      join(ROOT, "CONTRIBUTING.md"),
      ...textFiles(join(ROOT, ".agents", "workflows"), exts),
      ...textFiles(join(ROOT, ".github"), exts),
      ...textFiles(join(PKGS, "pack-sdlc", "assets", "skills"), exts),
      ...textFiles(join(ROOT, ".agents", "skills"), exts),
      ...textFiles(join(ROOT, "scripts"), exts),
      ...textFiles(join(ROOT, "test"), exts),
      ...readdirSync(PKGS).flatMap((p) => (existsSync(join(PKGS, p, "test")) ? textFiles(join(PKGS, p, "test"), exts) : [])),
    ];
    const hits = live.flatMap((f) =>
      readFileSync(f, "utf8")
        .split("\n")
        .flatMap((line, i) => (old.some((o) => new RegExp(`\\b${o}\\b`).test(line)) ? [`${relative(ROOT, f)}:${i + 1}`] : [])),
    );
    expect(hits).toEqual([]);
  });

  test("AC4 (B10): the shipped norn-implement skill asks for the fast suite after each change, slower tiers in their own check, never the full suite", () => {
    const skill = readFileSync(join(PKGS, "pack-sdlc", "assets", "skills", "norn-implement", "SKILL.md"), "utf8");
    expect({
      fastAfterEachChange: /fast suite after each change/.test(skill),
      slowerTiers: /slower tiers run in their own check/i.test(skill),
      fullSuite: /full suite/i.test(skill),
    }).toEqual({ fastAfterEachChange: true, slowerTiers: true, fullSuite: false });
  });

  type CiStep = { name?: string; run?: string };
  type CiJob = { needs?: string | string[]; steps: CiStep[]; strategy?: { "fail-fast"?: boolean; matrix?: { shard?: unknown[] } } };
  const ciJobs = (file: string) => (Bun.YAML.parse(readFileSync(join(ROOT, ".github", "workflows", file), "utf8")) as { jobs: Record<string, CiJob> }).jobs;
  const runs = (job: CiJob) => job.steps.flatMap((s) => (s.run ?? "").split("\n").map((l) => l.trim()).filter(Boolean));

  test("AC5 (B11, B12): ci.yml runs unit and the type check first; 4 integration shards, without fail-fast so a red run reports every failing shard, and package need it; git-spawning jobs set an identity", () => {
    const jobs = ciJobs("ci.yml");
    const unit = jobs.unit;
    expect(unit && runs(unit).filter((r) => r.startsWith("bun run"))).toEqual(["bun run test", "bun run typecheck"]);
    const needs = (j?: CiJob) => [j?.needs ?? []].flat();
    expect(["integration", "package"].map((n) => ({ n, needs: needs(jobs[n]) }))).toEqual(["integration", "package"].map((n) => ({ n, needs: ["unit"] })));
    const integration = jobs.integration;
    expect({ failFast: integration?.strategy?.["fail-fast"], shards: integration?.strategy?.matrix?.shard }).toEqual({ failFast: false, shards: [1, 2, 3, 4] });
    expect(integration && runs(integration)).toContain("bun run test:integration --shard=${{ matrix.shard }}/4");
    const identity = ["integration", "package"].map((n) => ({
      n,
      name: runs(jobs[n] as CiJob).some((r) => r.startsWith("git config --global user.name")),
      email: runs(jobs[n] as CiJob).some((r) => r.startsWith("git config --global user.email")),
    }));
    expect(identity).toEqual(["integration", "package"].map((n) => ({ n, name: true, email: true })));
  });

  test("the latest released norn loads every PR's tree but a release's, in a workflow of its own so a story's ci check never waits on it", () => {
    const wf = Bun.YAML.parse(readFileSync(join(ROOT, ".github", "workflows", "released-norn.yml"), "utf8")) as { on: Record<string, unknown>; jobs: Record<string, CiJob & { if?: string }> };
    expect(Object.keys(wf.on)).toEqual(["pull_request"]);
    const job = wf.jobs["released-norn"] as CiJob & { if?: string };
    // a release PR is told by the cli version it bumps, never by its title (norn names the version after opening it)
    expect(job.if).toBeUndefined();
    expect(runs(job)).toContain("recorded=$(jq -r .version packages/cli/package.json)");
    expect(runs(job)).toContain('if [ "$recorded" != "${tag#v}" ]; then');
    expect(runs(job)).toContainEqual(expect.stringContaining("gh release download --repo \"$GITHUB_REPOSITORY\" --pattern norn-linux-x64"));
    expect(runs(job)).toContainEqual(expect.stringContaining("norn-linux-x64\" doctor --repo"));
    // a release from before the thin CLI cannot read the new config: told by its --version, it passes with a notice
    expect(runs(job)).toContainEqual(expect.stringContaining("--version | grep -q '^plugin API '"));
    expect(Object.keys(ciJobs("ci.yml"))).not.toContain("released-norn");
  });

  test("AC6 (B13): release.yml's test step runs exactly the unit tier and the type check", () => {
    const steps = Object.values(ciJobs("release.yml")).flatMap((j) => j.steps);
    const testStep = steps.find((s) => s.name === "Test");
    const commands = (testStep?.run ?? "").split("\n").map((l) => l.trim()).filter((l) => l && !l.startsWith("git config"));
    expect(commands).toEqual(["bun run test", "bun run typecheck"]);
    expect(steps.some((s) => /test:integration|test:e2e/.test(s.run ?? ""))).toBe(false);
  });

  test("AC7 (B21): AGENTS.md lists the two tier commands and hands back on the unit tier and the type check, and every path it and docs/development.md name exists; the README names no test command (gh-162 B3: AGENTS.md holds them)", () => {
    const agents = readFileSync(join(ROOT, "AGENTS.md"), "utf8");
    const commands = section(agents, "Commands");
    const named = (cmd: string) => new RegExp(`^${cmd.replace(/[:]/g, "\\$&")}\\s+#`, "m").test(commands);
    expect(["bun run test", "bun run test:integration"].map(named)).toEqual([true, true]);
    expect(commands).toMatch(/The unit tier \(`bun run test`\) and the type check must pass before you hand work back/);
    // AGENTS.md is a map: most of the paths an agent is sent to are named in the contributor reference
    const devDocs = agents + readFileSync(join(ROOT, "docs", "development.md"), "utf8");
    const paths = [...devDocs.matchAll(/`((?:packages|test|scripts)\/[\w./*-]+)`/g)].map((m) => (m[1] as string).replace(/\/\*[^/]*$/, ""));
    expect(paths.length).toBeGreaterThan(0);
    expect(paths.filter((p) => !existsSync(join(ROOT, p)))).toEqual([]);
    // a test file named bare ("`contract.test .ts` there") must also be named by its full path, so the check above sees it
    const bare = [...devDocs.matchAll(/`([\w.-]+\.test\.ts)`/g)].map((m) => m[1] as string);
    expect(bare.filter((name) => !paths.some((p) => p.endsWith(`/${name}`)))).toEqual([]);
    const readme = readFileSync(join(ROOT, "README.md"), "utf8").split("\n").filter((l) => /^bun (run )?test\b/.test(l));
    expect(readme).toEqual([]);
  });

  test("B1, B2, B4: the root bunfig preloads the unit guard, ignores exactly the integration tier, and the test script is exactly bun test", () => {
    const scripts = rootScripts();
    expect(scripts.test).toBe("bun test");
    expect(bunfig("bunfig.toml").preload).toEqual(["./test/preload.ts", "./test/support/unit-guard-preload.ts"]);
    expect(bunfig("bunfig.toml").pathIgnorePatterns).toEqual(["**/integration/**"]);
    expect(tierSelection("bunfig.toml").filter((f) => f.includes("/integration/"))).toEqual([]);
  });

  test.each([
    // integration is spawn-bound: past 6 workers system CPU time eats the gain (bypass #259)
    ["test:integration", "bunfig.integration.toml", "--parallel=6", (f: string) => /^packages\/[^/]+\/test\/integration\//.test(f)],
  ] as const)("B5: %s runs bun test with %s, in parallel (%s) with a 20 s timeout, passing extra arguments through, and selects only its tier", (script, config, parallel, inTier) => {
    const scripts = rootScripts();
    // ends in flags, so `bun run <script> <file>` appends the file as bun test's own path filter
    expect(scripts[script]).toBe(`bun test --config=${config} ${parallel} --timeout=20000`);
    // the unit guard is the unit tier's alone; --parallel workers also load the root preloads, so the tier says it spawns
    expect(bunfig(config).preload).toEqual(["./test/preload.ts", "./test/support/spawning-tier-preload.ts"]);
    const all = testFilesUnder(ROOT);
    const selected = tierSelection(config);
    expect(selected.length).toBeGreaterThan(0);
    expect(selected).toEqual(all.filter(inTier));
  });
});

describe("intake by kind", () => {
  test("the bug report template applies norn:wf:reproduce", () => {
    const text = readFileSync(join(ROOT, ".github", "ISSUE_TEMPLATE", "bug_report.md"), "utf8");
    const fm = Bun.YAML.parse(text.match(/^---\n([\s\S]*?)\n---\n/)?.[1] ?? "") as { labels: string[] };
    expect(fm.labels).toEqual(["norn:wf:reproduce"]);
  });
});

describe("release metadata", () => {
  test("the README release badge names the cli version, and CHANGELOG.md has its section", () => {
    const { version } = JSON.parse(readFileSync(join(PKGS, "cli", "package.json"), "utf8")) as { version: string };
    const badges = [...readFileSync(join(ROOT, "README.md"), "utf8").matchAll(/badge\/release-v([0-9][^-]*)-/g)].map((m) => m[1]);
    expect(badges).toEqual([version]);
    expect(readFileSync(join(ROOT, "CHANGELOG.md"), "utf8")).toContain(`## [${version}]`);
  });
});

/**
 * Commands this release removed. A hit is `norn <old>` (or the plugin's `"$NORN" <old>`)
 * anywhere in a line: prose, comments, code spans, strings and scripts alike. Prose that names a thing
 * with an article ("a norn workflow", "the norn cockpit") is not a command and is left out first. Also
 * hit: `norn status <key>` (now `story view`) and the flags that changed what an old command did
 * (`cockpit --next`, `approve --reject`, …), with or without `norn`.
 */
const REMOVED_COMMANDS = ["drop", "inbox", "cockpit", "orient", "open", "answer", "approve", "unstick", "update", "mode", "workflow", "take", "release", "trace", "why"];
const OLD_COMMAND = new RegExp(`(?:\\bnorn|"\\$NORN")\\s+(${REMOVED_COMMANDS.join("|")})(?![\\w-])`);
const OLD_STATUS_KEY = /\bnorn status (?:<(?:key|story|unit|slice)>|g[hl]-\d+)/;
const OLD_FLAG = /\b(?:cockpit --(?:next|open|interval)|approve --reject|unstick --to|orient --open|workflow --to)\b/;
const NAMED_THING = /\b(?:a|an|the) norn \w+/gi;

/** The removed commands one line names (`norn <old>`, `norn status <key>`, an old flag). */
function oldCommandHits(line: string): string[] {
  const text = line.replace(NAMED_THING, "");
  return [OLD_COMMAND, OLD_STATUS_KEY, OLD_FLAG].flatMap((re) => [...text.matchAll(new RegExp(re.source, "g"))].map((m) => m[0]));
}

/** Lines allowed to match, by file and exact text, with why: a quoted name of a thing, not a command. */
const OLD_COMMAND_ALLOW: Array<[file: string, text: string, why: string]> = [
  ["packages/schema/src/workflow.ts", `title: "norn workflow",`, "the Workflow schema's title (a norn workflow file)"],
];

const OLD_COMMAND_FILES = (): string[] => [
  ...GLOSSARY_FILES().filter((f) => !f.includes("/schema/json/")),
  ...textFiles(join(ROOT, ".agents", "skills"), DOCS),
];

describe("removed commands (B71)", () => {
  test("matcher: commands anywhere in a line; a named thing (`a norn workflow`), new names and other flags are not hits", () => {
    expect(oldCommandHits("run `norn unstick gh-1` then")).toEqual(["norn unstick"]);
    expect(oldCommandHits(`  hint: "norn inbox",`)).toEqual(["norn inbox"]);
    expect(oldCommandHits(`out=$("$NORN" cockpit --next --json)`)).toEqual([`"$NORN" cockpit`, "cockpit --next"]);
    expect(oldCommandHits("`norn status gh-12` shows one story")).toEqual(["norn status gh-12"]);
    expect(oldCommandHits("`approve --reject --reason`")).toEqual(["approve --reject"]);
    expect(oldCommandHits("lands through a norn workflow, as a norn release")).toEqual([]);
    expect(oldCommandHits("// manual (you, with norn open) or auto")).toEqual(["norn open"]);
    expect(oldCommandHits("`norn trace` and `norn why` show it")).toEqual(["norn trace", "norn why"]);
    expect(oldCommandHits("Start a norn release; the norn cockpit lists it")).toEqual([]);
    expect(oldCommandHits("`norn story approve gh-1`, `norn run view --why`, `norn status --watch`")).toEqual([]);
    expect(oldCommandHits("`norn workflow-run` and `norn opening`")).toEqual([]);
  });

  test("no removed command in sources, assets, skills, README, CONTRIBUTING, AGENTS.md and docs/", () => {
    const hits: string[] = [];
    for (const f of OLD_COMMAND_FILES()) {
      const rel = relative(ROOT, f);
      readFileSync(f, "utf8")
        .split("\n")
        .forEach((line, i) => {
          if (OLD_COMMAND_ALLOW.some(([file, text]) => file === rel && line.trim() === text)) return;
          for (const old of oldCommandHits(line)) hits.push(`${rel}:${i + 1} → \`${old}\` was removed: ${line.trim()}`);
        });
    }
    expect(hits).toEqual([]);
  });
});

/**
 * No product doc or shipped text sends anyone to the old `.agents/norn/` folder. Scanned:
 * README, everything under packages/pack-sdlc/assets, package sources (`norn help` and every message
 * are built there), and AGENTS.md's Layout and "Where the contracts live". Not scanned, until the
 * follow-up story migrates this repo: AGENTS.md's other sections, CONTRIBUTING.md and the
 * `.agents/skills/norn*` copies (this repo's own process text).
 */
const OLD_DIR = /\.agents\/(norn|\*)\//;

/** Lines allowed to name the old folder, by file and a substring of the line, with why. */
const OLD_DIR_ALLOW: Array<[file: string, text: string, why: string]> = [];

/** The text of `## <title>` up to the next `## ` heading. */
function section(text: string, title: string): string {
  const start = text.indexOf(`\n## ${title}`);
  if (start < 0) throw new Error(`section not found: ${title}`);
  const end = text.indexOf("\n## ", start + 1);
  return text.slice(start, end < 0 ? undefined : end);
}

function productDocs(): Array<[file: string, text: string]> {
  const agents = readFileSync(join(ROOT, "AGENTS.md"), "utf8");
  return [
    ...[...allDocs(ROOT).filter((f) => !f.endsWith("AGENTS.md")), ...textFiles(join(PKGS, "pack-sdlc", "assets"), [...DOCS, ".txt"])].map(
      (f): [string, string] => [relative(ROOT, f), readFileSync(f, "utf8")],
    ),
    ...files(PKGS)
      .filter((p) => p.includes("/src/"))
      .map((f): [string, string] => [relative(ROOT, f), readFileSync(f, "utf8")]),
    ["AGENTS.md#Layout", section(agents, "Layout and dependency direction")],
    ["AGENTS.md#Where the contracts live", section(agents, "Where the contracts live")],
  ];
}

describe("the new layout in product docs (B22)", () => {
  test("matcher: the old folder and its parts are hits; the new config file and other .agents folders are not", () => {
    for (const hit of ["`.agents/norn/config.yaml`", "in .agents/norn/workflows/", ".agents/*/trace/x.jsonl", "(.agents/norn/)"]) expect(OLD_DIR.test(hit)).toBe(true);
    for (const miss of ["`.agents/norn.config.yaml`", ".agents/workflows/", ".agents/skills/norn/SKILL.md", ".agents/specs/gh-1-x/"]) expect(OLD_DIR.test(miss)).toBe(false);
  });

  test("AGENTS.md's sections are found, or the lint fails loudly", () => {
    expect(() => section("# x\n## A\nbody", "B")).toThrow("section not found: B");
    expect(section("# x\n## A\na\n## B\nb", "A")).toBe("\n## A\na");
  });

  test("the docs, shipped assets, package sources and AGENTS.md's Layout and contracts name no `.agents/norn/`", () => {
    const hits: string[] = [];
    for (const [file, text] of productDocs()) {
      text.split("\n").forEach((line, i) => {
        if (!OLD_DIR.test(line) || OLD_DIR_ALLOW.some(([f, t]) => f === file && line.includes(t))) return;
        hits.push(`${file}:${i + 1}: ${line.trim()}`);
      });
    }
    expect(hits).toEqual([]);
  });

  test("Concepts' Workflows are data and Reference's Config paragraphs name the new places", () => {
    const concepts = readFileSync(join(ROOT, "docs", "concepts.md"), "utf8").split("\n");
    const reference = readFileSync(join(ROOT, "docs", "reference.md"), "utf8").split("\n");
    expect(concepts.find((l) => l.startsWith("**Workflows are data.**"))).toContain("`.agents/workflows/`");
    expect(reference.find((l) => l.startsWith("| `.agents/norn.yaml`"))).toBeDefined();
  });
});

/**
 * Ratchet lints: each counts hits per file against an allowlist (file → count) that may only shrink.
 * A file over its count is a new hit; a file under it fails too, so the allowlist is lowered in the
 * same change that removed the hit. Counts are call sites (`name(`), comments included.
 */
type Counts = Record<string, number>;

function ratchet(hits: Counts, allow: Counts): string[] {
  const out: string[] = [];
  for (const [f, n] of Object.entries(hits)) {
    const a = allow[f] ?? 0;
    if (n > a) out.push(`${f}: ${n} hits, allowlist ${a} → new hit; move it behind the owning package instead`);
  }
  for (const [f, a] of Object.entries(allow)) {
    const n = hits[f] ?? 0;
    if (n < a) out.push(`${f}: ${n} hits, allowlist ${a} → lower the allowlist to ${n}`);
  }
  return out;
}

/** Package source files, repo-relative. */
const SRC = (): string[] => files(PKGS).filter((p) => p.includes("/src/")).map((p) => relative(ROOT, p));

function countHits(re: RegExp, keep: (file: string) => boolean): Counts {
  const out: Counts = {};
  for (const f of SRC().filter(keep)) {
    const n = [...readFileSync(join(ROOT, f), "utf8").matchAll(re)].length;
    if (n) out[f] = n;
  }
  return out;
}

const FS_WRITE = /\b(?:writeFileSync|appendFileSync|renameSync|cpSync|copyFileSync|writeFile|appendFile|copyFile)\s*\(|\bBun\.write\s*\(/g;

/** (a) S1: every file norn writes goes through host-node's files (atomic temp → fsync → rename). */
const FS_WRITE_ALLOW: Counts = {
  // the harness plugin writes the agent's own config file itself, temp → fsync → rename: it may not depend on store
  "packages/harness-claude/src/files.ts": 1,
  // the same for pi: the harness writes the extension pi loads, temp → fsync → rename
  "packages/harness-pi/src/files.ts": 1,
  // the new architecture's one IO boundary: every new package writes files only through the HostContext this builds
  "packages/host-node/src/files.ts": 1,
};

/**
 * (c) S2: every JSON read is validated against @norn/schema. Each entry says what it parses: tool
 * output (stdout of a CLI or a hook), or a file another tool owns.
 */
const JSON_PARSE_ALLOW: Record<string, [number, string]> = {
  "packages/harness-claude/src/files.ts": [1, "file claude owns: .claude/settings.local.json"],
  "packages/harness-pi/src/extension.ts": [1, "text the harness writes, run inside pi: the extension reading the hook command's stdout"],
  // plugins cannot reach store and schema parses no text, so this helper is their one JSON read, validated against a schema at once
  "packages/plugin-api/src/json.ts": [1, "tool output: the validated parse helper provider plugins use for CLI stdout and their own files"],
};

/** (d) processes are spawned by host-node alone: every other package starts them through the HostContext it builds. */
const SPAWN_ALLOW: Counts = {
  // the new architecture's one IO boundary: every new package starts processes only through the HostContext this builds
  "packages/host-node/src/exec.ts": 1,
  // the same boundary for the detached processes a runner or a detached check starts
  "packages/host-node/src/spawn.ts": 1,
};

/**
 * (g) B1, B2, B5: norn's paths under a repo are spelled only by the path modules (the cli's config
 * paths and schema's config files), so a layout change is a change there. Counts lines of package
 * sources and tests (root test/support too) that spell `.agents/norn` (or join `".agents", "norn"`)
 * outside a comment. Allowed: tests asserting text a person sees.
 */
const NORN_PATH = /\.agents\/norn\b|["'`]\.agents["'`]\s*,\s*["'`]norn["'`]/;
const NORN_PATH_ALLOW: Record<string, [number, string]> = {
  "packages/cli/src/config/paths.ts": [5, "the cli's path module: its config files, plugin lock and the old norn's team and repo-local configs it moves off, as messages name them"],
  "packages/cli/test/unit/config.test.ts": [3, "the cli's config files where a person sees them: the paths and the config error's message"],
  "packages/cli/test/unit/plugins.test.ts": [1, "the cli's committed plugin lock, where a person sees it in team mode"],
};

function nornPathLines(): Counts {
  const out: Counts = {};
  const all = [...files(PKGS), ...files(join(ROOT, "test", "support"))]
    .map((p) => relative(ROOT, p))
    .filter((p) => p.includes("/src/") || p.includes("/test/") || p.startsWith("test/"));
  for (const f of all) {
    const n = readFileSync(join(ROOT, f), "utf8")
      .split("\n")
      .filter((l) => !/^\s*(\*|\/\*|\/\/)/.test(l) && NORN_PATH.test(l.replace(/\s\/\/ .*$/, ""))).length;
    if (n) out[f] = n;
  }
  return out;
}

describe("ratchet lints", () => {
  test("matcher: a new hit and a stale allowlist entry both fail", () => {
    expect(ratchet({ a: 1 }, { a: 1 })).toEqual([]);
    expect(ratchet({ a: 2, b: 1 }, { a: 1 })).toHaveLength(2);
    expect(ratchet({}, { a: 1 })).toEqual(["a: 0 hits, allowlist 1 → lower the allowlist to 0"]);
  });

  test("(a) S1: fs writes only in host-node's files", () => {
    expect(ratchet(countHits(FS_WRITE, () => true), FS_WRITE_ALLOW)).toEqual([]);
  });

  test("(c) S2: JSON.parse only in schema", () => {
    const allow = Object.fromEntries(Object.entries(JSON_PARSE_ALLOW).map(([f, [n]]) => [f, n]));
    expect(ratchet(countHits(/\bJSON\.parse\s*\(/g, (f) => !f.startsWith("packages/schema/src/")), allow)).toEqual([]);
  });

  test("(d) Bun.spawn only in host-node", () => {
    expect(ratchet(countHits(/\bBun\.spawn(?:Sync)?\s*\(/g, () => true), SPAWN_ALLOW)).toEqual([]);
  });

  test("(e) the kernel is pure: no node:fs, Bun.spawn, Date.now, Math.random", () => {
    expect(countHits(/node:fs|\bBun\.spawn|\bDate\.now\b|\bMath\.random\b/g, (f) => f.startsWith("packages/kernel/src/"))).toEqual({});
  });

  test("(g) B1, B2, B5: `.agents/norn` paths are spelled only in the path modules", () => {
    const allow = Object.fromEntries(Object.entries(NORN_PATH_ALLOW).map(([f, [n]]) => [f, n]));
    expect(ratchet(nornPathLines(), allow)).toEqual([]);
  });
});

describe("one resolver for a unit's record folder (B30, B36)", () => {
  /** Where a unit's record path may be named: the pure name in schema. */
  const RESOLVERS = ["packages/schema/src/ids.ts"];
  /** A `runs` path segment built by hand: the bare literal (`join(…, "runs", …)`) or `runs/${…}` in a template. */
  const BY_HAND = /["'`]runs["'`]|\bruns\/\$\{/;
  const isComment = (line: string) => /^\s*(\*|\/\/|\/\*)/.test(line);
  const byHand = (src: string) =>
    src
      .split("\n")
      .map((l, i) => ({ l, i }))
      .filter(({ l }) => !isComment(l) && BY_HAND.test(l));

  test("matcher: a joined literal and a template segment are hits; comments and other runs/ text are not", () => {
    const src = [
      'const a = join(spec, "runs", dir);',
      "const b = `${spec}/runs/${dir}/state.json`;",
      " * `runs/${unit}` in a doc comment",
      "// join(spec, 'runs', dir)",
      "const c = `runs/ rewound`;",
      "const d = unitDir(spec, dir);",
    ].join("\n");
    expect(byHand(src).map(({ i }) => i)).toEqual([0, 1]);
  });

  test("no package source outside the resolvers builds runs/<unit> by hand", () => {
    const hits = files(PKGS)
      .filter((p) => p.includes("/src/") && !RESOLVERS.includes(relative(ROOT, p)))
      .flatMap((p) => byHand(readFileSync(p, "utf8")).map(({ l, i }) => `${relative(ROOT, p)}:${i + 1}: ${l.trim()}`));
    expect(hits).toEqual([]);
  });
});

describe("the run-state resolver takes the checkout, the story and the unit (gh-195 prefactor 1)", () => {
  /** The resolver: schema's pure names, paths relative to a root. */
  const RESOLVER = ["packages/schema/src/ids.ts"];
  /** The record's names: the folder, the unit's and round's record paths, decide's observed record. */
  const NAMES = String.raw`\b(?:RUNS_DIR|unitRecordPath|roundRecordPath|recordOf)\b|["'\x60]runs["'\x60/]`;
  /** A spec folder: `spec_dir`, `specDir`, `specPath`, `spec`, as a name or a field. */
  const SPEC = String.raw`\bspec(?:_dir|Dir|Path)?\b`;
  /**
   * A unit's run-state path built outside the resolver, matched over the whole source with comments
   * removed (so a call wrapped over lines counts):
   * - a template that joins something with the record's names (`${spec}/${unitRecordPath(…)}`), or a spec
   *   folder with a record (`${story.spec_dir}/${recordOf(uf)}`, `${spec}/runs/…`);
   * - a `join(…)` whose arguments name the record (`join(spec, RUNS_DIR)`);
   * - a path taken relative to a spec folder (`relative(join(root, spec_dir), dir)`): a record's name;
   * - a call of the resolver's spec-folder primitives (`unitDir(join(wt, spec_dir), unit)` and friends).
   */
  const TEMPLATE = new RegExp(String.raw`\$\{[^{}]*\}/(?:\$\{[^{}]*(?:${NAMES})|runs\b)|\$\{[^{}]*${SPEC}[^{}]*\}/\$\{[^{}]*\brecord`);
  const RELATIVE = new RegExp(String.raw`\brelative\(\s*(?:join\([^()]*${SPEC}[^()]*\)|[\w.]*${SPEC})\s*,`);
  const PRIMITIVE = /\b(?:unitDir|storyUnitDir|startDir|roundDir|specRunsDir|storyRounds|currentRound|isFlatStoryRecord)\s*\(/;

  /** `src` with every comment blanked out (strings and templates kept, newlines kept for line numbers). */
  function stripComments(src: string): string {
    let out = "";
    const stack: string[] = []; // open template literals / `${` braces
    for (let i = 0; i < src.length; i++) {
      const c = src[i] as string;
      const top = stack.at(-1);
      if (top === "`") {
        out += c;
        if (c === "\\") out += src[++i] ?? "";
        else if (c === "`") stack.pop();
        else if (c === "$" && src[i + 1] === "{") (out += src[++i]), stack.push("{");
        continue;
      }
      if (c === "/" && src[i + 1] === "/") {
        while (i < src.length && src[i] !== "\n") i++;
        out += "\n";
        continue;
      }
      if (c === "/" && src[i + 1] === "*") {
        const end = src.indexOf("*/", i + 2);
        const stop = end < 0 ? src.length : end + 2;
        out += src.slice(i, stop).replace(/[^\n]/g, " ");
        i = stop - 1;
        continue;
      }
      if (c === '"' || c === "'") {
        let j = i + 1;
        while (j < src.length && src[j] !== c && src[j] !== "\n") j += src[j] === "\\" ? 2 : 1;
        out += src.slice(i, j + 1);
        i = j;
        continue;
      }
      out += c;
      if (c === "`") stack.push("`");
      else if (c === "{" && stack.length) stack.push("{");
      else if (c === "}" && top === "{") stack.pop();
    }
    return out;
  }
  /** The text of each balanced `join(…)` call's arguments, with where it starts. */
  function joinCalls(src: string): Array<{ at: number; args: string }> {
    const out: Array<{ at: number; args: string }> = [];
    for (const m of src.matchAll(/\bjoin\(/g)) {
      const start = (m.index ?? 0) + m[0].length;
      let depth = 1;
      let j = start;
      while (j < src.length && depth) depth += src[j] === "(" ? 1 : src[j] === ")" ? -1 : 0, j++;
      out.push({ at: m.index ?? 0, args: src.slice(start, j - 1) });
    }
    return out;
  }
  /** Line numbers (0-based) where `src` builds a unit's run-state path by hand. */
  const builds = (src: string): number[] => {
    const code = stripComments(src);
    const lineOf = (at: number) => code.slice(0, at).split("\n").length - 1;
    const at = new Set<number>();
    for (const re of [TEMPLATE, RELATIVE, PRIMITIVE]) for (const m of code.matchAll(new RegExp(re.source, "g"))) at.add(lineOf(m.index ?? 0));
    for (const j of joinCalls(code)) if (new RegExp(NAMES).test(j.args)) at.add(lineOf(j.at));
    return [...at].sort((a, b) => a - b);
  };

  test("matcher: a spec folder joined with runs/ or a spec-folder primitive is a hit; the resolver's calls, comments and bare names are not", () => {
    const src = [
      "const a = `${story.spec_dir}/${unitRecordPath(unit)}`;",
      "const b = join(specDir, RUNS_DIR);",
      "const c = join(wt, spec_dir, roundRecordPath(1, wf));",
      "const d = unitDir(join(wt, m.spec_dir), m.unit);",
      "const e = startDir(join(wt, spec_dir), dir, wf);",
      "const f = runStateDir(wt, { key, spec_dir }, dir);",
      "const g = runStatePath(story, dir);",
      "/** `unitDir(join(wt, spec_dir), unit)` in a doc comment */",
      "const h = su.record === unitRecordPath(STORY_UNIT_DIR); // join(spec, RUNS_DIR)",
      "export function readState(unitDir: string): void {}",
    ].join("\n");
    expect(builds(src)).toEqual([0, 1, 2, 3, 4]);
  });

  test("matcher (review F1): a spec folder joined with decide's observed record is a hit; a record path through the resolver is not", () => {
    const src = [
      "log_path: `${story.spec_dir}/${recordOf(uf)}/logs/${run_id}.log`,",
      "const p = `${s.spec_dir}/${uf.record}/state.json`;",
      "const q = `${specDir}/runs/${dir}`;",
      "log_path: `${recordRunStatePath(story, recordOf(uf))}/logs/${run_id}.log`,",
      "const r = `${recordOf(uf)}/workflow.yaml`;",
    ].join("\n");
    expect(builds(src)).toEqual([0, 1, 2]);
  });

  test("matcher (review F2): a path taken relative to a spec folder is a hit; one relative to a root is not", () => {
    const src = [
      "record: relative(join(root, story.spec_dir), path),",
      "const m = `${relative(join(wtPath, story.spec_dir), runsDir)}/workflow.yaml`;",
      "const n = relative(s.specPath, s.runsDir);",
      "spec_dir: relative(root, specPath),",
      "record: runStateRecord(root, story, path),",
    ].join("\n");
    expect(builds(src)).toEqual([0, 1, 2]);
  });

  test("matcher (review F3): a join or a template wrapped over lines is a hit, at the line it starts; a comment over lines is not", () => {
    const src = [
      "const a = join(",
      "  wt,",
      "  RUNS_DIR,",
      ");",
      "const b = unitDir(",
      "  spec, dir);",
      "/*",
      " * join(spec,",
      " *   RUNS_DIR)",
      " */",
      "const c = `x ${y} // not a comment ${join(z,",
      "  unitRecordPath(u))}`;",
    ].join("\n");
    expect(builds(src)).toEqual([0, 4, 10]);
  });

  test("matcher: the machine dir joined with runs/ is a hit; the resolver's machine-dir calls are not", () => {
    const src = [
      'const a = join(machineDir(root), "runs");',
      "const b = join(machineDir(root), RUNS_DIR, story);",
      "const c = `${machineDir(root)}/runs/${key}`;",
      "const d = storyRunStateDir(root, story);",
      "const e = runStateFile(root, a.log_path);",
    ].join("\n");
    expect(builds(src)).toEqual([0, 1, 2]);
  });

  test("no package source outside the resolver builds a unit's run-state path from a spec folder", () => {
    const hits = files(PKGS)
      .filter((p) => p.includes("/src/") && !RESOLVER.includes(relative(ROOT, p)))
      .flatMap((p) => {
        const src = readFileSync(p, "utf8");
        const lines = src.split("\n");
        // The machine dir's `runs/` is run state too, so no exception remains
        return builds(src).map((i) => `${relative(ROOT, p)}:${i + 1}: ${lines[i]?.trim()}`);
      });
    expect(hits).toEqual([]);
  });
});

describe("the running version is a dependency (Prefactor 1)", () => {
  // only the default wiring reads the package version; every command takes `ctx.version`, so a test can run the CLI as any binary
  const WIRING = "packages/cli/src/main.ts";
  const readsConstant = (text: string) => /\bNORN_VERSION\b|["']\.{1,2}\/(?:\.\.\/)*version\.ts["']|["'](?:\.\.\/)+package\.json["']/.test(text);

  test("matcher: an import of version.ts, of the cli package.json or the constant itself is a read", () => {
    expect(readsConstant(`import { NORN_VERSION } from "../version.ts";`)).toBe(true);
    expect(readsConstant(`import { version } from "../package.json";`)).toBe(true);
    expect(readsConstant(`const v = ctx.version;`)).toBe(false);
  });

  test("no cli source but the default wiring and version.ts reads the version constant", () => {
    const hits = files(join(PKGS, "cli", "src"))
      .map((p) => relative(ROOT, p))
      .filter((p) => p !== WIRING && p !== "packages/cli/src/version.ts")
      .filter((p) => readsConstant(readFileSync(join(ROOT, p), "utf8")));
    expect(hits).toEqual([]);
  });
});

describe("one resolver for a unit's handoff (gh-195 prefactor 2, B6, B39)", () => {
  /** Where a unit's handoff path may be named: the pure name in schema and the runtime's story documents. */
  const RESOLVERS = ["packages/schema/src/ids.ts", "packages/runtime/src/story-docs.ts"];
  /**
   * A handoff path derived from a record folder: the bare `handoff.md` literal (`join(record, "handoff.md")`),
   * the old record-keyed helpers, or a `dirname` of a handoff path (the story's handoff sat above its round folders).
   */
  const FROM_RECORD = /["'`/]handoff\.md["'`]|\brecordHandoffPath\b|\brecordPaths\b|\bdirname\([^)]*handoff/i;
  const isComment = (line: string) => /^\s*(\*|\/\/|\/\*)/.test(line);
  const fromRecord = (src: string) =>
    src
      .split("\n")
      .map((l, i) => ({ l, i }))
      .filter(({ l }) => !isComment(l) && FROM_RECORD.test(l));

  test("matcher: a joined literal, the record-keyed helpers and a dirname of a handoff are hits; comments and the resolver are not", () => {
    const src = [
      'const a = join(runsDir, "handoff.md");',
      "const b = `${record}/handoff.md`;",
      "const c = recordHandoffPath(p.unit_dir);",
      "const d = recordPaths(loc.runsDir);",
      "const e = dirname(handoffPath(ud)) === ud;",
      " * the story's `handoff.md` in a doc comment",
      "// join(runsDir, 'handoff.md')",
      "const f = handoffPath(specDir, unit.dir);",
    ].join("\n");
    expect(fromRecord(src).map(({ i }) => i)).toEqual([0, 1, 2, 3, 4]);
  });

  test("no package source outside the resolvers derives a handoff path from a record folder", () => {
    const hits = files(PKGS)
      .filter((p) => p.includes("/src/") && !RESOLVERS.includes(relative(ROOT, p)))
      .flatMap((p) => fromRecord(readFileSync(p, "utf8")).map(({ l, i }) => `${relative(ROOT, p)}:${i + 1}: ${l.trim()}`));
    expect(hits).toEqual([]);
  });

  test("the resolvers key the handoff by the unit, never by a record folder", () => {
    const keyedByRecord = RESOLVERS.filter((f) => /\brecordHandoffPath\b|\brecordPaths\b/.test(readFileSync(join(ROOT, f), "utf8")));
    expect(keyedByRecord).toEqual([]);
  });
});

describe("superseded records replace unpushed runs and orphaned/ (B27, AC4)", () => {
  test("no package source, golden case, rule case, shipped asset, plugin, emitted schema or doc in the doc set names unpushed_runs, orphaned/ or work not in the record", () => {
    const GONE = /unpushed_runs|unpushedRuns|UnpushedRuns|orphaned\/|copyToOrphaned|orphanedDir\b|work (?:on \S+ is )?not in the record/;
    const scanned = [
      ...files(PKGS).filter((p) => p.includes("/src/") || p.endsWith("/test/rule-cases.ts")),
      ...readdirSync(join(PKGS, "kernel", "test", "golden")).map((n) => join(PKGS, "kernel", "test", "golden", n)),
      join(ROOT, "docs", "reference.md"),
      // the shipped assets (skills, workflows) and the emitted schemas a person or agent reads
      ...textFiles(join(PKGS, "pack-sdlc", "assets"), DOCS),
          ...textFiles(join(PKGS, "schema", "json"), DOCS),
      // and every doc
      ...allDocs(ROOT),
    ];
    const hits = scanned.flatMap((p) =>
      readFileSync(p, "utf8")
        .split("\n")
        .flatMap((l, i) => (GONE.test(l) ? [`${relative(ROOT, p)}:${i + 1}: ${l.trim().slice(0, 120)}`] : [])),
    );
    expect(hits).toEqual([]);
  });
});
