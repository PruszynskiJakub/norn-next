/**
 * gh-162: the docs lint. Each check is a pure matcher over a line or a file's text, tested on strings
 * first, then swept over the real doc set expecting no hits; each hit names file, line and the fix.
 */
import { describe, expect, test } from "bun:test";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { allDocs, CODE_SPAN, RULES_FILE, textFiles, URL, userDocs } from "../support/docs.ts";

const ROOT = join(import.meta.dir, "..", "..");
const rel = (f: string) => relative(ROOT, f);
const read = (f: string) => readFileSync(f, "utf8");

// ---------------------------------------------------------------------------------------------- rules

/** A rule is defined by a list line starting with its id (`- S5 …`, `  - BS10.1 …`, `- **X1** …`). */
function definedIds(text: string): string[] {
  return [...text.matchAll(/^\s*-\s+\**([A-Z]{1,3}\d+(?:\.\d+)?[a-z]?)\b/gm)].map((m) => m[1] as string);
}

/** B24 (D8): every rule id the PRD and the four SPEC files defined when gh-162 folded them. */
const PINNED_IDS = "G1 G2 G3 G4 G5 G6 P1 P2 P3 P4 P5 P6 P7 P8 ID1 ID2 MO1 MO2 MO3 MO5 MO4 LY1 LY2 LY3 S1 S2 S3 S4 S5 S6 S7 S8 S9 S10 H1 H2 H3 H4 H5 H6 H7 H8 H9 H10 H11 A1 A2 A3 A4 A5 A6 A7 B1 B2 B3 B4 B5 B6 B7 B8 B9 C1 C2 C3 C4 C5 QV1 QV2 QV3 QV4 QV5 QV5a QV6 QV7 QV8 NT1 NT2 NT3 NT4 NT5 NT6 W1 W2 W3 W4 W5 W6 W7 W8 W9 RD1 RD2 RD3 RD4 RD5 RD6 RD7 RD8 GR1 GR2 GR3 GR4 GR5 GR6 GR6b GR7 GR7a GR6a GR8 GR9 BS0 BS1 BS2 BS3 BS4 BS5 BS6 BS7 BS8 BS9 BS10 T1 T2 T3 T4 T5 T6 T6a T7 T7a T7b T7c T8 T9 T10 K1 K2 K2a K3 K4 K4.1 K5 K6 K7 O1 O2 O3 O4 O5 O6 O7 SK1 SK2 X1 X2 X3 X4 R1.1 R1.2 R1.3 R2.1 R2.2 R2.3 R3.1 R3.2 R3.3 R3.4 R4.1 R4.2 R4.3 R4.4 R5.1 R5.2 R5.3 R5.4 R5.5 R6.1 R6.2 R6.3 R7.1 R7.2 R7.3 R8.1 R8.2 R9.1 R10.1 BS3.3a BS5.1 BS5.2 BS10.1 BS10.2 BS11 CP1 CP2 CP3 CP4 CP5 CP6 CP7 CP8 CP9 CP10 CP11 CP13 CP12 OR1 OR2 OR3 OR4 SG1 SG2 SG3 HC1 HC2 HC3 HC4 HC5 HC6 HC7 HC8 HC9 HC10 HC11 HC12 HC13 HC14 HC15 HC16".split(" ");

describe("rules file (B23, B24, B27, B31)", () => {
  test("matcher: ids at the start of a list line, nested or bold", () => {
    expect(definedIds("- S5 state last\n  - BS10.1 nested\n- **X1** bold\ntext R5.1 is cited, not defined")).toEqual(["S5", "BS10.1", "X1"]);
  });

  test("the rules file exists; the PRD and SPEC files do not", () => {
    expect(existsSync(join(ROOT, RULES_FILE))).toBe(true);
    const old = readdirSync(join(ROOT, ".agents")).filter((n) => n === ["PRD", "md"].join(".") || /^SPEC-.*\.md$/.test(n));
    expect(old).toEqual([]);
  });

  test("every pinned rule id is defined exactly once in the rules file", () => {
    const ids = definedIds(read(join(ROOT, RULES_FILE)));
    const count = (id: string) => ids.filter((i) => i === id).length;
    expect(PINNED_IDS.filter((id) => count(id) !== 1).map((id) => `${id} is defined ${count(id)} times in ${RULES_FILE}`)).toEqual([]);
  });

  test("no file names the old PRD or a SPEC file, outside CHANGELOG and story specs", () => {
    const OLD = new RegExp(["\\bPRD\\b", "SPEC-[a-z]"].join("|"));
    const skip = (f: string) => rel(f) === "CHANGELOG.md" || rel(f).startsWith(".agents/specs/") || f === import.meta.path;
    const hits = textFiles(ROOT, [".md", ".ts", ".yaml", ".yml", ".json", ".toml", ".sh", ".html"])
      .filter((f) => !skip(f))
      .flatMap((f) => read(f).split("\n").flatMap((l, i) => (OLD.test(l) ? [`${rel(f)}:${i + 1} → name ${RULES_FILE} instead: ${l.trim()}`] : [])));
    expect(hits).toEqual([]);
  });
});

