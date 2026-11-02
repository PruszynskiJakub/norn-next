/** gh-162 B8–B13: docs/reference.md's generated block is rendered from the cli and kept up to date. */
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { CONFIG_SCHEMAS, ExitCode } from "@norn/schema";
import { freshReference, ROOT } from "../../scripts/docs-emit.ts";
import { COMMANDS, NOUNS } from "../../src/commands/index.ts";
import { currentReference, FILE_LABEL, REFERENCE_END, REFERENCE_FILE, REFERENCE_START, replaceReference } from "../../src/reference.ts";

const fresh = freshReference();

describe("Reference render (B8, B9, B13)", () => {
  test("every command and every noun verb has a heading with its usage, every option is listed", () => {
    for (const c of [...COMMANDS, ...NOUNS.flatMap((n) => n.verbs)]) {
      expect(fresh).toContain(`##### \`norn ${c.name}\`\n`);
      expect(fresh).toContain(c.usage);
      for (const k of Object.keys(c.options ?? {})) expect(fresh).toMatch(new RegExp(`^- \`[^\`\n]*--${k}(?![\\w-])`, "m"));
    }
    for (const n of NOUNS) expect(fresh).toContain(`##### \`norn ${n.name}\` (noun)`);
  });

  test("spec ids are stripped from summaries, as norn help does", () => {
    expect(fresh).not.toMatch(/\(B30–B32, MO1, W9, S7\)/);
  });

  test("every key of the three config files appears with the files that take it (gh-64 B1, B2)", () => {
    const keys = (schema: unknown, prefix = ""): string[] =>
      Object.entries((schema as { properties?: Record<string, unknown> }).properties ?? {})
        .filter(([k]) => k !== "$schema")
        .flatMap(([k, child]) => {
          const nested = keys(child, `${prefix}${k}.`);
          return nested.length ? nested : [`${prefix}${k}`];
        });
    for (const [kind, schema] of Object.entries(CONFIG_SCHEMAS)) {
      for (const key of keys(schema)) expect(fresh).toMatch(new RegExp(`^\\| \`${key.replace(/\./g, "\\.")}\` \\| [^|\n]*${FILE_LABEL[kind as keyof typeof FILE_LABEL]}`, "m"));
    }
  });

  test("types and defaults come from the file schemas and the built-in config (B9)", () => {
    expect(fresh).toContain('| `mode` | user, local | `"manual"` or `"auto"` | `"manual"` |');
    expect(fresh).toContain("| `max_agents` | user | integer 1–9 | `9` |");
    expect(fresh).toContain('| `agents.claude.args` | user, local | list of strings | `["--permission-mode","auto"]` |');
    expect(fresh).toContain('| `provider` | team | `"gh"` or `"glab"` | `"gh"` |');
    expect(fresh).toContain("| `base_branch` | team | string or null | `null` |");
    expect(fresh).toContain('| `trace.retain` | user | duration | `"14d"` |');
    expect(fresh).toContain("| `notify.os` | user | boolean | `true` |");
    expect(fresh).toContain("| `notify.ntfy` | user | URL | none |");
    expect(fresh).not.toContain("$schema");
  });

  test("no key gh-64 removed is listed (B52)", () => {
    for (const k of ["runner", "remote.", "default_mode", "default_agent", "default_workflow", "default_slice_workflow", "limits.", "slots.", "notifiers", "claim.", "watch_interval", "max_checks", "capabilities"])
      expect(fresh).not.toMatch(new RegExp(`^\\| \`${k.replace(/\./g, "\\.")}`, "m"));
  });

  test("the shipped workflows and every exit code", () => {
    for (const w of ["triage", "reproduce", "refinement", "story", "slice", "quick"]) expect(fresh).toMatch(new RegExp(`^- \`${w}\`: \\S`, "m"));
    for (const [k, v] of Object.entries(ExitCode)) expect(fresh).toContain(`| ${v} | \`${k}\` |`);
    expect(fresh).toContain("| 3 | `refused` |");
  });
});

describe("the generated block in the file (B10, B11, B12)", () => {
  test("replaceReference keeps the prose around the markers and replaces only the block", () => {
    const doc = `# Reference\n\nprose before\n\n${REFERENCE_START}\nold\n${REFERENCE_END}\n\nExit codes: prose after\n`;
    const out = replaceReference(doc, `${REFERENCE_START}\nnew\n${REFERENCE_END}`);
    expect(out).toBe(`# Reference\n\nprose before\n\n${REFERENCE_START}\nnew\n${REFERENCE_END}\n\nExit codes: prose after\n`);
    expect(() => replaceReference("# no markers", "x")).toThrow("no generated block");
  });

  test(`${REFERENCE_FILE} is up to date (bun run docs:emit)`, () => {
    const block = currentReference(readFileSync(join(ROOT, REFERENCE_FILE), "utf8"));
    expect(block, `${REFERENCE_FILE} is stale: run \`bun run docs:emit\` and commit the result`).toBe(fresh);
  });
});
