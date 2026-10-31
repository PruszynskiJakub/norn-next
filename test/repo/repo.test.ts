/** Repo-wide rules: dependency direction (§17) and banned glossary synonyms (§5). */
import { describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";

const ROOT = join(import.meta.dir, "..", "..");
const PKGS = join(ROOT, "packages");

/** schema ← core ← store ← adapters ← cli; view reads schema/core/store. */
const ALLOWED: Record<string, string[]> = {
  schema: [],
  core: ["schema"],
  store: ["schema", "core"],
  adapters: ["schema", "core", "store"],
  view: ["schema", "core", "store"],
  cli: ["schema", "core", "store", "adapters", "view"],
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

  /** Root test code (`test/`, `scripts/`) may import any package, by name, only when the root declares it (gh-118 B15). */
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
    writeFileSync(join(root, "scripts", "x.ts"), `import { decide } from "@norn/core";\nconst s = await import("@norn/store");\n`);
    expect(undeclaredRootImports(root)).toEqual([
      { file: join("scripts", "x.ts"), dep: "@norn/core" },
      { file: join("scripts", "x.ts"), dep: "@norn/store" },
    ]);
  });
});

/**
 * Banned synonyms (§5). Only unambiguous ones are linted; "state"/"status"/"lease" are context-dependent.
 * Word boundaries keep identifiers like `run_job` or `tasks_total` clear (`_` is a word character).
 */
const BANNED: Array<[RegExp, string]> = [
  [/\b(task|tasks|job|jobs|ticket|tickets)\b/i, "story / slice"],
  [/\binteractive steps?\b/i, "attended step"],
  [/\bapproved\b/i, "approve (outcomes are spelled as typed)"],
];