// ------------------------------------------------------------------------------------------- handoff

/** B34 (D7): a handoff.md outside a story spec's runs/ folder. */
function strayHandoff(relPath: string): boolean {
  return relPath.split("/").at(-1) === "handoff.md" && !/^\.agents\/specs\/[^/]+\/(?:.*\/)?runs\//.test(relPath);
}

describe("no stray handoff (B34)", () => {
  test("matcher", () => {
    expect(strayHandoff("handoff.md")).toBe(true);
    expect(strayHandoff("docs/handoff.md")).toBe(true);
    expect(strayHandoff(".agents/specs/gh-1-x/runs/_story/handoff.md")).toBe(false);
    expect(strayHandoff(".agents/specs/gh-1-x/runs/01-a/handoff.md")).toBe(false);
    expect(strayHandoff("packages/core/src/handoff.ts")).toBe(false);
  });

  test("no handoff.md in the repo outside a unit's runs/", () => {
    expect(textFiles(ROOT, [".md"]).map(rel).filter(strayHandoff).map((f) => `${f}: a handoff is tracked outside runs/; delete it`)).toEqual([]);
  });
});

// ------------------------------------------------------------------------------------------- versions

const VERSION = /\bv?\d+\.\d+\.\d+\b|\bas of release\b/i;

/** B38 (D6): a norn version named in a doc line; the README's release badge is the one allowed. */
function versionHit(line: string): boolean {
  if (line.includes("badge/release-v")) return false;
  return VERSION.test(line.replace(URL, " "));
}

describe("no version in the docs (B38)", () => {
  test("matcher", () => {
    expect(versionHit("Where norn breaks, as of 0.17.0")).toBe(true);
    expect(versionHit("tagged v1.2.3")).toBe(true);
    expect(versionHit("as of release")).toBe(true);
    expect(versionHit("[![release](https://img.shields.io/badge/release-v0.17.0-blue)](x)")).toBe(false);
    expect(versionHit("needs git ≥ 2.38 and Herdr ≥ 0.9")).toBe(false);
  });

  test("no doc but the README badge and CHANGELOG names a version", () => {
    const hits = allDocs(ROOT).flatMap((f) => read(f).split("\n").flatMap((l, i) => (versionHit(l) ? [`${rel(f)}:${i + 1} → drop the version: ${l.trim()}`] : [])));
    expect(hits).toEqual([]);
  });
});

// ---------------------------------------------------------------------------------------------- links

/** GitHub's heading anchor: lowercase, punctuation dropped, spaces to hyphens. */
function slug(heading: string): string {
  return heading
    .trim()
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s_-]/gu, "")
    .replace(/\s/g, "-");
}

