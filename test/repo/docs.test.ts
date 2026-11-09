/**
 * The docs lint. Each check is a pure matcher over a line or a file's text, tested on strings
 * first, then swept over the real doc set expecting no hits; each hit names file, line and the fix.
 */
import { describe, expect, test } from "bun:test";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { SLICE_NN_PATTERN } from "@norn/schema";
import { allDocs, CODE_SPAN, textFiles, URL, userDocs } from "../support/docs.ts";

const ROOT = join(import.meta.dir, "..", "..");
const rel = (f: string) => relative(ROOT, f);
const read = (f: string) => readFileSync(f, "utf8");

// ---------------------------------------------------------------------------------------------- rules

describe("no rules file", () => {
  test("there is no rules file, PRD or SPEC file, and no tracked text outside CHANGELOG and story specs names one", () => {
    const names = [".agents/RULES.md", "RULES.md"];
    expect(names.filter((n) => existsSync(join(ROOT, n)))).toEqual([]);
    expect(readdirSync(join(ROOT, ".agents")).filter((n) => n === ["PRD", "md"].join(".") || /^SPEC-.*\.md$/.test(n))).toEqual([]);
    const OLD = new RegExp(["\\bPRD\\b", "SPEC-[a-z]", ["RULES", "md"].join("\\.")].join("|"));
    const skip = (f: string) => rel(f) === "CHANGELOG.md" || rel(f).startsWith(".agents/specs/") || f === import.meta.path;
    const hits = textFiles(ROOT, [".md", ".ts", ".yaml", ".yml", ".json", ".toml", ".sh", ".html"])
      .filter((f) => !skip(f))
      .flatMap((f) => read(f).split("\n").flatMap((l, i) => (OLD.test(l) ? [`${rel(f)}:${i + 1}: ${l.trim()}`] : [])));
    expect(hits).toEqual([]);
  });
});

// ------------------------------------------------------------------------------------------- handoff

/** A unit's handoff, `<spec folder>/handoffs/_story.md` or `handoffs/<nn>-<slug>.md`. */
/** The slice number part of a slice handoff's name, from the schema's own pattern (`^[0-9]{2,3}$` today). */
const SLICE_NN = SLICE_NN_PATTERN.replace(/^\^|\$$/g, "");
const UNIT_HANDOFF = new RegExp(`^\\.agents/specs/[^/]+/handoffs/(?:_story|${SLICE_NN}-[a-z0-9]+(?:-[a-z0-9]+)*)\\.md$`);
/** An older norn's handoff, `runs/<unit>/handoff.md` in a spec folder: moved to `handoffs/` at the unit's next boundary. */
const OLD_HANDOFF = /^\.agents\/specs\/[^/]+\/(?:.*\/)?runs\//;

/** A handoff tracked anywhere but a spec folder's `handoffs/` (or an older norn's `runs/`). */
function strayHandoff(relPath: string): boolean {
  const parts = relPath.split("/");
  if (parts.at(-2) === "handoffs") return !UNIT_HANDOFF.test(relPath);
  return parts.at(-1) === "handoff.md" && !OLD_HANDOFF.test(relPath);
}

describe("no stray handoff (B34)", () => {
  test("matcher", () => {
    expect(strayHandoff("handoff.md")).toBe(true);
    expect(strayHandoff("docs/handoff.md")).toBe(true);
    expect(strayHandoff(".agents/specs/gh-1-x/handoffs/_story.md")).toBe(false);
    expect(strayHandoff(".agents/specs/gh-1-x/handoffs/01-a.md")).toBe(false);
    expect(strayHandoff(".agents/specs/gh-1-x/handoffs/handoff.md")).toBe(true);
    expect(strayHandoff(".agents/specs/gh-1-x/handoffs/1234-a.md")).toBe(true);
    expect(strayHandoff(".agents/specs/gh-1-x/handoffs/01-.md")).toBe(true);
    expect(strayHandoff(".agents/specs/gh-1-x/handoffs/01-Foo Bar.md")).toBe(true);
    expect(strayHandoff(".agents/specs/gh-1-x/handoffs/01-a-.md")).toBe(true);
    expect(strayHandoff(".agents/specs/gh-1-x/handoffs/01--a.md")).toBe(true);
    expect(strayHandoff(".agents/specs/gh-1-x/handoffs/01-a--b.md")).toBe(true);
    expect(strayHandoff(".agents/specs/gh-1-x/handoffs/101-a-b2.md")).toBe(false);
    expect(strayHandoff("docs/handoffs/_story.md")).toBe(true);
    expect(strayHandoff(".agents/specs/gh-1-x/handoff.md")).toBe(true);
    expect(strayHandoff(".agents/specs/gh-1-x/runs/_story/handoff.md")).toBe(false);
    expect(strayHandoff(".agents/specs/gh-1-x/runs/01-a/handoff.md")).toBe(false);
    expect(strayHandoff("packages/core/src/handoff.ts")).toBe(false);
  });

  test("no handoff in the repo outside a spec folder's handoffs/ (or an older norn's runs/)", () => {
    expect(textFiles(ROOT, [".md"]).map(rel).filter(strayHandoff).map((f) => `${f}: a handoff is tracked outside a spec folder's handoffs/; delete it`)).toEqual([]);
  });
});

// ------------------------------------------------------------------------------------------- versions

const VERSION = /\bv?\d+\.\d+\.\d+\b|\bas of (?:release\b|v?\d+\.\d+\b)/i;

