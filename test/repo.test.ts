/** Repo-wide rules: dependency direction (§17) and banned glossary synonyms (§5). */
import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const ROOT = join(import.meta.dir, "..");
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
  ...textFiles(join(ROOT, "plugins"), DOCS),
  ...textFiles(join(PKGS, "schema", "json"), DOCS),
  join(ROOT, "README.md"),
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

  test("every adapter has its tests in packages/adapters/test/<adapter>/", () => {
    const adapters = readdirSync(join(PKGS, "adapters", "src"), { withFileTypes: true })
      .filter((d) => d.isDirectory())
      .map((d) => d.name);
    const missing = adapters.filter((a) => {
      try {
        return !readdirSync(join(PKGS, "adapters", "test", a)).some((f) => f.endsWith(".test.ts"));
      } catch {
        return true;
      }
    });
    expect(missing).toEqual([]);
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
