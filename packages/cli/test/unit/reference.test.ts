/** gh-162 B8–B13: docs/reference.md's generated block is rendered from the cli and kept up to date. */
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { ExitCode, explainConfig } from "@norn/schema";
import { freshReference, ROOT } from "../../scripts/docs-emit.ts";
import { COMMANDS, NOUNS } from "../../src/commands/index.ts";
import { currentReference, REFERENCE_END, REFERENCE_FILE, REFERENCE_START, replaceReference } from "../../src/reference.ts";

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

  test("every config key of the built-in config appears with its type and default", () => {
    for (const e of explainConfig()) {
      const key = e.key.startsWith("agents.") ? "agents" : e.key;
      expect(fresh).toContain(`| \`${key}\` |`);
    }
    expect(fresh).toContain('| `default_mode` | `"manual"` or `"auto"` | `"manual"` |');
  });

  test("types come from the config schema, nested keys included (B9)", () => {
    expect(fresh).toContain("| `runner` | map or null | `null` |");
    expect(fresh).toContain("| `base_branch` | string or null | `null` |");
    expect(fresh).toContain("| `max_agents` | integer ≥ 1 | `2` |");
    expect(fresh).toContain("| `limits.deadline` | duration | `\"60m\"` |");
    for (const k of ["adapter", "command", "args", "model", "env", "capabilities"]) expect(fresh).toContain(`| \`agents.<name>.${k}\` |`);
    for (const k of ["runner.adapter", "runner.options", "notifiers[].adapter", "notifiers[].options", "slots.env"]) expect(fresh).toContain(`| \`${k}\` |`);
    expect(fresh).not.toContain("$schema");
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
