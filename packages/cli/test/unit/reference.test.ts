/** docs/reference.md's generated block is rendered from the cli and kept up to date. */
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { SDLC_PACK } from "@norn/pack-sdlc";
import { ExitCode } from "@norn/schema";
import { parse } from "yaml";
import { freshReference, ROOT } from "../../scripts/docs-emit.ts";
import { COMMANDS, NOUNS } from "../../src/commands/index.ts";
import { KernelKnobs } from "../../src/config/schema.ts";
import { configKeys, currentReference, durationText, KEY_DEFAULTS, REFERENCE_END, REFERENCE_FILE, REFERENCE_MARKERS, REFERENCE_START, replaceReference } from "../../src/reference.ts";

const fresh = freshReference();

describe("reference render", () => {
  test("every command and every noun verb has a heading with its usage, every option is listed", () => {
    for (const c of [...COMMANDS, ...NOUNS.flatMap((n) => n.verbs)]) {
      expect(fresh).toContain(`##### \`norn ${c.name}\`\n`);
      expect(fresh).toContain(c.usage);
      for (const k of Object.keys(c.options ?? {})) expect(fresh).toMatch(new RegExp(`^- \`[^\`\n]*--${k}(?![\\w-])`, "m"));
    }
    for (const n of NOUNS) expect(fresh).toContain(`##### \`norn ${n.name}\` (noun)`);
  });

  test("a person-only command says so under its heading, and no other command does", () => {
    const line = "A person's command: refused in an agent's session (`person_only`).";
    for (const c of [...COMMANDS, ...NOUNS.flatMap((n) => n.verbs)]) {
      const marked = fresh.includes(`##### \`norn ${c.name}\`\n\n${c.summary}\n\n${line}\n`);
      expect(marked, c.name).toBe(c.personOnly === true);
    }
  });

  test("every config key appears with its type, and the defaults come from the cli, the kernel and the runtime", () => {
    const { rows } = configKeys();
    for (const r of rows) expect(fresh).toMatch(new RegExp(`^\\| \`${r.key.replace(/[.<>]/g, "\\$&")}\` \\| `, "m"));
    expect(fresh).toContain('| `kernel.mode` | `"manual"` or `"auto"` | `"manual"` |');
    expect(fresh).toContain('| `vcs.use` | string | `"git"` |');
    expect(fresh).toContain('| `packs` | list of strings (one) | `["sdlc"]` |');
    expect(fresh).toContain('| `kernel.silent_after` | duration | `"15m"` |');
    expect(fresh).toContain('| `kernel.deadline` | duration or `"none"` | `"1h"` |');
    expect(fresh).toContain("| `executors.<name>.harness` | string | none |");
    expect(fresh).toContain("| `executor` | string | derived: the only executor |");
    expect(fresh).toMatch(/^Beside `use`, `tracker`, `forge`, `store`, `vcs`/m);
  });

  test("the evidence.publish key says what it publishes, who sees it and how to turn it off", () => {
    expect(fresh).toContain("| `evidence.publish` | boolean | `true` |");
    expect(fresh).toMatch(/^`evidence\.publish` keeps an agent QA report's evidence on `refs\/norn\/evidence\/<story>`.*as visible as the repo.*`false` keeps nothing.*forge-none never publishes.*\(#evidence\)/m);
  });

  test("the kernel.mode key says why init writes auto with the headless runner while the default is manual, and how to start in manual", () => {
    expect(fresh).toMatch(/^`kernel\.mode` is `"manual"` when no file sets it.*`norn init` writes `"auto"` with the headless runner.*`"manual"` with Herdr.*costs? money.*`norn config set kernel\.mode manual`/m);
  });

  test("every kernel knob has a default, and every default names a key the schema has", () => {
    const keys = new Set(configKeys().rows.map((r) => r.key));
    for (const k of Object.keys(KernelKnobs.properties).filter((k) => k !== "counters")) expect(KEY_DEFAULTS, k).toHaveProperty([`kernel.${k}`]);
    expect(Object.keys(KEY_DEFAULTS).filter((k) => !keys.has(k))).toEqual([]);
  });

  test("a duration is spelled in the largest unit that divides it", () => {
    expect([durationText(900_000), durationText(3_600_000), durationText(400_000), durationText(1_500), durationText(604_800_000)]).toEqual(["15m", "1h", "400s", "1500ms", "7d"]);
  });

  test("the commands a harness runs, its hooks and the lab's stand-in agent, are listed apart from a person's and an agent's", () => {
    const section = fresh.slice(fresh.indexOf("#### Called by a harness, not by hand"));
    const end = section.indexOf("\n#### ", 1);
    const headings = [...(end < 0 ? section : section.slice(0, end)).matchAll(/^##### `norn ([a-z-]+)`/gm)].map((m) => m[1]);
    expect(headings).toEqual(["hook", "lab-agent"]);
  });

  test("the shipped workflows and every exit code with its meaning", () => {
    for (const text of Object.values(SDLC_PACK.workflows)) expect(fresh).toMatch(new RegExp(`^- \`${(parse(text) as { name: string }).name}\`: \\S`, "m"));
    for (const [k, v] of Object.entries(ExitCode)) expect(fresh).toMatch(new RegExp(`^\\| ${v} \\| \`${k}\` \\| \\S`, "m"));
  });
});

describe("the generated block in the file", () => {
  test("replaceReference keeps the prose around the markers and replaces only the block", () => {
    const doc = `# Reference\n\nprose before\n\n${REFERENCE_START}\nold\n${REFERENCE_END}\n\nprose after\n`;
    const out = replaceReference(doc, `${REFERENCE_START}\nnew\n${REFERENCE_END}`, REFERENCE_MARKERS);
    expect(out).toBe(`# Reference\n\nprose before\n\n${REFERENCE_START}\nnew\n${REFERENCE_END}\n\nprose after\n`);
    expect(() => replaceReference("# no markers", "x", REFERENCE_MARKERS)).toThrow("no generated block");
  });

  test("the block helpers take a marker pair, so one file holds two generated blocks, each kept apart", () => {
    const other = { start: "<!-- other:start -->", end: "<!-- other:end -->" };
    const doc = `${REFERENCE_START}\nref\n${REFERENCE_END}\nprose\n${other.start}\nold\n${other.end}\n`;
    const out = replaceReference(doc, `${other.start}\nnew\n${other.end}`, other);
    expect(out).toBe(`${REFERENCE_START}\nref\n${REFERENCE_END}\nprose\n${other.start}\nnew\n${other.end}\n`);
    expect(currentReference(out, other)).toBe(`${other.start}\nnew\n${other.end}`);
    expect(currentReference(out, REFERENCE_MARKERS)).toBe(`${REFERENCE_START}\nref\n${REFERENCE_END}`);
    expect(currentReference("# none", other)).toBeUndefined();
    expect(() => replaceReference("# none", "x", other)).toThrow(other.start);
  });

  test(`${REFERENCE_FILE} is up to date (bun run docs:emit)`, () => {
    const block = currentReference(readFileSync(join(ROOT, REFERENCE_FILE), "utf8"), REFERENCE_MARKERS);
    expect(block, `${REFERENCE_FILE} is stale: run \`bun run docs:emit\` and commit the result`).toBe(fresh);
  });
});
