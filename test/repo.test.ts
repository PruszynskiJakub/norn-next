/** Repo-wide rules: dependency direction (§17) and banned glossary synonyms (§5). */
import { describe, expect, test } from "bun:test";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
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
  ...textFiles(join(ROOT, "plugins"), [...DOCS, ".toml", ".sh"]),
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

describe("herdr plugin (HC9)", () => {
  test("the manifest parses, has the cockpit pane and the open/next actions, and names only scripts that exist", () => {
    const dir = join(ROOT, "plugins", "herdr");
    const m = Bun.TOML.parse(readFileSync(join(dir, "herdr-plugin.toml"), "utf8")) as {
      id: string;
      panes: Array<{ id: string; command: string[] }>;
      actions: Array<{ id: string; command: string[] }>;
    };
    expect(m.id).toBe("norn");
    expect(m.panes.map((p) => p.id)).toEqual(["cockpit"]);
    expect(m.actions.map((a) => a.id)).toEqual(["open", "next"]);
    const scripts = [...m.panes, ...m.actions].map((e) => e.command.at(-1) as string);
    expect(scripts.filter((s) => !existsSync(join(dir, s)))).toEqual([]);
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

/** Calls, in cli/src, of the raw `git` that @norn/store exports (imported as `rawGit` or `git`). */
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
  "packages/adapters/src/claude/shared.ts": 1, // agent settings files (2.3 moves them onto store atomicWrite)
  "packages/cli/src/runtime/act.ts": 1,
  "packages/cli/src/runtime/assets.ts": 2,
  "packages/cli/src/runtime/worktrees.ts": 1,
};

/** (b) raw git from store in cli: commands and runtime go through GitPort (4.1, 4.2). */
const RAW_GIT_ALLOW: Counts = {
  "packages/cli/src/commands/approve.ts": 1,
  "packages/cli/src/commands/done.ts": 1,
  "packages/cli/src/commands/take.ts": 4,
  "packages/cli/src/commands/tidy.ts": 4,
  "packages/cli/src/commands/watch.ts": 1,
  "packages/cli/src/runtime/act.ts": 2,
  "packages/cli/src/runtime/human.ts": 5,
  "packages/cli/src/runtime/observe.ts": 7,
  "packages/cli/src/runtime/record.ts": 10,
  "packages/cli/src/runtime/release.ts": 3,
  "packages/cli/src/runtime/worktrees.ts": 1,
};

/**
 * (c) S2: every JSON read is validated against @norn/schema, through store. Each entry says what it
 * parses: a norn file read unvalidated (the 1.4 target), tool output (stdout of herdr/gh/glab/a hook),
 * a file another tool owns, or a clone (stringify round-trip, not a read).
 */
const JSON_PARSE_ALLOW: Record<string, [number, string]> = {
  "packages/adapters/src/claude/shared.ts": [3, "files claude owns: settings.json, transcript jsonl"],
  "packages/adapters/src/git/exec.ts": [1, "tool output: gh/glab --json stdout"],
  "packages/adapters/src/herdr/cockpit.ts": [1, "tool output: herdr stdout"],
  "packages/adapters/src/herdr/index.ts": [2, "tool output: herdr stdout and error stderr"],
  "packages/cli/src/commands/done.ts": [2, "agent-written findings / criteria files (validated after)"],
  "packages/cli/src/commands/hook.ts": [2, "tool output: hook payload on stdin, hook command stdout"],
  "packages/cli/src/commands/why.ts": [1, "clone: canonical JSON for the replay diff"],
  "packages/cli/src/runtime/detect.ts": [1, "file another tool owns: the repo's package.json"],
  "packages/cli/src/runtime/human.ts": [2, "norn files: heartbeat.json (unvalidated), state.json from git show"],
  "packages/cli/src/runtime/inbox-history.ts": [1, "norn file read unvalidated (1.4)"],
  "packages/cli/src/runtime/local.ts": [1, "norn files read unvalidated: remote/records/… caches (BUG-4, 1.4)"],
  "packages/cli/src/runtime/observe.ts": [1, "norn file: hook lines of the trace jsonl"],
  "packages/cli/src/runtime/tick.ts": [1, "clone: trace-safe copy of facts"],
};

/** (d) processes are spawned by store and adapters only (ports perform effects). */
const SPAWN_ALLOW: Counts = {
  "packages/cli/src/commands/brief.ts": 1,
  "packages/cli/src/commands/doctor.ts": 1,
  "packages/cli/src/runtime/detect.ts": 1,
  "packages/cli/src/runtime/strays.ts": 1,
};

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

/** decide sources: decide.ts today, a decide/ folder after 6.1. */
function decideText(): string {
  const core = join(PKGS, "core", "src");
  const dir = join(core, "decide");
  const parts = existsSync(dir) ? files(dir) : [];
  if (existsSync(join(core, "decide.ts"))) parts.push(join(core, "decide.ts"));
  return parts.map((p) => readFileSync(p, "utf8")).join("\n");
}

/** (f) kinds act handles that decide never emits: dead branches, kept only until their removal item. */
const ACT_ONLY_KINDS = ["kill_run"]; // 1.5 deletes KillRunAction and its act case

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

  test("(f) act handles exactly the action kinds decide emits", () => {
    const kinds = literalKinds(readFileSync(join(PKGS, "core", "src", "actions.ts"), "utf8"));
    const emitted = [...literalKinds(decideText())].filter((k) => kinds.has(k));
    const handled = [...switchedKinds(readFileSync(join(PKGS, "cli", "src", "runtime", "act.ts"), "utf8"))];
    expect({
      unhandled: emitted.filter((k) => !handled.includes(k)).sort(),
      notAnAction: handled.filter((k) => !kinds.has(k)).sort(),
      neverEmitted: handled.filter((k) => kinds.has(k) && !emitted.includes(k)).sort(),
    }).toEqual({ unhandled: [], notAnAction: [], neverEmitted: [...ACT_ONLY_KINDS].sort() });
  });
});