/** Every anchor a markdown text offers, repeated headings numbered as GitHub does. */
function anchors(text: string): Set<string> {
  const seen = new Map<string, number>();
  const out = new Set<string>();
  let fence = false;
  for (const line of text.split("\n")) {
    if (/^\s*```/.test(line)) fence = !fence;
    const m = fence ? null : /^#{1,6}\s+(.+?)\s*#*\s*$/.exec(line);
    if (!m) continue;
    const base = slug(m[1] as string);
    const n = seen.get(base) ?? 0;
    seen.set(base, n + 1);
    out.add(n === 0 ? base : `${base}-${n}`);
  }
  return out;
}

/** The relative links of one line: `[text](target)`, skipping URLs with a scheme (B37) and code spans. */
function relativeLinks(line: string): string[] {
  const prose = line.replace(CODE_SPAN, " ");
  return [...prose.matchAll(/\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g)].map((m) => m[1] as string).filter((t) => !/^[a-z][a-z0-9+.-]*:/i.test(t));
}

/** B36: what is wrong with one link from `from`, or undefined. */
function linkProblem(from: string, target: string, readText: (path: string) => string | undefined): string | undefined {
  const [path, anchor] = target.split("#") as [string, string | undefined];
  const file = path === "" ? from : resolve(dirname(from), decodeURIComponent(path));
  const text = readText(file);
  if (text === undefined) return `${path} does not exist`;
  if (anchor !== undefined && file.endsWith(".md") && !anchors(text).has(anchor)) return `${path || "this file"} has no heading #${anchor}`;
  return undefined;
}

/** D5: every markdown file but dependencies, story specs and CHANGELOG. */
function linkedDocs(): string[] {
  return textFiles(ROOT, [".md"]).filter((f) => !rel(f).startsWith(".agents/specs/") && rel(f) !== "CHANGELOG.md");
}

describe("links resolve (B36, B37)", () => {
  test("matcher: slugs, repeated headings, relative links only", () => {
    expect(slug("Config keys")).toBe("config-keys");
    expect(slug("`norn story edit` (noun)")).toBe("norn-story-edit-noun");
    expect(slug("Concepts › Glossary")).toBe("concepts--glossary");
    expect([...anchors("# A\n## B\n## B\n```\n# not\n```")]).toEqual(["a", "b", "b-1"]);
    expect(relativeLinks("see [Reference](docs/reference.md#config-keys) and [gh](https://github.com/x) and `[x](y)`")).toEqual(["docs/reference.md#config-keys"]);
    expect(relativeLinks("[mail](mailto:a@b.c)")).toEqual([]);
  });

  test("linkProblem: a missing file, a missing anchor, a good link", () => {
    const files: Record<string, string> = { "/r/docs/reference.md": "# Reference\n## Config keys\n" };
    const readText = (p: string) => files[p] ?? (p === "/r/docs" ? "" : undefined);
    expect(linkProblem("/r/README.md", "docs/reference.md#config-keys", readText)).toBeUndefined();
    expect(linkProblem("/r/README.md", "docs/reference.md#config", readText)).toBe("docs/reference.md has no heading #config");
    expect(linkProblem("/r/README.md", "docs/gone.md", readText)).toBe("docs/gone.md does not exist");
  });

  test("every relative link in the repo's markdown resolves", () => {
    const readText = (p: string) => (existsSync(p) ? (statSync(p).isDirectory() ? "" : read(p)) : undefined);
    let checked = 0;
    const hits = linkedDocs().flatMap((f) => {
      let fence = false;
      return read(f)
        .split("\n")
        .flatMap((l, i) => {
          if (/^\s*```/.test(l)) fence = !fence;
          if (fence) return [];
          return relativeLinks(l).flatMap((t) => {
            checked++;
            const problem = linkProblem(f, t, readText);
            return problem ? [`${rel(f)}:${i + 1} → ${problem}`] : [];
          });
        });
    });
    expect(hits).toEqual([]);
    expect(checked).toBeGreaterThan(0);
  });
});

// ------------------------------------------------------------------------------------------- commands

const REFERENCE = join(ROOT, "docs", "reference.md");
/** The generated block's markers: copies of REFERENCE_START/END in packages/cli/src/reference.ts (root tests cannot import the cli); the table test below fails if they drift. */
const GEN_START = "<!-- norn:reference:start";
const GEN_END = "<!-- norn:reference:end -->";

/** The commands and their flags, read from Reference's generated block (itself kept equal to the cli). */
function commandTable(reference: string): Map<string, Set<string>> {
  const table = new Map<string, Set<string>>();
  let current: Set<string> | undefined;
  for (const line of reference.split("\n")) {
    const h = /^#{5} `norn ([a-z -]+)`/.exec(line);
    if (h) {
      current = new Set(["json", "help"]);
      table.set(h[1] as string, current);
      continue;
    }
    const o = /^- `([^`]+)`/.exec(line);
    if (o && current) for (const m of (o[1] as string).matchAll(/--([\w-]+)/g)) current.add(m[1] as string);
  }
  return table;
}

/** B35 (D4): the problems of the `norn …` commands in one piece of code (an inline span or a code line). */
function commandHits(code: string, table: Map<string, Set<string>>): string[] {
  const hits: string[] = [];
  for (const m of code.matchAll(/(?:^|[\s($"'])norn((?:\s+[^\s|;&]+)*)/g)) {
    const words = (m[1] as string).trim().split(/\s+/).filter(Boolean);
    if (words.length === 0) continue;
    const plain = words.filter((w) => /^[a-z][a-z-]*$/.test(w));
    let name: string | undefined;
    for (let n = Math.min(2, plain.length); n >= 1; n--) {
      const candidate = words.slice(0, n).join(" ");
      if (table.has(candidate)) {
        name = candidate;
        break;
      }
    }
    if (!name) {
      if (/^[a-z][a-z-]*$/.test(words[0] as string)) hits.push(`norn ${words[0]} is not a command`);
      continue;
    }
    const verb = words[1];
    if (!name.includes(" ") && verb && /^[a-z][a-z-]*$/.test(verb) && [...table.keys()].some((k) => k.startsWith(`${name} `))) {
      hits.push(`norn ${name} ${verb} is not a command`);
      continue;
    }
    const flags = table.get(name) as Set<string>;
    for (const w of words) {
      const f = /^--([\w-]+)/.exec(w)?.[1];
      if (f && !flags.has(f)) hits.push(`--${f} is not a flag of norn ${name}`);
    }
  }
  return hits;
}

/** The code of a doc: inline spans of prose lines and whole lines of fenced blocks, with line numbers; Reference's generated block left out. */
function codeOf(text: string): Array<[line: number, code: string]> {
  const out: Array<[number, string]> = [];
  let fence = false;
  let generated = false;
  text.split("\n").forEach((l, i) => {
    if (l.startsWith(GEN_START)) generated = true;
    if (l.startsWith(GEN_END)) generated = false;
    if (generated) return;
    if (/^\s*```/.test(l)) {
      fence = !fence;
      return;
    }
    if (fence) out.push([i + 1, l.replace(/\s+#\s.*$/, "")]);
    else for (const m of l.matchAll(CODE_SPAN)) out.push([i + 1, m[0].slice(1, -1)]);
  });
  return out;
}

describe("commands and flags the docs name exist (B35)", () => {
  const table = commandTable(read(REFERENCE));

  test("matcher", () => {
    const t = new Map([
      ["story approve", new Set(["json", "help", "reason"])],
      ["story", new Set(["json", "help"])],
      ["status", new Set(["json", "help", "watch"])],
    ]);
    expect(commandHits("norn story approve gh-1 --force", t)).toEqual(["--force is not a flag of norn story approve"]);
    expect(commandHits("norn status --watch --json", t)).toEqual([]);
    expect(commandHits("norn story approve <unit>", t)).toEqual([]);
    expect(commandHits("norn pane --open", t)).toEqual(["norn pane is not a command"]);
    expect(commandHits("norn story bogus gh-1", t)).toEqual(["norn story bogus is not a command"]);
    expect(commandHits("cd norn-next && bun install", t)).toEqual([]);
    expect(commandHits("$NORN_BIN", t)).toEqual([]);
    expect(codeOf("run `norn status`\n```sh\nnorn status --watch   # live\n```")).toEqual([[1, "norn status"], [3, "norn status --watch"]]);
  });

  test("the table read from Reference has the noun verbs and their flags", () => {
    expect(table.get("story edit")?.has("workflow")).toBe(true);
    expect(table.get("status")?.has("watch")).toBe(true);
  });

  test("every norn command and flag in the user docs exists", () => {
    const mentions = userDocs(ROOT).flatMap((f) => codeOf(read(f)).map(([n, code]) => [f, n, code] as const));
    const hits = mentions.flatMap(([f, n, code]) => commandHits(code, table).map((h) => `${rel(f)}:${n} → ${h}: ${code.trim()}`));
    expect(hits).toEqual([]);
    expect(mentions.length).toBeGreaterThan(0);
  });
});