const URL = /\b[a-z][a-z0-9+.-]*:\/\/\S+/gi;
const CODE_SPAN = /`[^`\n]*`/g;

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

/** Text files under `dir` (any depth) with one of the extensions; skips node_modules. */
function textFiles(dir: string, exts: string[]): string[] {
  return readdirSync(dir).flatMap((n) => {
    const p = join(dir, n);
    if (statSync(p).isDirectory()) return n === "node_modules" ? [] : textFiles(p, exts);
    return exts.some((e) => p.endsWith(e)) ? [p] : [];
  });
}

const DOCS = [".md", ".yaml", ".yml", ".json"];
const GLOSSARY_FILES = (): string[] => [
  ...files(PKGS).filter((p) => p.includes("/src/")),
  ...textFiles(join(PKGS, "cli", "assets"), DOCS),
  ...textFiles(join(ROOT, "plugins"), [...DOCS, ".toml", ".sh"]),
  ...textFiles(join(PKGS, "schema", "json"), DOCS),
  join(ROOT, "README.md"),
  join(ROOT, "CONTRIBUTING.md"),
  join(ROOT, "AGENTS.md"),
];

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

  test("no banned synonyms in sources, assets, plugin, JSON schemas, README and AGENTS.md", () => {
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

/** Every `*.test.ts` under `root`, relative to it; skips node_modules and dot folders. */
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

/** This file, repo-relative: B16 exempts it alone (it names the helpers in fixtures), wherever it lives. */
const THIS_FILE = relative(ROOT, import.meta.path);
const PINNED_HELPERS = ["test/support/transcript.ts", "test/support/observe-snapshot.ts"];
/** `from "x"` (import, export … from), side-effect `import "x"` and dynamic `import("x")` */
const IMPORT_SPEC = /(?:\bfrom\s+|\bimport\s*\(?\s*)["']([^"']+)["']/g;

/** The relative imports of repo-relative `file` under `root`, resolved to repo-relative paths. */
function relativeImports(root: string, file: string): Array<{ spec: string; path: string }> {
  return [...readFileSync(join(root, file), "utf8").matchAll(IMPORT_SPEC)]
    .map((m) => m[1] as string)
    .filter((spec) => spec.startsWith("."))
    .map((spec) => ({ spec, path: relative(root, join(root, file, "..", spec)) }));
}

/**
 * B16: imports of the transcript recorder or the observe snapshot helpers outside test/e2e/ (and the
 * helpers' own folder, test/support/), in package tests and root test code under `root`. An import is
 * matched by the path it resolves to; a support helper that imports a pinned one (transitively) is pinned too.
 */
function pinnedHelperImports(root: string): Array<{ file: string; import: string }> {
  const pinned = new Set(PINNED_HELPERS);
  const support = existsSync(join(root, "test/support")) ? files(join(root, "test/support")).map((f) => relative(root, f)).filter((f) => f.endsWith(".ts")) : [];
  for (let grew = true; grew; ) {
    const more = support.filter((f) => !pinned.has(f) && relativeImports(root, f).some((i) => pinned.has(i.path)));
    for (const f of more) pinned.add(f);
    grew = more.length > 0;
  }
  const pkgTests = existsSync(join(root, "packages")) ? readdirSync(join(root, "packages")).map((p) => join(root, "packages", p, "test")) : [];
  const dirs = [...pkgTests, join(root, "test")].filter((d) => existsSync(d));
  return dirs
    .flatMap((d) => files(d))
    .map((f) => relative(root, f))
    .filter((f) => f.endsWith(".ts"))
    // the file holding this rule names the helpers in its own fixtures; test/repo/ is still a unit tier
    .filter((f) => !f.startsWith("test/e2e/") && !f.startsWith("test/support/") && f !== THIS_FILE)
    .sort()
    .flatMap((f) =>
      relativeImports(root, f)
        .filter((i) => pinned.has(i.path))
        .map((i) => ({ file: f, import: i.spec })),
    );
}

/** Adapters (folders of packages/adapters/src under `root`) with no `*.test.ts` in test/unit/<adapter>/ nor test/integration/<adapter>/. */
function adaptersWithoutTests(root: string): string[] {
  const test = join(root, "packages", "adapters", "test");
  const hasTests = (dir: string) => existsSync(dir) && testFilesUnder(dir).length > 0;
  return readdirSync(join(root, "packages", "adapters", "src"), { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => d.name)
    .filter((a) => !hasTests(join(test, "unit", a)) && !hasTests(join(test, "integration", a)))
    .sort();
}

/** gh-118 B17: the packages whose tests this slice put in tiers (cli has its own rules; schema and core follow). */
const TIERED_PACKAGES = ["store", "adapters", "view"];

/** `*.test.ts` files of the tiered packages under `root` that sit neither in test/unit/ nor in test/integration/. */
function untieredPackageTests(root: string): string[] {
  return TIERED_PACKAGES.flatMap((pkg) => {
    const dir = join(root, "packages", pkg, "test");
    return existsSync(dir) ? testFilesUnder(dir).filter((f) => !/^(unit|integration)\//.test(f)).map((f) => `packages/${pkg}/test/${f}`) : [];
  }).sort();
}

describe("test layout (AGENTS.md)", () => {
  test("tests and fixtures live under packages/<pkg>/test, never in src", () => {
    const inSrc = files(PKGS)
      .filter((p) => p.includes("/src/") && p.endsWith(".test.ts"))
      .map((p) => relative(ROOT, p));
    const fixtureDirs = readdirSync(join(PKGS, "adapters", "src")).filter((n) => {
      try {
        return statSync(join(PKGS, "adapters", "src", n, "fixtures")).isDirectory();
      } catch {
        return false;
      }
    });
    expect({ inSrc, fixtureDirs }).toEqual({ inSrc: [], fixtureDirs: [] });
  });

  test("every adapter has its tests in packages/adapters/test/unit/<adapter>/ or test/integration/<adapter>/", () => {
    expect(adaptersWithoutTests(ROOT)).toEqual([]);
  });

  test("an adapter whose tests sit in either tier has tests; one with none, or only outside a tier, is named", () => {
    const root = mkdtempSync(join(tmpdir(), "norn-adapter-tests-"));
    const put = (rel: string) => {
      mkdirSync(join(root, rel, ".."), { recursive: true });
      writeFileSync(join(root, rel), "");
    };
    for (const a of ["pure", "real", "both", "none", "old"]) mkdirSync(join(root, "packages/adapters/src", a), { recursive: true });
    put("packages/adapters/test/unit/pure/pure.test.ts");
    put("packages/adapters/test/integration/real/real.test.ts");
    put("packages/adapters/test/unit/both/both.test.ts");
    put("packages/adapters/test/integration/both/both.test.ts");
    put("packages/adapters/test/unit/none/fixtures/x.json");
    put("packages/adapters/test/old/old.test.ts");
    expect(adaptersWithoutTests(root)).toEqual(["none", "old"]);
  });

  test("gh-118 B17: every test file of store, adapters and view sits under test/unit/ or test/integration/", () => {
    expect(untieredPackageTests(ROOT)).toEqual([]);
  });

  test("gh-118 B17: a store, adapters or view test outside a tier folder is named; other packages are not this rule's", () => {
    const root = mkdtempSync(join(tmpdir(), "norn-tiers-"));
    const put = (rel: string) => {
      mkdirSync(join(root, rel, ".."), { recursive: true });
      writeFileSync(join(root, rel), "");
    };
    put("packages/store/test/unit/a.test.ts");
    put("packages/store/test/integration/b.test.ts");
    put("packages/store/test/c.test.ts");
    put("packages/adapters/test/unit/gh/gh.test.ts");
    put("packages/adapters/test/integration/contract/contract.test.ts");
    put("packages/adapters/test/claude/claude.test.ts");
    put("packages/adapters/test/contract/suite.ts");
    put("packages/view/test/fixtures/x.test.ts");
    put("packages/core/test/d.test.ts");
    expect(untieredPackageTests(root)).toEqual([
      "packages/adapters/test/claude/claude.test.ts",
      "packages/store/test/c.test.ts",
      "packages/view/test/fixtures/x.test.ts",
    ]);
  });

  test("test:fast and test:cli split the suite: fast skips the cli and the integration and e2e tiers, and slice, story and quick checks run fast", () => {
    const scripts = rootScripts();
    const cliDir = scripts["test:cli"]?.match(/^bun test \.\/(\S+)$/)?.[1];
    const ignored = [...(scripts["test:fast"] ?? "").matchAll(/--path-ignore-patterns='(\S+)'/g)].map((m) => m[1]);
    expect({ test: scripts.test, cliDir, ignored }).toEqual({ test: "bun test", cliDir: "packages/cli/test", ignored: ["packages/cli/**", "**/integration/**", "test/e2e/**"] });
    const run = (wf: string) => readFileSync(join(ROOT, ".agents", "workflows", `${wf}.yaml`), "utf8").match(/^ {4}run: "(.*)"$/m)?.[1];
    expect(["slice", "bug", "story", "quick"].map(run)).toEqual(Array(4).fill("bun install --frozen-lockfile && bun run test:fast && bun run typecheck"));
  });

  test("B1, B2: the root bunfig ignores exactly the integration and e2e tiers, and the test script is exactly bun test", () => {
    const scripts = rootScripts();
    expect(scripts.test).toBe("bun test");
    expect(bunfig("bunfig.toml").pathIgnorePatterns).toEqual(["**/integration/**", "test/e2e/**"]);
    expect(tierSelection("bunfig.toml").filter((f) => f.includes("/integration/") || f.startsWith("test/e2e/"))).toEqual([]);
  });

  test.each([
    ["test:integration", "bunfig.integration.toml", (f: string) => /^packages\/[^/]+\/test\/integration\//.test(f)],
    ["test:e2e", "bunfig.e2e.toml", (f: string) => f.startsWith("test/e2e/")],
  ] as const)("B5, B6: %s runs bun test with %s, in parallel with a 20 s timeout, passing extra arguments through, and selects only its tier", (script, config, inTier) => {
    const scripts = rootScripts();
    // ends in flags, so `bun run <script> <file>` appends the file as bun test's own path filter
    expect(scripts[script]).toBe(`bun test --config=${config} --parallel --timeout=20000`);
    expect(bunfig(config).preload).toEqual(["./test/preload.ts"]);
    const all = testFilesUnder(ROOT);
    const selected = tierSelection(config);
    expect(selected.length).toBeGreaterThan(0);
    expect(selected).toEqual(all.filter(inTier));
  });

  test("B16: only test/e2e/ imports the transcript recorder and the observe snapshot helpers", () => {
    expect(pinnedHelperImports(ROOT)).toEqual([]);
  });

  test("AC7: no test source tells a person to rewrite a transcript or snapshot with plain bun test, which skips test/e2e/", () => {
    const stale = new RegExp(["NORN_TRANSCRIPT_UPDATE=1", "bun test"].join(" "));
    const dirs = [join(ROOT, "test"), ...readdirSync(PKGS).map((p) => join(PKGS, p, "test"))].filter((d) => existsSync(d));
    const offenders = dirs
      .flatMap((d) => files(d))
      .filter((f) => f.endsWith(".ts") && stale.test(readFileSync(f, "utf8")))
      .map((f) => relative(ROOT, f));
    expect(offenders).toEqual([]);
  });

  test("B16: an integration or unit test importing them fails, naming the file and the import", () => {
    const root = mkdtempSync(join(tmpdir(), "norn-pinned-"));
    const put = (rel: string, text: string) => {
      mkdirSync(join(root, rel, ".."), { recursive: true });
      writeFileSync(join(root, rel), text);
    };
    put("packages/cli/test/integration/a.test.ts", `import { recordTranscript } from "../../../../test/support/transcript.ts";\n`);
    put("packages/store/test/unit/b.test.ts", `import { snap } from "../../../../test/support/observe-snapshot.ts";\n`);
    put("test/e2e/ok.test.ts", `import { t } from "../support/transcript.ts";\nimport { s } from "../support/observe-snapshot.ts";\n`);
    put("test/support/observe-snapshot.ts", `import { t } from "./transcript.ts";\n`);
    put("test/support/records.ts", `export { s } from "./observe-snapshot.ts";\n`);
    put("test/support/harness.ts", `export const h = 1;\n`);
    put("packages/cli/test/integration/c.test.ts", `import "../../../../test/support/transcript.ts";\nimport { h } from "../../../../test/support/harness.ts";\n`);
    put("packages/cli/test/integration/d.test.ts", `import { s } from "../../../../test/support/records.ts";\n`);
    // only the support helpers count: an adapter's own transcript.ts is another module
    put("packages/adapters/test/claude/e.test.ts", `import { t } from "../../src/agent-hooks/transcript.ts";\n`);
    // test/repo/ is a unit tier (D6): only the file holding this rule is exempt, not its folder
    put("test/repo/f.test.ts", `import { t } from "../support/transcript.ts";\n`);
    expect(pinnedHelperImports(root)).toEqual([
      { file: "packages/cli/test/integration/a.test.ts", import: "../../../../test/support/transcript.ts" },
      { file: "packages/cli/test/integration/c.test.ts", import: "../../../../test/support/transcript.ts" },
      { file: "packages/cli/test/integration/d.test.ts", import: "../../../../test/support/records.ts" },
      { file: "packages/store/test/unit/b.test.ts", import: "../../../../test/support/observe-snapshot.ts" },
      { file: "test/repo/f.test.ts", import: "../support/transcript.ts" },
    ]);
  });

  test("quick and story wait for the PR's CI after open-pr and send a red run back to implement", () => {
    for (const wf of ["quick", "story"]) {
      const { steps, counters } = Bun.YAML.parse(readFileSync(join(ROOT, ".agents", "workflows", `${wf}.yaml`), "utf8")) as {
        steps: Record<string, { type: string; run?: string; outcomes: Record<string, unknown> }>;
        counters: Record<string, unknown>;
      };
      expect(steps["open-pr"]?.outcomes).toEqual({ done: "ci" });
      expect(steps.ci?.type).toBe("check");
      expect(steps.ci?.run).toContain("gh pr checks --watch --fail-fast");
      expect(steps.ci?.outcomes).toEqual({ pass: "ready", fail: { to: "implement", counter: "ci_loop" } });
      expect(counters.ci_loop).toEqual({ max: 3 });
    }
  });

  test("release goes prepare → open-pr → ci → ready, a red CI goes $stuck, and a base commit makes it stale (BS7)", () => {
    const { start, steps, counters, base } = Bun.YAML.parse(readFileSync(join(ROOT, ".agents", "workflows", "release.yaml"), "utf8")) as {
      start: string;
      steps: Record<string, { type: string; run?: string; outcomes: Record<string, unknown> }>;
      counters: Record<string, unknown>;
      base: unknown;
    };
    expect(start).toBe("prepare");
    expect(Object.keys(steps).sort()).toEqual(["ci", "open-pr", "prepare", "ready", "resolve", "update"]);
    expect(steps.prepare?.outcomes.done).toMatchObject({ to: "open-pr" });
    expect(steps["open-pr"]?.outcomes).toEqual({ done: "ci" });
    expect(steps.ci?.type).toBe("check");
    expect(steps.ci?.run).toContain("gh pr checks --watch --fail-fast");
    expect(steps.ci?.outcomes).toEqual({ pass: "ready", fail: "$stuck" });
    expect(steps.ready?.outcomes.reject).toEqual({ to: "prepare", counter: "ready_loop" });
    expect(counters.version_loop).toBeUndefined();
    expect(base).toEqual({ stale: "behind" });
  });
});

describe("intake by kind (W9)", () => {
  type Wf = { start: string; steps: Record<string, { type: string; skill?: string; instructions?: string; outcomes: Record<string, unknown> }> };
  const workflow = (wf: string) => Bun.YAML.parse(readFileSync(join(ROOT, ".agents", "workflows", `${wf}.yaml`), "utf8")) as Wf;

  test("triage recommends quick, story or close, all to its confirm gate", () => {
    const { steps } = workflow("triage");
    expect(Object.keys(steps.explore?.outcomes ?? {}).sort()).toEqual(["close", "quick", "story"]);
    expect(steps.confirm?.type).toBe("gate");
  });

  test("reproduce is one norn-diagnose agent step that reports reproduced or cannot_reproduce to a confirm gate", () => {
    const { start, steps } = workflow("reproduce");
    expect(start).toBe("reproduce");
    expect(Object.keys(steps).sort()).toEqual(["confirm", "reproduce"]);
    expect(steps.reproduce?.skill).toBe("norn-diagnose");
    const targets = Object.fromEntries(Object.entries(steps.reproduce?.outcomes ?? {}).map(([k, v]) => [k, (v as { to: string }).to]));
    expect(targets).toEqual({ reproduced: "confirm", cannot_reproduce: "confirm" });
    expect(steps.confirm?.type).toBe("gate");
    expect(steps.confirm?.outcomes.approve).toBe("$done");
  });

  test("quick's implement turns a red loop from reproduce into a failing test first", () => {
    expect(workflow("quick").steps.implement?.instructions).toContain("## Reproduce");
  });

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
 * B5, B8, B71: commands this release removed. A hit is `norn <old>` (or the plugin's `"$NORN" <old>`)
 * anywhere in a line: prose, comments, code spans, strings and scripts alike. Prose that names a thing
 * with an article ("a norn workflow", "the norn cockpit") is not a command and is left out first. Also
 * hit: `norn status <key>` (now `story view`) and the flags that changed what an old command did
 * (`cockpit --next`, `approve --reject`, …), with or without `norn`. The list is core's
 * REMOVED_COMMANDS, read as text (the root tests cannot import a workspace package).
 */
function removedCommands(source: string): string[] {
  const list = /export const REMOVED_COMMANDS = (\[[^\]\n]*\])/.exec(source)?.[1];
  const names: unknown = list === undefined ? [] : JSON.parse(list);
  // a lint with no names would pass on anything: fail loudly instead
  if (!Array.isArray(names) || names.length === 0) throw new Error("REMOVED_COMMANDS not found in packages/core/src/commands.ts: update the lint's reader");
  return names as string[];
}
const REMOVED_COMMANDS = removedCommands(readFileSync(join(PKGS, "core", "src", "commands.ts"), "utf8"));
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
  ["packages/schema/src/trace.ts", `title: "norn trace event (one JSONL line)",`, "the TraceEvent schema's title"],
];

const OLD_COMMAND_FILES = (): string[] => [
  ...GLOSSARY_FILES().filter((f) => !f.includes("/schema/json/")),
  ...textFiles(join(ROOT, ".agents", "skills"), DOCS),
  join(ROOT, ".agents", "PRD.md"),
  // the SPEC-*.md files the PRD cites for its rules (HC, CP, R, BS, QV, NT), and the limits README points at
  ...readdirSync(join(ROOT, ".agents")).filter((n) => /^SPEC-.*\.md$/.test(n)).map((n) => join(ROOT, ".agents", n)),
  join(ROOT, ".agents", "LIMITATIONS.md"),
  join(ROOT, "docs", "cookbook.html"),
];

describe("removed commands (B5, B8, B71)", () => {
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

  test("the list of removed commands is read from core, or the lint fails loudly", () => {
    expect(REMOVED_COMMANDS).toContain("unstick");
    expect(() => removedCommands("export const REMOVED_COMMANDS = [\n  \"drop\",\n] as const;")).toThrow("REMOVED_COMMANDS not found");
    expect(() => removedCommands("export const OLD = [];")).toThrow("REMOVED_COMMANDS not found");
  });

  test("no removed command in sources, assets, plugins, skills, README, CONTRIBUTING, AGENTS.md, the PRD and its SPEC files, the cookbook", () => {
    const hits: string[] = [];
    for (const f of OLD_COMMAND_FILES()) {
      const rel = relative(ROOT, f);
      readFileSync(f, "utf8")
        .split("\n")
        .forEach((line, i) => {
          if (OLD_COMMAND_ALLOW.some(([file, text]) => file === rel && line.trim() === text)) return;
          for (const old of oldCommandHits(line)) hits.push(`${rel}:${i + 1} → \`${old}\` was removed (B5): ${line.trim()}`);
        });
    }
    expect(hits).toEqual([]);
  });

  test("the PRD's command table (§15) is the noun tree", () => {
    const prd = readFileSync(join(ROOT, ".agents", "PRD.md"), "utf8");
    const s15 = prd.slice(prd.search(/^## 15\b/m), prd.search(/^## 16\b/m));
    for (const verb of ["create", "list", "view", "answer", "approve", "reject", "update-branch", "start", "chat", "edit", "checkout", "handoff", "close", "reopen"])
      expect(s15).toContain(`norn story ${verb}`);
    for (const verb of ["list", "view", "attach", "rerun", "cancel"]) expect(s15).toContain(`norn run ${verb}`);
    expect(s15).toContain("norn status");
    expect(prd).toContain("through `norn story edit <unit> --workflow <name> --at <step>`");
  });
});

