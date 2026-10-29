/** Repo-wide rules: dependency direction (§17) and banned glossary synonyms (§5). */
import { describe, expect, test } from "bun:test";
import { chmodSync, existsSync, mkdtempSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
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

  test("test:fast and test:cli split the suite: fast skips exactly the folder cli runs, and slice, story and quick checks run fast", () => {
    const scripts: Record<string, string> = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8")).scripts;
    const cliDir = scripts["test:cli"]?.match(/^bun test \.\/(\S+)$/)?.[1];
    const ignored = scripts["test:fast"]?.match(/^bun test --path-ignore-patterns='(\S+)\/\*\*'$/)?.[1];
    expect({ test: scripts.test, cliDir, ignored }).toEqual({ test: "bun test", cliDir: "packages/cli/test", ignored: "packages/cli" });
    const run = (wf: string) => readFileSync(join(ROOT, ".agents", "norn", "workflows", `${wf}.yaml`), "utf8").match(/^ {4}run: "(.*)"$/m)?.[1];
    expect(["slice", "bug", "story", "quick"].map(run)).toEqual(Array(4).fill("bun install --frozen-lockfile && bun run test:fast && bun run typecheck"));
    expect(["fix"].map(run)).toEqual(["bun install --frozen-lockfile && bun run test && bun run typecheck"]);
  });

  test("quick and story wait for the PR's CI after open-pr and send a red run back to implement", () => {
    for (const wf of ["quick", "story"]) {
      const { steps, counters } = Bun.YAML.parse(readFileSync(join(ROOT, ".agents", "norn", "workflows", `${wf}.yaml`), "utf8")) as {
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
    const { start, steps, counters, base } = Bun.YAML.parse(readFileSync(join(ROOT, ".agents", "norn", "workflows", "release.yaml"), "utf8")) as {
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

  test("no removed command in sources, assets, plugins, skills, README, CONTRIBUTING, AGENTS.md, the PRD and its SPEC files", () => {
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

describe("herdr plugin (HC9)", () => {
  test("the manifest parses, has the pick pane and the open/next/pick actions, and names only scripts that exist", () => {
    const dir = join(ROOT, "plugins", "herdr");
    const m = Bun.TOML.parse(readFileSync(join(dir, "herdr-plugin.toml"), "utf8")) as {
      id: string;
      panes: Array<{ id: string; command: string[] }>;
      actions: Array<{ id: string; command: string[] }>;
    };
    expect(m.id).toBe("norn");
    expect(m.panes.map((p) => p.id)).toEqual(["pick"]);
    expect(m.actions.map((a) => a.id)).toEqual(["open", "next", "pick"]);
    const scripts = [...m.panes, ...m.actions].map((e) => e.command.at(-1) as string);
    expect(scripts.filter((s) => !existsSync(join(dir, s)))).toEqual([]);
  });

  test("B8: the actions and panes run the new commands", () => {
    const run = (script: string) => readFileSync(join(ROOT, "plugins", "herdr", script), "utf8");
    expect(run("next.sh")).toContain(`"$NORN" run attach --next --json`);
    expect(run("open.sh")).toContain(`"$NORN" status --watch --pane`);
    expect(run("pick.sh")).toContain(`"$NORN" status --watch >`);
  });

  /** Runs next.sh with a stub norn that refuses with `refusal` and a stub herdr that records the toast. */
  function nextToast(refusal: object): string {
    const dir = mkdtempSync(join(tmpdir(), "norn-next-"));
    const stub = (name: string, body: string) => {
      writeFileSync(join(dir, name), `#!/bin/sh\n${body}\n`);
      chmodSync(join(dir, name), 0o755);
      return join(dir, name);
    };
    writeFileSync(join(dir, "refusal.json"), JSON.stringify(refusal));
    const env = {
      ...process.env,
      NORN_BIN: stub("norn", `cat "${dir}/refusal.json"; exit 3`),
      HERDR_BIN_PATH: stub("herdr", `printf '%s|' "$@" > "${dir}/toast"`),
      HERDR_PLUGIN_CONTEXT_JSON: JSON.stringify({ focused_pane_cwd: dir }),
    };
    Bun.spawnSync(["sh", join(ROOT, "plugins", "herdr", "next.sh")], { env });
    return readFileSync(join(dir, "toast"), "utf8");
  }

  test("P8: next.sh branches on the refusal's code, not its text, and keeps escaped quotes", () => {
    const attach = nextToast({ error: 'no live agent pane for "gh-1/01"', do_instead: "norn story start gh-1/01", code: "nothing_to_attach" });
    expect(attach).toContain('no live agent pane for \\"gh-1/01\\"; run: norn story start gh-1/01|');
    const other = nextToast({ error: "No agent waits for you", do_instead: "norn status", code: "not_in_herdr" });
    expect(other).toContain("norn run attach --next failed in ");
    expect(other).toContain(": No agent waits for you|");
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
