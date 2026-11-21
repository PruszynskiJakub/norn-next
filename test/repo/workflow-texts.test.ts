/**
 * What an agent step's text promises the agent is there: an input it points at is one the step lists,
 * and nothing points at a brief section that never carries what it names. Over the shipped workflows,
 * this repo's own copies (which replace them here) and the merge skill their resolvers use.
 */
import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { parse } from "yaml";

const ROOT = join(import.meta.dir, "..", "..");
const DIRS = [join(ROOT, "packages", "pack-sdlc", "assets", "workflows"), join(ROOT, ".agents", "workflows")];

function yamlFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true, recursive: true })
    .filter((e) => e.isFile() && e.name.endsWith(".yaml"))
    .map((e) => join(e.parentPath, e.name));
}

interface AgentStep {
  where: string;
  text: string;
  inputs: string[];
  skills: string[];
}

interface WrittenStep {
  by?: unknown;
  do?: unknown;
  with?: { skills?: unknown[] };
  reads?: unknown[];
  agent?: unknown;
  inputs?: unknown[];
  skills?: unknown[];
}

function agentSteps(): AgentStep[] {
  const out: AgentStep[] = [];
  for (const file of DIRS.flatMap(yamlFiles)) {
    const doc = parse(readFileSync(file, "utf8")) as { steps?: Record<string, WrittenStep> };
    for (const [name, step] of Object.entries(doc.steps ?? {})) {
      // an agent step names a role with by: (never person, shell or a namespaced kind), or, in the older form, says agent:
      const byRole = typeof step?.by === "string" && !["person", "shell"].includes(step.by) && !step.by.includes(".");
      const text = byRole ? step.do : step?.agent;
      if (typeof text !== "string") continue;
      const strings = (xs: unknown[] | undefined) => (xs ?? []).filter((i): i is string => typeof i === "string");
      // an optional read is written with a trailing ? and names the same input
      const inputs = strings(byRole ? step.reads : step.inputs).map((i) => i.replace(/\?$/, ""));
      const skills = strings(byRole ? step.with?.skills : step.skills);
      out.push({ where: `${relative(ROOT, file)}#${name}`, text, inputs, skills });
    }
  }
  return out;
}

describe("agent step texts", () => {
  test("an input a step's text names is one the step lists", () => {
    const steps = agentSteps();
    expect(steps.length).toBeGreaterThan(0);
    const missing = steps.flatMap((s) => [...s.text.matchAll(/the (\w+) input/g)].map((m) => m[1] as string).filter((i) => !s.inputs.includes(i)).map((i) => `${s.where}: ${i}`));
    expect(missing).toEqual([]);
  });

  test("a step that resolves a merge lists base_side, the only input that names the commit to merge and the conflicting paths", () => {
    const resolvers = agentSteps().filter((s) => s.skills.includes("norn-merge"));
    expect(resolvers.map((s) => s.where)).toEqual(expect.arrayContaining([expect.stringMatching(/slice\.yaml#merge$/), expect.stringMatching(/release\.yaml#resolve$/)]));
    expect(resolvers.filter((s) => !s.inputs.includes("base_side")).map((s) => s.where)).toEqual([]);
  });

  test("no step looks for the base commit under Rework, which carries findings and never a base commit", () => {
    expect(agentSteps().filter((s) => /named in Rework/.test(s.text)).map((s) => s.where)).toEqual([]);
  });

  test("the merge skill finds its base commit in the base_side input its steps list, not in a Rework or Base update section", () => {
    const skill = readFileSync(join(ROOT, "packages", "pack-sdlc", "assets", "skills", "norn-merge", "SKILL.md"), "utf8");
    expect(skill).toContain("`base_side`");
    expect(skill).not.toMatch(/Rework section|Base update section|\(Rework:/);
  });

  test("the merge skill has a mode for a resolver a resolution review sent back, which merges nothing", () => {
    const skill = readFileSync(join(ROOT, "packages", "pack-sdlc", "assets", "skills", "norn-merge", "SKILL.md"), "utf8");
    const row = skill.split("\n").find((l) => l.startsWith("|") && l.includes("findings under Rework"));
    expect(row).toContain("Merge nothing");
  });
});