/**
 * gh-110 B22 (D12): no product doc or shipped text sends anyone to the old `.agents/norn/` folder. Scanned:
 * README, the PRD, everything under packages/cli/assets, package sources (`norn help` and every message
 * are built there), and AGENTS.md's Layout and "Where the contracts live". Not scanned, until the
 * follow-up story migrates this repo: AGENTS.md's other sections, CONTRIBUTING.md and the
 * `.agents/skills/norn*` copies (this repo's own process text).
 */
const OLD_DIR = /\.agents\/(norn|\*)\//;

/** Lines allowed to name the old folder, by file and a substring of the line, with why. */
const OLD_DIR_ALLOW: Array<[file: string, text: string, why: string]> = [
  ["packages/store/src/paths.ts", "export const OLD_", "the old layout's places, only refused and moved from (gh-110 D4)"],
];

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
    ...[join(ROOT, "README.md"), join(ROOT, ".agents", "PRD.md"), ...textFiles(join(PKGS, "cli", "assets"), [...DOCS, ".txt"])].map(
      (f): [string, string] => [relative(ROOT, f), readFileSync(f, "utf8")],
    ),
    ...files(PKGS)
      .filter((p) => p.includes("/src/"))
      .map((f): [string, string] => [relative(ROOT, f), readFileSync(f, "utf8")]),
    ["AGENTS.md#Layout", section(agents, "Layout and dependency direction")],
    ["AGENTS.md#Where the contracts live", section(agents, "Where the contracts live")],
  ];
}

