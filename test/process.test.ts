/** norn's own process setup: the repo's workflows, config and skills load as norn would load them (W5, SK1). */
import { describe, expect, test } from "bun:test";
import { lstatSync, mkdtempSync, readdirSync, readFileSync, realpathSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parse } from "yaml";
import { checkWorkflowLevel, validateWorkflowDefinition } from "../packages/core/src/index.ts";
import { loadConfig, loadWorkflows, visibleSkills } from "../packages/store/src/index.ts";

const ROOT = join(import.meta.dir, "..");
const AGENTS_SKILLS = join(ROOT, ".agents", "skills");
const CLAUDE_SKILLS = join(ROOT, ".claude", "skills");

/** Workflows that end in `integrate` run on slices (W8); every other one is a story workflow. */
const SLICE_WORKFLOWS = new Set(["slice", "bug"]);
const PERSON_ONLY_SKILLS = ["issue", "release-start"];

function frontmatter(skill: string): Record<string, unknown> {
  const text = readFileSync(join(AGENTS_SKILLS, skill, "SKILL.md"), "utf8");
  const m = text.match(/^---\n([\s\S]*?)\n---\n/);
  if (!m) throw new Error(`${skill}/SKILL.md has no frontmatter`);
  return parse(m[1] as string) as Record<string, unknown>;
}

describe("repo config", () => {
  test("loads, with triage as the default workflow", () => {
    const loaded = loadConfig({ repoRoot: ROOT, home: mkdtempSync(join(tmpdir(), "norn-home-")) });
    expect(loaded.ok ? loaded.config.default_workflow : loaded.errors).toBe("triage");
  });
});

describe("repo workflows", () => {
  const listing = loadWorkflows(ROOT);
  const claude = visibleSkills(CLAUDE_SKILLS);

  test("load without errors", () => {
    expect(listing.errors).toEqual([]);
  });
  test("include the five story workflows of the process, and no fix or spec", () => {
    const names = Object.keys(listing.workflows);
    for (const name of ["triage", "reproduce", "story", "quick", "release"]) expect(names).toContain(name);
    expect(names.filter((n) => n === "fix" || n === "spec")).toEqual([]);
  });
  test.each(Object.keys(listing.workflows))("%s is valid for claude with the linked skills", (name) => {
    const result = validateWorkflowDefinition(listing.workflows[name]!.workflow, {
      agentSkills: { default_agent: "claude", visible: { claude } },
    });
    expect(result.ok ? [] : result.issues).toEqual([]);
    if (result.ok) expect(checkWorkflowLevel(result.workflow, SLICE_WORKFLOWS.has(name) ? "slice" : "story")).toEqual([]);
  });
});

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
    const bundled = new Set(readdirSync(join(ROOT, "packages", "cli", "assets", "skills")));
    expect(skills.filter((s) => s.startsWith("norn") && !bundled.has(s))).toEqual([]);
  });
});
