/** norn's own process setup: the repo's workflows, config and skills load as norn would load them. */
import { describe, expect, test } from "bun:test";
import { cpSync, existsSync, lstatSync, mkdtempSync, readdirSync, readFileSync, realpathSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parse } from "yaml";
import { checkWorkflowLevel, validateWorkflowDefinition, workflowHash } from "../../packages/core/src/index.ts";
import { loadConfig, loadWorkflows, repoConfigPath, visibleSkills, workflowsDir } from "../../packages/store/src/index.ts";

const ROOT = join(import.meta.dir, "..", "..");
/**
 * This repo stays on the old layout until a released norn can migrate it (gh-110, out of scope), and
 * store reads only the new one: until then its config and workflows are read from a copy at the new
 * paths. Once `.agents/norn/` is gone this is ROOT.
 */
const OLD_DIR = join(ROOT, ".agents", "norn");
const CONFIG_ROOT = existsSync(OLD_DIR) ? newLayoutCopy() : ROOT;

function newLayoutCopy(): string {
  const root = mkdtempSync(join(tmpdir(), "norn-process-"));
  cpSync(join(OLD_DIR, "config.yaml"), repoConfigPath(root));
  cpSync(join(OLD_DIR, "workflows"), workflowsDir(root), { recursive: true });
  return root;
}
const AGENTS_SKILLS = join(ROOT, ".agents", "skills");
const CLAUDE_SKILLS = join(ROOT, ".claude", "skills");

/** Workflows that end in `integrate` run on slices; every other one is a story workflow. */
const SLICE_WORKFLOWS = new Set(["slice"]);
const PERSON_ONLY_SKILLS = ["issue", "release-start"];
/**
 * The meaning of each repo workflow a rewrite must keep, taken from the loader on the base before it: a
 * changed route, counter or instruction changes the hash, formatting and key order never do.
 */
const PINNED_HASHES: Record<string, string> = {
  quick: "423a7af61633bdf264ca0f3198899b7179fe8b1dd577e6776f291dee49207d0b",
  story: "41a88e61e5fb3f84c704c8f1efed7d2f0850fce9acd22faf6349fdf0ece945b3",
  release: "8032f58290802bb801afd45308ccb2d785a3d61847d513cadda4bfe8ff60c682",
};

function frontmatter(skill: string): Record<string, unknown> {
  const text = readFileSync(join(AGENTS_SKILLS, skill, "SKILL.md"), "utf8");
  const m = text.match(/^---\n([\s\S]*?)\n---\n/);
  if (!m) throw new Error(`${skill}/SKILL.md has no frontmatter`);
  return parse(m[1] as string) as Record<string, unknown>;
}

describe("repo config", () => {
  test("loads, with triage as the default workflow", () => {
    const loaded = loadConfig({ repoRoot: CONFIG_ROOT, home: mkdtempSync(join(tmpdir(), "norn-home-")) });
    expect(loaded.ok ? loaded.config.workflow : loaded.errors).toBe("triage");
  });
});

describe("repo workflows", () => {
  const listing = loadWorkflows(CONFIG_ROOT);
  const claude = visibleSkills(CLAUDE_SKILLS);

  test("load without errors", () => {
    expect(listing.errors).toEqual([]);
  });
  test.each(Object.keys(PINNED_HASHES))("%s keeps its pinned meaning", (name) => {
    expect(workflowHash(listing.workflows[name]!.workflow)).toBe(PINNED_HASHES[name] as string);
  });
  test("are the six shipped workflows plus release, and no bug, fix or spec", () => {
    expect(Object.keys(listing.workflows).sort()).toEqual(["quick", "refinement", "release", "reproduce", "slice", "story", "triage"]);
  });
  test.each(Object.keys(listing.workflows))("%s is valid for claude with the linked skills", (name) => {
    const result = validateWorkflowDefinition(listing.workflows[name]!.workflow, {
      agentSkills: { agent: "claude", visible: { claude } },
    });
    expect(result.ok ? [] : result.issues).toEqual([]);
    if (result.ok) expect(checkWorkflowLevel(result.workflow, SLICE_WORKFLOWS.has(name) ? "slice" : "story")).toEqual([]);
  });
  test("the CI wait is written once, in a shared file, and every workflow in the folder still loads", () => {
    const dir = workflowsDir(CONFIG_ROOT);
    const files = [
      ...readdirSync(dir).filter((f) => f.endsWith(".yaml")),
      ...readdirSync(join(dir, "shared")).filter((f) => f.endsWith(".yaml")).map((f) => `shared/${f}`),
    ];
    expect(files.filter((f) => readFileSync(join(dir, f), "utf8").includes("gh run watch"))).toEqual(["shared/ci.yaml"]);
    expect(listing.errors).toEqual([]);
  });
  test("story's and quick's resolve take the base side of each conflict, as the shipped copies do", () => {
    for (const name of ["story", "quick"]) expect((listing.workflows[name]!.workflow.steps.resolve as { inputs?: unknown[] }).inputs).toContain("base_side");
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