/** A norn version named in a doc line; the README's release badge is the one allowed. */
function versionHit(line: string): boolean {
  if (line.includes("badge/release-v")) return false;
  return VERSION.test(line.replace(URL, " "));
}

describe("no version in the docs (B38)", () => {
  test("matcher", () => {
    expect(versionHit("Where norn breaks, as of 0.17.0")).toBe(true);
    expect(versionHit("tagged v1.2.3")).toBe(true);
    expect(versionHit("as of release")).toBe(true);
    expect(versionHit("as of 0.17")).toBe(true);
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

/** The relative links of one line: `[text](target)`, skipping URLs with a scheme and code spans. */
function relativeLinks(line: string): string[] {
  const prose = line.replace(CODE_SPAN, " ");
  return [...prose.matchAll(/\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g)].map((m) => m[1] as string).filter((t) => !/^[a-z][a-z0-9+.-]*:/i.test(t));
}

/** What is wrong with one link from `from`, or undefined. */
function linkProblem(from: string, target: string, readText: (path: string) => string | undefined): string | undefined {
  const [path, anchor] = target.split("#") as [string, string | undefined];
  const file = path === "" ? from : resolve(dirname(from), decodeURIComponent(path));
  const text = readText(file);
  if (text === undefined) return `${path} does not exist`;
  if (anchor !== undefined && file.endsWith(".md") && !anchors(text).has(anchor)) return `${path || "this file"} has no heading #${anchor}`;
  return undefined;
}

/** Every markdown file but dependencies, story specs and CHANGELOG. */
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
/** The generated block's markers: copies of REFERENCE_START/END in packages/cli/src/reference.ts (root tests cannot import the cli); the marker test below fails if they drift. */
const GEN_START = "<!-- norn:reference:start";
const GEN_END = "<!-- norn:reference:end -->";

/** The commands and their flags, read from Reference's generated block (itself kept equal to the cli). */
function commandTable(reference: string): Map<string, Set<string>> {
  const table = new Map<string, Set<string>>();
  let current: Set<string> | undefined;
  for (const line of reference.split("\n")) {
    // a heading above command level ends the last command: a flag bullet under it is not that command's
    if (/^#{1,4} /.test(line)) current = undefined;
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

/** The flags norn takes with no command (cli.ts). */
const GLOBAL_FLAGS = new Set(["version", "help", "json"]);

/** The problems of the `norn …` commands in one piece of code (an inline span or a code line). */
function commandHits(code: string, table: Map<string, Set<string>>): string[] {
  const hits: string[] = [];
  // each `norn` starts its own mention: a second one on the line is checked on its own
  for (const m of code.matchAll(/(?:^|[\s($"'])norn((?:\s+(?!norn\b)[^\s|;&]+)*)/g)) {
    const words = (m[1] as string).trim().split(/\s+/).filter(Boolean);
    if (words.length === 0) continue;
    // `--label norn`: a flag's value, not a command
    if (/(?:^|\s)-[\w-]+$/.test(code.slice(0, m.index + 1).trimEnd())) continue;
    const top = /^--([\w-]+)/.exec(words[0] as string)?.[1];
    if (top) {
      if (!GLOBAL_FLAGS.has(top)) hits.push(`norn --${top} is not a flag of norn`);
      continue;
    }
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
    expect(commandHits("norn status then norn pane", t)).toEqual(["norn pane is not a command"]);
    expect(commandHits("norn --version", t)).toEqual([]);
    expect(commandHits("norn --bogus", t)).toEqual(["norn --bogus is not a flag of norn"]);
    expect(commandHits("gh issue create --label norn --assignee @me", t)).toEqual([]);
    expect([...(commandTable("##### `norn status`\n- `--watch`\n#### Other\n- `--stray`").get("status") ?? [])]).not.toContain("stray");
    expect(codeOf("run `norn status`\n```sh\nnorn status --watch   # live\n```")).toEqual([[1, "norn status"], [3, "norn status --watch"]]);
  });

  test("Reference holds each generated-block marker exactly once", () => {
    const text = read(REFERENCE);
    for (const marker of [GEN_START, GEN_END]) expect(text.split(marker).length - 1, marker).toBe(1);
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

  // The bundled skills print commands an agent runs as written
  test("every norn command and flag in the bundled skills exists", () => {
    const dir = join(ROOT, "packages/cli/assets/skills");
    const files = readdirSync(dir).flatMap((s) => readdirSync(join(dir, s)).filter((f) => f.endsWith(".md")).map((f) => join(dir, s, f)));
    const mentions = files.flatMap((f) => codeOf(read(f)).map(([n, code]) => [f, n, code] as const));
    const hits = mentions.flatMap(([f, n, code]) => commandHits(code, table).map((h) => `${rel(f)}:${n} → ${h}: ${code.trim()}`));
    expect(hits).toEqual([]);
    expect(mentions.length).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------------------- limitations

describe("limitations: the hooks entry", () => {
  test("says the hooks are a reminder, not a sandbox, and names what they miss as still forbidden by the brief", () => {
    const entry = read(join(ROOT, "docs", "limitations.md"))
      .split("\n")
      .find((l) => l.includes("The hooks are a reminder, not a sandbox"));
    expect(entry).toBeDefined();
    const text = entry as string;
    expect(text).toContain("no security boundary");
    expect(text).toContain("still forbidden by the brief");
    expect(text).toContain("shell writes under norn's run state");
    expect(text).toContain("remote writes not on its list");
    expect(text).toMatch(/every norn command but `brief`, `done`, `ask` and `stuck`/);
  });
});
