/** norn's own process setup: the repo's skills are named, linked and kept apart from the bundled ones. */
import { describe, expect, test } from "bun:test";
import { lstatSync, readdirSync, readFileSync, realpathSync } from "node:fs";
import { join } from "node:path";
import { parse } from "yaml";

const ROOT = join(import.meta.dir, "..", "..");
const AGENTS_SKILLS = join(ROOT, ".agents", "skills");
const CLAUDE_SKILLS = join(ROOT, ".claude", "skills");
const BUNDLED_SKILLS = join(ROOT, "packages", "pack-sdlc", "assets", "skills");

const PERSON_ONLY_SKILLS = ["issue", "release-start"];

function frontmatter(skill: string): Record<string, unknown> {
  const text = readFileSync(join(AGENTS_SKILLS, skill, "SKILL.md"), "utf8");
  const m = text.match(/^---\n([\s\S]*?)\n---\n/);
  if (!m) throw new Error(`${skill}/SKILL.md has no frontmatter`);
  return parse(m[1] as string) as Record<string, unknown>;
}

describe("repo skills", () => {
  const skills = readdirSync(AGENTS_SKILLS).filter((n) => !n.startsWith("."));

  test.each(skills)("%s: frontmatter name matches its folder, with a description", (skill) => {
    const fm = frontmatter(skill);
    expect({ name: fm.name, described: typeof fm.description === "string" && fm.description.length > 0 }).toEqual({ name: skill, described: true });
  });
  test.each(skills)("%s is linked for claude", (skill) => {
    const link = join(CLAUDE_SKILLS, skill);
    expect(lstatSync(link).isSymbolicLink()).toBe(true);
    expect(realpathSync(link)).toBe(realpathSync(join(AGENTS_SKILLS, skill)));
  });
  test.each(PERSON_ONLY_SKILLS)("%s is person-only", (skill) => {
    expect(frontmatter(skill)["disable-model-invocation"]).toBe(true);
  });
  test("repo-local skills never use the bundled norn- prefix", () => {
    const bundled = new Set(readdirSync(BUNDLED_SKILLS));
    expect(skills.filter((s) => s.startsWith("norn") && !bundled.has(s))).toEqual([]);
  });
});

describe("the agent guide's docs rule", () => {
  const agents = readFileSync(join(ROOT, "AGENTS.md"), "utf8");
  const start = agents.indexOf("\n## Rules\n");
  const end = agents.indexOf("\n## ", start + 1);
  const rules = start < 0 ? "" : agents.slice(start, end < 0 ? undefined : end);

  test("AGENTS.md's Rules hold the docs rule: a change a person or agent can notice updates its doc in the same PR, and the PR names the docs it touched or why none", () => {
    const rule = rules.split("\n").find((line) => line.startsWith("- **Docs.**")) ?? "";
    expect({
      present: rule !== "",
      noticeable: /a person or (an )?agent can notice/.test(rule),
      samePr: /in the same (pull request|PR)/.test(rule),
      named: /which docs it touched,? or why none/.test(rule),
    }).toEqual({ present: true, noticeable: true, samePr: true, named: true });
  });
});