describe("the new layout in product docs (gh-110 B3, B22)", () => {
  test("matcher: the old folder and its parts are hits; the new config file and other .agents folders are not", () => {
    for (const hit of ["`.agents/norn/config.yaml`", "in .agents/norn/workflows/", ".agents/*/trace/x.jsonl", "(.agents/norn/)"]) expect(OLD_DIR.test(hit)).toBe(true);
    for (const miss of ["`.agents/norn.config.yaml`", ".agents/workflows/", ".agents/skills/norn/SKILL.md", ".agents/specs/gh-1-x/"]) expect(OLD_DIR.test(miss)).toBe(false);
  });

  test("AGENTS.md's sections are found, or the lint fails loudly", () => {
    expect(() => section("# x\n## A\nbody", "B")).toThrow("section not found: B");
    expect(section("# x\n## A\na\n## B\nb", "A")).toBe("\n## A\na");
  });

  test("README, the PRD, shipped assets, package sources and AGENTS.md's Layout and contracts name no `.agents/norn/`", () => {
    const hits: string[] = [];
    for (const [file, text] of productDocs()) {
      text.split("\n").forEach((line, i) => {
        if (!OLD_DIR.test(line) || OLD_DIR_ALLOW.some(([f, t]) => f === file && line.includes(t))) return;
        hits.push(`${file}:${i + 1}: ${line.trim()}`);
      });
    }
    expect(hits).toEqual([]);
  });

  test("README's Workflows are data and Config paragraphs name the new places", () => {
    const readme = readFileSync(join(ROOT, "README.md"), "utf8").split("\n");
    expect(readme.find((l) => l.startsWith("**Workflows are data.**"))).toContain("`.agents/workflows/`");
    expect(readme.find((l) => l.startsWith("**Config**"))).toContain("`.agents/norn.config.yaml`");
  });

  test("the PRD's §7 layout and ID2 describe the machine dir and its id", () => {
    const prd = readFileSync(join(ROOT, ".agents", "PRD.md"), "utf8");
    const s7 = prd.slice(prd.search(/^## 7\b/m), prd.search(/^## 8\b/m));
    expect(s7).toContain("norn.config.yaml");
    expect(s7).toContain("workflows/");
    expect(s7).toContain("repos/<id>/");
    const id2 = prd.split("\n").find((l) => l.startsWith("- ID2 ")) ?? "";
    expect(id2).toContain("repos/<id>/");
  });

  test("B3: the shipped norn skill puts only runs/ and the generated top of handoff.md off limits", () => {
    const skill = readFileSync(join(PKGS, "cli", "assets", "skills", "norn", "SKILL.md"), "utf8");
    const rules = section(skill, "Hard rules");
    const never = rules.split("\n").filter((l) => /\bnever edit\b/i.test(l));
    expect(never).toHaveLength(1);
    const offLimits = (never[0] as string).split(/\.\s/)[0] as string;
    expect([...offLimits.matchAll(CODE_SPAN)].map((m) => m[0])).toEqual(["`runs/`"]);
    expect(offLimits).toContain("the generated top of handoff.md");
    expect(rules).toContain("`.agents/workflows/`");
    expect(rules).toContain("`.agents/norn.config.yaml`");
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

/** Imports and calls, in cli/src, of store's raw `git` (as `rawGit` or `git`). Store no longer exports it (4.2): the allowlist is empty and stays so. */
function rawGitCalls(): Counts {
  const out: Counts = {};
  for (const f of SRC().filter((p) => p.startsWith("packages/cli/src/"))) {
    const text = readFileSync(join(ROOT, f), "utf8");
    for (const m of text.matchAll(/import\s*\{([^}]*)\}\s*from\s*["']@norn\/store["']/g)) {
      for (const spec of (m[1] as string).split(",").map((s) => s.trim())) {
        const named = /^git(?:\s+as\s+(\w+))?$/.exec(spec);
        if (!named) continue;
        const local = named[1] ?? "git";
        // an import with no call still counts once: it is the door the lint is closing
        out[f] = (out[f] ?? 0) + Math.max(1, [...text.matchAll(new RegExp(`(?<![\\w.])${local}\\s*\\(`, "g"))].length);
      }
    }
  }
  return out;
}

const FS_WRITE = /\b(?:writeFileSync|appendFileSync|renameSync|cpSync|copyFileSync|writeFile|appendFile|copyFile)\s*\(|\bBun\.write\s*\(/g;

/** (a) S1: every file norn writes goes through store (atomic temp → fsync → rename). */
const FS_WRITE_ALLOW: Counts = {
  "packages/cli/src/runtime/assets.ts": 2,
};

/** (b) raw git from store in cli: commands and runtime go through GitPort (4.1, 4.2). */
const RAW_GIT_ALLOW: Counts = {};

/**
 * (c) S2: every JSON read is validated against @norn/schema, through store. Each entry says what it
 * parses: a norn file read unvalidated (the 1.4 target), tool output (stdout of herdr/gh/glab/a hook),
 * a file another tool owns, or a clone (stringify round-trip, not a read).
 */
const JSON_PARSE_ALLOW: Record<string, [number, string]> = {
  "packages/adapters/src/agent-hooks/index.ts": [3, "files claude owns: settings.json, transcript jsonl"],
  "packages/adapters/src/exec.ts": [1, "tool output: gh/glab --json stdout"],
  "packages/adapters/src/herdr/call.ts": [2, "tool output: herdr stdout and error stderr"],
  // added by main 0.9.x (orient workspace order): one reply line from herdr's socket API
  "packages/adapters/src/herdr/cockpit.ts": [1, "tool output: herdr socket API reply line"],
  "packages/cli/src/commands/done.ts": [2, "agent-written findings / criteria files (validated after)"],
  "packages/cli/src/commands/hook.ts": [2, "tool output: hook payload on stdin, hook command stdout"],
  "packages/cli/src/commands/run-view.ts": [1, "clone: canonical JSON for the replay diff"],
  "packages/cli/src/runtime/detect.ts": [1, "file another tool owns: the repo's package.json"],
  "packages/cli/src/runtime/human.ts": [1, "norn file: state.json from git show"],
  "packages/cli/src/runtime/tick.ts": [1, "clone: trace-safe copy of facts"],
};

/** (d) processes are spawned by store and adapters only (ports perform effects). */
const SPAWN_ALLOW: Counts = {
  "packages/cli/src/commands/brief.ts": 1,
  "packages/cli/src/commands/doctor.ts": 1,
  "packages/cli/src/runtime/detect.ts": 1,
  "packages/cli/src/runtime/strays.ts": 1,
};

/**
 * (g) B1, B2, B5: norn's paths under a repo are spelled only by store's path module (paths.ts), so a
 * layout change is a change there. Counts lines of package sources and tests (root test/support and test/e2e too) that spell `.agents/norn`
 * (or join `".agents", "norn"`) outside a comment; messages name paths through its `REPO_CONFIG_FILE` and
 * `WORKFLOWS_DIR` (gh-110 D11). Allowed: tests asserting text a person sees.
 */
const NORN_PATH = /\.agents\/norn\b|["'`]\.agents["'`]\s*,\s*["'`]norn["'`]/;
const NORN_PATH_ALLOW: Record<string, [number, string]> = {
  "packages/store/src/paths.ts": [5, "the path module, and the old layout's places (gh-110 D4)"],
  "test/support/harness.ts": [1, "the old layout's places as a person had them, spelled independently of store (gh-110 S1)"],
  "packages/cli/test/integration/migrate.test.ts": [6, "the old paths as a person had them and as `git status` and the report show them (gh-110 S1)"],
  "packages/cli/test/integration/config.test.ts": [1, "message: the user-or-repo pick"],
  "test/e2e/slice-workflow.test.ts": [1, "message: init's config row"],
  "packages/cli/test/integration/layout.test.ts": [1, "the layout test: the repo config file as a person sees it"],
  "packages/core/test/unit/printed-commands.test.ts": [1, "not a path read: a string the removed-command matcher must pass"],
};

function nornPathLines(): Counts {
  const out: Counts = {};
  const all = [...files(PKGS), ...files(join(ROOT, "test", "support")), ...files(join(ROOT, "test", "e2e"))]
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

/** Action kinds: the `kind` literals of actions.ts; emitted ones appear as `kind: "…"` in decide. */
function literalKinds(text: string): Set<string> {
  return new Set([...text.matchAll(/\bkind:\s*"([a-z_]+)"/g)].map((m) => m[1] as string));
}

/** `case "…":` labels inside every `switch (a.kind) { … }` of a file (brace-matched). */
function switchedKinds(text: string): Set<string> {
  const out = new Set<string>();
  for (const m of text.matchAll(/switch\s*\(\s*a\.kind\s*\)\s*\{/g)) {
    let depth = 1;
    let i = (m.index ?? 0) + m[0].length;
    const start = i;
    for (; i < text.length && depth > 0; i++) depth += text[i] === "{" ? 1 : text[i] === "}" ? -1 : 0;
    for (const c of text.slice(start, i).matchAll(/case\s+"([a-z_]+)"\s*:/g)) out.add(c[1] as string);
  }
  return out;
}

/** decide's sources: every file of packages/core/src/decide/. */
function decideText(): string {
  return files(join(PKGS, "core", "src", "decide"))
    .map((p) => readFileSync(p, "utf8"))
    .join("\n");
}

/** act sources: act.ts before 6.3, an act/ folder after. */
function actText(): string {
  const runtime = join(PKGS, "cli", "src", "runtime");
  const dir = join(runtime, "act");
  const parts = existsSync(dir) ? files(dir) : [];
  if (existsSync(join(runtime, "act.ts"))) parts.push(join(runtime, "act.ts"));
  return parts.map((p) => readFileSync(p, "utf8")).join("\n");
}

/** (f) kinds act handles that decide never emits: dead branches, kept only until their removal item. */
const ACT_ONLY_KINDS: string[] = [];

describe("ratchet lints", () => {
  test("matcher: a new hit and a stale allowlist entry both fail", () => {
    expect(ratchet({ a: 1 }, { a: 1 })).toEqual([]);
    expect(ratchet({ a: 2, b: 1 }, { a: 1 })).toHaveLength(2);
    expect(ratchet({}, { a: 1 })).toEqual(["a: 0 hits, allowlist 1 → lower the allowlist to 0"]);
    expect(switchedKinds('switch (a.kind) { case "x": { if (y) {} } case "y": } case "z":')).toEqual(new Set(["x", "y"]));
  });

  test("(a) S1: fs writes only in packages/store/src", () => {
    expect(ratchet(countHits(FS_WRITE, (f) => !f.startsWith("packages/store/src/")), FS_WRITE_ALLOW)).toEqual([]);
  });

  test("(b) cli does not call store's raw git", () => {
    expect(ratchet(rawGitCalls(), RAW_GIT_ALLOW)).toEqual([]);
  });

  test("(c) S2: JSON.parse only in store and schema", () => {
    const allow = Object.fromEntries(Object.entries(JSON_PARSE_ALLOW).map(([f, [n]]) => [f, n]));
    expect(ratchet(countHits(/\bJSON\.parse\s*\(/g, (f) => !/^packages\/(store|schema)\/src\//.test(f)), allow)).toEqual([]);
  });

  test("(d) Bun.spawn only in store and adapters", () => {
    expect(ratchet(countHits(/\bBun\.spawn(?:Sync)?\s*\(/g, (f) => !/^packages\/(store|adapters)\/src\//.test(f)), SPAWN_ALLOW)).toEqual([]);
  });

  test("(e) core is pure: no node:fs, Bun.spawn, Date.now, Math.random", () => {
    expect(countHits(/node:fs|\bBun\.spawn|\bDate\.now\b|\bMath\.random\b/g, (f) => f.startsWith("packages/core/src/"))).toEqual({});
  });

  test("(g) B1, B2, B5: `.agents/norn` paths are spelled only in store's path module", () => {
    const allow = Object.fromEntries(Object.entries(NORN_PATH_ALLOW).map(([f, [n]]) => [f, n]));
    expect(ratchet(nornPathLines(), allow)).toEqual([]);
  });

  test("(f) act handles exactly the action kinds decide emits", () => {
    const kinds = literalKinds(readFileSync(join(PKGS, "core", "src", "actions.ts"), "utf8"));
    const emitted = [...literalKinds(decideText())].filter((k) => kinds.has(k));
    const handled = [...switchedKinds(actText())];
    expect({
      unhandled: emitted.filter((k) => !handled.includes(k)).sort(),
      notAnAction: handled.filter((k) => !kinds.has(k)).sort(),
      neverEmitted: handled.filter((k) => kinds.has(k) && !emitted.includes(k)).sort(),
    }).toEqual({ unhandled: [], notAnAction: [], neverEmitted: [...ACT_ONLY_KINDS].sort() });
  });
});
